use std::path::Path;
use std::process::Command;

use junto_core::{MediaKind, Project};
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
}
