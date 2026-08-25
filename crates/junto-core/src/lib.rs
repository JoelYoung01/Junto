pub mod error;
pub mod export;
pub mod filesystem;
pub mod media;
pub mod paths;
pub mod probe;
pub mod project;
pub mod thumbnail;
pub mod timeline;

pub use error::{JuntoError, Result};
pub use filesystem::{
    consolidate_media_into_raw_footage, ensure_project_layout, import_media_into_raw_footage,
    list_raw_footage, project_exists, scan_project_directory, DirectoryScan, DirectoryScanKind,
    ScannedMediaFile,
};
pub use media::{is_media_file, MediaKind};
pub use paths::{outputs_dir, project_file, raw_footage_dir, META_DIR, OUTPUTS_DIR, RAW_FOOTAGE_DIR};
pub use probe::probe_duration;
pub use project::{ExportProgress, ExportSettings, Project, ProjectFile, DEFAULT_PHOTO_DURATION};
pub use thumbnail::{extract_frame_jpeg, frame_jpeg_cached};
pub use timeline::{Clip, Timeline, Track, TrackKind};
