use std::path::Path;
use std::process::{Command, Stdio};

use crate::error::{JuntoError, Result};

/// Probe media duration in seconds via `ffprobe`.
pub fn probe_duration(path: &Path) -> Result<f64> {
    if !path.exists() {
        return Err(JuntoError::Probe(format!(
            "file not found: {}",
            path.display()
        )));
    }

    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| JuntoError::Probe(format!("ffprobe failed to start: {e}")))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(JuntoError::Probe(format!(
            "ffprobe failed for {}: {err}",
            path.display()
        )));
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("N/A") {
        return Err(JuntoError::Probe(format!(
            "no duration reported for {}",
            path.display()
        )));
    }

    let duration: f64 = trimmed.parse().map_err(|e| {
        JuntoError::Probe(format!(
            "invalid duration '{trimmed}' for {}: {e}",
            path.display()
        ))
    })?;

    if !duration.is_finite() || duration <= 0.0 {
        return Err(JuntoError::Probe(format!(
            "non-positive duration {duration} for {}",
            path.display()
        )));
    }

    Ok(duration)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use tempfile::TempDir;

    fn make_video(path: &Path, seconds: f64) {
        let status = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("color=c=green:s=160x120:d={seconds}"),
                "-f",
                "lavfi",
                "-i",
                &format!("sine=f=440:d={seconds}"),
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
                &path.to_string_lossy(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("ffmpeg");
        assert!(status.success());
    }

    fn make_audio(path: &Path, seconds: f64) {
        let status = Command::new("ffmpeg")
            .args([
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!("sine=f=880:d={seconds}"),
                "-c:a",
                "aac",
                &path.to_string_lossy(),
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("ffmpeg");
        assert!(status.success());
    }

    #[test]
    fn probes_video_duration() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("clip.mp4");
        make_video(&path, 2.5);
        let d = probe_duration(&path).expect("probe");
        assert!((d - 2.5).abs() < 0.15, "got {d}");
    }

    #[test]
    fn probes_audio_duration() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("bed.m4a");
        make_audio(&path, 1.5);
        let d = probe_duration(&path).expect("probe");
        assert!((d - 1.5).abs() < 0.15, "got {d}");
    }

    #[test]
    fn missing_file_errors() {
        let err = probe_duration(Path::new("/tmp/junto-missing-media-xyz.mp4")).unwrap_err();
        assert!(err.to_string().contains("not found"));
    }
}
