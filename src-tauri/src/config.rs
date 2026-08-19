//! UI preferences: ~/.pi/pi-usage-report-store/usage_config.yaml

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UsageUiConfig {
    /// Relative preset id: today | 15m | 1h | 6h | 24h | 7d | 14d | 30d | "" for custom
    pub time_preset: String,
    /// End time tracks "now"
    pub end_is_live: bool,
    /// Poll interval seconds when live
    pub refresh_interval: u32,
    /// Auto-refresh live mode
    pub is_live: bool,
    /// Absolute start when time_preset is empty
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    /// Absolute end when not end_is_live and no preset
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_time: Option<String>,
    /// Enable chart dynamic LOD downsampling (default true)
    #[serde(default = "default_true")]
    pub lod_enabled: bool,
    /// Enable LOD debug logging in console (default false)
    #[serde(default)]
    pub log_enabled: bool,
}

fn default_true() -> bool {
    true
}

impl Default for UsageUiConfig {
    fn default() -> Self {
        Self {
            time_preset: "24h".into(),
            end_is_live: true,
            refresh_interval: 30,
            is_live: true,
            start_time: None,
            end_time: None,
            lod_enabled: true,
            log_enabled: false,
        }
    }
}

pub fn config_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi")
        .join("pi-usage-report-store")
        .join("usage_config.yaml")
}

pub fn load() -> UsageUiConfig {
    let path = config_path();
    if !path.exists() {
        let cfg = UsageUiConfig::default();
        let _ = save(&cfg);
        return cfg;
    }
    match fs::read_to_string(&path) {
        Ok(text) => serde_yaml::from_str(&text).unwrap_or_default(),
        Err(_) => UsageUiConfig::default(),
    }
}

pub fn save(cfg: &UsageUiConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_yaml::to_string(cfg).map_err(|e| e.to_string())?;
    // Keep a short header comment for humans
    let body = format!(
        "# Pi Usage Monitor UI preferences\n# Path: ~/.pi/pi-usage-report-store/usage_config.yaml\n{}",
        text
    );
    fs::write(&path, body).map_err(|e| e.to_string())
}
