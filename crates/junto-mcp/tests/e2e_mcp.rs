use std::path::Path;
use std::process::Command;
use std::sync::{Arc, RwLock};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use junto_core::Project;
use junto_mcp::router;
use serde_json::json;
use tempfile::TempDir;
use tower::ServiceExt;

fn generate_test_image(path: &Path) {
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=160x120:d=1",
            "-frames:v",
            "1",
            &path.to_string_lossy(),
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("ffmpeg should be installed for MCP export tests");
    assert!(status.success());
}

async fn post_tool(
    app: &mut axum::Router,
    body: serde_json::Value,
) -> serde_json::Value {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/mcp")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .expect("request"),
        )
        .await
        .expect("response");
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("body");
    serde_json::from_slice(&bytes).expect("json response")
}

#[tokio::test]
async fn mcp_tools_drive_project_workflow() {
    let temp = TempDir::new().expect("temp dir");
    let image_path = temp.path().join("photo.jpg");
    generate_test_image(&image_path);

    let project_root = temp.path().join("project");
    std::fs::create_dir_all(&project_root).expect("project dir");

    let mut project =
        Project::create(project_root.clone(), "MCP E2E".into()).expect("create project");
    let imported = project.import_footage(&image_path).expect("import");
    assert_eq!(imported.len(), 1);

    let shared = Arc::new(RwLock::new(Some(project)));
    let mut app = router(Arc::clone(&shared));

    let health = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("health response");
    assert_eq!(health.status(), StatusCode::OK);

    let track_id = {
        let guard = shared.read().expect("read lock");
        guard
            .as_ref()
            .expect("project")
            .file
            .timeline
            .tracks[0]
            .id
            .to_string()
    };

    let add_response = post_tool(
        &mut app,
        json!({
            "name": "add_clip",
            "arguments": {
                "track_id": track_id,
                "source_path": imported[0],
                "start": 0.0,
                "duration": 1.5
            }
        }),
    )
    .await;
    assert!(add_response["content"][0]["text"]
        .as_str()
        .expect("clip id text")
        .contains("clip_id"));

    let export_response = post_tool(&mut app, json!({ "name": "export_video" })).await;
    let export_text = export_response["content"][0]["text"]
        .as_str()
        .expect("export text");
    assert!(export_text.contains("output_path"));

    let output_path = serde_json::from_str::<serde_json::Value>(export_text)
        .expect("export payload json")["output_path"]
        .as_str()
        .expect("output path")
        .to_string();
    assert!(Path::new(&output_path).exists());

    let timeline_response = post_tool(&mut app, json!({ "name": "get_timeline" })).await;
    let timeline_text = timeline_response["content"][0]["text"]
        .as_str()
        .expect("timeline text");
    let timeline = serde_json::from_str::<serde_json::Value>(timeline_text).expect("timeline json");
    assert_eq!(timeline["clips"].as_array().expect("clips").len(), 1);
}
