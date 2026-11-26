// commands/webdav.rs — settings and manual upload for the WebDAV destination.

use tauri::AppHandle;

use crate::webdav::{self, WebDavSettings, WebDavTestResult, WebDavUpload};

#[tauri::command]
pub async fn webdav_settings() -> Result<WebDavSettings, String> {
    tokio::task::spawn_blocking(webdav::settings)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_webdav_settings(
    settings: WebDavSettings,
    password: Option<String>,
) -> Result<WebDavSettings, String> {
    tokio::task::spawn_blocking(move || webdav::save_settings(settings, password))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn webdav_test() -> Result<WebDavTestResult, String> {
    webdav::test_connection().await
}

#[tauri::command]
pub async fn webdav_upload_now(app: AppHandle) -> Result<WebDavUpload, String> {
    webdav::upload_now(app).await
}
