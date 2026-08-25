use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{JuntoError, Result};
use crate::filesystem::{
    consolidate_media_into_raw_footage, ensure_project_layout, import_media_into_raw_footage,
    list_raw_footage, project_exists, scan_project_directory, DirectoryScan,
};
use crate::media::MediaKind;
use crate::paths::{outputs_dir, project_file};
use crate::probe::probe_duration;
use crate::timeline::{Clip, Timeline, TrackKind};

pub const PROJECT_FORMAT_VERSION: u32 = 1;
pub const DEFAULT_PHOTO_DURATION: f64 = 3.0;
/// Fallback duration when `ffprobe` is unavailable or fails for video/audio.
pub const FALLBACK_AV_DURATION: f64 = 5.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSettings {
    pub width: u32,
    pub height: u32,
    pub video_codec: String,
    pub audio_codec: String,
    pub crf: u8,
    pub fps: u32,
}

impl Default for ExportSettings {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            video_codec: "libx264".into(),
            audio_codec: "aac".into(),
            crf: 20,
            fps: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProgress {
    pub done: bool,
    pub progress: f32,
    pub message: String,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFile {
    pub format_version: u32,
    pub id: Uuid,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub timeline: Timeline,
    pub photo_default_duration: f64,
    pub export_settings: ExportSettings,
}

#[derive(Debug)]
pub struct Project {
    pub root: PathBuf,
    pub file: ProjectFile,
}

impl Project {
    pub fn create(root: PathBuf, name: String) -> Result<Self> {
        ensure_project_layout(&root)?;
        let now = Utc::now().to_rfc3339();
        let file = ProjectFile {
            format_version: PROJECT_FORMAT_VERSION,
            id: Uuid::new_v4(),
            name,
            created_at: now.clone(),
            updated_at: now,
            timeline: Timeline::new(),
            photo_default_duration: DEFAULT_PHOTO_DURATION,
            export_settings: ExportSettings::default(),
        };
        let project = Self { root, file };
        project.save()?;
        Ok(project)
    }

    pub fn open(root: PathBuf) -> Result<Self> {
        if !project_exists(&root) {
            return Err(JuntoError::ProjectNotFound(
                project_file(&root).display().to_string(),
            ));
        }
        let data = fs::read_to_string(project_file(&root))?;
        let file: ProjectFile = serde_json::from_str(&data)?;
        if file.format_version != PROJECT_FORMAT_VERSION {
            return Err(JuntoError::InvalidProject(format!(
                "unsupported format version {}",
                file.format_version
            )));
        }
        Ok(Self { root, file })
    }

    pub fn save(&self) -> Result<()> {
        ensure_project_layout(&self.root)?;
        let mut file = self.file.clone();
        file.updated_at = Utc::now().to_rfc3339();
        let data = serde_json::to_string_pretty(&file)?;
        fs::write(project_file(&self.root), data)?;
        Ok(())
    }

    pub fn scan(&self) -> Result<DirectoryScan> {
        scan_project_directory(&self.root)
    }

    pub fn import_footage(&mut self, source: &Path) -> Result<Vec<String>> {
        let imported = import_media_into_raw_footage(&self.root, source)?;
        self.touch();
        Ok(imported)
    }

    pub fn consolidate_footage(&mut self) -> Result<Vec<String>> {
        let moved = consolidate_media_into_raw_footage(&self.root)?;
        self.touch();
        Ok(moved)
    }

    pub fn list_media(&self) -> Result<Vec<crate::filesystem::ScannedMediaFile>> {
        list_raw_footage(&self.root)
    }

    pub fn resolve_path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    /// Static fallback durations by media kind.
    ///
    /// Images use `photo_default_duration`. Video/audio return
    /// [`FALLBACK_AV_DURATION`] (5s) — prefer [`Self::duration_for_media`] which
    /// probes real length via ffprobe when adding clips.
    pub fn default_duration_for(&self, kind: MediaKind) -> f64 {
        match kind {
            MediaKind::Image => self.file.photo_default_duration,
            MediaKind::Video | MediaKind::Audio => FALLBACK_AV_DURATION,
        }
    }

    /// Preferred duration when placing media on the timeline.
    ///
    /// - Image → `photo_default_duration`
    /// - Video / Audio → `ffprobe` duration for the file at `path`
    ///   (`path` may be absolute or project-relative)
    ///
    /// Callers that want a soft fallback can use
    /// `duration_for_media(...).unwrap_or_else(|_| default_duration_for(kind))`.
    pub fn duration_for_media(&self, kind: MediaKind, path: &str) -> Result<f64> {
        match kind {
            MediaKind::Image => Ok(self.file.photo_default_duration),
            MediaKind::Video | MediaKind::Audio => {
                let resolved = {
                    let p = Path::new(path);
                    if p.is_absolute() {
                        p.to_path_buf()
                    } else {
                        self.resolve_path(path)
                    }
                };
                probe_duration(&resolved)
            }
        }
    }

    pub fn touch(&mut self) {
        self.file.updated_at = Utc::now().to_rfc3339();
    }

    pub fn export_blocking(&self) -> Result<PathBuf> {
        export_timeline_with_progress(self, |_, _| {})
    }

    pub fn export_async(&self) -> mpsc::Receiver<ExportProgress> {
        let project = self.clone_for_export();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let send = |progress: f32, message: &str, done: bool, output: Option<String>, error: Option<String>| {
                let _ = tx.send(ExportProgress {
                    done,
                    progress,
                    message: message.into(),
                    output_path: output,
                    error,
                });
            };

            send(0.05, "Preparing export...", false, None, None);

            match export_timeline_with_progress(&project, |p, msg| {
                send(p, msg, false, None, None);
            }) {
                Ok(path) => {
                    send(
                        1.0,
                        "Export complete",
                        true,
                        Some(path.to_string_lossy().into()),
                        None,
                    );
                }
                Err(err) => {
                    send(0.0, "Export failed", true, None, Some(err.to_string()));
                }
            }
        });
        rx
    }

    fn clone_for_export(&self) -> Self {
        Self {
            root: self.root.clone(),
            file: self.file.clone(),
        }
    }
}

/// Visual segment covering `[start, start+duration)` on the timeline.
///
/// When multiple video tracks have a clip covering the same time, the clip on
/// the track with the **lowest `track.index`** wins (same rule as preview).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct VisualSegment {
    pub start: f64,
    pub duration: f64,
    /// `None` means a black gap (no visual clip covering this range).
    pub clip_id: Option<Uuid>,
}

/// Build a contiguous visual plan from `0` to `timeline.duration()`.
///
/// Gaps with no covering video/image clip become black segments (`clip_id = None`).
pub(crate) fn build_visual_segments(timeline: &Timeline) -> Vec<VisualSegment> {
    let total = timeline.duration();
    if total <= 1e-6 {
        return Vec::new();
    }

    let visual_clips: Vec<(&Clip, u32)> = timeline
        .clips
        .iter()
        .filter(|c| matches!(c.media_kind, MediaKind::Video | MediaKind::Image))
        .filter_map(|c| {
            let track = timeline.track(c.track_id)?;
            if track.kind != TrackKind::Video {
                return None;
            }
            Some((c, track.index))
        })
        .collect();

    let mut boundaries: Vec<f64> = Vec::new();
    boundaries.push(0.0);
    boundaries.push(total);
    for (clip, _) in &visual_clips {
        let start = clip.start.clamp(0.0, total);
        let end = (clip.start + clip.duration).clamp(0.0, total);
        boundaries.push(start);
        boundaries.push(end);
    }
    boundaries.sort_by(|a, b| a.partial_cmp(b).unwrap());
    boundaries.dedup_by(|a, b| (*a - *b).abs() < 1e-9);

    let times = boundaries;
    let mut segments: Vec<VisualSegment> = Vec::new();

    for window in times.windows(2) {
        let t0 = window[0];
        let t1 = window[1];
        let dur = t1 - t0;
        if dur <= 1e-6 {
            continue;
        }
        let mid = t0 + dur * 0.5;
        let covering = visual_clips
            .iter()
            .filter(|(c, _)| mid + 1e-9 >= c.start && mid < c.start + c.duration)
            .min_by_key(|(_, index)| *index)
            .map(|(c, _)| c.id);

        // Merge adjacent identical segments.
        if let Some(last) = segments.last_mut() {
            if last.clip_id == covering {
                last.duration += dur;
                continue;
            }
        }

        segments.push(VisualSegment {
            start: t0,
            duration: dur,
            clip_id: covering,
        });
    }

    segments
}

fn export_timeline_with_progress(
    project: &Project,
    mut on_progress: impl FnMut(f32, &str),
) -> Result<PathBuf> {
    let settings = &project.file.export_settings;
    fs::create_dir_all(outputs_dir(&project.root))?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let output = outputs_dir(&project.root).join(format!("export_{timestamp}.mp4"));

    let timeline = &project.file.timeline;
    let total_duration = timeline.duration();
    if total_duration <= 0.0 {
        return Err(JuntoError::Export("timeline is empty".into()));
    }

    let has_visual = timeline
        .clips
        .iter()
        .any(|c| matches!(c.media_kind, MediaKind::Video | MediaKind::Image));
    if !has_visual {
        return Err(JuntoError::Export(
            "timeline has no video or image clips".into(),
        ));
    }

    let visual_plan = build_visual_segments(timeline);
    if visual_plan.is_empty() {
        return Err(JuntoError::Export("no visual segments to export".into()));
    }

    let audio_clips: Vec<&Clip> = timeline
        .clips
        .iter()
        .filter(|c| matches!(c.media_kind, MediaKind::Audio))
        .collect();

    let temp_dir = project.root.join(".junto").join("export_tmp");
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir)?;

    let segment_count = visual_plan.len();
    let mut list_contents = String::new();

    for (idx, seg) in visual_plan.iter().enumerate() {
        let progress = 0.05 + 0.65 * ((idx as f32) / (segment_count as f32).max(1.0));
        on_progress(
            progress,
            &format!("Rendering visual segment {}/{}", idx + 1, segment_count),
        );

        let seg_path = temp_dir.join(format!("vseg_{idx:04}.mp4"));
        let duration = seg.duration.max(1.0 / settings.fps.max(1) as f64);

        match seg.clip_id {
            None => {
                render_black_segment(settings, duration, &seg_path)?;
            }
            Some(clip_id) => {
                let clip = timeline
                    .clips
                    .iter()
                    .find(|c| c.id == clip_id)
                    .ok_or_else(|| JuntoError::Export(format!("missing clip {clip_id}")))?;
                let source = project.resolve_path(&clip.source_path);
                if !source.exists() {
                    return Err(JuntoError::Export(format!(
                        "missing source file: {}",
                        source.display()
                    )));
                }
                // How far into the clip this plan slice starts.
                let into_clip = (seg.start - clip.start).max(0.0);
                let source_ss = clip.source_offset + into_clip;
                match clip.media_kind {
                    MediaKind::Image => {
                        render_image_segment(settings, &source, duration, &seg_path)?;
                    }
                    MediaKind::Video => {
                        render_video_segment(settings, &source, source_ss, duration, &seg_path)?;
                    }
                    MediaKind::Audio => {
                        return Err(JuntoError::Export(
                            "audio clip cannot be a visual segment".into(),
                        ));
                    }
                }
            }
        }

        // concat demuxer wants escaped single quotes in paths.
        let escaped = seg_path.display().to_string().replace('\'', "'\\''");
        list_contents.push_str(&format!("file '{escaped}'\n"));
    }

    on_progress(0.72, "Concatenating visual timeline...");
    let list_file = temp_dir.join("concat.txt");
    fs::write(&list_file, &list_contents)?;
    let video_only = temp_dir.join("video_timeline.mp4");
    run_ffmpeg(
        &[
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_file.to_string_lossy(),
            "-an",
            "-c:v",
            &settings.video_codec,
            "-crf",
            &settings.crf.to_string(),
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            &video_only.to_string_lossy(),
        ],
        "ffmpeg visual concat failed",
    )?;

    on_progress(0.82, "Mixing audio...");
    let mixed_audio = temp_dir.join("audio_mix.m4a");
    let has_audio = render_audio_mix(project, &audio_clips, total_duration, settings, &mixed_audio)?;

    on_progress(0.92, "Muxing final output...");
    if has_audio {
        run_ffmpeg(
            &[
                "-y",
                "-i",
                &video_only.to_string_lossy(),
                "-i",
                &mixed_audio.to_string_lossy(),
                "-c:v",
                "copy",
                "-c:a",
                &settings.audio_codec,
                "-shortest",
                "-movflags",
                "+faststart",
                &output.to_string_lossy(),
            ],
            "ffmpeg final mux failed",
        )?;
    } else {
        // Silent bed so the MP4 always has an audio stream.
        let silent = temp_dir.join("silent.m4a");
        run_ffmpeg(
            &[
                "-y",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=channel_layout=stereo:sample_rate=48000",
                "-t",
                &format!("{total_duration:.6}"),
                "-c:a",
                &settings.audio_codec,
                &silent.to_string_lossy(),
            ],
            "ffmpeg silent audio failed",
        )?;
        run_ffmpeg(
            &[
                "-y",
                "-i",
                &video_only.to_string_lossy(),
                "-i",
                &silent.to_string_lossy(),
                "-c:v",
                "copy",
                "-c:a",
                "copy",
                "-shortest",
                "-movflags",
                "+faststart",
                &output.to_string_lossy(),
            ],
            "ffmpeg silent mux failed",
        )?;
    }

    let _ = fs::remove_dir_all(&temp_dir);
    on_progress(0.98, "Finishing export...");
    Ok(output)
}

fn scale_pad_filter(settings: &ExportSettings) -> String {
    format!(
        "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        settings.width, settings.height, settings.width, settings.height
    )
}

fn render_black_segment(settings: &ExportSettings, duration: f64, out: &Path) -> Result<()> {
    run_ffmpeg(
        &[
            "-y",
            "-f",
            "lavfi",
            "-i",
            &format!(
                "color=c=black:s={}x{}:r={}",
                settings.width, settings.height, settings.fps
            ),
            "-t",
            &format!("{duration:.6}"),
            "-c:v",
            &settings.video_codec,
            "-pix_fmt",
            "yuv420p",
            "-an",
            &out.to_string_lossy(),
        ],
        "ffmpeg black segment failed",
    )
}

fn render_image_segment(
    settings: &ExportSettings,
    source: &Path,
    duration: f64,
    out: &Path,
) -> Result<()> {
    let vf = scale_pad_filter(settings);
    run_ffmpeg(
        &[
            "-y",
            "-loop",
            "1",
            "-i",
            &source.to_string_lossy(),
            "-t",
            &format!("{duration:.6}"),
            "-vf",
            &vf,
            "-r",
            &settings.fps.to_string(),
            "-c:v",
            &settings.video_codec,
            "-pix_fmt",
            "yuv420p",
            "-an",
            &out.to_string_lossy(),
        ],
        "ffmpeg image segment failed",
    )
}

fn render_video_segment(
    settings: &ExportSettings,
    source: &Path,
    source_offset: f64,
    duration: f64,
    out: &Path,
) -> Result<()> {
    let vf = scale_pad_filter(settings);
    run_ffmpeg(
        &[
            "-y",
            "-ss",
            &format!("{source_offset:.6}"),
            "-i",
            &source.to_string_lossy(),
            "-t",
            &format!("{duration:.6}"),
            "-vf",
            &vf,
            "-r",
            &settings.fps.to_string(),
            "-c:v",
            &settings.video_codec,
            "-pix_fmt",
            "yuv420p",
            "-an",
            &out.to_string_lossy(),
        ],
        "ffmpeg video segment failed",
    )
}

/// Mix dedicated audio-track clips onto a full-length audio file.
/// Returns `true` when mixed audio was written.
fn render_audio_mix(
    project: &Project,
    audio_clips: &[&Clip],
    total_duration: f64,
    settings: &ExportSettings,
    out: &Path,
) -> Result<bool> {
    if audio_clips.is_empty() {
        return Ok(false);
    }

    let temp_dir = out.parent().unwrap_or_else(|| Path::new("."));
    let mut inputs: Vec<PathBuf> = Vec::new();
    let mut filter_parts: Vec<String> = Vec::new();
    let mut amix_inputs = String::new();

    for (idx, clip) in audio_clips.iter().enumerate() {
        let source = project.resolve_path(&clip.source_path);
        if !source.exists() {
            return Err(JuntoError::Export(format!(
                "missing audio source: {}",
                source.display()
            )));
        }
        let seg = temp_dir.join(format!("aseg_{idx:04}.wav"));
        let duration = clip.duration.max(0.01);
        run_ffmpeg(
            &[
                "-y",
                "-ss",
                &format!("{:.6}", clip.source_offset),
                "-i",
                &source.to_string_lossy(),
                "-t",
                &format!("{duration:.6}"),
                "-vn",
                "-ac",
                "2",
                "-ar",
                "48000",
                &seg.to_string_lossy(),
            ],
            "ffmpeg audio segment failed",
        )?;

        // adelay takes milliseconds per channel; pad with silence after via apad.
        let delay_ms = (clip.start.max(0.0) * 1000.0).round() as i64;
        filter_parts.push(format!(
            "[{idx}:a]adelay={delay_ms}|{delay_ms},apad=whole_dur={total_duration:.6}[a{idx}]"
        ));
        amix_inputs.push_str(&format!("[a{idx}]"));
        inputs.push(seg);
    }

    let n = inputs.len();
    filter_parts.push(format!(
        "{amix_inputs}amix=inputs={n}:duration=longest:normalize=0[aout]"
    ));
    let filter = filter_parts.join(";");

    let mut args: Vec<String> = vec!["-y".into()];
    for path in &inputs {
        args.push("-i".into());
        args.push(path.to_string_lossy().into());
    }
    args.extend([
        "-filter_complex".into(),
        filter,
        "-map".into(),
        "[aout]".into(),
        "-t".into(),
        format!("{total_duration:.6}"),
        "-c:a".into(),
        settings.audio_codec.clone(),
        out.to_string_lossy().into(),
    ]);

    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_ffmpeg(&arg_refs, "ffmpeg audio mix failed")?;
    Ok(true)
}

fn run_ffmpeg(args: &[&str], err_msg: &str) -> Result<()> {
    let output = Command::new("ffmpeg")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| JuntoError::Export(e.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!(target: "junto_core::export", "{err_msg}: {stderr}");
        return Err(JuntoError::Export(format!("{err_msg}: {stderr}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::timeline::TrackKind;

    fn clip(
        track_id: Uuid,
        kind: MediaKind,
        start: f64,
        duration: f64,
        id: Option<Uuid>,
    ) -> Clip {
        Clip {
            id: id.unwrap_or_else(Uuid::new_v4),
            track_id,
            source_path: "Raw Footage/x.mp4".into(),
            media_kind: kind,
            start,
            duration,
            source_offset: 0.0,
        }
    }

    #[test]
    fn visual_plan_fills_gaps_with_black() {
        let mut timeline = Timeline::new();
        let v0 = timeline.tracks[0].id;
        let id_a = Uuid::new_v4();
        let id_b = Uuid::new_v4();
        timeline
            .clips
            .push(clip(v0, MediaKind::Image, 1.0, 2.0, Some(id_a)));
        timeline
            .clips
            .push(clip(v0, MediaKind::Image, 5.0, 1.0, Some(id_b)));

        let plan = build_visual_segments(&timeline);
        assert_eq!(plan.len(), 4);
        assert_eq!(plan[0].clip_id, None); // 0..1 black
        assert!((plan[0].duration - 1.0).abs() < 1e-9);
        assert_eq!(plan[1].clip_id, Some(id_a)); // 1..3
        assert_eq!(plan[2].clip_id, None); // 3..5 black
        assert_eq!(plan[3].clip_id, Some(id_b)); // 5..6
        let covered: f64 = plan.iter().map(|s| s.duration).sum();
        assert!((covered - timeline.duration()).abs() < 1e-9);
    }

    #[test]
    fn visual_plan_prefers_lowest_track_index() {
        let mut timeline = Timeline::new();
        let v0 = timeline.tracks[0].id;
        let v1 = timeline.add_track(TrackKind::Video);
        let top = Uuid::new_v4();
        let bottom = Uuid::new_v4();
        // index 0 and index 1 overlap; index 0 should win.
        timeline
            .clips
            .push(clip(v0, MediaKind::Video, 0.0, 4.0, Some(top)));
        timeline
            .clips
            .push(clip(v1, MediaKind::Video, 1.0, 2.0, Some(bottom)));

        let plan = build_visual_segments(&timeline);
        // Entire 0..4 should be the index-0 clip (merged).
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].clip_id, Some(top));
        assert!((plan[0].duration - 4.0).abs() < 1e-9);
    }

    #[test]
    fn default_duration_docs_fallback() {
        let temp = tempfile::TempDir::new().unwrap();
        let project = Project::create(temp.path().to_path_buf(), "t".into()).unwrap();
        assert_eq!(
            project.default_duration_for(MediaKind::Image),
            DEFAULT_PHOTO_DURATION
        );
        assert_eq!(
            project.default_duration_for(MediaKind::Video),
            FALLBACK_AV_DURATION
        );
        assert_eq!(
            project.default_duration_for(MediaKind::Audio),
            FALLBACK_AV_DURATION
        );
    }
}
