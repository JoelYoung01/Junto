use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Video,
    Image,
    Audio,
}

impl MediaKind {
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        if VIDEO_EXTENSIONS.contains(&ext.as_str()) {
            Some(MediaKind::Video)
        } else if IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            Some(MediaKind::Image)
        } else if AUDIO_EXTENSIONS.contains(&ext.as_str()) {
            Some(MediaKind::Audio)
        } else {
            None
        }
    }

    pub fn default_timeline_track_kind(self) -> crate::timeline::TrackKind {
        match self {
            MediaKind::Video | MediaKind::Image => crate::timeline::TrackKind::Video,
            MediaKind::Audio => crate::timeline::TrackKind::Audio,
        }
    }
}

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "mov", "mkv", "webm", "avi", "m4v", "mpeg", "mpg", "wmv", "flv",
];

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "tif", "tiff"];

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "wma"];

pub fn is_media_file(path: &Path) -> bool {
    MediaKind::from_path(path).is_some()
}

pub fn is_ignored_dir(name: &str) -> bool {
    matches!(name, ".junto" | "outputs" | "Raw Footage" | ".git" | "node_modules")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_media_types() {
        assert_eq!(MediaKind::from_path(Path::new("clip.mp4")), Some(MediaKind::Video));
        assert_eq!(MediaKind::from_path(Path::new("photo.jpg")), Some(MediaKind::Image));
        assert_eq!(MediaKind::from_path(Path::new("song.mp3")), Some(MediaKind::Audio));
        assert_eq!(MediaKind::from_path(Path::new("readme.txt")), None);
    }
}
