mod auth;
mod config;
mod db;

use config::UsageUiConfig;
use db::{parse_time, CalibrationScript, Health, ModelUsage, ProviderGroup, ProviderStat, ServerSummary, TokenDataPoint};
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
fn get_providers() -> Result<Vec<ProviderStat>, String> {
    db::get_providers()
}

#[tauri::command]
fn get_calibration_script(provider: String) -> Result<Option<CalibrationScript>, String> {
    db::get_calibration_script(&provider)
}

#[tauri::command]
fn get_all_calibration_scripts() -> Result<Vec<CalibrationScript>, String> {
    db::get_all_calibration_scripts()
}

#[tauri::command]
fn save_calibration_script(provider: String, script: String) -> Result<(), String> {
    db::save_calibration_script(&provider, &script)
}

#[tauri::command]
fn delete_calibration_script(provider: String) -> Result<(), String> {
    db::delete_calibration_script(&provider)
}

#[tauri::command]
fn get_all_provider_groups() -> Result<Vec<ProviderGroup>, String> {
    db::get_all_provider_groups()
}

#[tauri::command]
fn create_provider_group(group_name: String, members: Vec<String>) -> Result<i64, String> {
    db::create_provider_group(&group_name, members)
}

#[tauri::command]
fn add_to_provider_group(group_id: i64, provider: String) -> Result<(), String> {
    db::add_to_provider_group(group_id, &provider)
}

#[tauri::command]
fn remove_from_provider_group(group_id: i64, provider: String) -> Result<(), String> {
    db::remove_from_provider_group(group_id, &provider)
}

#[tauri::command]
fn delete_provider_group(group_id: i64) -> Result<(), String> {
    db::delete_provider_group(group_id)
}

#[tauri::command]
fn find_group_by_provider(provider: String) -> Result<Option<ProviderGroup>, String> {
    db::find_group_by_provider(&provider)
}

#[tauri::command]
fn delete_llm_call(id: i64) -> Result<(), String> {
    db::delete_llm_call(id)
}

#[tauri::command]
fn get_auth_config() -> auth::AuthConfig {
    auth::get_config()
}

#[tauri::command]
fn save_auth_config(config: auth::AuthConfig) -> Result<auth::AuthStatus, String> {
    auth::save_config(&config)
}

#[tauri::command]
fn get_auth_status() -> auth::AuthStatus {
    auth::get_status()
}

#[tauri::command]
fn update_auth_status(status: String, message: String) -> Result<auth::AuthStatus, String> {
    auth::update_status(status, message)
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
            get_providers,
            get_calibration_script,
            get_all_calibration_scripts,
            save_calibration_script,
            delete_calibration_script,
            get_all_provider_groups,
            create_provider_group,
            add_to_provider_group,
            remove_from_provider_group,
            delete_provider_group,
            find_group_by_provider,
            delete_llm_call,
            get_auth_config,
            save_auth_config,
            get_auth_status,
            update_auth_status,
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
