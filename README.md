# Junto

A fast, folder-first desktop video tool for personal video — vlogs, home movies, and photo slideshows.

Open a folder of footage and assets, refine the cut on a simple timeline (drag-and-drop + natural language), and export a finished video file. Junto is a **tool**, not an autocomplete: you stay in control; an in-app agent handles complexity via a **large MCP tool layer** you never have to learn.

## Guiding principles

These are the product ideas we build against. When a design or engineering choice is unclear, come back here.

### 1. Cross-platform desktop first

Junto ships as a native app for **Linux, macOS, and Windows**. Personal video creators use all three; we do not gate features to one OS.

**In scope for v1:** desktop builds for all three platforms.

**Out of scope for v1 (future):** web app with hosted backend, iOS, and Android.

### 2. Simple surface, capable engine

The UI stays minimal: folder ingest, preview, a drag-and-drop timeline, and annotation. No jargon, no dense menus, no requirement to learn NLE vocabulary.

Behind that simple surface sits a **first-class video engine** — robust ingest, timeline editing, analysis, and export — comparable in depth to what you'd expect from serious editor tooling. Complexity lives in the engine and agent layer, not in the primary UI.

### 3. The agent is the bridge

An LLM-backed agent sits between the user and the engine. Users describe outcomes in plain language ("make this part faster," "use the upbeat track here"); the agent plans and executes the right operations.

Users **never need to know tool names**. The agent reads a large, well-documented tool catalog and handles the hard parts.

### 4. Large MCP API, streamable HTTP

Junto exposes a **comprehensive MCP server** over **streamable HTTP** — the full programmatic face of the app for agents. This is not a minimal side API; it should grow toward the breadth of mature MCP-native editors (dozens of precise, composable tools for ingest, timeline ops, analysis, annotations, render, undo, and more).

Tool design rules:

- One clear job per tool
- Inspectable state (agents can read before they write)
- Safe mutations (validation, undo, staged edits where appropriate)
- Agent-facing documentation, not user-facing menus

### 5. Connect any agent via bundles

Users should be able to connect **their** agent — Cursor, Claude Code, Claude Desktop, or similar — to Junto without wiring things by hand. We leverage the emerging **plugin/bundle pattern** (skills + MCP packaged together) so installing Junto in an agent environment is a one-click flow.

In-app chat and external MCP clients share the **same live project** — one timeline, two callers.

### 6. Annotations that carry context

Click-to-annotate and drag-select on the timeline attach **structured context** to a clip or range. That context flows to the agent (and can be copied to the clipboard so users can paste it into an external agent session).

This is the primary UX for "change *this part*" — inspired by annotation patterns in design tools, not just timeline markers.

### 7. Folder-first, not blank-project-first

Start from a **directory of media** (clips, photos, music), not an empty timeline wizard. Junto ingests the folder, detects asset types, and builds an initial timeline — tuned for **vlog**, **slideshow**, or **hybrid** workflows.

### 8. Tool, not autocomplete

AI assists execution; the user directs creative intent. Junto is not "make my video for me with no input." It is a fast staging tool where you review, rearrange, trim, and refine — with the agent doing the tedious work when you ask.

**Staged agent edits** (propose → preview → apply or discard) keep trust high for non-experts.

### 9. Personal video, export to file

Built for **home movies, travel vlogs, and photo slideshows** — not AI marketing reels, not cinema post-production, not a generic NLE clone.

**Output is a local video file** (e.g. MP4 via ffmpeg). No built-in publishing to YouTube or TikTok in v1. No generative-video credit meter in v1.

### 10. Local-first and reliable

Heavy work — ffmpeg renders, folder scans, MCP tool calls, vision/analysis — runs **off the UI thread** so the app stays responsive while agents work.

Sources stay **non-destructive** until export. Agent via BYOK or the user's existing subscriptions; privacy-friendly for home footage.

---

## Who it's for

People with a folder of trip footage, event clips, or photos plus music — and a clear idea for the video — who don't want to learn Resolve, Premiere, or professional editing jargon.

## Status

Early product definition and competitive research. Application code not started yet.

## Documentation

- [Product definition](./docs/Junto%20Product.md)
- [Competitive wedge summary](./docs/competitive/Wedge%20Summary%20—%20Kerf%20vs%20Palmier%20vs%20Us.md)
- [Kerf analysis](./docs/competitive/Kerf%20Product%20Analysis.md)
- [Palmier Pro analysis](./docs/competitive/Palmier%20Pro%20Product.md)

## Stack (planned)

- **Rust** — core engine, timeline model, ingest, render orchestration, MCP server
- **Tauri** — cross-platform desktop shell
- **Web UI** — timeline, drag-and-drop, annotation overlays, agent panel
- **ffmpeg** — decode, encode, filter, mux

## Repository

https://github.com/JoelYoung01/Junto
