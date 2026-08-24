# Kerf — Competitive Product Analysis

> **Analyzed:** August 24, 2026  
> **Repo:** [OrellBuehler/kerf](https://github.com/OrellBuehler/kerf)  
> **Version reference:** v0.19.2  
> **License:** PolyForm Noncommercial 1.0.0  
> **Traction:** ~4 GitHub stars, solo maintainer, 0 open issues (35 closed, maintainer-driven)

---

## 1. Executive Summary

Kerf is a **mature, cross-platform desktop NLE** (Rust + Tauri + Svelte + ffmpeg) whose product thesis is: **the editor is an API**. The GUI and an embedded MCP server (78 tools, HTTP on `127.0.0.1:7777/mcp`) share one live `Project` — agent edits appear instantly in the timeline.

It is **not** a folder-first vlog tool. It is a capable non-destructive editor with pro-adjacent depth (360/Insta360, beat snapping, keyframes, ducking, transcript editing, staged agent proposals). The agent is **external** (Claude Code, Cursor, etc.) — no embedded chat LLM.

**Relevance to us:** Best-in-class **technical reference** for dual-surface architecture, ffmpeg export purity, vision MCP tools, and staged agent safety. **Different category** from our folder-first personal video product.

---

## 2. Product Positioning

| Dimension | Kerf |
|-----------|------|
| **Primary user** | Technical creators / agent operators who want a real NLE driven by MCP |
| **Core job** | Non-destructive cut assembly with agent + human on same timeline |
| **AI role** | External MCP client analyzes footage and executes cuts |
| **Monetization** | None (noncommercial license) |
| **Platform** | Windows, macOS, Linux (Tauri) |
| **Maturity** | Shipped editor — timeline, preview, export, MCP all wired to real state |

**Tagline (implicit):** “The non-destructive video editor your AI can drive.”

---

## 3. Architecture (from code)

```
kerf-core (UI-agnostic)     kerf-app (Tauri adapter)
├── model.rs (EDL)           ├── lib.rs — Arc<Mutex<Project>>
├── project.rs (SQLite .kerf) ├── Tauri commands → GUI
├── analysis.rs             └── mcp.rs — rmcp HTTP server
└── engine/cli.rs (ffmpeg)         same Project mutex
frontend (SvelteKit 5)
```

### Design decisions that matter

1. **Single mutation path** — GUI and MCP both call `Project`; edits attributed `User` vs `Agent`.
2. **True EDL** — sources untouched until export; clips reference source ranges.
3. **Staged agent edits** — agent writes proposal timeline; user reviews diff, preview, apply/discard.
4. **Task queue** — persisted NL tasks (`claim_next_task`); not embedded chat.
5. **Vision MCP** — `get_frame`, `skim_asset`, `preview_timeline` return **images** to the model.
6. **ffmpeg as CLI orchestration** — pure `build_filter_complex` unit-tested; optional in-process libav (off by default).
7. **Windows bundles ffmpeg** — dev builds can run with `--no-default-features` (no libav).

### Stack match with our planned stack

| Layer | Kerf | Our plan |
|-------|------|----------|
| Core | Rust | Rust |
| Shell | Tauri 2 | Tauri |
| UI | Svelte 5 | TS/Svelte (planned) |
| Render | ffmpeg | ffmpeg |
| MCP | rmcp HTTP embedded | MCP embedded (planned) |

---

## 4. Key Product Ideas (insights from implementation)

### 4.1 Staged edits with reviewable diffs

Agent mutations during `stage_edits` land in a **proposal** timeline. UI shows added/removed/moved/retrimmed clips. User previews proposal, then applies as one revision or discards. Stale detection if user edited meanwhile.

**Insight:** Safer than “agent edits live immediately” for non-expert users — aligns with our “tool not autocomplete” principle.

### 4.2 Agent can *see* footage

Visual MCP tools return JPEG/contact sheets/composited timeline stills — not just metadata JSON.

**Insight:** Essential for vlog assembly (“which clip is the beach?”). We should plan vision tools early.

### 4.3 Transcript as editing surface

Media bin transcript tab: click to seek, cut sentence + ripple delete. `captions_from_transcript` for overlays.

**Insight:** Adjacent to our **timeline annotation** idea — Kerf ties text to cuts but not user-scoped agent context.

### 4.4 Beat-aware editing

Tempo analysis on assets, beat grid on ruler, snap while dragging, `snap_to_beats` MCP tool.

**Insight:** Strong for music-driven home video; we could offer simpler “sync to music” product verbs.

### 4.5 Delivery format as project property

16:9 / 9:16 / 1:1 / 4:5 with cover-crop — preview and export share geometry.

**Insight:** Avoid export surprise; good default for “export a file” workflow.

### 4.6 Insta360 / 360 as first-class

Dual-lens stitch at import, reframe keyframes, spherical preview proxies.

**Insight:** Deep niche — **not** our v1 wedge (home video generalists).

### 4.7 Ducking + loudnorm on export

Music tracks can duck under dialogue; −14 LUFS normalize option.

**Insight:** Music-over-footage is core to our use case — Kerf has mechanics but no “place music from folder” heuristic.

### 4.8 No folder ingest

App launches **empty project** (#2). Import via file picker only. **No MCP import tool** (noted in PR #3).

**Insight:** Largest gap vs our product vision.

---

## 5. MCP Surface (~78 tools)

Grouped by function:

| Category | Examples | Character |
|----------|----------|-----------|
| See / analyze | `list_assets`, `analyze_asset`, `get_frame`, `skim_asset`, `preview_timeline`, waveforms | Vision-heavy |
| Cut / arrange | `cut_clip`, `split_at`, `move_clip`, `ripple_delete`, `snap_to_beats` | NLE vocabulary |
| Style | effects, keyframes, reframe, overlays, captions, delivery format | Granular / pro |
| Render / safety | `export`, `stage_edits`, `staged_diff`, `apply_staged_edits`, `undo`/`redo` | Staging unique |
| Task queue | `enqueue_task`, `claim_next_task`, `complete_task` | Async agent handoff |

**Missing vs our planned MCP:** `ingest_folder`, `create_project_from_folder`, `create_annotation`, `get_selection_context`, `place_music`, slideshow heuristics.

**Transport:** Streamable HTTP (`KERF_MCP_ADDR`), not stdio (docs partially stale).

---

## 6. Feature Completeness Matrix

| Area | Status |
|------|--------|
| Multi-track NLE | Shipped |
| Real composited preview | Shipped |
| Transcription + transcript cuts | Shipped |
| Captions / SRT | Shipped |
| Effects, color, keyframes | Shipped |
| GPU export | Shipped |
| MCP agent integration | Shipped (78 tools) |
| Embedded agent chat | **Not present** |
| Folder-first bootstrap | **Not present** |
| Timeline annotations → agent | **Partial** (markers only) |
| Slideshow / vlog heuristics | **Not present** |
| Rich transitions | **Partial** (crossfade, dip-to-black) |
| OTIO interchange | **Not present** |

---

## 7. GitHub Issues — What They Struggle With

**0 open issues.** All 35 closed — solo maintainer hygiene, not user backlog.

### Themes from closed issues / PRs

| Theme | Evidence | Implication |
|-------|----------|-------------|
| **UI freeze under load** | PR #3 — sync Tauri commands on main thread; ffmpeg under project mutex stalled GUI + MCP | They fixed via `spawn_blocking` + lock discipline — lesson for us |
| **MCP lock contention** | Agent skimming footage froze user edits | Design async MCP paths early |
| **Windows packaging** | Bundled ffmpeg, whisper feature for transcription | Windows-first user is viable path Kerf already walks |
| **rmcp SDK churn** | Issue #34 — 1.7→3.1 broke Host validation | MCP dependency risk |
| **macOS unsigned builds** | README right-click open | Distribution friction |
| **Empty project launch** | Issue #2 — intentional; no auto-bootstrap | Confirms ingest gap |

### Roadmap (README)

- Live MCP activity stream (today: polled task queue)
- Richer staged-edit diffs in review step
- Auralized effects in preview
- More transitions

---

## 8. Community & Forum Signal

**Very limited public discussion** — no Reddit threads, no HN thread found. Product is pre-adoption despite technical depth.

| Source | Signal |
|--------|--------|
| GitHub | 4 stars, 0 forks — niche / undiscovered |
| CONTRIBUTING.md | Welcomes PRs; “early and moving fast” |
| Site | orellbuehler.github.io/kerf — marketing site exists |

**Interpretation:** Kerf is **engineer-quality, market-quiet**. Risk for them: distribution. Opportunity for us: same architecture ideas with clearer **consumer positioning**.

---

## 9. Strengths vs Weaknesses

### Strengths

- Cross-platform (Windows included)
- Fully OSS stack visible (editor + MCP)
- Deep ffmpeg orchestration with tests
- Agent safety model (staging)
- Vision tools for footage understanding
- Real NLE depth without cloud dependency

### Weaknesses

- PolyForm **Noncommercial** — cannot commercialize fork without license change
- No embedded agent UX — user must wire Cursor/Claude separately
- Full NLE UI — intimidates non-editors
- No folder ingest or vlog/slideshow bootstrap
- No annotation-scoped agent context
- Minimal community / GTM
- Solo maintainer bandwidth

---

## 10. Gap vs Our Product Vision

| Our principle | Kerf |
|---------------|------|
| Folder-first ingest | File picker only |
| Staging editorial mode | Full NLE staging (broader than we need) |
| Tool not autocomplete | Staged edits help; UI still pro-NLE |
| Timeline annotations for agent | Markers only |
| Plain-language MCP verbs | 78 low-level NLE tools |
| Photo slideshow defaults | Still images supported; no bootstrap |
| Windows user (you) | **Supported** |
| Commercial product path | **Blocked by license** |

---

## 11. What to Borrow vs Avoid

### Borrow (ideas, not code — license)

- Dual-surface `Project` + shared undo
- Staged agent proposals with diff review
- Vision MCP tools (`skim`, `preview_timeline`)
- Pure export graph + unit tests in core
- Task queue for async agent work
- Coalesced UI refresh on agent edit bursts

### Avoid

- Forking Kerf for commercial product
- Matching full NLE surface area in v1
- **Agent-mediated UI** — many MCP tools OK if users interact via agent, not tool picker
- Insta360/360 depth in v1
- External-only agent without in-app chat panel

---

## 12. References

- [Kerf README](https://github.com/OrellBuehler/kerf)
- [PR #3 — main thread / lock fixes](https://github.com/OrellBuehler/kerf/pull/3)
- [Release v0.13.0 — responsiveness + transcript cuts](https://github.com/OrellBuehler/kerf/releases/tag/v0.13.0)
- [Issue #2 — empty project launch](https://github.com/OrellBuehler/kerf/issues/2)
