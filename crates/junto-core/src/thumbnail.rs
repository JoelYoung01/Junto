use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::error::{JuntoError, Result};
use crate::media::MediaKind;
use crate::paths::meta_dir;

const THUMBS_DIR: &str = "thumbs";

/// Extract a JPEG frame from an image or video and return the bytes.
/// Audio sources are not supported.
pub fn extract_frame_jpeg(source: &Path, time_seconds: f64, max_width: u32) -> Result<Vec<u8>> {
    let kind = MediaKind::from_path(source).ok_or_else(|| {
        JuntoError::Export(format!("unsupported media: {}", source.display()))
    })?;
    if matches!(kind, MediaKind::Audio) {
        return Err(JuntoError::Export("audio has no visual frame".into()));
    }
    if !source.exists() {
        return Err(JuntoError::Export(format!(
            "missing media file: {}",
            source.display()
        )));
    }

    let scale = format!("scale={max_width}:-1:force_original_aspect_ratio=decrease");
    let time = time_seconds.max(0.0);

    let mut cmd = Command::new("ffmpeg");
    cmd.arg("-hide_banner").arg("-loglevel").arg("error").arg("-y");

    match kind {
        MediaKind::Image => {
            cmd.arg("-i").arg(source);
        }
        MediaKind::Video => {
            // Seek before -i for speed on large files; fine for short demo clips too.
            cmd.arg("-ss").arg(format!("{time:.3}")).arg("-i").arg(source);
        }
        MediaKind::Audio => unreachable!(),
    }

    cmd.args([
        "-frames:v",
        "1",
        "-vf",
        &scale,
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|e| JuntoError::Export(format!("ffmpeg failed to start: {e}")))?;

    if !output.status.success() || output.stdout.is_empty() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(JuntoError::Export(format!(
            "ffmpeg frame extract failed: {err}"
        )));
    }

    Ok(output.stdout)
}

/// Cached JPEG path under `.junto/thumbs/` for a project-relative source + time bucket.
pub fn cached_thumb_path(
    project_root: &Path,
    relative_source: &str,
    time_seconds: f64,
    max_width: u32,
) -> PathBuf {
    let bucket_ms = (time_seconds.max(0.0) * 10.0).round() as i64; // 100ms buckets
    let safe = relative_source
        .replace('/', "__")
        .replace('\\', "__")
        .replace(' ', "_");
    meta_dir(project_root)
        .join(THUMBS_DIR)
        .join(format!("{safe}_{bucket_ms}ms_w{max_width}.jpg"))
}

/// Return JPEG bytes, reading from cache when present.
pub fn frame_jpeg_cached(
    project_root: &Path,
    relative_source: &str,
    absolute_source: &Path,
    time_seconds: f64,
    max_width: u32,
) -> Result<Vec<u8>> {
    let cache = cached_thumb_path(project_root, relative_source, time_seconds, max_width);
    if cache.exists() {
        return Ok(fs::read(&cache)?);
    }
    if let Some(parent) = cache.parent() {
        fs::create_dir_all(parent)?;
    }
    let jpeg = extract_frame_jpeg(absolute_source, time_seconds, max_width)?;
    let _ = fs::write(&cache, &jpeg);
    Ok(jpeg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn make_image(path: &Path) {
        let status = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x240:d=1",
                "-frames:v",
                "1",
                &path.to_string_lossy(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("ffmpeg");
        assert!(status.success());
    }

    #[test]
    fn extracts_image_frame() {
        let dir = TempDir::new().unwrap();
        let img = dir.path().join("shot.png");
        make_image(&img);
        let bytes = extract_frame_jpeg(&img, 0.0, 160).expect("frame");
        assert!(bytes.len() > 100);
        assert_eq!(&bytes[0..2], &[0xFF, 0xD8]); // JPEG SOI
    }
}
