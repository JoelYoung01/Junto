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

fn tool_text(response: &serde_json::Value) -> &str {
    response["content"][0]["text"].as_str().expect("tool text")
}

fn assert_tool_ok(response: &serde_json::Value) {
    assert_ne!(
        response.get("is_error").and_then(|v| v.as_bool()),
        Some(true),
        "tool error: {}",
        tool_text(response)
    );
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

    let tools = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/tools")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("tools response");
    assert_eq!(tools.status(), StatusCode::OK);
    let tools_bytes = axum::body::to_bytes(tools.into_body(), usize::MAX)
        .await
        .expect("tools body");
    let tools_json: serde_json::Value = serde_json::from_slice(&tools_bytes).expect("tools json");
    let tool_names: Vec<&str> = tools_json["tools"]
        .as_array()
        .expect("tools array")
        .iter()
        .map(|t| t["name"].as_str().expect("name"))
        .collect();
    for required in [
        "trim_clip",
        "set_clip_duration",
        "set_photo_default_duration",
        "add_track",
        "move_clip",
        "update_export_settings",
    ] {
        assert!(
            tool_names.contains(&required),
            "missing tool {required} in {tool_names:?}"
        );
    }

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
    assert_tool_ok(&add_response);
    let add_text = tool_text(&add_response);
    assert!(add_text.contains("clip_id"));
    let clip_id = serde_json::from_str::<serde_json::Value>(add_text).expect("clip json")["clip_id"]
        .as_str()
        .expect("clip_id")
        .to_string();

    let photo_dur = post_tool(
        &mut app,
        json!({
            "name": "set_photo_default_duration",
            "arguments": { "duration": 4.0 }
        }),
    )
    .await;
    assert_tool_ok(&photo_dur);
    assert!(tool_text(&photo_dur).contains("4"));

    let set_dur = post_tool(
        &mut app,
        json!({
            "name": "set_clip_duration",
            "arguments": { "clip_id": clip_id, "duration": 2.0 }
        }),
    )
    .await;
    assert_tool_ok(&set_dur);

    let trim = post_tool(
        &mut app,
        json!({
            "name": "trim_clip",
            "arguments": {
                "clip_id": clip_id,
                "source_offset": 0.0,
                "duration": 1.25
            }
        }),
    )
    .await;
    assert_tool_ok(&trim);

    let add_track = post_tool(
        &mut app,
        json!({
            "name": "add_track",
            "arguments": { "kind": "video" }
        }),
    )
    .await;
    assert_tool_ok(&add_track);
    let new_track_id = serde_json::from_str::<serde_json::Value>(tool_text(&add_track))
        .expect("track json")["track_id"]
        .as_str()
        .expect("track_id")
        .to_string();

    let move_clip = post_tool(
        &mut app,
        json!({
            "name": "move_clip",
            "arguments": {
                "clip_id": clip_id,
                "start": 0.5,
                "track_id": new_track_id
            }
        }),
    )
    .await;
    assert_tool_ok(&move_clip);

    let settings = post_tool(
        &mut app,
        json!({
            "name": "update_export_settings",
            "arguments": {
                "width": 1280,
                "height": 720,
                "video_codec": "libx264",
                "audio_codec": "aac",
                "crf": 23,
                "fps": 24
            }
        }),
    )
    .await;
    assert_tool_ok(&settings);

    let export_response = post_tool(&mut app, json!({ "name": "export_video" })).await;
    assert_tool_ok(&export_response);
    let export_text = tool_text(&export_response);
    assert!(export_text.contains("output_path"));

    let output_path = serde_json::from_str::<serde_json::Value>(export_text)
        .expect("export payload json")["output_path"]
        .as_str()
        .expect("output path")
        .to_string();
    assert!(Path::new(&output_path).exists());

    let timeline_response = post_tool(&mut app, json!({ "name": "get_timeline" })).await;
    assert_tool_ok(&timeline_response);
    let timeline_text = tool_text(&timeline_response);
    let timeline = serde_json::from_str::<serde_json::Value>(timeline_text).expect("timeline json");
    assert_eq!(timeline["clips"].as_array().expect("clips").len(), 1);
    let clip = &timeline["clips"][0];
    assert_eq!(clip["track_id"], new_track_id);
    assert!((clip["start"].as_f64().unwrap() - 0.5).abs() < f64::EPSILON);
    assert!((clip["duration"].as_f64().unwrap() - 1.25).abs() < f64::EPSILON);
}
