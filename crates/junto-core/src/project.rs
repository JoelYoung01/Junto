use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{JuntoError, Result};
use crate::export::export_timeline_blocking;
use crate::filesystem::{
    ensure_project_layout, import_media_into_raw_footage, list_raw_footage, project_exists,
    scan_project_directory, consolidate_media_into_raw_footage, DirectoryScan,
};
use crate::media::MediaKind;
use crate::paths::project_file;
use crate::probe::probe_duration;
use crate::timeline::Timeline;

pub const PROJECT_FORMAT_VERSION: u32 = 1;
pub const DEFAULT_PHOTO_DURATION: f64 = 3.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSettings {
    pub width: u32,
    pub height: u32,
    pub video_codec: String,
    pub audio_codec: String,
    pub crf: u8,
    pub fps: u32,
}

impl Default for ExportSettings {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            video_codec: "libx264".into(),
            audio_codec: "aac".into(),
            crf: 20,
            fps: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProgress {
    pub done: bool,
    pub progress: f32,
    pub message: String,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectFile {
    pub format_version: u32,
    pub id: Uuid,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub timeline: Timeline,
    pub photo_default_duration: f64,
    pub export_settings: ExportSettings,
}

#[derive(Debug)]
pub struct Project {
    pub root: PathBuf,
    pub file: ProjectFile,
}

impl Project {
    pub fn create(root: PathBuf, name: String) -> Result<Self> {
        ensure_project_layout(&root)?;
        let now = Utc::now().to_rfc3339();
        let file = ProjectFile {
            format_version: PROJECT_FORMAT_VERSION,
            id: Uuid::new_v4(),
            name,
            created_at: now.clone(),
            updated_at: now,
            timeline: Timeline::new(),
            photo_default_duration: DEFAULT_PHOTO_DURATION,
            export_settings: ExportSettings::default(),
        };
        let project = Self { root, file };
        project.save()?;
        Ok(project)
    }

    pub fn open(root: PathBuf) -> Result<Self> {
        if !project_exists(&root) {
            return Err(JuntoError::ProjectNotFound(
                project_file(&root).display().to_string(),
            ));
        }
        let data = fs::read_to_string(project_file(&root))?;
        let file: ProjectFile = serde_json::from_str(&data)?;
        if file.format_version != PROJECT_FORMAT_VERSION {
            return Err(JuntoError::InvalidProject(format!(
                "unsupported format version {}",
                file.format_version
            )));
        }
        Ok(Self { root, file })
    }

    pub fn save(&self) -> Result<()> {
        ensure_project_layout(&self.root)?;
        let mut file = self.file.clone();
        file.updated_at = Utc::now().to_rfc3339();
        let data = serde_json::to_string_pretty(&file)?;
        fs::write(project_file(&self.root), data)?;
        Ok(())
    }

    pub fn scan(&self) -> Result<DirectoryScan> {
        scan_project_directory(&self.root)
    }

    pub fn import_footage(&mut self, source: &Path) -> Result<Vec<String>> {
        let imported = import_media_into_raw_footage(&self.root, source)?;
        self.touch();
        Ok(imported)
    }

    pub fn consolidate_footage(&mut self) -> Result<Vec<String>> {
        let moved = consolidate_media_into_raw_footage(&self.root)?;
        self.touch();
        Ok(moved)
    }

    pub fn list_media(&self) -> Result<Vec<crate::filesystem::ScannedMediaFile>> {
        list_raw_footage(&self.root)
    }

    pub fn list_project_entries(&self) -> Result<Vec<crate::filesystem::ProjectEntry>> {
        crate::filesystem::list_project_entries(&self.root)
    }

    pub fn resolve_path(&self, source: &str) -> PathBuf {
        let path = Path::new(source);
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.root.join(source)
        }
    }

    pub fn relative_source_path(&self, source: &str) -> String {
        crate::paths::normalize_project_relative_path(&self.root, source)
    }

    pub fn default_duration_for(&self, kind: MediaKind) -> f64 {
        match kind {
            MediaKind::Image => self.file.photo_default_duration,
            MediaKind::Video | MediaKind::Audio => 5.0,
        }
    }

    /// Preferred duration when adding a clip from a known source path.
    pub fn duration_for_media(&self, relative_path: &str, kind: MediaKind) -> Result<f64> {
        match kind {
            MediaKind::Image => Ok(self.file.photo_default_duration),
            MediaKind::Video | MediaKind::Audio => {
                let abs = self.resolve_path(relative_path);
                probe_duration(&abs)
            }
        }
    }

    /// Set the default on-timeline duration used for newly added photos.
    /// Caller is responsible for persisting via [`Project::save`].
    pub fn set_photo_default_duration(&mut self, duration: f64) -> Result<()> {
        if duration <= 0.0 {
            return Err(JuntoError::InvalidProject(
                "photo_default_duration must be greater than 0".into(),
            ));
        }
        self.file.photo_default_duration = duration;
        Ok(())
    }

    pub fn touch(&mut self) {
        self.file.updated_at = Utc::now().to_rfc3339();
    }

    pub fn export_blocking(&self) -> Result<PathBuf> {
        export_timeline_blocking(self, None)
    }

    pub fn export_async(&self) -> mpsc::Receiver<ExportProgress> {
        let project = self.clone_for_export();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let tx_cb = |progress: ExportProgress| {
                let _ = tx.send(progress);
            };
            let _ = tx.send(ExportProgress {
                done: false,
                progress: 0.05,
                message: "Preparing export...".into(),
                output_path: None,
                error: None,
            });

            match export_timeline_blocking(&project, Some(&tx_cb)) {
                Ok(path) => {
                    let _ = tx.send(ExportProgress {
                        done: true,
                        progress: 1.0,
                        message: "Export complete".into(),
                        output_path: Some(path.to_string_lossy().into()),
                        error: None,
                    });
                }
                Err(err) => {
                    let _ = tx.send(ExportProgress {
                        done: true,
                        progress: 0.0,
                        message: "Export failed".into(),
                        output_path: None,
                        error: Some(err.to_string()),
                    });
                }
            }
        });
        rx
    }

    fn clone_for_export(&self) -> Self {
        Self {
            root: self.root.clone(),
            file: self.file.clone(),
        }
    }
}
