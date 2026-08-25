import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { open as openUrl } from "@tauri-apps/plugin-shell";

export interface AppConfig {
  setup_complete: boolean;
  last_project?: string | null;
}

export interface DirectoryScan {
  kind:
    | "empty"
    | "has_media_outside_raw_footage"
    | "has_media_in_raw_footage"
    | "has_non_media_only";
  media_files: ScannedMediaFile[];
  non_media_files: string[];
  raw_footage_exists: boolean;
}

export interface ScannedMediaFile {
  path: string;
  relative_path: string;
  media_kind: "video" | "image" | "audio";
}

export interface ProjectSummary {
  name: string;
  root: string;
  duration_seconds: number;
}

export interface Track {
  id: string;
  name: string;
  kind: "video" | "audio";
  index: number;
}

export interface Clip {
  id: string;
  track_id: string;
  source_path: string;
  media_kind: "video" | "image" | "audio";
  start: number;
  duration: number;
  source_offset: number;
}

export interface Timeline {
  tracks: Track[];
  clips: Clip[];
  playhead: number;
}

export interface ExportSettings {
  width: number;
  height: number;
  video_codec: string;
  audio_codec: string;
  crf: number;
  fps: number;
}

export interface ExportProgress {
  done: boolean;
  progress: number;
  message: string;
  output_path?: string;
  error?: string;
}

export const api = {
  getAppConfig: () => invoke<AppConfig>("get_app_config"),
  completeSetup: () => invoke<void>("complete_setup"),
  getMcpInfo: () => invoke<{ url: string; tools_url: string; health_url: string }>("get_mcp_info"),
  scanDirectory: (path: string) => invoke<DirectoryScan>("scan_directory", { path }),
  createProject: (path: string, name: string) =>
    invoke<ProjectSummary>("create_project", { path, name }),
  openProject: (path: string) => invoke<ProjectSummary>("open_project", { path }),
  getCurrentProject: () => invoke<ProjectSummary | null>("get_current_project"),
  importFootage: (sourcePath: string) => invoke<string[]>("import_footage", { sourcePath }),
  consolidateFootage: () => invoke<string[]>("consolidate_footage"),
  listMedia: () => invoke<ScannedMediaFile[]>("list_media"),
  getTimeline: () => invoke<Timeline>("get_timeline"),
  addClipToTimeline: (trackId: string, sourcePath: string, start: number, duration?: number) =>
    invoke<string>("add_clip_to_timeline", { trackId, sourcePath, start, duration }),
  moveTimelineClip: (clipId: string, start: number) =>
    invoke<void>("move_timeline_clip", { clipId, start }),
  removeTimelineClip: (clipId: string) => invoke<void>("remove_timeline_clip", { clipId }),
  setPlayhead: (position: number) => invoke<void>("set_playhead", { position }),
  addTrack: (kind: "video" | "audio") => invoke<string>("add_track", { kind }),
  getExportSettings: () => invoke<ExportSettings>("get_export_settings"),
  updateExportSettings: (settings: ExportSettings) =>
    invoke<void>("update_export_settings", { settings }),
  startExport: () => invoke<void>("start_export"),
  onExportProgress: (handler: (progress: ExportProgress) => void) =>
    listen<ExportProgress>("export-progress", (event) => handler(event.payload)),
};

export async function pickDirectory(title: string) {
  const selected = await open({ directory: true, multiple: false, title });
  if (!selected || Array.isArray(selected)) return null;
  return selected;
}

export async function pickFootageSource(title: string) {
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  });
  if (!selected || Array.isArray(selected)) return null;
  return selected;
}

export function mcpBundleInstructions(mcpUrl: string) {
  return JSON.stringify(
    {
      mcpServers: {
        junto: {
          url: mcpUrl,
        },
      },
    },
    null,
    2,
  );
}

export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}

export { openUrl };
