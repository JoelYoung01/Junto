use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{JuntoError, Result};
use crate::filesystem::{
    ensure_project_layout, import_media_into_raw_footage, list_raw_footage, project_exists,
    scan_project_directory, consolidate_media_into_raw_footage, DirectoryScan,
};
use crate::media::MediaKind;
use crate::paths::{outputs_dir, project_file};
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

    pub fn resolve_path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    pub fn default_duration_for(&self, kind: MediaKind) -> f64 {
        match kind {
            MediaKind::Image => self.file.photo_default_duration,
            MediaKind::Video => 5.0,
            MediaKind::Audio => 5.0,
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
        export_timeline_blocking(self)
    }

    pub fn export_async(&self) -> mpsc::Receiver<ExportProgress> {
        let project = self.clone_for_export();
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let _ = tx.send(ExportProgress {
                done: false,
                progress: 0.05,
                message: "Preparing export...".into(),
                output_path: None,
                error: None,
            });

            match export_timeline_blocking(&project) {
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

fn export_timeline_blocking(project: &Project) -> Result<PathBuf> {
    let settings = &project.file.export_settings;
    fs::create_dir_all(outputs_dir(&project.root))?;

    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let output = outputs_dir(&project.root).join(format!("export_{timestamp}.mp4"));

    let video_clips: Vec<_> = project
        .file
        .timeline
        .clips
        .iter()
        .filter(|c| matches!(c.media_kind, MediaKind::Video | MediaKind::Image))
        .collect();

    if video_clips.is_empty() {
        return Err(JuntoError::Export("timeline has no video or image clips".into()));
    }

    let mut sorted = video_clips;
    sorted.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap());

    let temp_dir = project.root.join(".junto").join("export_tmp");
    fs::create_dir_all(&temp_dir)?;
    let list_file = temp_dir.join("concat.txt");
    let mut list_contents = String::new();

    for (idx, clip) in sorted.iter().enumerate() {
        let source = project.resolve_path(&clip.source_path);
        if !source.exists() {
            return Err(JuntoError::Export(format!(
                "missing source file: {}",
                source.display()
            )));
        }

        match clip.media_kind {
            MediaKind::Image => {
                let seg = temp_dir.join(format!("seg_{idx}.mp4"));
                let duration = clip.duration.max(0.1);
                let status = Command::new("ffmpeg")
                    .args([
                        "-y",
                        "-loop",
                        "1",
                        "-i",
                        &source.to_string_lossy(),
                        "-t",
                        &duration.to_string(),
                        "-vf",
                        &format!(
                            "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
                            settings.width, settings.height, settings.width, settings.height
                        ),
                        "-r",
                        &settings.fps.to_string(),
                        "-c:v",
                        &settings.video_codec,
                        "-pix_fmt",
                        "yuv420p",
                        &seg.to_string_lossy(),
                    ])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .map_err(|e| JuntoError::Export(e.to_string()))?;
                if !status.success() {
                    return Err(JuntoError::Export("ffmpeg image segment failed".into()));
                }
                list_contents.push_str(&format!("file '{}'\n", seg.display()));
            }
            MediaKind::Video => {
                let seg = temp_dir.join(format!("seg_{idx}.mp4"));
                let duration = clip.duration.max(0.1);
                let status = Command::new("ffmpeg")
                    .args([
                        "-y",
                        "-ss",
                        &clip.source_offset.to_string(),
                        "-i",
                        &source.to_string_lossy(),
                        "-t",
                        &duration.to_string(),
                        "-vf",
                        &format!(
                            "scale={}:{}:force_original_aspect_ratio=decrease,pad={}:{}:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
                            settings.width, settings.height, settings.width, settings.height
                        ),
                        "-r",
                        &settings.fps.to_string(),
                        "-c:v",
                        &settings.video_codec,
                        "-c:a",
                        &settings.audio_codec,
                        "-pix_fmt",
                        "yuv420p",
                        &seg.to_string_lossy(),
                    ])
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .status()
                    .map_err(|e| JuntoError::Export(e.to_string()))?;
                if !status.success() {
                    return Err(JuntoError::Export("ffmpeg video segment failed".into()));
                }
                list_contents.push_str(&format!("file '{}'\n", seg.display()));
            }
            MediaKind::Audio => {}
        }
    }

    fs::write(&list_file, list_contents)?;

    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            &list_file.to_string_lossy(),
            "-c:v",
            &settings.video_codec,
            "-crf",
            &settings.crf.to_string(),
            "-c:a",
            &settings.audio_codec,
            "-movflags",
            "+faststart",
            &output.to_string_lossy(),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| JuntoError::Export(e.to_string()))?;

    let _ = fs::remove_dir_all(&temp_dir);

    if !status.success() {
        return Err(JuntoError::Export("ffmpeg concat export failed".into()));
    }

    Ok(output)
}
