/// Well-known paths inside a Junto project directory.
pub const META_DIR: &str = ".junto";
pub const PROJECT_FILE: &str = "project.json";
pub const RAW_FOOTAGE_DIR: &str = "Raw Footage";
pub const OUTPUTS_DIR: &str = "outputs";

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
