---
name: junto
description: >-
  Use the local Junto MCP server to inspect and edit the open project timeline,
  media library, playhead, and export settings. Load when working on Junto
  projects, driving edits via MCP tools, debugging timeline state, or needing a
  brief architecture overview of the app.
---

# Junto

Junto is a filesystem-first desktop video editor (Tauri + React UI + Rust core).
An in-app **MCP server** exposes the open project so agents can edit the timeline
without learning the UI.

## Prerequisites

1. **Junto desktop must be running** with a project open.
2. MCP listens on loopback only: `http://127.0.0.1:7799/mcp`
3. Optional health check (non-MCP): `GET http://127.0.0.1:7799/health`
4. **ffmpeg** must be available for export and frame/duration tooling.

If tools fail with “no project open”, open or create a project in the app first.

## Architecture (usage-relevant)

| Layer | Role |
| --- | --- |
| `junto-core` | Project model, timeline, import, thumbnails, export orchestration |
| `junto-mcp` | Streamable HTTP MCP tools over the shared in-memory project |
| `junto-desktop` | Tauri shell; starts MCP on `127.0.0.1:7799`; UI commands share the same project |
| `ui/` | React editor (timeline, preview, file tree) |

Important for agents:

- **One open project** is shared by the UI and MCP. MCP mutations save the project file.
- Media paths are **project-relative** (typically under `Raw Footage/…`).
- Tracks are `video` or `audio`. Video/image clips go on video tracks; audio on audio tracks.
- Clips on a track **must not overlap**. Moves/adds that would overlap fail.
- Export settings (`width`/`height`/`fps`/codecs/CRF) control the output; the UI preview stage matches that aspect ratio.
- Source files stay untouched until export writes a finished video.

## MCP workflow

Prefer this order:

1. `get_project_summary` — confirm name, root, duration, clip count
2. `get_timeline` / `list_media` / `scan_directory` — inspect state and assets
3. Mutate with `add_track`, `add_clip`, `move_clip`, `trim_clip`, `set_clip_duration`, `remove_clip`, `set_playhead`, `set_photo_default_duration`, `update_export_settings`
4. `export_video` last — **blocking**; only one export at a time

After mutations, re-read `get_timeline` before further edits so IDs and times stay accurate.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_project_summary` | Name, root path, duration, clip count |
| `get_timeline` | Full tracks + clips + playhead JSON |
| `list_media` | Media under Raw Footage |
| `scan_directory` | Project directory layout scan |
| `add_track` | `{ "kind": "video" \| "audio" }` → `track_id` |
| `add_clip` | `{ track_id, source_path, start?, duration? }` — duration inferred when omitted |
| `move_clip` | `{ clip_id, start, track_id? }` — optional cross-track move |
| `trim_clip` | `{ clip_id, source_offset, duration }` |
| `set_clip_duration` | `{ clip_id, duration }` (timeline duration only) |
| `set_photo_default_duration` | Default length for new stills |
| `remove_clip` | `{ clip_id }` |
| `set_playhead` | `{ position }` seconds |
| `update_export_settings` | `{ width, height, video_codec, audio_codec, crf, fps }` |
| `export_video` | Blocking export → `{ output_path }` |

IDs are UUID strings from `get_timeline` / tool responses.

## Practical tips

- Place clips with enough gap; on conflict, pick another `start` or track.
- Stills use photo default duration unless `duration` is set on `add_clip`.
- Keep video and audio on matching track kinds.
- Do not call `export_video` in a tight loop; wait for completion.
- UI and MCP stay in sync via the shared project — refresh timeline reads after UI-only edits if the user may have changed the cut.

## Out of scope for this plugin

- Starting the desktop binary (user runs the app / `cargo tauri dev`)
- Remote/non-loopback MCP
- Resources, prompts, or subscriptions (tools only)
