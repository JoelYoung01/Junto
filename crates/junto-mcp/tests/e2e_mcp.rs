use std::path::Path;
use std::process::Command;
use std::sync::{Arc, RwLock};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use junto_core::Project;
use junto_mcp::router;
use rmcp::{
    model::{CallToolRequestParams, CallToolResult, ClientInfo, ContentBlock},
    service::RunningService,
    transport::StreamableHttpClientTransport,
    RoleClient, ServiceExt,
};
use serde_json::json;
use tempfile::TempDir;
use tower::ServiceExt as TowerServiceExt;

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

fn tool_text(result: &CallToolResult) -> &str {
    match &result.content[0] {
        ContentBlock::Text(text) => &text.text,
        other => panic!("expected text content, got {other:?}"),
    }
}

fn assert_tool_ok(result: &CallToolResult) {
    assert_ne!(
        result.is_error,
        Some(true),
        "tool error: {}",
        tool_text(result)
    );
}

async fn call_tool(
    client: &RunningService<RoleClient, ClientInfo>,
    name: &str,
    arguments: serde_json::Value,
) -> CallToolResult {
    let args = arguments
        .as_object()
        .cloned()
        .unwrap_or_default();
    client
        .call_tool(CallToolRequestParams::new(name.to_string()).with_arguments(args))
        .await
        .expect("mcp tool call")
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
    let app = router(Arc::clone(&shared), None);

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

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind test listener");
    let addr = listener.local_addr().expect("local addr");
    tokio::spawn(async move {
        axum::serve(listener, app).await.expect("serve mcp");
    });

    let transport =
        StreamableHttpClientTransport::from_uri(format!("http://{addr}/mcp"));
    let client = ClientInfo::default()
        .serve(transport)
        .await
        .expect("connect mcp client");

    let tools = client.list_all_tools().await.expect("list tools");
    let tool_names: Vec<String> = tools.iter().map(|tool| tool.name.to_string()).collect();
    for required in [
        "trim_clip",
        "set_clip_duration",
        "set_photo_default_duration",
        "add_track",
        "move_clip",
        "update_export_settings",
        "export_video",
        "get_timeline",
    ] {
        assert!(
            tool_names.iter().any(|name| name == required),
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

    let add_response = call_tool(
        &client,
        "add_clip",
        json!({
            "track_id": track_id,
            "source_path": imported[0],
            "start": 0.0,
            "duration": 1.5
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

    let photo_dur = call_tool(
        &client,
        "set_photo_default_duration",
        json!({ "duration": 4.0 }),
    )
    .await;
    assert_tool_ok(&photo_dur);
    assert!(tool_text(&photo_dur).contains("4"));

    let set_dur = call_tool(
        &client,
        "set_clip_duration",
        json!({ "clip_id": clip_id, "duration": 2.0 }),
    )
    .await;
    assert_tool_ok(&set_dur);

    let trim = call_tool(
        &client,
        "trim_clip",
        json!({
            "clip_id": clip_id,
            "source_offset": 0.0,
            "duration": 1.25
        }),
    )
    .await;
    assert_tool_ok(&trim);

    let add_track = call_tool(&client, "add_track", json!({ "kind": "video" })).await;
    assert_tool_ok(&add_track);
    let new_track_id = serde_json::from_str::<serde_json::Value>(tool_text(&add_track))
        .expect("track json")["track_id"]
        .as_str()
        .expect("track_id")
        .to_string();

    let move_clip = call_tool(
        &client,
        "move_clip",
        json!({
            "clip_id": clip_id,
            "start": 0.5,
            "track_id": new_track_id
        }),
    )
    .await;
    assert_tool_ok(&move_clip);

    let settings = call_tool(
        &client,
        "update_export_settings",
        json!({
            "width": 1280,
            "height": 720,
            "video_codec": "libx264",
            "audio_codec": "aac",
            "crf": 23,
            "fps": 24
        }),
    )
    .await;
    assert_tool_ok(&settings);

    let export_response = call_tool(&client, "export_video", json!({})).await;
    assert_tool_ok(&export_response);
    let export_text = tool_text(&export_response);
    assert!(export_text.contains("output_path"));

    let output_path = serde_json::from_str::<serde_json::Value>(export_text)
        .expect("export payload json")["output_path"]
        .as_str()
        .expect("output path")
        .to_string();
    assert!(Path::new(&output_path).exists());

    let timeline_response = call_tool(&client, "get_timeline", json!({})).await;
    assert_tool_ok(&timeline_response);
    let timeline_text = tool_text(&timeline_response);
    let timeline = serde_json::from_str::<serde_json::Value>(timeline_text).expect("timeline json");
    assert_eq!(timeline["clips"].as_array().expect("clips").len(), 1);
    let clip = &timeline["clips"][0];
    assert_eq!(clip["track_id"], new_track_id);
    assert!((clip["start"].as_f64().unwrap() - 0.5).abs() < f64::EPSILON);
    assert!((clip["duration"].as_f64().unwrap() - 1.25).abs() < f64::EPSILON);
}
