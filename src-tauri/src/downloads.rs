// downloads.rs — WhatsApp file downloads and their local history.
//
// WebView2 downloads triggered inside a `wa_*` webview are routed here by the
// `on_download` handler. Files are saved to `Downloads\Dona Bridge` (a visible,
// user-owned folder), and every finished download is recorded in
// `downloads.json` inside the app data directory. The React Downloads panel
// lists that history and can open, reveal or delete files.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const HISTORY_FILE: &str = "downloads.json";
const MAX_RECORDS: usize = 500;
const FOLDER_NAME: &str = "Dona Bridge";

static LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn lock() -> &'static Mutex<()> {
    LOCK.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRecord {
    pub id: String,
    pub account_id: String,
    pub file_name: String,
    pub path: String,
    pub url: String,
    pub bytes: u64,
    pub success: bool,
    pub created_at: String,
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    crate::paths::data_root(app).map_err(|e| format!("Could not resolve app data directory: {e}"))
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(HISTORY_FILE))
}

/// The visible folder where downloads are saved.
pub fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // Demo screenshots must not expose the real user's home directory.
    if std::env::var_os("DONA_DEMO").is_some() {
        if let Some(public) = std::env::var_os("PUBLIC") {
            let dir = PathBuf::from(public).join("Downloads").join(FOLDER_NAME);
            let _ = std::fs::create_dir_all(&dir);
            return Ok(dir);
        }
    }

    let base = app
        .path()
        .download_dir()
        .map_err(|e| format!("Could not resolve the Downloads folder: {e}"))?;
    let dir = base.join(FOLDER_NAME);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn load(app: &AppHandle) -> Vec<DownloadRecord> {
    let Ok(path) = history_path(app) else {
        return Vec::new();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Vec<DownloadRecord>>(&text).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, records: &[DownloadRecord]) -> Result<(), String> {
    let path = history_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    std::fs::write(path, text).map_err(|e| e.to_string())
}

pub fn list(app: &AppHandle) -> Result<Vec<DownloadRecord>, String> {
    let _guard = lock().lock();
    let mut records = load(app);
    records.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(records)
}

fn sanitize_file_name(raw: &str) -> String {
    let base = Path::new(raw)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("download");
    let mut cleaned = String::with_capacity(base.len());
    for ch in base.chars() {
        match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => cleaned.push('_'),
            c if c.is_control() => {}
            c => cleaned.push(c),
        }
    }
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    let name = if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed
    };
    if name.chars().count() > 160 {
        name.chars().take(160).collect()
    } else {
        name
    }
}

/// Build a non-existing path in the downloads folder for a suggested name.
pub fn unique_destination(app: &AppHandle, suggested: &str) -> Result<PathBuf, String> {
    let dir = downloads_dir(app)?;
    let name = sanitize_file_name(suggested);
    let path = Path::new(&name);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download");
    let extension = path.extension().and_then(|s| s.to_str());

    let candidate = dir.join(&name);
    if !candidate.exists() {
        return Ok(candidate);
    }
    for index in 1..1000 {
        let file_name = match extension {
            Some(ext) => format!("{stem} ({index}).{ext}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = dir.join(file_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Ok(dir.join(format!(
        "{stem}-{}.{}",
        Utc::now().timestamp(),
        extension.unwrap_or("bin")
    )))
}

/// Record a finished download, persist the history and notify the UI.
pub fn record_finished(
    app: &AppHandle,
    account_id: &str,
    url: &str,
    path: Option<PathBuf>,
    success: bool,
) -> Option<DownloadRecord> {
    let bytes = path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .map(|meta| meta.len())
        .unwrap_or(0);
    let file_name = path
        .as_ref()
        .and_then(|p| p.file_name())
        .and_then(|name| name.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            let tail = url.rsplit('/').next().unwrap_or("download");
            sanitize_file_name(tail)
        });

    let record = DownloadRecord {
        id: uuid::Uuid::new_v4().to_string(),
        account_id: account_id.to_string(),
        file_name,
        path: path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        url: url.chars().take(2000).collect(),
        bytes,
        success,
        created_at: Utc::now().to_rfc3339(),
    };

    {
        let _guard = lock().lock();
        let mut records = load(app);
        records.insert(0, record.clone());
        records.truncate(MAX_RECORDS);
        if let Err(err) = save(app, &records) {
            tracing::warn!("Could not save download history: {err}");
        }
    }

    let _ = app.emit("download-finished", &record);
    let _ = app
        .notification()
        .builder()
        .title(if success {
            "Download complete"
        } else {
            "Download failed"
        })
        .body(&record.file_name)
        .show();
    tracing::info!(
        "Download {}: {} ({} bytes)",
        if success { "finished" } else { "failed" },
        record.file_name,
        record.bytes
    );
    Some(record)
}

pub fn open_path(app: &AppHandle, path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("This download has no file on disk".into());
    }
    if !Path::new(path).exists() {
        return Err("The file no longer exists. It may have been moved or deleted.".into());
    }
    app.opener()
        .open_path(path.to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

pub fn reveal_path(app: &AppHandle, path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("This download has no file on disk".into());
    }
    if !Path::new(path).exists() {
        return Err("The file no longer exists. It may have been moved or deleted.".into());
    }
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| e.to_string())
}

pub fn remove(app: &AppHandle, id: &str, delete_file: bool) -> Result<(), String> {
    let _guard = lock().lock();
    let mut records = load(app);
    if let Some(record) = records.iter().find(|record| record.id == id) {
        if delete_file && !record.path.is_empty() {
            if let Err(err) = std::fs::remove_file(&record.path) {
                if err.kind() != std::io::ErrorKind::NotFound {
                    return Err(format!("Could not delete the file: {err}"));
                }
            }
        }
    }
    records.retain(|record| record.id != id);
    save(app, &records)
}

pub fn clear(app: &AppHandle) -> Result<(), String> {
    let _guard = lock().lock();
    save(app, &[])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_sanitized() {
        assert_eq!(sanitize_file_name("invoice.pdf"), "invoice.pdf");
        assert_eq!(sanitize_file_name("../../evil.pdf"), "evil.pdf");
        assert_eq!(sanitize_file_name("a*b?.pdf"), "a_b_.pdf");
        assert_eq!(sanitize_file_name(""), "download");
        assert_eq!(sanitize_file_name("   "), "download");
    }
}
