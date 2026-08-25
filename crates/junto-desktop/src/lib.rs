use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use junto_core::{
    DirectoryScan, ExportSettings, Project, ScannedMediaFile, Timeline, TrackKind,
};
use junto_mcp::{start_server, SharedProject};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

mod app_config;

pub use app_config::{load as load_app_config, save as save_app_config};

pub struct AppState {
    pub project: SharedProject,
    pub mcp_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub setup_complete: bool,
    #[serde(default)]
    pub last_project: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectSummary {
    pub name: String,
    pub root: String,
    pub duration_seconds: f64,
}

#[tauri::command]
fn get_app_config() -> Result<AppConfig, String> {
    app_config::load().map_err(|e| e.to_string())
}

#[tauri::command]
fn complete_setup() -> Result<(), String> {
    let mut config = app_config::load().map_err(|e| e.to_string())?;
    config.setup_complete = true;
    app_config::save(&config).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_mcp_info(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "url": format!("http://127.0.0.1:{}/mcp", state.mcp_port),
        "tools_url": format!("http://127.0.0.1:{}/tools", state.mcp_port),
        "health_url": format!("http://127.0.0.1:{}/health", state.mcp_port),
    }))
}

#[tauri::command]
fn scan_directory(path: String) -> Result<DirectoryScan, String> {
    let path = PathBuf::from(path);
    junto_core::scan_project_directory(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_project(path: String, name: String, state: State<'_, AppState>) -> Result<ProjectSummary, String> {
    let root = PathBuf::from(path);
    let project = Project::create(root, name).map_err(|e| e.to_string())?;
    let summary = project_summary(&project);
    app_config::remember_project(&project.root).map_err(|e| e.to_string())?;
    *state.project.write().map_err(|e| e.to_string())? = Some(project);
    Ok(summary)
}

#[tauri::command]
fn open_project(path: String, state: State<'_, AppState>) -> Result<ProjectSummary, String> {
    let root = PathBuf::from(path);
    let project = Project::open(root).map_err(|e| e.to_string())?;
    let summary = project_summary(&project);
    app_config::remember_project(&project.root).map_err(|e| e.to_string())?;
    *state.project.write().map_err(|e| e.to_string())? = Some(project);
    Ok(summary)
}

#[tauri::command]
fn get_current_project(state: State<'_, AppState>) -> Result<Option<ProjectSummary>, String> {
    let guard = state.project.read().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(project_summary))
}

#[tauri::command]
fn import_footage(source_path: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    let imported = project
        .import_footage(&PathBuf::from(source_path))
        .map_err(|e| e.to_string())?;
    project.save().map_err(|e| e.to_string())?;
    Ok(imported)
}

#[tauri::command]
fn consolidate_footage(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    let moved = project.consolidate_footage().map_err(|e| e.to_string())?;
    project.save().map_err(|e| e.to_string())?;
    Ok(moved)
}

#[tauri::command]
fn list_media(state: State<'_, AppState>) -> Result<Vec<ScannedMediaFile>, String> {
    let guard = state.project.read().map_err(|e| e.to_string())?;
    let project = guard.as_ref().ok_or_else(|| "no project open".to_string())?;
    project.list_media().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_timeline(state: State<'_, AppState>) -> Result<Timeline, String> {
    let guard = state.project.read().map_err(|e| e.to_string())?;
    let project = guard.as_ref().ok_or_else(|| "no project open".to_string())?;
    Ok(project.file.timeline.clone())
}

#[tauri::command]
fn add_clip_to_timeline(
    track_id: String,
    source_path: String,
    start: f64,
    duration: Option<f64>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let track_id = Uuid::parse_str(&track_id).map_err(|e| e.to_string())?;
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    let media_kind = junto_core::MediaKind::from_path(std::path::Path::new(&source_path))
        .ok_or_else(|| "unsupported media file".to_string())?;
    let duration = match duration {
        Some(d) => d,
        None => project.duration_for_media(&source_path, media_kind),
    };
    let clip_id = project
        .file
        .timeline
        .add_clip(track_id, source_path, media_kind, start, duration)
        .map_err(|e| e.to_string())?;
    project.save().map_err(|e| e.to_string())?;
    Ok(clip_id.to_string())
}

#[tauri::command]
fn move_timeline_clip(
    clip_id: String,
    start: f64,
    track_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let clip_id = Uuid::parse_str(&clip_id).map_err(|e| e.to_string())?;
    let new_track_id = match track_id {
        Some(id) => Some(Uuid::parse_str(&id).map_err(|e| e.to_string())?),
        None => None,
    };
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    project
        .file
        .timeline
        .move_clip_to_track(clip_id, start, new_track_id)
        .map_err(|e| e.to_string())?;
    project.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn trim_timeline_clip(
    clip_id: String,
    source_offset: f64,
    duration: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let clip_id = Uuid::parse_str(&clip_id).map_err(|e| e.to_string())?;
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    project
        .file
        .timeline
        .trim_clip(clip_id, source_offset, duration)
        .map_err(|e| e.to_string())?;
    project.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_timeline_clip_duration(
    clip_id: String,
    duration: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let clip_id = Uuid::parse_str(&clip_id).map_err(|e| e.to_string())?;
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    project
        .file
        .timeline
        .set_clip_duration(clip_id, duration)
        .map_err(|e| e.to_string())?;
    project.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_photo_default_duration(duration: f64, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    project
        .set_photo_default_duration(duration)
        .map_err(|e| e.to_string())?;
    project.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_photo_default_duration(state: State<'_, AppState>) -> Result<f64, String> {
    let guard = state.project.read().map_err(|e| e.to_string())?;
    let project = guard.as_ref().ok_or_else(|| "no project open".to_string())?;
    Ok(project.file.photo_default_duration)
}

#[tauri::command]
fn remove_timeline_clip(clip_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let clip_id = Uuid::parse_str(&clip_id).map_err(|e| e.to_string())?;
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    project
        .file
        .timeline
        .remove_clip(clip_id)
        .map_err(|e| e.to_string())?;
    project.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_playhead(position: f64, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    // Playhead is ephemeral UI state — avoid writing project.json on every tick.
    project.file.timeline.playhead = position.max(0.0);
    Ok(())
}

#[tauri::command]
fn add_track(kind: String, state: State<'_, AppState>) -> Result<String, String> {
    let track_kind = match kind.as_str() {
        "video" => TrackKind::Video,
        "audio" => TrackKind::Audio,
        other => return Err(format!("unknown track kind: {other}")),
    };
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    let id = project.file.timeline.add_track(track_kind);
    project.save().map_err(|e| e.to_string())?;
    Ok(id.to_string())
}

#[tauri::command]
fn get_export_settings(state: State<'_, AppState>) -> Result<ExportSettings, String> {
    let guard = state.project.read().map_err(|e| e.to_string())?;
    let project = guard.as_ref().ok_or_else(|| "no project open".to_string())?;
    Ok(project.file.export_settings.clone())
}

#[tauri::command]
fn update_export_settings(settings: ExportSettings, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.project.write().map_err(|e| e.to_string())?;
    let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
    project.file.export_settings = settings;
    project.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn start_export(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let rx = {
        let guard = state.project.read().map_err(|e| e.to_string())?;
        let project = guard.as_ref().ok_or_else(|| "no project open".to_string())?;
        tracing::info!(
            "starting export for project {} ({} clips)",
            project.root.display(),
            project.file.timeline.clips.len()
        );
        project.export_async()
    };

    tauri::async_runtime::spawn_blocking(move || {
        while let Ok(progress) = rx.recv() {
            tracing::info!(
                "export progress: {}% {} {:?}",
                (progress.progress * 100.0) as i32,
                progress.message,
                progress.output_path
            );
            let _ = app.emit("export-progress", &progress);
            if progress.done {
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
async fn get_media_frame(
    source_path: String,
    time_seconds: Option<f64>,
    max_width: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let (root, abs) = {
        let guard = state.project.read().map_err(|e| e.to_string())?;
        let project = guard.as_ref().ok_or_else(|| "no project open".to_string())?;
        let abs = project.resolve_path(&source_path);
        (project.root.clone(), abs)
    };
    let kind = junto_core::MediaKind::from_path(&abs);
    if matches!(kind, Some(junto_core::MediaKind::Audio) | None) {
        return Ok(None);
    }
    let time = time_seconds.unwrap_or(0.0);
    let width = max_width.unwrap_or(320);
    let source_path_clone = source_path.clone();
    let jpeg = tauri::async_runtime::spawn_blocking(move || {
        junto_core::frame_jpeg_cached(&root, &source_path_clone, &abs, time, width)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;
    Ok(Some(format!(
        "data:image/jpeg;base64,{}",
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, jpeg)
    )))
}

#[tauri::command]
async fn get_preview_frame(
    playhead: Option<f64>,
    max_width: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    let snapshot = {
        let guard = state.project.read().map_err(|e| e.to_string())?;
        let project = guard.as_ref().ok_or_else(|| "no project open".to_string())?;
        let t = playhead.unwrap_or(project.file.timeline.playhead);
        let width = max_width.unwrap_or(640);

        let mut visual: Vec<_> = project
            .file
            .timeline
            .clips
            .iter()
            .filter(|c| {
                matches!(
                    c.media_kind,
                    junto_core::MediaKind::Video | junto_core::MediaKind::Image
                )
            })
            .filter(|c| t + f64::EPSILON >= c.start && t <= c.start + c.duration + 0.05)
            .cloned()
            .collect();
        visual.sort_by(|a, b| {
            let track_a = project
                .file
                .timeline
                .tracks
                .iter()
                .find(|tr| tr.id == a.track_id)
                .map(|tr| tr.index)
                .unwrap_or(0);
            let track_b = project
                .file
                .timeline
                .tracks
                .iter()
                .find(|tr| tr.id == b.track_id)
                .map(|tr| tr.index)
                .unwrap_or(0);
            track_a.cmp(&track_b)
        });

        let Some(clip) = visual.into_iter().next() else {
            return Ok(None);
        };
        let local = (t - clip.start + clip.source_offset).max(0.0);
        let abs = project.resolve_path(&clip.source_path);
        (
            project.root.clone(),
            clip.source_path,
            clip.media_kind,
            abs,
            local,
            width,
            t,
        )
    };

    let (root, source_path, media_kind, abs, local, width, t) = snapshot;
    let jpeg = tauri::async_runtime::spawn_blocking(move || {
        junto_core::frame_jpeg_cached(&root, &source_path, &abs, local, width)
            .map(|jpeg| (jpeg, source_path, media_kind))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let (jpeg, source_path, media_kind) = jpeg;
    Ok(Some(serde_json::json!({
        "data_url": format!(
            "data:image/jpeg;base64,{}",
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, jpeg)
        ),
        "source_path": source_path,
        "media_kind": media_kind,
        "playhead": t,
    })))
}

fn project_summary(project: &Project) -> ProjectSummary {
    ProjectSummary {
        name: project.file.name.clone(),
        root: project.root.to_string_lossy().into(),
        duration_seconds: project.file.timeline.duration(),
    }
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .init();

    let project: SharedProject = Arc::new(RwLock::new(None));

    // Prefer explicit env override, then last opened project from config.
    if let Some(path) = std::env::var_os("JUNTO_OPEN_PROJECT") {
        let path = PathBuf::from(path);
        match Project::open(path.clone()).or_else(|_| {
            Project::create(
                path.clone(),
                path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Untitled Project")
                    .to_string(),
            )
        }) {
            Ok(opened) => {
                let _ = app_config::remember_project(&opened.root);
                tracing::info!("Opened project from JUNTO_OPEN_PROJECT: {}", opened.root.display());
                *project.write().expect("project lock") = Some(opened);
            }
            Err(err) => tracing::warn!("JUNTO_OPEN_PROJECT failed: {err}"),
        }
    } else if let Ok(config) = app_config::load() {
        if let Some(path) = config.last_project {
            match Project::open(PathBuf::from(&path)) {
                Ok(opened) => {
                    tracing::info!("Reopened last project: {}", opened.root.display());
                    *project.write().expect("project lock") = Some(opened);
                }
                Err(err) => tracing::warn!("Failed to reopen last project {path}: {err}"),
            }
        }
    }

    let mcp_port = 7799u16;
    let mcp_project = Arc::clone(&project);

    tauri::async_runtime::spawn(async move {
        let addr: SocketAddr = format!("127.0.0.1:{mcp_port}").parse().unwrap();
        if let Err(err) = start_server(mcp_project, addr).await {
            tracing::error!("MCP server failed: {err}");
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState { project, mcp_port })
        .invoke_handler(tauri::generate_handler![
            get_app_config,
            complete_setup,
            get_mcp_info,
            scan_directory,
            create_project,
            open_project,
            get_current_project,
            import_footage,
            consolidate_footage,
            list_media,
            get_timeline,
            add_clip_to_timeline,
            move_timeline_clip,
            trim_timeline_clip,
            set_timeline_clip_duration,
            set_photo_default_duration,
            get_photo_default_duration,
            remove_timeline_clip,
            set_playhead,
            add_track,
            get_export_settings,
            update_export_settings,
            start_export,
            get_media_frame,
            get_preview_frame,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Junto");
}
