use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use junto_core::{DirectoryScan, ExportSettings, Project, ScannedMediaFile, TrackKind};
use rmcp::schemars;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::SharedProject;

pub struct ToolContext {
    pub project: SharedProject,
    pub export_running: Option<Arc<AtomicBool>>,
}

impl ToolContext {
    pub fn with_project<R>(&self, f: impl FnOnce(&mut Project) -> Result<R, String>) -> Result<R, String> {
        let mut guard = self.project.write().map_err(|e| e.to_string())?;
        let project = guard.as_mut().ok_or_else(|| "no project open".to_string())?;
        f(project)
    }
}

pub fn execute_tool(ctx: &ToolContext, name: &str, args: Value) -> Result<String, String> {
    match name {
        "get_project_summary" => ctx.with_project(|project| {
            let duration = project.file.timeline.duration();
            Ok(json!({
                "name": project.file.name,
                "root": project.root,
                "duration_seconds": duration,
                "clip_count": project.file.timeline.clips.len(),
            })
            .to_string())
        }),
        "get_timeline" => ctx.with_project(|project| {
            serde_json::to_string(&project.file.timeline).map_err(|e| e.to_string())
        }),
        "list_media" => ctx.with_project(|project| {
            let media: Vec<ScannedMediaFile> = project.list_media().map_err(|e| e.to_string())?;
            serde_json::to_string(&media).map_err(|e| e.to_string())
        }),
        "scan_directory" => ctx.with_project(|project| {
            let scan: DirectoryScan = project.scan().map_err(|e| e.to_string())?;
            serde_json::to_string(&scan).map_err(|e| e.to_string())
        }),
        "add_clip" => {
            let params: AddClipParams = serde_json::from_value(args).map_err(|e| e.to_string())?;
            let track_id = parse_uuid(&params.track_id, "track_id")?;
            ctx.with_project(|project| {
                let media_kind =
                    junto_core::MediaKind::from_path(std::path::Path::new(&params.source_path))
                        .ok_or_else(|| "unsupported media file".to_string())?;
                let start = params.start.unwrap_or(0.0);
                let duration = match params.duration {
                    Some(d) => d,
                    None => project
                        .duration_for_media(&params.source_path, media_kind)
                        .map_err(|e| e.to_string())?,
                };
                let id = project
                    .file
                    .timeline
                    .add_clip(
                        track_id,
                        params.source_path,
                        media_kind,
                        start,
                        duration,
                    )
                    .map_err(|e| e.to_string())?;
                project.save().map_err(|e| e.to_string())?;
                Ok(json!({ "clip_id": id }).to_string())
            })
        }
        "move_clip" => {
            let params: MoveClipParams = serde_json::from_value(args).map_err(|e| e.to_string())?;
            let clip_id = parse_uuid(&params.clip_id, "clip_id")?;
            let new_track_id = match params.track_id {
                Some(id) => Some(parse_uuid(&id, "track_id")?),
                None => None,
            };
            ctx.with_project(|project| {
                project
                    .file
                    .timeline
                    .move_clip_to_track(clip_id, params.start, new_track_id)
                    .map_err(|e| e.to_string())?;
                project.save().map_err(|e| e.to_string())?;
                Ok(json!({ "ok": true }).to_string())
            })
        }
        "trim_clip" => {
            let params: TrimClipParams = serde_json::from_value(args).map_err(|e| e.to_string())?;
            let clip_id = parse_uuid(&params.clip_id, "clip_id")?;
            ctx.with_project(|project| {
                project
                    .file
                    .timeline
                    .trim_clip(clip_id, params.source_offset, params.duration)
                    .map_err(|e| e.to_string())?;
                project.save().map_err(|e| e.to_string())?;
                Ok(json!({ "ok": true }).to_string())
            })
        }
        "set_clip_duration" => {
            let params: SetClipDurationParams =
                serde_json::from_value(args).map_err(|e| e.to_string())?;
            let clip_id = parse_uuid(&params.clip_id, "clip_id")?;
            ctx.with_project(|project| {
                project
                    .file
                    .timeline
                    .set_clip_duration(clip_id, params.duration)
                    .map_err(|e| e.to_string())?;
                project.save().map_err(|e| e.to_string())?;
                Ok(json!({ "ok": true }).to_string())
            })
        }
        "set_photo_default_duration" => {
            let params: SetPhotoDefaultDurationParams =
                serde_json::from_value(args).map_err(|e| e.to_string())?;
            ctx.with_project(|project| {
                project
                    .set_photo_default_duration(params.duration)
                    .map_err(|e| e.to_string())?;
                project.save().map_err(|e| e.to_string())?;
                Ok(json!({ "photo_default_duration": project.file.photo_default_duration }).to_string())
            })
        }
        "add_track" => {
            let params: AddTrackParams = serde_json::from_value(args).map_err(|e| e.to_string())?;
            ctx.with_project(|project| {
                let kind = match params.kind.as_str() {
                    "video" => TrackKind::Video,
                    "audio" => TrackKind::Audio,
                    other => return Err(format!("unknown track kind: {other}")),
                };
                let id = project.file.timeline.add_track(kind);
                project.save().map_err(|e| e.to_string())?;
                Ok(json!({ "track_id": id, "kind": params.kind }).to_string())
            })
        }
        "update_export_settings" => {
            let params: UpdateExportSettingsParams =
                serde_json::from_value(args).map_err(|e| e.to_string())?;
            ctx.with_project(|project| {
                project.file.export_settings = ExportSettings {
                    width: params.width,
                    height: params.height,
                    video_codec: params.video_codec,
                    audio_codec: params.audio_codec,
                    crf: params.crf,
                    fps: params.fps,
                };
                project.save().map_err(|e| e.to_string())?;
                Ok(json!({
                    "ok": true,
                    "export_settings": project.file.export_settings
                })
                .to_string())
            })
        }
        "remove_clip" => {
            let params: RemoveClipParams = serde_json::from_value(args).map_err(|e| e.to_string())?;
            let clip_id = parse_uuid(&params.clip_id, "clip_id")?;
            ctx.with_project(|project| {
                project
                    .file
                    .timeline
                    .remove_clip(clip_id)
                    .map_err(|e| e.to_string())?;
                project.save().map_err(|e| e.to_string())?;
                Ok(json!({ "ok": true }).to_string())
            })
        }
        "set_playhead" => {
            let params: SetPlayheadParams = serde_json::from_value(args).map_err(|e| e.to_string())?;
            ctx.with_project(|project| {
                project.file.timeline.playhead = params.position.max(0.0);
                Ok(json!({ "playhead": project.file.timeline.playhead }).to_string())
            })
        }
        "export_video" => {
            let export_guard = match ctx.export_running.as_ref() {
                Some(flag) => Some(ExportRunningGuard::try_acquire(Arc::clone(flag))?),
                None => None,
            };
            let output = ctx.with_project(|project| {
                let path = project.export_blocking().map_err(|e| e.to_string())?;
                Ok(json!({ "output_path": path }).to_string())
            });
            drop(export_guard);
            output
        }
        other => Err(format!("unknown tool: {other}")),
    }
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct AddClipParams {
    pub track_id: String,
    pub source_path: String,
    #[serde(default)]
    pub start: Option<f64>,
    #[serde(default)]
    pub duration: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct MoveClipParams {
    pub clip_id: String,
    pub start: f64,
    #[serde(default)]
    pub track_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct TrimClipParams {
    pub clip_id: String,
    pub source_offset: f64,
    pub duration: f64,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SetClipDurationParams {
    pub clip_id: String,
    pub duration: f64,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SetPhotoDefaultDurationParams {
    pub duration: f64,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct AddTrackParams {
    pub kind: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct UpdateExportSettingsParams {
    pub width: u32,
    pub height: u32,
    pub video_codec: String,
    pub audio_codec: String,
    pub crf: u8,
    pub fps: u32,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct RemoveClipParams {
    pub clip_id: String,
}

#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct SetPlayheadParams {
    pub position: f64,
}

fn parse_uuid(value: &str, field: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|e| format!("invalid {field}: {e}"))
}

struct ExportRunningGuard(Arc<AtomicBool>);

impl ExportRunningGuard {
    fn try_acquire(flag: Arc<AtomicBool>) -> Result<Self, String> {
        if flag
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("export already in progress".into());
        }
        Ok(Self(flag))
    }
}

impl Drop for ExportRunningGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
