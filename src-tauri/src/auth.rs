//! Auth system persistence: ~/.pi/pi-usage-report-store/auth.db
//!
//! Stores 中转站地址 (relay URL) + Edge 登录态开关（手动控制）。
//! EdgeBridge 就绪后，状态卡可直接探测 ~/.pi/pi-usage-report-store/edge-bridge.json 获得真实连接信息。

use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    /// 中转站 API 基地址，例如 https://relay.example.com/v1
    pub relay_url: String,
    /// 是否启用 Edge 登录态访问（手动开关）
    pub edge_auth_enabled: bool,
    /// off | disconnected | connected | logged_in
    pub auth_status: String,
    /// EdgeDebug 端口（桥接就绪后填充）
    pub bridge_port: Option<u16>,
    pub last_checked_ms: Option<i64>,
    pub message: String,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            relay_url: String::new(),
            edge_auth_enabled: false,
            auth_status: "off".into(),
            bridge_port: None,
            last_checked_ms: None,
            message: "尚未启用 Edge 登录态".into(),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub enabled: bool,
    pub status: String,
    pub relay_url: String,
    pub bridge_port: Option<u16>,
    pub bridge_running: bool,
    pub message: String,
    pub last_checked_ms: Option<i64>,
}

pub fn db_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi")
        .join("pi-usage-report-store")
        .join("auth.db")
}

/// EdgeBridge 状态文件（Phase 2 起由桥接进程写入）
pub fn bridge_state_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pi")
        .join("pi-usage-report-store")
        .join("edge-bridge.json")
}

fn now_ms() -> i64 {
    Local::now().timestamp_millis()
}

fn open() -> Result<Connection, String> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

fn set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO kv(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_bool(conn: &Connection, key: &str) -> bool {
    get(conn, key).map(|v| v == "true").unwrap_or(false)
}

fn get_i64(conn: &Connection, key: &str) -> Option<i64> {
    get(conn, key)
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<i64>().ok())
}

fn get_u16(conn: &Connection, key: &str) -> Option<u16> {
    get(conn, key)
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<u16>().ok())
}

pub fn get_config() -> AuthConfig {
    let Ok(conn) = open() else {
        return AuthConfig::default();
    };
    AuthConfig {
        relay_url: get(&conn, "relay_url").unwrap_or_default(),
        edge_auth_enabled: get_bool(&conn, "edge_auth_enabled"),
        auth_status: get(&conn, "auth_status").unwrap_or_else(|| "off".into()),
        bridge_port: get_u16(&conn, "bridge_port"),
        last_checked_ms: get_i64(&conn, "last_checked_ms"),
        message: get(&conn, "message").unwrap_or_else(|| "尚未启用 Edge 登录态".into()),
    }
}

pub fn save_config(cfg: &AuthConfig) -> Result<AuthStatus, String> {
    let conn = open()?;
    set(&conn, "relay_url", cfg.relay_url.trim())?;
    set(&conn, "edge_auth_enabled", &cfg.edge_auth_enabled.to_string())?;
    set(&conn, "auth_status", &cfg.auth_status)?;
    set(
        &conn,
        "bridge_port",
        &cfg.bridge_port.map(|p| p.to_string()).unwrap_or_default(),
    )?;
    set(
        &conn,
        "last_checked_ms",
        &cfg.last_checked_ms.map(|v| v.to_string()).unwrap_or_default(),
    )?;
    set(&conn, "message", &cfg.message)?;
    Ok(get_status())
}

/// 状态卡刷新：手动开关关闭 → off；已连接/已登录但桥接进程不在 → disconnected；
/// 否则原样返回。桥接状态文件来自 EdgeBridge（Phase 2）。
pub fn get_status() -> AuthStatus {
    let cfg = get_config();
    let mut bridge_port = None;
    let mut bridge_running = false;
    if let Ok(text) = fs::read_to_string(bridge_state_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(p) = v.get("port").and_then(|x| x.as_u64()) {
                bridge_port = Some(p as u16);
                bridge_running = true;
            }
        }
    }

    let status = if !cfg.edge_auth_enabled {
        "off".to_string()
    } else if matches!(cfg.auth_status.as_str(), "connected" | "logged_in") && !bridge_running {
        "disconnected".to_string()
    } else {
        cfg.auth_status.clone()
    };

    let message = if status != cfg.auth_status {
        "桥接进程未运行，状态降级为未连接".to_string()
    } else {
        cfg.message.clone()
    };

    AuthStatus {
        enabled: cfg.edge_auth_enabled,
        status,
        relay_url: cfg.relay_url,
        bridge_port: bridge_port.or(cfg.bridge_port),
        bridge_running,
        message,
        last_checked_ms: cfg.last_checked_ms,
    }
}

/// 手动控制按钮：连接 Edge / 标记已登录 / 断开 等
pub fn update_status(status: String, message: String) -> Result<AuthStatus, String> {
    let conn = open()?;
    set(&conn, "auth_status", &status)?;
    set(&conn, "message", &message)?;
    set(&conn, "last_checked_ms", &now_ms().to_string())?;
    Ok(get_status())
}