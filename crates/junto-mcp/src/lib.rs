use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, RwLock};

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::Json;
use junto_core::{DirectoryScan, ExportSettings, Project, ScannedMediaFile, TrackKind};
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
            { "name": "move_clip", "description": "Move a clip on the timeline; optional track_id for cross-track move" },
            { "name": "trim_clip", "description": "Trim a clip source_offset and duration" },
            { "name": "set_clip_duration", "description": "Set a clip visible duration without changing source_offset" },
            { "name": "set_photo_default_duration", "description": "Set default duration for newly added photos" },
            { "name": "add_track", "description": "Add a video or audio track" },
            { "name": "update_export_settings", "description": "Update project export settings" },
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
            let duration = match args.get("duration").and_then(|v| v.as_f64()) {
                Some(d) => d,
                None => resolve_clip_duration(project, &source_path, media_kind),
            };
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
            let new_track_id = match args.get("track_id") {
                Some(v) if !v.is_null() => {
                    let id: uuid::Uuid = serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
                    Some(id)
                }
                _ => None,
            };
            project
                .file
                .timeline
                .move_clip_to_track(clip_id, start, new_track_id)
                .map_err(|e| e.to_string())?;
            project.save().map_err(|e| e.to_string())?;
            json!({ "ok": true }).to_string()
        }
        "trim_clip" => {
            let clip_id: uuid::Uuid = parse_arg(&args, "clip_id")?;
            let source_offset: f64 = parse_arg(&args, "source_offset")?;
            let duration: f64 = parse_arg(&args, "duration")?;
            project
                .file
                .timeline
                .trim_clip(clip_id, source_offset, duration)
                .map_err(|e| e.to_string())?;
            project.save().map_err(|e| e.to_string())?;
            json!({ "ok": true }).to_string()
        }
        "set_clip_duration" => {
            let clip_id: uuid::Uuid = parse_arg(&args, "clip_id")?;
            let duration: f64 = parse_arg(&args, "duration")?;
            project
                .file
                .timeline
                .set_clip_duration(clip_id, duration)
                .map_err(|e| e.to_string())?;
            project.save().map_err(|e| e.to_string())?;
            json!({ "ok": true }).to_string()
        }
        "set_photo_default_duration" => {
            let duration: f64 = parse_arg(&args, "duration")?;
            project
                .set_photo_default_duration(duration)
                .map_err(|e| e.to_string())?;
            project.save().map_err(|e| e.to_string())?;
            json!({ "photo_default_duration": project.file.photo_default_duration }).to_string()
        }
        "add_track" => {
            let kind_str: String = parse_arg(&args, "kind")?;
            let kind = match kind_str.as_str() {
                "video" => TrackKind::Video,
                "audio" => TrackKind::Audio,
                other => return Err(format!("unknown track kind: {other}")),
            };
            let id = project.file.timeline.add_track(kind);
            project.save().map_err(|e| e.to_string())?;
            json!({ "track_id": id, "kind": kind_str }).to_string()
        }
        "update_export_settings" => {
            let settings: ExportSettings = serde_json::from_value(args.clone())
                .or_else(|_| parse_arg(&args, "settings"))
                .map_err(|e| e.to_string())?;
            project.file.export_settings = settings;
            project.save().map_err(|e| e.to_string())?;
            json!({ "ok": true, "export_settings": project.file.export_settings }).to_string()
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

fn resolve_clip_duration(
    project: &Project,
    source_path: &str,
    media_kind: junto_core::MediaKind,
) -> f64 {
    match media_kind {
        junto_core::MediaKind::Image => project.default_duration_for(media_kind),
        junto_core::MediaKind::Video | junto_core::MediaKind::Audio => {
            let abs = project.resolve_path(source_path);
            probe_duration_ffprobe(&abs).unwrap_or_else(|| project.default_duration_for(media_kind))
        }
    }
}

/// Temporary MCP-local duration probe until Core exports `probe_duration`.
fn probe_duration_ffprobe(path: &Path) -> Option<f64> {
    let output = std::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let duration: f64 = text.trim().parse().ok()?;
    if duration.is_finite() && duration > 0.0 {
        Some(duration)
    } else {
        None
    }
}
