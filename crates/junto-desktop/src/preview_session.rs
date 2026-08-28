use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use junto_core::{prefetch_preview_neighbors, MediaKind, Project};
use junto_mcp::SharedProject;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const PREFETCH_OFFSETS: &[f64] = &[-1.0, -0.5, -0.2, 0.2, 0.5, 1.0];

#[derive(Debug, Clone, Copy)]
pub struct PreviewTarget {
    pub playhead: f64,
    pub max_height: u32,
    pub scrubbing: bool,
    pub generation: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct PreviewFrameEvent {
    pub playhead: f64,
    pub source_path: String,
    pub media_kind: MediaKind,
    pub max_height: u32,
    pub jpeg: Vec<u8>,
    pub generation: u64,
}

struct SharedTarget {
    target: Mutex<Option<PreviewTarget>>,
    cvar: Condvar,
}

pub struct PreviewSession {
    stop: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    shared: Arc<SharedTarget>,
    handle: Option<JoinHandle<()>>,
}

impl PreviewSession {
    pub fn start(app: AppHandle, project: SharedProject) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let generation = Arc::new(AtomicU64::new(0));
        let shared = Arc::new(SharedTarget {
            target: Mutex::new(None),
            cvar: Condvar::new(),
        });

        let stop_flag = Arc::clone(&stop);
        let gen = Arc::clone(&generation);
        let shared_worker = Arc::clone(&shared);

        let handle = thread::spawn(move || {
            worker_loop(app, project, stop_flag, gen, shared_worker);
        });

        Self {
            stop,
            generation,
            shared,
            handle: Some(handle),
        }
    }

    pub fn set_target(&self, playhead: f64, max_height: u32, scrubbing: bool) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let mut guard = self.shared.target.lock().expect("preview target lock");
        *guard = Some(PreviewTarget {
            playhead: playhead.max(0.0),
            max_height: max_height.max(16),
            scrubbing,
            generation,
        });
        self.shared.cvar.notify_one();
    }
}

impl Drop for PreviewSession {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.shared.cvar.notify_one();
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn worker_loop(
    app: AppHandle,
    project: SharedProject,
    stop: Arc<AtomicBool>,
    _generation: Arc<AtomicU64>,
    shared: Arc<SharedTarget>,
) {
    let mut last_served_generation = 0u64;

    while !stop.load(Ordering::SeqCst) {
        let target = {
            let mut guard = shared.target.lock().expect("preview target lock");
            loop {
                if stop.load(Ordering::SeqCst) {
                    return;
                }
                if let Some(t) = guard.as_ref().copied() {
                    if t.generation != last_served_generation {
                        break t;
                    }
                }
                let (g, timeout) = shared
                    .cvar
                    .wait_timeout(guard, Duration::from_millis(250))
                    .expect("preview cvar wait");
                guard = g;
                if timeout.timed_out() && stop.load(Ordering::SeqCst) {
                    return;
                }
            }
        };

        match render_preview_frame(&project, target) {
            Ok(Some(event)) => {
                last_served_generation = event.generation;
                if let Err(err) = app.emit("preview-frame", &event) {
                    tracing::warn!("failed to emit preview-frame: {err}");
                }

                // Prefetch only when target hasn't moved (still latest-wins).
                    let still_current = shared
                        .target
                        .lock()
                        .ok()
                        .and_then(|g| g.as_ref().map(|t| t.generation == event.generation))
                        .unwrap_or(false);
                if still_current && !target.scrubbing {
                    if let Ok(Some((root, relative, abs, local, height))) =
                        snapshot_source_at(&project, target.playhead, target.max_height)
                    {
                        prefetch_preview_neighbors(
                            &root,
                            &relative,
                            &abs,
                            local,
                            height,
                            PREFETCH_OFFSETS,
                        );
                    }
                }
            }
            Ok(None) => {
                last_served_generation = target.generation;
                let empty = PreviewFrameEvent {
                    playhead: target.playhead,
                    source_path: String::new(),
                    media_kind: MediaKind::Video,
                    max_height: target.max_height,
                    jpeg: Vec::new(),
                    generation: target.generation,
                };
                let _ = app.emit("preview-frame", &empty);
            }
            Err(err) => {
                tracing::debug!("preview extract failed: {err}");
                last_served_generation = target.generation;
            }
        }
    }
}

fn snapshot_source_at(
    project: &SharedProject,
    playhead: f64,
    max_height: u32,
) -> Result<Option<(std::path::PathBuf, String, std::path::PathBuf, f64, u32)>, String> {
    let guard = project.read().map_err(|e| e.to_string())?;
    let Some(project) = guard.as_ref() else {
        return Ok(None);
    };
    let Some((relative, abs, local)) = resolve_visual_at(project, playhead) else {
        return Ok(None);
    };
    Ok(Some((
        project.root.clone(),
        relative,
        abs,
        local,
        max_height,
    )))
}

fn resolve_visual_at(project: &Project, t: f64) -> Option<(String, std::path::PathBuf, f64)> {
    let mut visual: Vec<_> = project
        .file
        .timeline
        .clips
        .iter()
        .filter(|c| {
            matches!(
                c.media_kind,
                MediaKind::Video | MediaKind::Image
            )
        })
        .filter(|c| t + f64::EPSILON >= c.start && t <= c.start + c.duration + 0.05)
        .cloned()
        .collect();
    visual.sort_by(|a, b| {
        let track_a = project
            .file
            .timeline
            .tracks
            .iter()
            .find(|tr| tr.id == a.track_id)
            .map(|tr| tr.index)
            .unwrap_or(0);
        let track_b = project
            .file
            .timeline
            .tracks
            .iter()
            .find(|tr| tr.id == b.track_id)
            .map(|tr| tr.index)
            .unwrap_or(0);
        track_a.cmp(&track_b)
    });
    let clip = visual.into_iter().next()?;
    let local = (t - clip.start + clip.source_offset).max(0.0);
    let relative = project.relative_source_path(&clip.source_path);
    let abs = project.resolve_path(&relative);
    Some((relative, abs, local))
}

fn render_preview_frame(
    project: &SharedProject,
    target: PreviewTarget,
) -> Result<Option<PreviewFrameEvent>, String> {
    let snapshot = {
        let guard = project.read().map_err(|e| e.to_string())?;
        let Some(project) = guard.as_ref() else {
            return Ok(None);
        };
        let Some((relative, abs, local)) = resolve_visual_at(project, target.playhead) else {
            return Ok(None);
        };
        let kind = MediaKind::from_path(&abs).unwrap_or(MediaKind::Video);
        (
            project.root.clone(),
            relative,
            abs,
            local,
            kind,
            target.max_height,
            target.playhead,
            target.generation,
        )
    };

    let (root, relative, abs, local, kind, height, playhead, generation) = snapshot;
    if matches!(kind, MediaKind::Audio) {
        return Ok(None);
    }

    let jpeg = juntos_core_extract(&root, &relative, &abs, local, height)?;
    Ok(Some(PreviewFrameEvent {
        playhead,
        source_path: relative,
        media_kind: kind,
        max_height: height,
        jpeg,
        generation,
    }))
}

fn juntos_core_extract(
    root: &std::path::Path,
    relative: &str,
    abs: &std::path::Path,
    local: f64,
    height: u32,
) -> Result<Vec<u8>, String> {
    junto_core::frame_jpeg_cached_hot(root, relative, abs, local, height).map_err(|e| e.to_string())
}
