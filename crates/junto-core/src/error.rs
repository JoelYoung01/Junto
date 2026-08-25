use thiserror::Error;

#[derive(Debug, Error)]
pub enum JuntoError {
    #[error("project not found: {0}")]
    ProjectNotFound(String),
    #[error("invalid project: {0}")]
    InvalidProject(String),
    #[error("filesystem error: {0}")]
    Filesystem(String),
    #[error("timeline error: {0}")]
    Timeline(String),
    #[error("export error: {0}")]
    Export(String),
    #[error("media probe error: {0}")]
    Probe(String),
    #[error("clip not found: {0}")]
    ClipNotFound(String),
    #[error("track not found: {0}")]
    TrackNotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, JuntoError>;
