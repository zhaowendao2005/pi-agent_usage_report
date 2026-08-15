mod config;
mod db;

use config::UsageUiConfig;
use db::{parse_time, Health, ModelUsage, ServerSummary, TokenDataPoint};
use serde_json::Value;
use tauri::Manager;

fn range_from_args(start: Option<Value>, end: Option<Value>) -> (i64, i64) {
    let now = chrono::Local::now().timestamp_millis();
    let end_ms = end
        .as_ref()
        .map(|v| parse_time(v, now))
        .unwrap_or(now);
    let start_ms = start
        .as_ref()
        .map(|v| parse_time(v, end_ms - 24 * 60 * 60 * 1000))
        .unwrap_or(end_ms - 24 * 60 * 60 * 1000);
    (start_ms, end_ms)
}

#[tauri::command]
fn get_health() -> Result<Health, String> {
    db::health()
}

#[tauri::command]
fn get_series(start: Option<Value>, end: Option<Value>) -> Result<Vec<TokenDataPoint>, String> {
    let (s, e) = range_from_args(start, end);
    db::series(s, e)
}

#[tauri::command]
fn get_models(start: Option<Value>, end: Option<Value>) -> Result<Vec<ModelUsage>, String> {
    let (s, e) = range_from_args(start, end);
    db::models(s, e)
}

#[tauri::command]
fn get_summary(start: Option<Value>, end: Option<Value>) -> Result<ServerSummary, String> {
    let (s, e) = range_from_args(start, end);
    db::summary(s, e)
}

#[tauri::command]
fn get_usage_config() -> UsageUiConfig {
    config::load()
}

#[tauri::command]
fn save_usage_config(config: UsageUiConfig) -> Result<(), String> {
    config::save(&config)
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_health,
            get_series,
            get_models,
            get_summary,
            get_usage_config,
            save_usage_config,
            show_main_window
        ])
        .setup(|app| {
            // Ensure main window is visible on start
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
