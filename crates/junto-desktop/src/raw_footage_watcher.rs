use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use junto_core::paths::meta_dir;
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

const DEBOUNCE_MS: u64 = 400;

pub struct RawFootageWatcher {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl RawFootageWatcher {
    pub fn start(app: AppHandle, project_root: PathBuf) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        let watch_root = project_root.clone();
        let meta_root = meta_dir(&watch_root);
        let _ = std::fs::create_dir_all(&watch_root);

        let handle = thread::spawn(move || {
            let (tx, rx) = std::sync::mpsc::channel();

            let mut watcher = match RecommendedWatcher::new(
                move |result: notify::Result<Event>| {
                    if let Ok(event) = result {
                        let relevant = matches!(
                            event.kind,
                            EventKind::Create(_)
                                | EventKind::Modify(_)
                                | EventKind::Remove(_)
                                | EventKind::Any
                        );
                        if !relevant {
                            return;
                        }
                        if event.paths.iter().any(|path| path.starts_with(&meta_root)) {
                            return;
                        }
                        let _ = tx.send(());
                    }
                },
                notify::Config::default(),
            ) {
                Ok(watcher) => watcher,
                Err(err) => {
                    tracing::warn!("raw footage watcher failed to start: {err}");
                    return;
                }
            };

            if let Err(err) = watcher.watch(&watch_root, RecursiveMode::Recursive) {
                tracing::warn!(
                    "project filesystem watcher could not watch {}: {err}",
                    watch_root.display()
                );
                return;
            }

            tracing::info!("Watching project root at {}", watch_root.display());

            while !stop_flag.load(Ordering::SeqCst) {
                match rx.recv_timeout(Duration::from_millis(200)) {
                    Ok(()) => {
                        thread::sleep(Duration::from_millis(DEBOUNCE_MS));
                        while rx.try_recv().is_ok() {}

                        if stop_flag.load(Ordering::SeqCst) {
                            break;
                        }

                        if let Err(err) = app.emit("raw-footage-changed", ()) {
                            tracing::warn!("failed to emit raw-footage-changed: {err}");
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        Self {
            stop,
            handle: Some(handle),
        }
    }
}

impl Drop for RawFootageWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}
