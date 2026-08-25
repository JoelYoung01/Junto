use std::net::SocketAddr;
use std::sync::{Arc, RwLock};

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Json;
use junto_core::{DirectoryScan, Project, ScannedMediaFile};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::net::TcpListener;

pub type SharedProject = Arc<RwLock<Option<Project>>>;

#[derive(Clone)]
pub struct McpState {
    pub project: SharedProject,
}

#[derive(Debug, Deserialize)]
struct ToolCallRequest {
    name: String,
    arguments: Option<Value>,
}

#[derive(Debug, Serialize)]
struct ToolCallResponse {
    content: Vec<ToolContent>,
    is_error: Option<bool>,
}

#[derive(Debug, Serialize)]
struct ToolContent {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
}

pub async fn start_server(project: SharedProject, addr: SocketAddr) -> anyhow::Result<()> {
    let app = router(project);
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("Junto MCP listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

pub fn router(project: SharedProject) -> axum::Router {
    let state = McpState { project };
    axum::Router::new()
        .route("/health", get(health))
        .route("/mcp", post(handle_tool))
        .route("/tools", get(list_tools))
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok", "service": "junto-mcp" }))
}

async fn list_tools() -> Json<Value> {
    Json(json!({
        "tools": [
            { "name": "get_project_summary", "description": "Get project name, path, and timeline duration" },
            { "name": "get_timeline", "description": "Get full timeline state" },
            { "name": "list_media", "description": "List media files in Raw Footage" },
            { "name": "scan_directory", "description": "Scan project directory layout" },
            { "name": "add_clip", "description": "Add a clip to the timeline" },
            { "name": "move_clip", "description": "Move a clip on the timeline" },
            { "name": "remove_clip", "description": "Remove a clip from the timeline" },
            { "name": "set_playhead", "description": "Set playhead position in seconds" },
            { "name": "export_video", "description": "Export timeline to MP4 in outputs/" }
        ]
    }))
}

async fn handle_tool(
    State(state): State<McpState>,
    Json(req): Json<ToolCallRequest>,
) -> Result<Json<ToolCallResponse>, StatusCode> {
    let result = tokio::task::spawn_blocking(move || execute_tool(state.project, req))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    match result {
        Ok(response) => Ok(Json(response)),
        Err(err) => Ok(Json(ToolCallResponse {
            content: vec![ToolContent {
                content_type: "text".into(),
                text: err,
            }],
            is_error: Some(true),
        })),
    }
}

fn execute_tool(project: SharedProject, req: ToolCallRequest) -> Result<ToolCallResponse, String> {
    let mut guard = project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    let args = req.arguments.unwrap_or(json!({}));

    let text = match req.name.as_str() {
        "get_project_summary" => {
            let duration = project.file.timeline.duration();
            json!({
                "name": project.file.name,
                "root": project.root,
                "duration_seconds": duration,
                "clip_count": project.file.timeline.clips.len(),
            })
            .to_string()
        }
        "get_timeline" => serde_json::to_string(&project.file.timeline).map_err(|e| e.to_string())?,
        "list_media" => {
            let media: Vec<ScannedMediaFile> = project.list_media().map_err(|e| e.to_string())?;
            serde_json::to_string(&media).map_err(|e| e.to_string())?
        }
        "scan_directory" => {
            let scan: DirectoryScan = project.scan().map_err(|e| e.to_string())?;
            serde_json::to_string(&scan).map_err(|e| e.to_string())?
        }
        "add_clip" => {
            let track_id: uuid::Uuid = parse_arg(&args, "track_id")?;
            let source_path: String = parse_arg(&args, "source_path")?;
            let media_kind = junto_core::MediaKind::from_path(std::path::Path::new(&source_path))
                .ok_or_else(|| "unsupported media file".to_string())?;
            let start: f64 = args.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let duration = args
                .get("duration")
                .and_then(|v| v.as_f64())
                .unwrap_or_else(|| project.default_duration_for(media_kind));
            let id = project
                .file
                .timeline
                .add_clip(track_id, source_path, media_kind, start, duration)
                .map_err(|e| e.to_string())?;
            project.save().map_err(|e| e.to_string())?;
            json!({ "clip_id": id }).to_string()
        }
        "move_clip" => {
            let clip_id: uuid::Uuid = parse_arg(&args, "clip_id")?;
            let start: f64 = parse_arg(&args, "start")?;
            project
                .file
                .timeline
                .move_clip(clip_id, start)
                .map_err(|e| e.to_string())?;
            project.save().map_err(|e| e.to_string())?;
            json!({ "ok": true }).to_string()
        }
        "remove_clip" => {
            let clip_id: uuid::Uuid = parse_arg(&args, "clip_id")?;
            project
                .file
                .timeline
                .remove_clip(clip_id)
                .map_err(|e| e.to_string())?;
            project.save().map_err(|e| e.to_string())?;
            json!({ "ok": true }).to_string()
        }
        "set_playhead" => {
            let position: f64 = parse_arg(&args, "position")?;
            project.file.timeline.playhead = position.max(0.0);
            project.save().map_err(|e| e.to_string())?;
            json!({ "playhead": project.file.timeline.playhead }).to_string()
        }
        "export_video" => {
            let path = project.export_blocking().map_err(|e| e.to_string())?;
            json!({ "output_path": path }).to_string()
        }
        other => return Err(format!("unknown tool: {other}")),
    };

    Ok(ToolCallResponse {
        content: vec![ToolContent {
            content_type: "text".into(),
            text,
        }],
        is_error: None,
    })
}

fn parse_arg<T: for<'de> Deserialize<'de>>(args: &Value, key: &str) -> Result<T, String> {
    args.get(key)
        .cloned()
        .ok_or_else(|| format!("missing argument: {key}"))
        .and_then(|v| serde_json::from_value(v).map_err(|e| e.to_string()))
}
