# Junto

A fast, folder-first desktop video tool for personal video — vlogs, home movies, and photo slideshows.

Open a folder of footage and assets, refine the cut on a simple timeline (drag-and-drop + natural language), and export a finished video file. Junto is a **tool**, not an autocomplete: you stay in control; an in-app agent handles complexity via a **large MCP tool layer** you never have to learn.

## Guiding principles

1. **Cross-platform desktop (v1)** — Linux, macOS, and Windows. Web, iOS, and Android later.

2. **Simple surface, capable engine** — Folder, preview, timeline, annotations. No jargon. Editing depth lives in the engine and agent layer, not the menus.

3. **Agent + MCP** — Users speak in plain language; a large streamable-HTTP MCP API does the work. In-app chat and external agents (via one-click plugin bundles) share one live project. Users never see tool names.

4. **Timeline annotations** — Drag-select a region to attach structured context for the agent. Copy to clipboard for external agent sessions.

5. **Folder-first** — Open a directory of clips, photos, and music → auto-built timeline (vlog, slideshow, or hybrid).

6. **You steer, AI assists** — Not full automation. Agent changes are staged: propose → preview → apply or discard.

7. **Personal video, local export** — Home movies and slideshows. MP4 to disk. No platform publishing or gen credits in v1.

8. **Fast and non-destructive** — Renders and agent work off the UI thread. Source files untouched until export.

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
