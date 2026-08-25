/// Well-known paths inside a Junto project directory.
pub const META_DIR: &str = ".junto";
pub const PROJECT_FILE: &str = "project.json";
pub const RAW_FOOTAGE_DIR: &str = "Raw Footage";
pub const OUTPUTS_DIR: &str = "outputs";

/// Normalize a media path to a project-relative `/`-separated string.
pub fn normalize_project_relative_path(project_root: &std::path::Path, source: &str) -> String {
    let path = std::path::Path::new(source);
    let relative = if path.is_absolute() {
        path.strip_prefix(project_root)
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|_| path.to_path_buf())
    } else {
        path.to_path_buf()
    };
    relative.to_string_lossy().replace('\\', "/")
}

pub fn meta_dir(project_root: &std::path::Path) -> std::path::PathBuf {
    project_root.join(META_DIR)
}

pub fn project_file(project_root: &std::path::Path) -> std::path::PathBuf {
    meta_dir(project_root).join(PROJECT_FILE)
}

pub fn raw_footage_dir(project_root: &std::path::Path) -> std::path::PathBuf {
    project_root.join(RAW_FOOTAGE_DIR)
}

pub fn outputs_dir(project_root: &std::path::Path) -> std::path::PathBuf {
    project_root.join(OUTPUTS_DIR)
}
