# MVP stub / thin-UI completion plan

Scope: implement every **stubbed / incomplete** and **placeholder / thin UI** item required for desktop MVP (`folder → project → timeline → preview → export`, plus usable MCP for agents).

**Out of scope** (documented / not built yet): in-app agent chat, NL editing, drag-select annotations, auto initial timeline heuristics, split/ripple/duplicate/link/speed/volume/fades, transitions, music ducking, staged agent edits / undo checkpoints, OTIO/Resolve, bundled ffmpeg, full vision MCP catalog.

## Workstreams

### A — Core media & export (`crates/junto-core`)

| Item | Current gap | Done when |
|------|-------------|-----------|
| Real media duration | Video/audio default to `5.0s` | `ffprobe` duration used when adding clips; images keep `photo_default_duration` |
| Timeline-aware export | Naive concat ignores gaps / start times | Export spans full timeline length; gaps render as black (silence on A) |
| Audio in export | Audio clips skipped | Music/audio tracks mixed into final MP4 |
| `source_offset` in export | Partially used for video only | All visual/audio segments honor trim in/out |
| Real export progress | Preparing → Done | Progress updates while rendering segments / final mux |

### B — Timeline editing APIs (`timeline` + desktop + MCP)

| Item | Current gap | Done when |
|------|-------------|-----------|
| Trim | `source_offset` unused in UI; no mutate API | `trim_clip(clip_id, source_offset, duration)` with overlap checks |
| Move across tracks | `move_clip` only changes start | `move_clip(clip_id, start, track_id?)` |
| Photo / clip duration | No setter | `set_clip_duration` + `set_photo_default_duration` |
| MCP tools | Thin set missing trim/track/duration | Tools cover MVP editorial surface; `/health` used for verify |

### C — Editor / setup UI (`ui/`)

| Item | Current gap | Done when |
|------|-------------|-----------|
| Add Track | Always creates video | Explicit Video / Audio track actions |
| Trim UI | None | Selected clip: In / Out (or duration + offset) controls |
| Cross-track move | Drag stays on same lane | Drop onto another compatible track |
| Photo duration | Hardcoded default only | Editable default + per-clip duration for images |
| Export settings | Header Export ignores advanced edits | Dialog opens first; Export applies saved settings then runs |
| Filmstrip | Single tiled still | Multi-frame strip sampled across clip |
| MCP status | “not verified yet” | Poll `/health` and show connected / unreachable |
| Preview playback | JPEG scrub only | Keep frame preview; play advances playhead with accurate trimmed frames (MVP preview fidelity) |

## Acceptance (MVP merge gate)

1. Add real-length video/audio without hardcoded 5s.
2. Trim a clip; preview and export use the trimmed range.
3. Leave a gap on the timeline; export contains black for that gap (not collapsed).
4. Place music on an audio track; export contains audible audio.
5. Export progress moves through intermediate percentages.
6. Add an audio track from UI; move a clip between tracks.
7. Change photo default duration and a still’s on-timeline duration.
8. Advanced export settings are applied when exporting.
9. Setup shows live MCP health; MCP can trim / move-to-track / set duration / add track.

## Ownership for parallel implementation

- **Agent A:** `media.rs` (+ probe helpers), `project.rs` export path, core tests
- **Agent B:** `timeline.rs`, `junto-desktop` commands, `junto-mcp` tools + tests
- **Agent C:** `ui/src/**` only (api.ts, EditorView, TimelineClip, SetupView)

Integration: parent merges branches, runs `cargo test`, `pnpm build:ui`, smoke export.
