// commands/downloads.rs — download history and file actions.

use tauri::AppHandle;

use crate::downloads::{self, DownloadRecord};

#[tauri::command]
pub async fn downloads_list(app: AppHandle) -> Result<Vec<DownloadRecord>, String> {
    tokio::task::spawn_blocking(move || downloads::list(&app))
        .await
        .map_err(|e| e.to_string())?
}

/// Create (if needed) and return the folder where downloads are saved.
#[tauri::command]
pub async fn downloads_folder(app: AppHandle) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        downloads::downloads_dir(&app).map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn download_open(app: AppHandle, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || downloads::open_path(&app, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn download_reveal(app: AppHandle, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || downloads::reveal_path(&app, &path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn download_remove(app: AppHandle, id: String, delete_file: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || downloads::remove(&app, &id, delete_file))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn downloads_clear(app: AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || downloads::clear(&app))
        .await
        .map_err(|e| e.to_string())?
}
