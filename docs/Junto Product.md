# Junto

> **Status:** Product definition (name locked)  
> **Repository:** [github.com/JoelYoung01/Junto](https://github.com/JoelYoung01/Junto)  
> **Last updated:** August 24, 2026

---

## 1. Vision

**Junto** is a purpose-built video production tool optimized for **quick, idea-driven video creation** — not full automation, and not a generic NLE clone.

Junto helps people turn a folder of raw footage and assets into a **finished video file** (vlog, home movie, or photo slideshow) with **high-quality export**, without requiring deep knowledge of video editing jargon, codecs, or professional tool workflows.

**Core philosophy:** This is a **tool**, not an autocomplete. The user stays in control of the creative decisions. The software makes execution fast and understandable. Natural language and an AI agent handle complexity behind the surface; the user focuses on what they want the video to be.

---

## 2. Problem

Creating personal videos today forces a bad tradeoff:

| Path | Pain |
|------|------|
| **Professional NLEs** (Resolve, Premiere, Kdenlive) | Powerful but overwhelming UI, steep learning curve, jargon-heavy |
| **Fully automated editors** | Fast but loss of editorial control; hard to steer the result |
| **Simple slideshow / template apps** | Too limited for mixed photo + video vlog workflows |

The target user often has **lots of raw footage** or **a folder of photos + music** and a **clear idea** for the video — but not the skills or patience to operate a full NLE efficiently.

---

## 3. Target Use Cases

### Primary content types

1. **Vlogs / home videos** — many clips from a trip, event, or day; narrative assembled from raw footage
2. **Photo slideshow videos** — still images with music, pacing, and light motion
3. **Hybrid** — mixed photo and video in one timeline (common for family / travel content)

### Typical workflow

1. User gathers **raw footage and assets** in a folder (video clips, photos, music tracks)
2. Junto **ingests** the folder and builds an initial **timeline** of media
3. User enters **staging / editorial mode** — review, rearrange, trim, add music
4. User refines via **direct manipulation** (drag-and-drop) and **natural language** to the agent
5. Junto **exports** a finished video file to disk

---

## 4. Product Principles

1. **Tool, not autocomplete** — AI assists execution; the user directs creative intent
2. **Hide complexity** — most functionality accessible through natural language + agent, not memorized UI
3. **Editorial staging** — explicit middle phase between ingest and final export; user can slide clips on tracks like familiar video editors
4. **Context-rich interaction** — annotations and selections on the timeline give the agent precise, visual context (inspired by annotation patterns from design tools)
5. **Folder-first** — start from a directory of media, not a blank project wizard
6. **Plain language** — avoid forcing users to learn NLE jargon unless they want to
7. **Agent as middleman** — users do not operate tools directly; a friendly agent arbitrates between intent and a **large, capable tool layer** behind the UI

---

## 4.1 Agent vs UI — where complexity lives

Junto deliberately splits the surface area:

| Layer | Who sees it | Goal |
|-------|-------------|------|
| **UI** | Human | Simple staging: folder, preview, drag-and-drop timeline, annotations, chat |
| **MCP / tool API** | Agent (in-app or external) | **Broad and robust** — many precise operations the engine can perform |
| **Agent** | Human (via chat + annotations) | Translates plain language and selection context into correct tool sequences |

**Users never need to know what tools exist.** They describe outcomes (“make this part faster,” “use the other song here”). The agent reads the tool catalog, plans steps, and calls what’s needed.

We are **not** optimizing for a minimal MCP surface for the sake of simplicity. We want **depth and coverage** on the tool side — granular timeline ops, ingest, analysis, export, annotations, safety/undo — as long as tools are **well-named, non-overlapping, and documented for agents** (not cluttered into the main UI).

More tools is fine when:

- Each tool has a clear, single responsibility
- Overlapping capabilities are distinguished in agent instructions (when to use which)
- Failures return actionable errors so the agent can recover

The complexity budget is spent on **agent + engine**, not on **menus and jargon** in the primary UI.

---

## 5. Key Features (Planned)

### 5.1 Folder ingest & project bootstrap

- Point at a folder of footage and assets
- Auto-detect video, image, and audio files
- Build an initial timeline (order, durations, track layout)
- Support both **slideshow-first** and **footage-heavy vlog** starting points

### 5.2 Staging / editorial mode

- Multi-track timeline (video/photo tracks + music/audio tracks)
- Drag-and-drop clip arrangement
- Trim, split, move, ripple-style edits at a practical (not pro-broadcast) level
- Music beds over visual content
- Preview playback before export

### 5.3 Natural language + agent control

- User describes what they want in plain language
- Agent performs timeline and project changes through a **robust MCP** (Model Context Protocol) server
- User does not need to memorize a complex UI or API
- Agent operations are **transparent and reversible** where possible (undo / checkpoints)

### 5.4 Timeline annotations & selection context

- Click or drag/select regions on the timeline to attach **context for the agent**
- Similar to annotation tools in design products: "change *this* part," "make *this section* faster," "use different music *here*"
- Selections map to concrete timeline objects (clips, ranges, tracks, markers)
- Annotations become structured input alongside natural language prompts

### 5.5 Export

- **Output is video files** — local export to disk (e.g. MP4); no built-in publishing to streaming platforms in v1
- **High-quality defaults** (1080p default; 4K where source allows)
- Sensible defaults for codec, bitrate, and audio
- ffmpeg as the **core render engine** under the hood

---

## 6. Architecture Direction

### Decision: build net-new, not fork or plugin

After evaluating Kdenlive (fork / plugin) and DaVinci Resolve (plugin), the chosen path is:

**Own the editorial layer. Use ffmpeg for media processing.**

| Layer | Responsibility |
|-------|----------------|
| **Application** | Ingest, project model, staging UI, annotations, agent chat |
| **Timeline model** | Clips, tracks, ranges, markers, music layout; exportable representation (e.g. OpenTimelineIO or internal JSON → OTIO) |
| **Render engine** | ffmpeg for transcode, concat, filter graphs, final mux |
| **Agent / MCP** | Large tool surface for agents (`ingest_folder`, `move_clip`, `set_photo_duration`, `place_music`, `annotate_range`, …); not simplified for UI exposure |
| **Optional future** | Conform / handoff to Resolve or other NLEs for advanced color or audio |

### Why not host inside an existing NLE?

- Existing NLEs optimize for **general editing**, not **fast personal video production**
- Their UIs cannot be truly hidden; plugin surfaces are limited (especially Kdenlive)
- Resolve scripting requires Studio and running Resolve; Kdenlive lacks a cross-platform official automation API
- A custom app can expose **many Junto-native tools** tuned for agents — breadth on the API, simplicity in the UI

---

## 7. Technology Stack (Initial Direction)

### Render core: ffmpeg

- Industry-standard, handles photos + video + audio in one pipeline
- Filter graphs for transitions, scaling, overlays, audio mix
- Proven path to high-quality H.264/H.265 + AAC file output

### Application language: Rust (recommended, with nuance)

**Rust is a strong choice for Junto** — not because of hype alone, but because it fits the workload:

| Concern | Rust fit |
|---------|----------|
| Fast ingest / metadata scanning | Excellent (parallel folder walks, zero-copy where possible) |
| Timeline & project state | Excellent (strong types, safe concurrency) |
| MCP server co-located with core | Excellent (single binary, low overhead) |
| Long render jobs without UI jank | Excellent (async + background workers) |
| Cross-platform desktop (Windows-first user) | Good (Tauri, native builds) |

**Important nuance:** Rust does not replace ffmpeg for actual pixel/audio processing. Rust **orchestrates** ffmpeg (CLI or `ffmpeg-next` / libav bindings). Rust sits at the right layer: **product logic + pipeline orchestration + agent server**.

#### Suggested stack (v1)

- **Rust** — core engine, timeline model, ingest, render orchestration, MCP server
- **Tauri** (Rust + web frontend) — desktop shell; fast native app with rich UI for timeline and annotations
- **Web UI** (TypeScript/React or Svelte) — timeline, drag-and-drop, annotation overlays, agent panel
- **ffmpeg** — decode, encode, filter, mux (system dependency or bundled)

---

## 8. MCP / Agent Surface (Conceptual)

The MCP layer should be **comprehensive and robust** — the full programmatic face of Junto for agents. It is **not** the user-facing UI. Tools should be precise and well-scoped (not raw ffmpeg flags leaking to the agent), but we should prefer **many clear tools** over a artificially small set when coverage matters.

### Design principles for tools

1. **Agent-facing, not user-facing** — tool count is an agent concern; the UI stays simple
2. **One job per tool** — avoid ambiguous tools that do different things based on opaque flags
3. **Composable** — agents chain small tools; optional higher-level “workflow” tools where patterns repeat
4. **Inspectable** — read tools (`get_timeline_state`, `list_clips`, vision frames) so the agent can verify before mutating
5. **Safe** — validated args, undo/checkpoints, staged edits where appropriate

### Example tool families (non-exhaustive — expect growth)

**Project & ingest**

- `open_folder`, `ingest_folder`, `scan_folder_metadata`
- `create_project_from_folder` — slideshow vs vlog heuristics
- `get_project_summary`, `get_media_pool`

**Timeline editing** (granular — agents combine as needed)

- Track/clip CRUD, trim, split, move, ripple, duplicate, link, speed, volume, fades
- Photo duration, transitions, music placement, ducking
- Markers, guides, delivery format / aspect

**Annotations & context**

- `create_annotation`, `list_annotations`, `get_selection_context`
- Bridge from UI drag-select → structured agent input

**Analysis & vision** (so agents understand footage)

- Waveform, scenes, silence, beats, transcript
- `get_frame`, `skim_asset`, `preview_timeline` (image-returning tools)

**Render**

- `preview_range`, `export_video`, export presets, job status

**Safety & history**

- `undo`, `redo`, `checkpoint_save` / `restore`, staged edit proposal/apply (optional)

We are not targeting a fixed small number of tools. Competitors expose ~48–78+ MCP tools; Junto should be **at least that capable** over time, with **agent instructions and in-app chat** as the layer that keeps users from ever thinking in tool names.

---

## 9. User Experience Sketch

```
┌─────────────────────────────────────────────────────────────────┐
│  [Folder]  [Export]                    Agent chat panel         │
├─────────────────────────────────────────────────────────────────┤
│  Media bin          │  Preview viewport                         │
│  (imported clips)   │                                           │
│                     │                                           │
├─────────────────────┴───────────────────────────────────────────┤
│  Timeline (multi-track)                                         │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│  ███ clip ████  ███ clip ███  │  ← user drag-select annotates │
│  ♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪  │     "make this part faster"   │
└─────────────────────────────────────────────────────────────────┘
```

**Interaction modes:**

- **Direct** — drag clips, trim handles, drop music on audio track
- **Conversational** — "put the beach clips first, use the upbeat track, keep each photo 3 seconds"
- **Annotated** — select a timeline region, add a note or prompt scoped to that selection

---

## 10. Quality & Output Targets

- **Default export:** 1080p, H.264 + AAC video file (e.g. MP4)
- **Optional:** 4K when source resolution supports it
- **Audio:** normalized levels, music ducking under speech (future / agent-driven)
- **Photos:** configurable default duration, transitions (crossfade, etc.)

---

## 11. Non-Goals (v1)

- Full professional color grading suite
- Multi-cam broadcast workflows
- Motion graphics / Fusion-style compositing
- Replacing DaVinci Resolve for cinema/post houses
- Fully autonomous "AI makes the whole video with no user input"
- **Platform publishing** (YouTube, TikTok, etc.) — export only; user uploads elsewhere

---

## 12. Open Questions (for later workshops)

- [x] **Product name** — **Junto**
- [ ] Slideshow vs vlog **default heuristics** when ingesting a mixed folder
- [ ] **Offline vs cloud** agent (local LLM vs API; privacy for home video)
- [ ] **Bundled ffmpeg** vs require system install
- [ ] **OpenTimelineIO** as interchange format from day one vs internal model first
- [ ] Transition / effect palette scope for v1
- [ ] Licensing model (personal free tier, pro features, etc.)

---

## 13. Conversation History / Decision Log

| Date | Decision |
|------|----------|
| Aug 21, 2026 | Evaluated fork Kdenlive, Kdenlive plugin, Resolve plugin → chose **net-new product** |
| Aug 21, 2026 | Confirmed desire for **staging editorial mode**, not full automation |
| Aug 21, 2026 | Confirmed **MCP + LLM** as primary way to hide complex functionality |
| Aug 21, 2026 | Confirmed support for **photos + video + music** in one timeline |
| Aug 24, 2026 | Confirmed **ffmpeg as core render API** |
| Aug 24, 2026 | Confirmed **tool-not-autocomplete** positioning; efficiency for non-experts |
| Aug 24, 2026 | Confirmed **timeline annotation / selection context** for agent (design-tool pattern) |
| Aug 24, 2026 | Initial language direction: **Rust** for core + suggested Tauri/web UI split |
| Aug 24, 2026 | **Output is video files only** — local export, not platform publish |
| Aug 24, 2026 | Product name **Junto**; repo [JoelYoung01/Junto](https://github.com/JoelYoung01/Junto) |
| Aug 24, 2026 | **Large MCP tool surface** behind agent middleman — UI stays simple; tools are for agents, not direct user exposure |

---

## 14. One-Line Pitch

**Junto is a fast, folder-first video tool that turns your footage and photos into finished video files — you steer the edit with simple drag-and-drop and plain language, and an agent handles the hard parts behind the scenes.**
