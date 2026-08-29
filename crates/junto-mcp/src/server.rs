use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock},
    tool, tool_handler, tool_router, ServerHandler,
};
use serde_json::json;

use crate::tools::{
    execute_tool, AddClipParams, AddTrackParams, MoveClipParams, RemoveClipParams,
    SetClipDurationParams, SetPhotoDefaultDurationParams, SetPlayheadParams, ToolContext,
    TrimClipParams, UpdateExportSettingsParams,
};
use crate::SharedProject;

#[derive(Clone)]
pub struct JuntoMcpServer {
    project: SharedProject,
    export_running: Option<Arc<AtomicBool>>,
}

impl JuntoMcpServer {
    pub fn new(project: SharedProject, export_running: Option<Arc<AtomicBool>>) -> Self {
        Self {
            project,
            export_running,
        }
    }

    fn ctx(&self) -> ToolContext {
        ToolContext {
            project: Arc::clone(&self.project),
            export_running: self.export_running.clone(),
        }
    }

    fn run_tool(&self, name: &str, args: serde_json::Value) -> CallToolResult {
        tracing::info!(tool = name, "MCP tool call started");
        tracing::debug!(tool = name, args = %args, "MCP tool arguments");

        match execute_tool(&self.ctx(), name, args) {
            Ok(text) => {
                tracing::info!(
                    tool = name,
                    response_bytes = text.len(),
                    "MCP tool call succeeded"
                );
                CallToolResult::success(vec![ContentBlock::text(text)])
            }
            Err(err) => {
                tracing::warn!(tool = name, error = %err, "MCP tool call returned error");
                CallToolResult::error(vec![ContentBlock::text(err)])
            }
        }
    }
}

#[tool_router]
impl JuntoMcpServer {
    #[tool(description = "Get project name, path, and timeline duration")]
    fn get_project_summary(&self) -> CallToolResult {
        self.run_tool("get_project_summary", json!({}))
    }

    #[tool(description = "Get full timeline state")]
    fn get_timeline(&self) -> CallToolResult {
        self.run_tool("get_timeline", json!({}))
    }

    #[tool(description = "List media files in Raw Footage")]
    fn list_media(&self) -> CallToolResult {
        self.run_tool("list_media", json!({}))
    }

    #[tool(description = "Scan project directory layout")]
    fn scan_directory(&self) -> CallToolResult {
        self.run_tool("scan_directory", json!({}))
    }

    #[tool(description = "Add a clip to the timeline")]
    fn add_clip(&self, Parameters(params): Parameters<AddClipParams>) -> CallToolResult {
        self.run_tool(
            "add_clip",
            serde_json::to_value(params).unwrap_or_else(|_| json!({})),
        )
    }

    #[tool(description = "Move a clip on the timeline; optional track_id for cross-track move")]
    fn move_clip(&self, Parameters(params): Parameters<MoveClipParams>) -> CallToolResult {
        self.run_tool(
            "move_clip",
            serde_json::to_value(params).unwrap_or_else(|_| json!({})),
        )
    }

    #[tool(description = "Trim a clip source_offset and duration")]
    fn trim_clip(&self, Parameters(params): Parameters<TrimClipParams>) -> CallToolResult {
        self.run_tool(
            "trim_clip",
            serde_json::to_value(params).unwrap_or_else(|_| json!({})),
        )
    }

    #[tool(description = "Set a clip visible duration without changing source_offset")]
    fn set_clip_duration(
        &self,
        Parameters(params): Parameters<SetClipDurationParams>,
    ) -> CallToolResult {
        self.run_tool(
            "set_clip_duration",
            serde_json::to_value(params).unwrap_or_else(|_| json!({})),
        )
    }

    #[tool(description = "Set default duration for newly added photos")]
    fn set_photo_default_duration(
        &self,
        Parameters(params): Parameters<SetPhotoDefaultDurationParams>,
    ) -> CallToolResult {
        self.run_tool(
            "set_photo_default_duration",
            serde_json::to_value(params).unwrap_or_else(|_| json!({})),
        )
    }

    #[tool(description = "Add a video or audio track")]
    fn add_track(&self, Parameters(params): Parameters<AddTrackParams>) -> CallToolResult {
        self.run_tool(
            "add_track",
            serde_json::to_value(params).unwrap_or_else(|_| json!({})),
        )
    }

    #[tool(description = "Update project export settings")]
    fn update_export_settings(
        &self,
        Parameters(params): Parameters<UpdateExportSettingsParams>,
    ) -> CallToolResult {
        self.run_tool(
            "update_export_settings",
            serde_json::to_value(params).unwrap_or_else(|_| json!({})),
        )
    }

    #[tool(description = "Remove a clip and ripple later clips on that track left by its duration")]
    fn remove_clip(&self, Parameters(params): Parameters<RemoveClipParams>) -> CallToolResult {
        self.run_tool(
            "remove_clip",
            serde_json::to_value(params).unwrap_or_else(|_| json!({})),
        )
    }

    #[tool(description = "Set playhead position in seconds")]
    fn set_playhead(&self, Parameters(params): Parameters<SetPlayheadParams>) -> CallToolResult {
        self.run_tool(
            "set_playhead",
            serde_json::to_value(params).unwrap_or_else(|_| json!({})),
        )
    }

    #[tool(description = "Export timeline to MP4 in outputs/")]
    fn export_video(&self) -> CallToolResult {
        self.run_tool("export_video", json!({}))
    }
}

#[tool_handler(router = Self::tool_router(), name = "junto", version = "0.1.0")]
impl ServerHandler for JuntoMcpServer {}