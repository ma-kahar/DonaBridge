// webdav.rs — encrypted backup upload to a WebDAV folder.
//
// Works with Nextcloud, ownCloud, HiDrive, box.com, Synology/QNAP NAS and any
// other WebDAV server. The file is encrypted by `backup::create_backup` before
// it is read, so the server only ever receives AES-256-GCM ciphertext.
//
// A temporary file is written, uploaded and deleted; the local automatic-backup
// folder is not required. The last `keep` uploads are pruned with DELETE.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{backup, secrets};

const PASSWORD_KEY: &str = "backup/webdav-password";
const SETTING_ENABLED: &str = "webdav_enabled";
const SETTING_URL: &str = "webdav_url";
const SETTING_USER: &str = "webdav_user";
const SETTING_INTERVAL: &str = "webdav_interval_hours";
const SETTING_KEEP: &str = "webdav_keep";
const SETTING_LAST_AT: &str = "webdav_last_at";
const SETTING_LAST_STATUS: &str = "webdav_last_status";
const SETTING_LAST_ERROR: &str = "webdav_last_error";
const SETTING_LAST_FILE: &str = "webdav_last_file";
const SETTING_HISTORY: &str = "webdav_history";

const DEFAULT_INTERVAL: i64 = 24;
const DEFAULT_KEEP: usize = 14;

/// Prevents overlapping scheduled uploads.
static UPLOADING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavSettings {
    pub enabled: bool,
    pub url: String,
    pub username: String,
    pub interval_hours: i64,
    pub keep: usize,
    #[serde(default)]
    pub has_password: bool,
    #[serde(default)]
    pub last_at: Option<String>,
    #[serde(default)]
    pub last_status: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub last_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WebDavTestResult {
    pub ok: bool,
    pub status: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WebDavUpload {
    pub file: String,
    pub bytes: u64,
    pub status: u16,
}

fn read_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    dona_core::db::get_setting(conn, key).ok().flatten()
}

fn read_history(conn: &rusqlite::Connection) -> Vec<String> {
    read_setting(conn, SETTING_HISTORY)
        .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

pub fn settings() -> Result<WebDavSettings, String> {
    let conn = dona_core::db::get().lock();
    Ok(WebDavSettings {
        enabled: read_setting(&conn, SETTING_ENABLED).as_deref() == Some("1"),
        url: read_setting(&conn, SETTING_URL).unwrap_or_default(),
        username: read_setting(&conn, SETTING_USER).unwrap_or_default(),
        interval_hours: read_setting(&conn, SETTING_INTERVAL)
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(DEFAULT_INTERVAL),
        keep: read_setting(&conn, SETTING_KEEP)
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(DEFAULT_KEEP),
        has_password: secrets::has_secret(PASSWORD_KEY),
        last_at: read_setting(&conn, SETTING_LAST_AT).filter(|value| !value.is_empty()),
        last_status: read_setting(&conn, SETTING_LAST_STATUS).filter(|value| !value.is_empty()),
        last_error: read_setting(&conn, SETTING_LAST_ERROR).filter(|value| !value.is_empty()),
        last_file: read_setting(&conn, SETTING_LAST_FILE).filter(|value| !value.is_empty()),
    })
}

fn validate_url(raw: &str) -> Result<String, String> {
    let url = raw.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Err("Enter the WebDAV folder URL".into());
    }
    let parsed = reqwest::Url::parse(&url).map_err(|_| "That URL is not valid".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http:// and https:// WebDAV URLs are supported".into());
    }
    if parsed.host_str().unwrap_or_default().is_empty() {
        return Err("The URL needs a host name".into());
    }
    Ok(url)
}

pub fn save_settings(
    mut input: WebDavSettings,
    password: Option<String>,
) -> Result<WebDavSettings, String> {
    let url = if input.url.trim().is_empty() {
        String::new()
    } else {
        validate_url(&input.url)?
    };
    input.interval_hours = input.interval_hours.clamp(1, 168);
    input.keep = input.keep.clamp(1, 100);
    if input.enabled && url.is_empty() {
        return Err("Add the WebDAV folder URL before enabling uploads".into());
    }

    if let Some(password) = password {
        if !password.trim().is_empty() {
            secrets::set_secret(PASSWORD_KEY, password.trim())?;
        }
    }

    {
        let conn = dona_core::db::get().lock();
        let write = |key: &str, value: &str| dona_core::db::set_setting(&conn, key, value);
        write(SETTING_ENABLED, if input.enabled { "1" } else { "0" }).map_err(|e| e.to_string())?;
        write(SETTING_URL, &url).map_err(|e| e.to_string())?;
        write(SETTING_USER, input.username.trim()).map_err(|e| e.to_string())?;
        write(SETTING_INTERVAL, &input.interval_hours.to_string()).map_err(|e| e.to_string())?;
        write(SETTING_KEEP, &input.keep.to_string()).map_err(|e| e.to_string())?;
    }
    settings()
}

fn password() -> Result<Option<String>, String> {
    secrets::get_secret(PASSWORD_KEY)
}

fn remote_url(base: &str, name: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), name)
}

fn backup_filename() -> String {
    let short = uuid::Uuid::new_v4().simple().to_string();
    format!(
        "dona-{}-{}.donabk",
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        &short[..6]
    )
}

fn truncate(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        trimmed.to_string()
    } else {
        format!("{}…", trimmed.chars().take(limit).collect::<String>())
    }
}

fn record(
    status: Option<u16>,
    error: Option<&str>,
    file: Option<&str>,
    history: Option<&[String]>,
) {
    if let Some(conn) = dona_core::db::get().try_lock_for(Duration::from_secs(3)) {
        let _ = dona_core::db::set_setting(&conn, SETTING_LAST_AT, &Utc::now().to_rfc3339());
        let status_text = status
            .map(|code| format!("HTTP {code}"))
            .unwrap_or_default();
        let _ = dona_core::db::set_setting(&conn, SETTING_LAST_STATUS, &status_text);
        let _ = dona_core::db::set_setting(
            &conn,
            SETTING_LAST_ERROR,
            &error.map(|value| truncate(value, 500)).unwrap_or_default(),
        );
        if let Some(file) = file {
            let _ = dona_core::db::set_setting(&conn, SETTING_LAST_FILE, file);
        }
        if let Some(history) = history {
            if let Ok(json) = serde_json::to_string(history) {
                let _ = dona_core::db::set_setting(&conn, SETTING_HISTORY, &json);
            }
        }
    }
}

/// Names to keep after adding `new_name`, plus names that fell out of retention.
fn next_history(
    mut existing: Vec<String>,
    keep: usize,
    new_name: &str,
) -> (Vec<String>, Vec<String>) {
    existing.push(new_name.to_string());
    let excess = existing.len().saturating_sub(keep.max(1));
    let removed: Vec<String> = existing.drain(..excess).collect();
    (existing, removed)
}

fn http_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())
}

async fn put_file(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: Option<&str>,
    body: Vec<u8>,
) -> Result<(u16, String), String> {
    let mut request = client
        .put(url)
        .header("content-type", "application/octet-stream")
        .body(body);
    if !username.trim().is_empty() {
        request = request.basic_auth(username.trim(), password);
    }
    let response = request.send().await.map_err(|e| {
        if e.is_timeout() {
            "The WebDAV server did not answer in time".to_string()
        } else if e.is_connect() {
            "Could not connect to the WebDAV server".to_string()
        } else {
            e.to_string()
        }
    })?;
    let status = response.status().as_u16();
    let text = response.text().await.unwrap_or_default();
    Ok((status, text))
}

async fn delete_remote(
    client: &reqwest::Client,
    url: &str,
    username: &str,
    password: Option<&str>,
) {
    let mut request = client.delete(url);
    if !username.trim().is_empty() {
        request = request.basic_auth(username.trim(), password);
    }
    let _ = request.send().await;
}

/// PUT a probe file and remove it again. Validates URL, credentials and write
/// permission without creating a real backup.
pub async fn test_connection() -> Result<WebDavTestResult, String> {
    let settings = tokio::task::spawn_blocking(settings)
        .await
        .map_err(|e| e.to_string())??;
    if settings.url.trim().is_empty() {
        return Err("Add the WebDAV folder URL first".into());
    }
    let base = validate_url(&settings.url)?;
    let password = tokio::task::spawn_blocking(password)
        .await
        .map_err(|e| e.to_string())??;
    let client = http_client(30)?;
    let probe = backup_filename().replace(".donabk", ".txt");
    let url = remote_url(&base, &probe);

    let (status, text) = put_file(
        &client,
        &url,
        &settings.username,
        password.as_deref(),
        b"Dona Bridge WebDAV test".to_vec(),
    )
    .await?;

    if !(200..300).contains(&status) {
        return Ok(WebDavTestResult {
            ok: false,
            status: Some(status),
            error: Some(format!("HTTP {status}: {}", truncate(&text, 300))),
        });
    }
    delete_remote(&client, &url, &settings.username, password.as_deref()).await;
    Ok(WebDavTestResult {
        ok: true,
        status: Some(status),
        error: None,
    })
}

/// Create an encrypted backup and upload it. This is what the "Back up now"
/// button and the scheduler call.
pub async fn upload_now(app: AppHandle) -> Result<WebDavUpload, String> {
    let settings = tokio::task::spawn_blocking(settings)
        .await
        .map_err(|e| e.to_string())??;
    if settings.url.trim().is_empty() {
        return Err("Add the WebDAV folder URL first".into());
    }
    upload_with(&app, settings).await
}

async fn upload_with(app: &AppHandle, settings: WebDavSettings) -> Result<WebDavUpload, String> {
    let base = validate_url(&settings.url)?;
    let password = tokio::task::spawn_blocking(password)
        .await
        .map_err(|e| e.to_string())??;
    let key = tokio::task::spawn_blocking(backup::auto_backup_key)
        .await
        .map_err(|e| e.to_string())??;

    let file_name = backup_filename();
    let temp_path = std::env::temp_dir().join(&file_name);
    let app_for_backup = app.clone();
    let temp_for_backup = temp_path.clone();
    let created = tokio::task::spawn_blocking(move || {
        backup::create_backup(&app_for_backup, &key, &temp_for_backup)
    })
    .await
    .map_err(|e| e.to_string())??;

    let read_path = temp_path.clone();
    let bytes = tokio::task::spawn_blocking(move || std::fs::read(read_path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("Could not read the encrypted backup: {e}"))?;

    let client = http_client(180)?;
    let url = remote_url(&base, &file_name);
    let result = put_file(
        &client,
        &url,
        &settings.username,
        password.as_deref(),
        bytes,
    )
    .await;

    let _ = std::fs::remove_file(&temp_path);

    match result {
        Ok((status, _text)) if (200..300).contains(&status) => {
            // Best-effort retention: delete the oldest files we uploaded.
            let keep = settings.keep.max(1);
            let history = {
                let conn = dona_core::db::get()
                    .try_lock_for(Duration::from_secs(3))
                    .ok_or_else(|| "Database is busy".to_string())?;
                read_history(&conn)
            };
            let (new_history, removed) = next_history(history, keep, &file_name);
            for old in &removed {
                delete_remote(
                    &client,
                    &remote_url(&base, old),
                    &settings.username,
                    password.as_deref(),
                )
                .await;
            }
            record(
                Some(status),
                None,
                Some(&file_name),
                Some(new_history.as_slice()),
            );
            tracing::info!(
                "WebDAV backup uploaded to {url} ({} bytes, HTTP {status})",
                created.bytes
            );
            Ok(WebDavUpload {
                file: file_name,
                bytes: created.bytes,
                status,
            })
        }
        Ok((status, text)) => {
            let error = format!("HTTP {status}: {}", truncate(&text, 300));
            record(Some(status), Some(&error), None, None);
            Err(format!("WebDAV upload failed: {error}"))
        }
        Err(error) => {
            record(None, Some(&error), None, None);
            Err(error)
        }
    }
}

/// Called by the 30-second background timer. Uploads when enabled and due;
/// failures update the last status and wait for the next interval.
pub async fn auto_upload_if_due(app: AppHandle) -> Result<(), String> {
    if UPLOADING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = async {
        let settings = tokio::task::spawn_blocking(settings)
            .await
            .map_err(|e| e.to_string())??;
        if !settings.enabled || settings.url.trim().is_empty() {
            return Ok(());
        }
        let due = settings
            .last_at
            .as_deref()
            .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
            .map(|last| {
                Utc::now()
                    .signed_duration_since(last.with_timezone(&Utc))
                    .num_hours()
                    >= settings.interval_hours
            })
            .unwrap_or(true);
        if !due {
            return Ok(());
        }
        upload_with(&app, settings).await.map(|_| ())
    }
    .await;
    UPLOADING.store(false, Ordering::SeqCst);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_validation_and_join() {
        assert_eq!(
            validate_url("https://cloud.example.com/remote.php/dav/files/me/Dona/").unwrap(),
            "https://cloud.example.com/remote.php/dav/files/me/Dona"
        );
        assert_eq!(
            remote_url("https://cloud.example.com/dona/", "file.donabk"),
            "https://cloud.example.com/dona/file.donabk"
        );
        assert!(validate_url("ftp://example.com").is_err());
        assert!(validate_url("").is_err());
    }

    #[test]
    fn history_keeps_newest_files() {
        let (kept, removed) = next_history(vec!["a".into(), "b".into(), "c".into()], 3, "d");
        assert_eq!(kept, vec!["b", "c", "d"]);
        assert_eq!(removed, vec!["a"]);
    }

    #[test]
    fn history_never_drops_below_one() {
        let (kept, removed) = next_history(vec![], 0, "only");
        assert_eq!(kept, vec!["only"]);
        assert!(removed.is_empty());
    }

    #[test]
    fn backup_file_name_is_sortable_and_unique() {
        let first = backup_filename();
        let second = backup_filename();
        assert!(first.starts_with("dona-"));
        assert!(first.ends_with(".donabk"));
        assert_ne!(first, second);
    }
}
