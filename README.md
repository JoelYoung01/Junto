# Junto

A fast, filesystem-first desktop video tool for personal video — vlogs, home movies, and photo slideshows.

Open a folder of footage and assets, refine the cut on a simple timeline (drag-and-drop + natural language), and export a finished video file. Junto is a **tool**, not an autocomplete: you stay in control; an in-app agent handles complexity via a **large MCP tool layer** you never have to learn.

## Guiding principles

### Cross-platform desktop (v1)

Ship on Linux, macOS, and Windows. Web, iOS, and Android are out of scope for v1.

### Simple surface

Minimal UI: folder, preview, timeline, and drag-select annotations. No jargon.

### Filesystem-first

Open a directory of clips, photos, and music. Junto builds an initial timeline for vlog, slideshow, or hybrid workflows.

### You steer, Agent assists

Not full automation. Agent changes are staged: propose, preview, then apply or discard.

### Fast and non-destructive

Renders and agent work run off the UI thread. Source files stay untouched until export.

---



## Who it's for

People with a folder of trip footage, event clips, or photos plus music — and a clear idea for the video — who don't want to learn Resolve, Premiere, or professional editing jargon.

## Status

MVP in progress. Rust core + Tauri desktop shell + React UI (shadcn/Tailwind).

## Development

Requires [pnpm](https://pnpm.io), Rust (1.85+), and ffmpeg.

```bash
pnpm install          # install UI deps (workspace root)
pnpm dev              # UI only (Vite)
./scripts/build.sh    # build UI + desktop release binary
```

Tauri dev (UI + desktop):

```bash
export PATH="$HOME/.cargo/bin:$PATH"
cargo run -p junto-desktop
```

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

[https://github.com/JoelYoung01/Junto](https://github.com/JoelYoung01/Junto)