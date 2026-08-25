use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::AppConfig;

const CONFIG_FILE: &str = "config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredConfig {
    setup_complete: bool,
    #[serde(default)]
    last_project: Option<String>,
}

pub fn config_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("junto").join(CONFIG_FILE)
}

pub fn load() -> anyhow::Result<AppConfig> {
    let path = config_path();
    if !path.exists() {
        return Ok(AppConfig {
            setup_complete: false,
            last_project: None,
        });
    }
    let data = fs::read_to_string(path)?;
    let stored: StoredConfig = serde_json::from_str(&data)?;
    Ok(AppConfig {
        setup_complete: stored.setup_complete,
        last_project: stored.last_project,
    })
}

pub fn save(config: &AppConfig) -> anyhow::Result<()> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let stored = StoredConfig {
        setup_complete: config.setup_complete,
        last_project: config.last_project.clone(),
    };
    fs::write(path, serde_json::to_string_pretty(&stored)?)?;
    Ok(())
}

pub fn remember_project(root: &std::path::Path) -> anyhow::Result<()> {
    let mut config = load()?;
    config.last_project = Some(root.to_string_lossy().into());
    save(&config)
}
