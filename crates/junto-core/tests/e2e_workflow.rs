use std::path::Path;
use std::process::Command;
use std::time::Duration;

use junto_core::{MediaKind, Project, TrackKind};
use tempfile::TempDir;

fn generate_test_image(path: &Path) {
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=320x240:d=1",
            "-frames:v",
            "1",
            &path.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("ffmpeg should be installed for export tests");
    assert!(status.success(), "failed to generate test image with ffmpeg");
}

fn generate_test_audio(path: &Path, seconds: f64) {
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            &format!("sine=f=440:d={seconds}"),
            "-c:a",
            "aac",
            &path.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("ffmpeg");
    assert!(status.success(), "failed to generate test audio");
}

fn generate_test_video(path: &Path, seconds: f64) {
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            &format!("color=c=red:s=320x240:d={seconds}"),
            "-f",
            "lavfi",
            "-i",
            &format!("sine=f=220:d={seconds}"),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            &path.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("ffmpeg");
    assert!(status.success(), "failed to generate test video");
}

fn probe_out_duration(path: &Path) -> f64 {
    junto_core::probe_duration(path).expect("probe export")
}

fn has_audio_stream(path: &Path) -> bool {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_type",
            "-of",
            "csv=p=0",
        ])
        .arg(path)
        .output()
        .expect("ffprobe");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .any(|l| l.trim() == "audio")
}

#[test]
fn project_create_import_timeline_export_workflow() {
    let temp = TempDir::new().expect("temp dir");
    let image_path = temp.path().join("clip.jpg");
    generate_test_image(&image_path);

    let project_root = temp.path().join("project");
    std::fs::create_dir_all(&project_root).expect("project dir");

    let mut project =
        Project::create(project_root.clone(), "E2E Test".into()).expect("create project");

    let imported = project
        .import_footage(&image_path)
        .expect("import footage");
    assert_eq!(imported.len(), 1);

    let media = project.list_media().expect("list media");
    assert_eq!(media.len(), 1);
    assert_eq!(media[0].media_kind, MediaKind::Image);

    let track_id = project.file.timeline.tracks[0].id;
    project
        .file
        .timeline
        .add_clip(
            track_id,
            imported[0].clone(),
            MediaKind::Image,
            0.0,
            2.0,
        )
        .expect("add clip");
    project.save().expect("save project");

    let output = project.export_blocking().expect("export timeline");
    assert!(output.exists(), "export output should exist");
    assert!(
        output.metadata().expect("output metadata").len() > 0,
        "export output should not be empty"
    );
    let dur = probe_out_duration(&output);
    assert!((dur - 2.0).abs() < 0.35, "expected ~2s export, got {dur}");
}

#[test]
fn export_preserves_gaps_as_black() {
    let temp = TempDir::new().expect("temp dir");
    let image_path = temp.path().join("still.jpg");
    generate_test_image(&image_path);

    let project_root = temp.path().join("project");
    let mut project = Project::create(project_root, "Gaps".into()).expect("create");
    let imported = project.import_footage(&image_path).expect("import");

    let vtrack = project.file.timeline.tracks[0].id;
    // Clip at 1..2 → timeline duration 2 with leading gap.
    project
        .file
        .timeline
        .add_clip(vtrack, imported[0].clone(), MediaKind::Image, 1.0, 1.0)
        .expect("add");
    project.save().expect("save");

    // Use smaller export for speed.
    project.file.export_settings.width = 320;
    project.file.export_settings.height = 240;
    project.file.export_settings.fps = 15;

    let output = project.export_blocking().expect("export");
    let dur = probe_out_duration(&output);
    assert!(
        (dur - 2.0).abs() < 0.4,
        "gap export should span full timeline (~2s), got {dur}"
    );
}

#[test]
fn export_mixes_audio_track_clips() {
    let temp = TempDir::new().expect("temp dir");
    let image_path = temp.path().join("still.jpg");
    let audio_path = temp.path().join("bed.m4a");
    generate_test_image(&image_path);
    generate_test_audio(&audio_path, 2.0);

    let project_root = temp.path().join("project");
    let mut project = Project::create(project_root, "Audio".into()).expect("create");
    let img = project.import_footage(&image_path).expect("import img");
    let aud = project.import_footage(&audio_path).expect("import aud");

    let vtrack = project
        .file
        .timeline
        .tracks
        .iter()
        .find(|t| t.kind == TrackKind::Video)
        .unwrap()
        .id;
    let atrack = project
        .file
        .timeline
        .tracks
        .iter()
        .find(|t| t.kind == TrackKind::Audio)
        .unwrap()
        .id;

    project
        .file
        .timeline
        .add_clip(vtrack, img[0].clone(), MediaKind::Image, 0.0, 2.0)
        .expect("video clip");
    project
        .file
        .timeline
        .add_clip(atrack, aud[0].clone(), MediaKind::Audio, 0.5, 1.0)
        .expect("audio clip");

    project.file.export_settings.width = 320;
    project.file.export_settings.height = 240;
    project.file.export_settings.fps = 15;

    let output = project.export_blocking().expect("export");
    assert!(has_audio_stream(&output), "export should contain audio");
    let dur = probe_out_duration(&output);
    assert!((dur - 2.0).abs() < 0.4, "got {dur}");
}

#[test]
fn duration_for_media_probes_video() {
    let temp = TempDir::new().expect("temp dir");
    let video_path = temp.path().join("clip.mp4");
    generate_test_video(&video_path, 3.0);

    let project_root = temp.path().join("project");
    let mut project = Project::create(project_root, "Probe".into()).expect("create");
    let imported = project.import_footage(&video_path).expect("import");

    let probed = project
        .duration_for_media(MediaKind::Video, &imported[0])
        .expect("duration_for_media");
    assert!(
        (probed - 3.0).abs() < 0.25,
        "expected ~3s probed duration, got {probed}"
    );

    // Image still uses photo default.
    let img = temp.path().join("p.jpg");
    generate_test_image(&img);
    let img_imp = project.import_footage(&img).expect("import img");
    let img_dur = project
        .duration_for_media(MediaKind::Image, &img_imp[0])
        .expect("image duration");
    assert_eq!(img_dur, project.file.photo_default_duration);
}

#[test]
fn export_async_emits_intermediate_progress() {
    let temp = TempDir::new().expect("temp dir");
    let image_path = temp.path().join("still.jpg");
    generate_test_image(&image_path);

    let project_root = temp.path().join("project");
    let mut project = Project::create(project_root, "Progress".into()).expect("create");
    let imported = project.import_footage(&image_path).expect("import");
    let vtrack = project.file.timeline.tracks[0].id;
    // Leading gap + clip forces multiple visual segments.
    project
        .file
        .timeline
        .add_clip(vtrack, imported[0].clone(), MediaKind::Image, 0.5, 1.0)
        .expect("add");
    project.file.export_settings.width = 160;
    project.file.export_settings.height = 120;
    project.file.export_settings.fps = 10;

    let rx = project.export_async();
    let mut updates = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(120);
    while std::time::Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(p) => {
                updates.push(p.clone());
                if p.done {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    assert!(
        updates.len() >= 3,
        "expected intermediate progress updates, got {}",
        updates.len()
    );
    let last = updates.last().unwrap();
    assert!(last.done);
    assert!(last.error.is_none(), "export error: {:?}", last.error);
    assert!(last.output_path.is_some());

    let mid: Vec<_> = updates
        .iter()
        .filter(|u| !u.done && u.progress > 0.05 && u.progress < 1.0)
        .collect();
    assert!(
        !mid.is_empty(),
        "expected progress between start and finish, updates={updates:?}"
    );
}
