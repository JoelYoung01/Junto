use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::error::{JuntoError, Result};
use crate::media::{is_ignored_dir, is_media_file, MediaKind};
use crate::paths::{meta_dir, outputs_dir, project_file, raw_footage_dir, RAW_FOOTAGE_DIR};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectoryScanKind {
    Empty,
    HasMediaOutsideRawFootage,
    HasMediaInRawFootage,
    HasNonMediaOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedMediaFile {
    pub path: PathBuf,
    pub relative_path: String,
    pub media_kind: MediaKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryScan {
    pub kind: DirectoryScanKind,
    pub media_files: Vec<ScannedMediaFile>,
    pub non_media_files: Vec<String>,
    pub raw_footage_exists: bool,
}

pub fn scan_project_directory(root: &Path) -> Result<DirectoryScan> {
    let mut media_files = Vec::new();
    let mut non_media_files = Vec::new();
    let raw_exists = raw_footage_dir(root).is_dir();

    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .map_err(|e| JuntoError::Filesystem(e.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");

        if relative.starts_with(".junto/") || relative.starts_with("outputs/") {
            continue;
        }

        if let Some(kind) = MediaKind::from_path(path) {
            let in_raw = relative.starts_with(&format!("{RAW_FOOTAGE_DIR}/"))
                || relative == RAW_FOOTAGE_DIR;
            media_files.push(ScannedMediaFile {
                path: path.to_path_buf(),
                relative_path: relative,
                media_kind: kind,
            });
            let _ = in_raw;
        } else if !relative.contains('/') {
            non_media_files.push(relative);
        }
    }

    let media_outside_raw: Vec<_> = media_files
        .iter()
        .filter(|f| !f.relative_path.starts_with(&format!("{RAW_FOOTAGE_DIR}/")))
        .collect();

    let media_in_raw: Vec<_> = media_files
        .iter()
        .filter(|f| f.relative_path.starts_with(&format!("{RAW_FOOTAGE_DIR}/")))
        .collect();

    let kind = if media_files.is_empty() {
        DirectoryScanKind::Empty
    } else if !media_outside_raw.is_empty() {
        DirectoryScanKind::HasMediaOutsideRawFootage
    } else if !media_in_raw.is_empty() {
        DirectoryScanKind::HasMediaInRawFootage
    } else {
        DirectoryScanKind::HasNonMediaOnly
    };

    Ok(DirectoryScan {
        kind,
        media_files,
        non_media_files,
        raw_footage_exists: raw_exists,
    })
}

pub fn ensure_project_layout(root: &Path) -> Result<()> {
    fs::create_dir_all(meta_dir(root))?;
    fs::create_dir_all(raw_footage_dir(root))?;
    fs::create_dir_all(outputs_dir(root))?;
    Ok(())
}

/// Copy media from `source` into the project's Raw Footage folder.
pub fn import_media_into_raw_footage(project_root: &Path, source: &Path) -> Result<Vec<String>> {
    ensure_project_layout(project_root)?;
    let dest_root = raw_footage_dir(project_root);
    let mut imported = Vec::new();

    if source.is_file() {
        if is_media_file(source) {
            let file_name = source
                .file_name()
                .ok_or_else(|| JuntoError::Filesystem("invalid source file".into()))?;
            let dest = unique_destination(&dest_root.join(file_name));
            fs::copy(source, &dest)?;
            imported.push(relative_to_project(project_root, &dest)?);
        }
        return Ok(imported);
    }

    if !source.is_dir() {
        return Err(JuntoError::Filesystem("source path does not exist".into()));
    }

    for entry in WalkDir::new(source).follow_links(false).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            if is_ignored_dir(path.file_name().and_then(|n| n.to_str()).unwrap_or("")) {
                continue;
            }
            continue;
        }
        if !is_media_file(path) {
            continue;
        }
        let rel = path.strip_prefix(source).unwrap();
        let dest = unique_destination(&dest_root.join(rel));
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(path, &dest)?;
        imported.push(relative_to_project(project_root, &dest)?);
    }

    Ok(imported)
}

/// Move project-root media files (outside Raw Footage) into Raw Footage.
pub fn consolidate_media_into_raw_footage(project_root: &Path) -> Result<Vec<String>> {
    let scan = scan_project_directory(project_root)?;
    let mut moved = Vec::new();

    for file in scan.media_files {
        if file.relative_path.starts_with(&format!("{RAW_FOOTAGE_DIR}/")) {
            continue;
        }
        let file_name = Path::new(&file.relative_path)
            .file_name()
            .ok_or_else(|| JuntoError::Filesystem("invalid media path".into()))?;
        let dest = unique_destination(&raw_footage_dir(project_root).join(file_name));
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&file.path, &dest).or_else(|_| {
            fs::copy(&file.path, &dest)?;
            fs::remove_file(&file.path)?;
            Ok::<(), std::io::Error>(())
        })?;
        moved.push(relative_to_project(project_root, &dest)?);
    }

    Ok(moved)
}

pub fn list_raw_footage(project_root: &Path) -> Result<Vec<ScannedMediaFile>> {
    let raw = raw_footage_dir(project_root);
    if !raw.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in WalkDir::new(&raw)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(kind) = MediaKind::from_path(path) {
            files.push(ScannedMediaFile {
                path: path.to_path_buf(),
                relative_path: relative_to_project(project_root, path)?,
                media_kind: kind,
            });
        }
    }
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(files)
}

pub fn project_exists(root: &Path) -> bool {
    project_file(root).is_file()
}

fn relative_to_project(project_root: &Path, path: &Path) -> Result<String> {
    Ok(path
        .strip_prefix(project_root)
        .map_err(|e| JuntoError::Filesystem(e.to_string()))?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn unique_destination(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    for i in 1..10_000 {
        let candidate = parent.join(format!("{stem}_{i}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    path.to_path_buf()
}
