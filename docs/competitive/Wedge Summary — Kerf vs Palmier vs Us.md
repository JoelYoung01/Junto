# Competitive Wedge Summary

> **August 24, 2026** — Kerf vs Palmier Pro vs **Junto**  
> See also: [Kerf Product Analysis](./Kerf%20Product%20Analysis.md), [Palmier Pro Product Analysis](./Palmier%20Pro%20Product%20Analysis.md)

---

## Side-by-Side

| Dimension | Kerf | Palmier Pro | **Junto** |
|-----------|------|-------------|-----------------|
| **Stack** | Rust/Tauri/Svelte/ffmpeg | Swift/macOS native | Rust/Tauri/ffmpeg (planned) |
| **Platform** | Win/Mac/Linux | macOS 26 + Apple Silicon only | **Windows-first**, cross-platform |
| **Stars / traction** | ~4 (pre-adoption) | ~13.8k (category leader) | New |
| **License** | PolyForm Noncommercial | GPLv3 editor; closed gen | Our choice (commercial OK) |
| **Agent integration** | External MCP only | MCP + in-app chat | **In-app chat + MCP** |
| **MCP tools** | ~78 (granular NLE) | ~48 (filmmaker) | **Large agent-facing surface** (UI stays simple) |
| **Gen AI on timeline** | No | Yes (paid credits) | **No v1** |
| **Folder ingest** | No | Manual import | **Core v1** |
| **Vlog / slideshow heuristics** | No | No | **Core v1** |
| **Timeline annotations** | Markers | Markers | **Design-tool pattern** |
| **Target user** | Technical MCP users | AI video / Claude power users | **Personal video, non-editors** |
| **Positioning** | “NLE your AI drives” | “Cursor for video” + gen | **“Fast tool for your idea”** |

---

## What Both Get Right (industry direction)

1. **One project, two callers** — GUI and agent share live timeline state.
2. **MCP as product interface** — not a side script; the agent is a first-class editor.
3. **Non-destructive until export** — sources stay intact; EDL/timeline model.
4. **Footage understanding** — vision frames, transcript, beats (various depths).
5. **Agent safety** — Kerf: staged diffs; Palmier: undo + (improving) bounded args.
6. **Local-first export** — finished video files on disk.

---

## Where Both Leave a Gap (our wedge)

### 1. Platform — **Windows + “normal” Macs**

- Palmier: **hard gate** on macOS 26 Tahoe + Apple Silicon (#195, #262, HN comments).
- Kerf: cross-platform but **unknown to consumers**.
- **Wedge:** Be the agent-native editor that **runs on your machine today** (Windows 10/11 priority).

### 2. User — **personal video, not AI marketing**

- Palmier born from **YC launch videos** and gen-in-timeline.
- Kerf born from **technical NLE + MCP**.
- **Wedge:** Folder of trip footage / photos + music → finished file. No Seedance/Kling required.

### 3. Workflow — **folder-first bootstrap**

Neither product:

- Scans a folder and builds a **first timeline** (slideshow vs vlog mode).
- Sets photo durations, orders clips by time/heuristic.
- Places music bed automatically (with user override).

**Wedge:** “Open folder” → **staging timeline in 30 seconds** → refine. This is the **missing middle** between CapCut templates and full NLE blank project.

### 4. Interaction — **annotations as agent context**

Neither product implements **design-tool annotations**:

- Drag-select on timeline → note attached to range/clips.
- Agent receives structured `selection_context` + user prompt.

Kerf: markers (internal). Palmier: markers.  
**Wedge:** Primary UX for “change *this part*” without jargon.

### 5. MCP vocabulary — **breadth for agents, not for users**

- Kerf: ~78 granular NLE tools (agent/external MCP).
- Palmier: ~48 filmmaker tools.
- **Junto:** Aim for **robust tool coverage** comparable to or beyond peers — but **users never see the catalog**. The in-app agent (and optional external MCP) maps intent → tool sequences.

**Wedge is not “fewer tools.”** It is **simple UI + agent middleman** while the engine exposes many precise operations. Tool design rules: clear names, no conflicting overlap, good agent docs — not artificial minimization.

### 6. UX depth — **tool, not NLE clone**

Both expose **full editor complexity** (Inspector, color, multicam, 360 in Kerf; color scopes in Palmier).

**Wedge:** Progressive disclosure — drag-drop + chat + annotations visible; pro knobs hidden behind agent or “advanced” mode.

### 7. Monetization — **no gen credit anxiety**

Palmier: free editor but **gen + cloud STT = credits**; MCP gen tools need account.  
Kerf: noncommercial license.

**Wedge:** v1 = **local ffmpeg export only**; agent via BYOK or user's existing Cursor/Claude sub; **no per-export credit meter**.

### 8. Reliability — **async agent architecture**

Palmier's **#58** class: main-actor saturation freezes UI + MCP. Kerf fixed similar via `spawn_blocking` (PR #3).

**Wedge:** Design MCP + heavy ffmpeg **off UI thread from day one**; staged edits (Kerf pattern) for user trust.

---

## Positioning Statement (draft)

**Not** “Cursor for video” (Palmier).  
**Not** “the NLE your AI drives” (Kerf).  

**Junto instead:** “Open a folder, describe the video you want, point at what should change — get a file out.”

---

## Recommended Wedge Pillars (v1)

| Pillar | Why competitors weak here |
|--------|---------------------------|
| **Folder → timeline** | Neither automates personal ingest |
| **Annotation + NL** | Neither binds selection to agent context |
| **Windows desktop** | Palmier excludes; Kerf unmarketed |
| **Slideshow + vlog modes** | Neither distinguishes photo-heavy vs footage-heavy |
| **Agent middleman UX** | Both expose many tools to agents without a personal-video-focused chat + annotation layer |
| **Export-only output** | No publish scope; no gen subscription |

---

## Risks If We Ignore Them

| Risk | Source |
|------|--------|
| Palmier adds Windows | GitHub #195 pressure; “over time” on HN |
| Palmier improves folder ingest | Already has `import_media` + filesystem |
| Kerf adds bootstrap heuristics | Active solo dev; architecturally ready |
| Unclear tool overlap | Design agent docs + validation so a large tool set stays composable |
| “Annotation” as markers only | Ship real selection-scoped context or no wedge |

---

## Build Order Suggestion (from gap analysis)

1. **Folder ingest + heuristic timeline** (slideshow / vlog) — largest functional gap.
2. **Timeline UI + drag-drop** (minimal tracks) — parity with “staging mode” promise.
3. **Annotation layer + `get_selection_context` MCP** — unique UX.
4. **In-app agent panel** + growing MCP catalog (start with core ingest/timeline/export; expand toward Kerf/Palmier depth).
5. **Staged agent edits** (borrow Kerf pattern) — trust for non-experts.
6. **Vision skim** (borrow Kerf `skim_asset` idea) — agent understands footage.
7. **ffmpeg export presets** — 1080p H.264+AAC defaults.

**Defer:** generative video, multicam, 360, HDR, XML interchange, color grading suite.
