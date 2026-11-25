// commands/data.rs — encrypted backup/restore and the local health report.

use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::backup::{self, BackupResult, HealthReport};

#[derive(Debug, Clone, Serialize)]
pub struct RestoreResult {
    pub accounts: usize,
}

/// Create a password-protected backup at `destination`.
#[tauri::command]
pub async fn backup_encrypted(
    app: AppHandle,
    password: String,
    destination: String,
) -> Result<BackupResult, String> {
    let path = PathBuf::from(destination);
    tokio::task::spawn_blocking(move || {
        backup::create_backup(&app, &password, &path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Decrypt and validate a backup, then restart to apply it.
#[tauri::command]
pub async fn restore_encrypted(
    app: AppHandle,
    path: String,
    password: String,
) -> Result<RestoreResult, String> {
    let source = PathBuf::from(path);
    let handle = app.clone();
    let accounts = tokio::task::spawn_blocking(move || {
        backup::stage_restore(&handle, &source, &password).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(RestoreResult { accounts })
}

/// Storage/health information for the Settings → Data panel.
#[tauri::command]
pub async fn app_health(app: AppHandle) -> Result<HealthReport, String> {
    tokio::task::spawn_blocking(move || backup::health_report(&app).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Create an automatic snapshot immediately.
#[tauri::command]
pub async fn create_snapshot() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        backup::create_snapshot().map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Restore an automatic snapshot, then restart to apply it.
#[tauri::command]
pub async fn restore_snapshot(app: AppHandle, path: String) -> Result<RestoreResult, String> {
    let source = PathBuf::from(path);
    let handle = app.clone();
    let accounts = tokio::task::spawn_blocking(move || {
        backup::stage_snapshot_restore(&handle, &source).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(RestoreResult { accounts })
}

/// Bundle logs and health information into a diagnostics folder.
#[tauri::command]
pub async fn export_diagnostics(app: AppHandle) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        backup::export_diagnostics(&app)
            .map(|path| path.to_string_lossy().to_string())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
