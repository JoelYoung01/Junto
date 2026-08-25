use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use uuid::Uuid;

use crate::error::{JuntoError, Result};
use crate::media::MediaKind;
use crate::paths::outputs_dir;
use crate::project::{ExportProgress, ExportSettings, Project};
use crate::timeline::{Clip, Timeline, TrackKind};

const EPS: f64 = 1e-6;

struct TempDirGuard(PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn escape_concat_path(path: &Path) -> String {
    path.display().to_string().replace('\'', "'\\''")
}

#[derive(Debug, Clone)]
enum VisualPiece {
    Black { duration: f64 },
    Clip { clip: Clip, duration: f64, source_time: f64 },
}

pub fn export_timeline_blocking(
    project: &Project,
    on_progress: Option<&dyn Fn(ExportProgress)>,
) -> Result<PathBuf> {
    let settings = &project.file.export_settings;
    let timeline = &project.file.timeline;
    let total = timeline.duration().max(0.1);

    let has_visual = timeline
        .clips
        .iter()
        .any(|c| matches!(c.media_kind, MediaKind::Video | MediaKind::Image));
    if !has_visual {
        return Err(JuntoError::Export(
            "timeline has no video or image clips".into(),
        ));
    }

    fs::create_dir_all(outputs_dir(&project.root))?;
    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let output = outputs_dir(&project.root).join(format!("export_{timestamp}.mp4"));

    let temp_dir = project
        .root
        .join(".junto")
        .join("export_tmp")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&temp_dir)?;
    let _temp_guard = TempDirGuard(temp_dir.clone());

    let report = |progress: f32, message: &str| {
        if let Some(cb) = on_progress {
            cb(ExportProgress {
                done: false,
                progress,
                message: message.into(),
                output_path: None,
                error: None,
            });
        }
    };

    report(0.05, "Preparing export...");

    let visual_pieces = build_visual_pieces(timeline, total);
    let visual_segments: Vec<PathBuf> = visual_pieces
        .iter()
        .enumerate()
        .map(|(idx, piece)| {
            let progress = 0.1 + 0.55 * (idx as f32 / visual_pieces.len().max(1) as f32);
            report(progress, &format!("Rendering visual segment {}…", idx + 1));
            render_visual_piece(project, settings, &temp_dir, idx, piece)
        })
        .collect::<Result<Vec<_>>>()?;

    let video_only = temp_dir.join("video_only.mp4");
    concat_video_segments(&visual_segments, &video_only, settings)?;

    report(0.72, "Mixing audio...");

    let audio_clips: Vec<Clip> = timeline
        .clips
        .iter()
        .filter(|c| {
            matches!(c.media_kind, MediaKind::Audio)
                || (matches!(c.media_kind, MediaKind::Video)
                    && timeline
                        .track(c.track_id)
                        .map(|t| t.kind == TrackKind::Video)
                        .unwrap_or(false))
        })
        .cloned()
        .collect();

    let final_output = if audio_clips.is_empty() {
        report(0.88, "Finalizing export...");
        fs::copy(&video_only, &output).map_err(JuntoError::Io)?;
        output
    } else {
        let mixed_audio = temp_dir.join("mixed_audio.m4a");
        mix_audio_clips(project, settings, &temp_dir, &audio_clips, total, &mixed_audio)?;
        report(0.88, "Muxing video and audio...");
        mux_video_audio(&video_only, &mixed_audio, &output, settings, total)?;
        output
    };

    if let Some(cb) = on_progress {
        cb(ExportProgress {
            done: false,
            progress: 0.98,
            message: "Export complete".into(),
            output_path: Some(final_output.to_string_lossy().into()),
            error: None,
        });
    }

    Ok(final_output)
}

fn build_visual_pieces(timeline: &Timeline, total: f64) -> Vec<VisualPiece> {
    let mut breakpoints = vec![0.0, total];
    for clip in &timeline.clips {
        if matches!(clip.media_kind, MediaKind::Video | MediaKind::Image) {
            breakpoints.push(clip.start);
            breakpoints.push((clip.start + clip.duration).min(total));
        }
    }
    breakpoints.sort_by(|a, b| a.partial_cmp(b).unwrap());
    breakpoints.dedup_by(|a, b| (*a - *b).abs() < EPS);

    let mut pieces = Vec::new();
    for window in breakpoints.windows(2) {
        let seg_start = window[0];
        let seg_end = window[1];
        let duration = seg_end - seg_start;
        if duration <= EPS {
            continue;
        }
        let mid = seg_start + duration / 2.0;
        if let Some(clip) = top_visual_clip_at(timeline, mid) {
            let source_time = (seg_start - clip.start + clip.source_offset).max(0.0);
            pieces.push(VisualPiece::Clip {
                clip: clip.clone(),
                duration,
                source_time,
            });
        } else {
            pieces.push(VisualPiece::Black { duration });
        }
    }

    merge_adjacent_visual_pieces(pieces)
}

fn merge_adjacent_visual_pieces(pieces: Vec<VisualPiece>) -> Vec<VisualPiece> {
    let mut merged: Vec<VisualPiece> = Vec::new();
    for piece in pieces {
        match (merged.last_mut(), &piece) {
            (Some(VisualPiece::Black { duration: d1 }), VisualPiece::Black { duration: d2 }) => {
                *d1 += d2;
            }
            (
                Some(VisualPiece::Clip {
                    clip: c1,
                    duration: d1,
                    source_time: t1,
                }),
                VisualPiece::Clip {
                    clip: c2,
                    duration: d2,
                    source_time: t2,
                },
            ) if c1.id == c2.id && (*t1 + *d1 - t2).abs() < 0.05 => {
                *d1 += d2;
            }
            _ => merged.push(piece),
        }
    }
    merged
}

fn top_visual_clip_at<'a>(timeline: &'a Timeline, t: f64) -> Option<&'a Clip> {
    timeline
        .clips
        .iter()
        .filter(|c| matches!(c.media_kind, MediaKind::Video | MediaKind::Image))
        .filter(|c| t + EPS >= c.start && t < c.start + c.duration - EPS)
        .min_by_key(|c| {
            timeline
                .tracks
                .iter()
                .find(|tr| tr.id == c.track_id)
                .map(|tr| tr.index)
                .unwrap_or(u32::MAX)
        })
}

fn render_visual_piece(
    project: &Project,
    settings: &ExportSettings,
    temp_dir: &Path,
    idx: usize,
    piece: &VisualPiece,
) -> Result<PathBuf> {
    let seg = temp_dir.join(format!("vseg_{idx}.mp4"));
    let vf = format!(
        "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        settings.width, settings.height, settings.width, settings.height
    );

    let status = match piece {
        VisualPiece::Black { duration } => Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!(
                    "color=c=black:s={}x{}:d={duration}",
                    settings.width, settings.height
                ),
                "-r",
                &settings.fps.to_string(),
                "-c:v",
                &settings.video_codec,
                "-pix_fmt",
                "yuv420p",
                "-an",
                &seg.to_string_lossy(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| JuntoError::Export(e.to_string()))?,
        VisualPiece::Clip {
            clip,
            duration,
            source_time,
        } => {
            let source = project.resolve_path(&clip.source_path);
            if !source.exists() {
                return Err(JuntoError::Export(format!(
                    "missing source file: {}",
                    source.display()
                )));
            }
            match clip.media_kind {
                MediaKind::Image => {
                    let mut args = vec![
                        "-y".to_string(),
                        "-loop".to_string(),
                        "1".to_string(),
                    ];
                    if *source_time > EPS {
                        args.extend([
                            "-ss".to_string(),
                            source_time.max(0.0).to_string(),
                        ]);
                    }
                    args.extend([
                        "-i".to_string(),
                        source.to_string_lossy().into(),
                        "-t".to_string(),
                        duration.max(0.1).to_string(),
                        "-vf".to_string(),
                        vf.clone(),
                        "-r".to_string(),
                        settings.fps.to_string(),
                        "-c:v".to_string(),
                        settings.video_codec.clone(),
                        "-pix_fmt".to_string(),
                        "yuv420p".to_string(),
                        "-an".to_string(),
                        seg.to_string_lossy().into(),
                    ]);
                    Command::new("ffmpeg")
                        .args(&args)
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status()
                        .map_err(|e| JuntoError::Export(e.to_string()))?
                }
                MediaKind::Video => Command::new("ffmpeg")
                    .args([
                        "-y",
                        "-ss",
                        &source_time.max(0.0).to_string(),
                        "-i",
                        &source.to_string_lossy(),
                        "-t",
                        &duration.max(0.1).to_string(),
                        "-vf",
                        &vf,
                        "-r",
                        &settings.fps.to_string(),
                        "-c:v",
                        &settings.video_codec,
                        "-pix_fmt",
                        "yuv420p",
                        "-an",
                        &seg.to_string_lossy(),
                    ])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .map_err(|e| JuntoError::Export(e.to_string()))?,
                MediaKind::Audio => {
                    return Err(JuntoError::Export("unexpected audio in visual piece".into()))
                }
            }
        }
    };

    if !status.success() {
        return Err(JuntoError::Export(format!(
            "ffmpeg visual segment {idx} failed"
        )));
    }
    Ok(seg)
}

fn concat_video_segments(
    segments: &[PathBuf],
    output: &Path,
    settings: &ExportSettings,
) -> Result<()> {
    let list_file = output.with_extension("txt");
    let mut list_contents = String::new();
    for seg in segments {
        list_contents.push_str(&format!("file '{}'\n", escape_concat_path(seg)));
    }
    fs::write(&list_file, list_contents)?;

    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_file.to_string_lossy(),
            "-c:v",
            &settings.video_codec,
            "-pix_fmt",
            "yuv420p",
            "-an",
            &output.to_string_lossy(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| JuntoError::Export(e.to_string()))?;

    let _ = fs::remove_file(&list_file);
    if !status.success() {
        return Err(JuntoError::Export("ffmpeg video concat failed".into()));
    }
    Ok(())
}

fn mix_audio_clips(
    project: &Project,
    settings: &ExportSettings,
    temp_dir: &Path,
    clips: &[Clip],
    total: f64,
    output: &Path,
) -> Result<()> {
    if clips.is_empty() {
        return Err(JuntoError::Export("no audio clips to mix".into()));
    }

    let mut inputs: Vec<String> = Vec::new();
    let mut filter_parts: Vec<String> = Vec::new();
    let mut input_idx = 0usize;

    for (clip_idx, clip) in clips.iter().enumerate() {
        let source = project.resolve_path(&clip.source_path);
        if !source.exists() {
            return Err(JuntoError::Export(format!(
                "missing audio source: {}",
                source.display()
            )));
        }
        let wav = temp_dir.join(format!("aseg_{clip_idx}.wav"));
        let status = Command::new("ffmpeg")
            .args([
                "-y",
                "-ss",
                &clip.source_offset.to_string(),
                "-i",
                &source.to_string_lossy(),
                "-t",
                &clip.duration.max(0.1).to_string(),
                "-vn",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-c:a",
                "pcm_s16le",
                &wav.to_string_lossy(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| JuntoError::Export(e.to_string()))?;
        if !status.success() {
            return Err(JuntoError::Export(format!(
                "ffmpeg audio extract failed for {}",
                source.display()
            )));
        }

        inputs.push("-i".into());
        inputs.push(wav.to_string_lossy().into());
        let delay_ms = (clip.start * 1000.0).round() as i64;
        filter_parts.push(format!(
            "[{input_idx}:a]adelay={delay_ms}|{delay_ms}[a{clip_idx}]"
        ));
        input_idx += 1;
    }

    let mix_inputs: String = (0..clips.len())
        .map(|i| format!("[a{i}]"))
        .collect();
    let filter = format!(
        "{};{mix_inputs}amix=inputs={}:duration=longest:dropout_transition=0[aout]",
        filter_parts.join(";"),
        clips.len()
    );

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-y");
    for arg in &inputs {
        cmd.arg(arg);
    }
    let status = cmd
        .args([
            "-filter_complex",
            &filter,
            "-map",
            "[aout]",
            "-t",
            &total.to_string(),
            "-c:a",
            &settings.audio_codec,
            &output.to_string_lossy(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| JuntoError::Export(e.to_string()))?;

    if !status.success() {
        return Err(JuntoError::Export("ffmpeg audio mix failed".into()));
    }
    Ok(())
}

fn mux_video_audio(
    video: &Path,
    audio: &Path,
    output: &Path,
    settings: &ExportSettings,
    total: f64,
) -> Result<()> {
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &video.to_string_lossy(),
            "-i",
            &audio.to_string_lossy(),
            "-t",
            &total.to_string(),
            "-c:v",
            &settings.video_codec,
            "-crf",
            &settings.crf.to_string(),
            "-c:a",
            &settings.audio_codec,
            "-movflags",
            "+faststart",
            &output.to_string_lossy(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| JuntoError::Export(e.to_string()))?;

    if !status.success() {
        return Err(JuntoError::Export("ffmpeg mux failed".into()));
    }
    Ok(())
}
