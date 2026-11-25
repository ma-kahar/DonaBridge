// backup.rs — password-protected, portable database backups and a local
// storage/health report.
//
// A backup is a consistent SQLite snapshot (`VACUUM INTO`) encrypted with
// AES-256-GCM. The key is derived from the user's password with Argon2id.
//
// Restores are applied on the next startup (see `dona_core::db`): the file is
// decrypted and validated now, staged next to the live database, and swapped in
// before SQLite opens it. This avoids replacing an open database file on
// Windows and makes a restore atomic from the app's point of view.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::Argon2;
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAGIC: &[u8; 8] = b"DONABK1\0";
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const HEADER_LEN: usize = MAGIC.len() + SALT_LEN + NONCE_LEN;
const MIN_CIPHERTEXT_LEN: usize = 16; // AES-GCM authentication tag

#[derive(Debug, Clone, Serialize)]
pub struct BackupResult {
    pub path: String,
    pub bytes: u64,
    pub accounts: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SnapshotInfo {
    pub path: String,
    pub bytes: u64,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthReport {
    pub data_dir: String,
    pub db_path: String,
    pub db_bytes: u64,
    pub wal_bytes: u64,
    pub log_dir: String,
    pub backups_bytes: u64,
    pub account_count: usize,
    pub group_count: usize,
    pub webview_profiles: usize,
    pub webview_bytes: u64,
    pub version: String,
    pub os: String,
    pub unclean_shutdown: bool,
    pub integrity_ok: bool,
    pub recovery_notice: Option<String>,
    pub snapshots: Vec<SnapshotInfo>,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|e| format!("Could not resolve app data directory: {e}"))
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Could not derive encryption key: {e}"))?;
    Ok(key)
}

/// Cryptographically random bytes from the OS CSPRNG (UUID v4 is seeded with it).
fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    let mut filled = 0;
    while filled < N {
        let bytes = uuid::Uuid::new_v4().into_bytes();
        let take = (N - filled).min(bytes.len());
        out[filled..filled + take].copy_from_slice(&bytes[..take]);
        filled += take;
    }
    out
}

fn validate_backup_database(path: &Path) -> Result<usize, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Backup is not a valid database: {e}"))?;

    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| format!("Backup integrity check failed: {e}"))?;
    if integrity != "ok" {
        return Err(format!("Backup is damaged: {integrity}"));
    }

    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'accounts'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Backup is not a Dona Bridge database: {e}"))?;
    if tables != 1 {
        return Err("Backup does not contain Dona Bridge data".into());
    }

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if version > dona_core::db::LATEST_SCHEMA_VERSION {
        return Err(format!(
            "Backup was created by a newer version of Dona Bridge (schema v{version})."
        ));
    }

    conn.query_row("SELECT count(*) FROM accounts", [], |row| row.get(0))
        .map_err(|e| format!("Could not read accounts from backup: {e}"))
}

/// Create an encrypted snapshot of the live database.
pub fn create_backup(
    app: &AppHandle,
    password: &str,
    destination: &Path,
) -> Result<BackupResult, String> {
    if password.trim().len() < 8 {
        return Err("Backup password must be at least 8 characters".into());
    }
    if destination.as_os_str().is_empty() {
        return Err("Choose where to save the backup".into());
    }

    let dir = data_dir(app)?;
    let snapshot = dir.join(format!("snapshot-{}.db", uuid::Uuid::new_v4()));
    let _ = std::fs::remove_file(&snapshot);

    let account_count = {
        let conn = dona_core::db::get().lock();
        // `VACUUM INTO` writes a consistent snapshot, including committed WAL
        // frames, without blocking readers.
        conn.execute("VACUUM INTO ?1", params![snapshot.to_string_lossy()])
            .map_err(|e| format!("Could not create database snapshot: {e}"))?;
        conn.query_row("SELECT count(*) FROM accounts", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap_or(0) as usize
    };

    let plain = std::fs::read(&snapshot).map_err(|e| format!("Could not read snapshot: {e}"))?;
    let _ = std::fs::remove_file(&snapshot);

    let salt = random_bytes::<SALT_LEN>();
    let nonce = random_bytes::<NONCE_LEN>();
    let key = derive_key(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Cipher init failed: {e}"))?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plain.as_slice())
        .map_err(|_| "Could not encrypt the backup".to_string())?;

    let mut output = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&salt);
    output.extend_from_slice(&nonce);
    output.extend_from_slice(&ciphertext);

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not create folder: {e}"))?;
    }
    std::fs::write(destination, &output)
        .map_err(|e| format!("Could not write the backup file: {e}"))?;

    tracing::info!(
        "Encrypted backup written to {} ({} bytes, {account_count} accounts)",
        destination.display(),
        output.len()
    );

    Ok(BackupResult {
        path: destination.to_string_lossy().to_string(),
        bytes: output.len() as u64,
        accounts: account_count,
    })
}

/// Decrypt and validate a backup, stage it for the next startup and return the
/// number of accounts it contains.
pub fn stage_restore(app: &AppHandle, source: &Path, password: &str) -> Result<usize, String> {
    if password.trim().is_empty() {
        return Err("Enter the backup password".into());
    }

    let data = std::fs::read(source).map_err(|e| format!("Could not read the backup file: {e}"))?;
    if data.len() < HEADER_LEN + MIN_CIPHERTEXT_LEN {
        return Err("This file is too small to be a Dona Bridge backup".into());
    }
    if &data[..MAGIC.len()] != MAGIC {
        return Err("This is not a Dona Bridge backup file".into());
    }

    let salt = &data[MAGIC.len()..MAGIC.len() + SALT_LEN];
    let nonce_start = MAGIC.len() + SALT_LEN;
    let nonce = &data[nonce_start..nonce_start + NONCE_LEN];
    let ciphertext = &data[HEADER_LEN..];

    let key = derive_key(password, salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("Cipher init failed: {e}"))?;
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "Wrong password, or the backup file is corrupted".to_string())?;

    let dir = data_dir(app)?;
    let staging_name = format!("restore-staging-{}.db", uuid::Uuid::new_v4());
    let staging = dir.join(&staging_name);
    std::fs::write(&staging, &plain).map_err(|e| format!("Could not stage the restore: {e}"))?;

    let account_count = match validate_backup_database(&staging) {
        Ok(count) => count,
        Err(err) => {
            let _ = std::fs::remove_file(&staging);
            return Err(err);
        }
    };

    dona_core::db::note_pending_restore(&dir, &staging_name).map_err(|e| e.to_string())?;
    // Flush the live WAL and clear the session marker before the restart.
    dona_core::db::end_session();

    tracing::info!(
        "Restore staged from {} ({account_count} accounts); restarting to apply",
        source.display()
    );

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        handle.restart();
    });

    Ok(account_count)
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            total = total.saturating_add(dir_size(&entry.path()));
        } else {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

fn count_dirs(path: &Path) -> usize {
    std::fs::read_dir(path)
        .map(|entries| entries.flatten().filter(|e| e.path().is_dir()).count())
        .unwrap_or(0)
}

pub fn health_report(app: &AppHandle) -> Result<HealthReport, String> {
    let dir = data_dir(app)?;
    let db_path = dona_core::db::db_path(&dir);
    let metadata = |name: &str| {
        std::fs::metadata(dir.join(name))
            .map(|m| m.len())
            .unwrap_or(0)
    };

    let (account_count, group_count, integrity_ok) = {
        let conn = dona_core::db::get().lock();
        let accounts: i64 = conn
            .query_row("SELECT count(*) FROM accounts", [], |row| row.get(0))
            .unwrap_or(0);
        let groups: i64 = conn
            .query_row("SELECT count(*) FROM account_groups", [], |row| row.get(0))
            .unwrap_or(0);
        let integrity = conn
            .query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0))
            .map(|value| value.eq_ignore_ascii_case("ok"))
            .unwrap_or(false);
        (accounts as usize, groups as usize, integrity)
    };

    let webview_dir = dir.join("WebView2");
    let snapshots = dona_core::db::list_auto_snapshots()
        .into_iter()
        .map(|(path, bytes, created)| SnapshotInfo {
            path: path.to_string_lossy().to_string(),
            bytes,
            created_at: created.map(|dt| dt.to_rfc3339()),
        })
        .collect();

    Ok(HealthReport {
        data_dir: dir.to_string_lossy().to_string(),
        db_path: db_path.to_string_lossy().to_string(),
        db_bytes: metadata("dona.db"),
        wal_bytes: metadata("dona.db-wal"),
        log_dir: dir.join("logs").to_string_lossy().to_string(),
        backups_bytes: dir_size(&dir.join("backups")),
        account_count,
        group_count,
        webview_profiles: count_dirs(&webview_dir),
        webview_bytes: dir_size(&webview_dir),
        version: app.package_info().version.to_string(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
        unclean_shutdown: dona_core::db::last_session_unclean(),
        integrity_ok,
        recovery_notice: dona_core::db::recovery_notice(),
        snapshots,
    })
}

/// Take a local automatic snapshot immediately.
pub fn create_snapshot() -> Result<PathBuf, String> {
    dona_core::db::auto_snapshot()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Could not create a snapshot: the database is busy. Try again.".to_string())
}

/// Restore a plain automatic snapshot, then restart to apply it.
pub fn stage_snapshot_restore(app: &AppHandle, source: &Path) -> Result<usize, String> {
    let dir = data_dir(app)?;
    let backup_dir = dir.join("backups");
    let canonical_source = source
        .canonicalize()
        .map_err(|e| format!("Snapshot not found: {e}"))?;
    let canonical_backups = backup_dir
        .canonicalize()
        .map_err(|e| format!("Backups folder not found: {e}"))?;
    if !canonical_source.starts_with(&canonical_backups) {
        return Err("Only snapshots inside the backups folder can be restored".into());
    }

    let conn = Connection::open_with_flags(&canonical_source, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("Snapshot is not a valid database: {e}"))?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| format!("Snapshot integrity check failed: {e}"))?;
    if integrity != "ok" {
        return Err(format!("Snapshot is damaged: {integrity}"));
    }
    let tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='accounts'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Snapshot is not a Dona Bridge database: {e}"))?;
    if tables != 1 {
        return Err("Snapshot does not contain Dona Bridge data".into());
    }
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap_or(0);
    if version > dona_core::db::LATEST_SCHEMA_VERSION {
        return Err("Snapshot was created by a newer version of Dona Bridge".into());
    }
    let accounts: i64 = conn
        .query_row("SELECT count(*) FROM accounts", [], |row| row.get(0))
        .map_err(|e| format!("Could not read accounts from the snapshot: {e}"))?;
    drop(conn);

    let staging_name = format!("restore-staging-{}.db", uuid::Uuid::new_v4());
    std::fs::copy(&canonical_source, dir.join(&staging_name))
        .map_err(|e| format!("Could not stage the snapshot: {e}"))?;
    dona_core::db::note_pending_restore(&dir, &staging_name).map_err(|e| e.to_string())?;
    dona_core::db::end_session();

    tracing::info!(
        "Snapshot {} staged for restore; restarting",
        canonical_source.display()
    );
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(700)).await;
        handle.restart();
    });

    Ok(accounts as usize)
}

/// Bundle the logs and a health summary into a diagnostics folder.
pub fn export_diagnostics(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?;
    let health = health_report(app)?;
    let out = dir.join(format!(
        "diagnostics-{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));
    std::fs::create_dir_all(&out)
        .map_err(|e| format!("Could not create diagnostics folder: {e}"))?;

    let log_dir = PathBuf::from(&health.log_dir);
    if let Ok(entries) = std::fs::read_dir(&log_dir) {
        let mut logs: Vec<PathBuf> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_file())
            .collect();
        logs.sort_by_key(|path| {
            std::fs::metadata(path)
                .and_then(|meta| meta.modified())
                .ok()
        });
        logs.reverse();
        for path in logs.into_iter().take(5) {
            if let Some(name) = path.file_name() {
                let _ = std::fs::copy(&path, out.join(name));
            }
        }
    }

    let json = serde_json::to_string_pretty(&health)
        .map_err(|e| format!("Could not serialise health data: {e}"))?;
    std::fs::write(out.join("health.json"), json)
        .map_err(|e| format!("Could not write health.json: {e}"))?;

    let summary = format!(
        "Dona Bridge diagnostics\n\
         Version: {}\n\
         OS: {}\n\
         Data folder: {}\n\
         Database: {}\n\
         Logs: {}\n\
         Previous session unclean: {}\n\
         Integrity check: {}\n\
         Recovery notice: {}\n",
        health.version,
        health.os,
        health.data_dir,
        health.db_path,
        health.log_dir,
        health.unclean_shutdown,
        if health.integrity_ok { "ok" } else { "failed" },
        health.recovery_notice.as_deref().unwrap_or("none"),
    );
    std::fs::write(out.join("summary.txt"), summary)
        .map_err(|e| format!("Could not write summary.txt: {e}"))?;

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_roundtrip_detects_wrong_password() {
        let dir = std::env::temp_dir().join(format!("dona-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let db_file = dir.join("dona.db");

        // Build a minimal valid database with an accounts table.
        {
            let conn = Connection::open(&db_file).expect("open db");
            conn.execute_batch(
                "CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
                 INSERT INTO accounts (id, name) VALUES ('a', 'Alpha'), ('b', 'Beta');",
            )
            .expect("schema");
            conn.execute_batch("PRAGMA user_version = 1;")
                .expect("version");
        }

        assert_eq!(validate_backup_database(&db_file).expect("valid"), 2);

        let plain = std::fs::read(&db_file).expect("read db");
        let mut password = String::from("correct horse battery");
        let salt = random_bytes::<SALT_LEN>();
        let nonce = random_bytes::<NONCE_LEN>();
        let key = derive_key(&password, &salt).expect("key");
        let cipher = Aes256Gcm::new_from_slice(&key).expect("cipher");
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), plain.as_slice())
            .expect("encrypt");

        let mut file = Vec::new();
        file.extend_from_slice(MAGIC);
        file.extend_from_slice(&salt);
        file.extend_from_slice(&nonce);
        file.extend_from_slice(&ciphertext);

        let key_ok = derive_key(&password, &salt).expect("key");
        let cipher_ok = Aes256Gcm::new_from_slice(&key_ok).expect("cipher");
        let decrypted = cipher_ok
            .decrypt(Nonce::from_slice(&nonce), &ciphertext[..])
            .expect("decrypt");
        assert_eq!(decrypted, plain);

        password = "wrong password".into();
        let key_bad = derive_key(&password, &salt).expect("key");
        assert_ne!(key_bad, key_ok);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
