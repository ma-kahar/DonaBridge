// commands/local_api.rs — read-only local API settings.

use crate::local_api::{self, ApiSettings};

#[tauri::command]
pub async fn api_settings() -> Result<ApiSettings, String> {
    tokio::task::spawn_blocking(local_api::settings)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_api_settings(
    settings: ApiSettings,
    token: Option<String>,
) -> Result<ApiSettings, String> {
    tokio::task::spawn_blocking(move || local_api::save_settings(settings, token))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn api_token() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(local_api::token)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rotate_api_token() -> Result<String, String> {
    tokio::task::spawn_blocking(local_api::rotate_token)
        .await
        .map_err(|e| e.to_string())?
}
