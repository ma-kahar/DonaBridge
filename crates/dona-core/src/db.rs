// dona-core/src/db.rs
// SQLite in WAL mode with numbered migrations (Blueprint §3 #6, #7).
// Blueprint §3 #6: structs have #[serde(default)]; never overwrite a file that failed to parse.
// Blueprint §3 #7: SQLite in WAL mode; images as files, path in DB, never base64 inline.

use parking_lot::Mutex;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    time::Duration,
};

use crate::error::Result;

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

/// Every `dona.db` sidecar file that has to travel with the database.
const DB_SIDECARS: [&str; 3] = ["dona.db", "dona.db-wal", "dona.db-shm"];

/// Kept in sync with the number of migrations below.
pub const LATEST_SCHEMA_VERSION: i64 = 3;

/// Marker file written before a restore; applied on the next startup.
const RESTORE_MARKER: &str = "restore.pending";

/// Present while the app is running. Removed on a clean exit; if it still
/// exists on the next start, the previous session crashed or was killed.
const SESSION_MARKER: &str = "session.running";

/// Automatic snapshot prefix and retention (kept in the backups folder).
const AUTO_PREFIX: &str = "auto-";
const AUTO_KEEP: usize = 14;
const AUTO_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();
static LAST_UNCLEAN: AtomicBool = AtomicBool::new(false);
static INTEGRITY_OK: AtomicBool = AtomicBool::new(true);
static RECOVERY_NOTICE: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DbHealth {
    Ok,
    Corrupt,
    Busy,
}

/// All migrations in order. Never modify an existing migration — add a new one.
fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        // M001: initial schema
        M::up(include_str!("migrations/001_initial.sql")),
        // M002: account group colours
        M::up(include_str!("migrations/002_account_group_color.sql")),
        // M003: LiteCRM pipelines, deals, custom fields, tasks, activity
        M::up(include_str!("migrations/003_crm_lite.sql")),
    ])
}

/// Initialise the database. Called once at app startup.
pub fn init(app_data_dir: &Path) -> Result<()> {
    init_with_legacy(app_data_dir, None)
}

/// Initialise the database at `dir`, first copying a database found in
/// `legacy_dir` (the old Roaming AppData location) when no database exists yet.
///
/// The database lives next to the WebView2 profiles in **Local** AppData on
/// purpose: Roaming AppData can be synchronised by OneDrive / roaming profiles
/// and SQLite does not tolerate that (WAL files get copied mid-write and the
/// database can appear empty or corrupt after a reboot).
pub fn init_with_legacy(dir: &Path, legacy_dir: Option<&Path>) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    let _ = DATA_DIR.set(dir.to_path_buf());

    // Detect an unclean shutdown before we write the marker for this session.
    let unclean = dir.join(SESSION_MARKER).exists();
    LAST_UNCLEAN.store(unclean, Ordering::SeqCst);
    if unclean {
        tracing::warn!("Previous session did not exit cleanly");
    }

    // A restore is staged on disk and applied here, before SQLite opens the
    // database. Replacing an open SQLite file on Windows is not reliable, so
    // the restore command only writes a marker + staging file and restarts.
    apply_pending_restore(dir)?;

    let db_path = dir.join("dona.db");

    if !db_path.exists() {
        if let Some(legacy) = legacy_dir {
            migrate_from_legacy(legacy, dir);
        }
    }

    // Never open a damaged database normally: quarantine it and fall back to
    // the newest automatic snapshot that passes its own integrity check.
    if db_path.exists() {
        match check_db_file(&db_path) {
            DbHealth::Ok => INTEGRITY_OK.store(true, Ordering::SeqCst),
            DbHealth::Corrupt => {
                INTEGRITY_OK.store(false, Ordering::SeqCst);
                recover_corrupt_database(dir, &db_path);
            }
            DbHealth::Busy => {
                tracing::warn!("Startup integrity check skipped: database is busy");
            }
        }
    }

    let mut conn = Connection::open(&db_path)?;

    // WAL mode for better performance and crash safety (Blueprint §3 #7).
    // synchronous=FULL makes every commit durable even across a power cut /
    // hard reset — losing an account because the PC was switched off is far
    // worse than a few extra fsyncs.
    // busy_timeout: SQLite retries internally for up to 10 s before SQLITE_BUSY.
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         PRAGMA busy_timeout=10000;
         PRAGMA synchronous=FULL;
         PRAGMA wal_autocheckpoint=1000;",
    )?;

    // Take a plain snapshot before a schema upgrade so a broken migration can
    // always be rolled back manually.
    if db_path.exists() {
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap_or(0);
        if version > 0 && version < LATEST_SCHEMA_VERSION {
            // Fold the WAL into the main file first, otherwise the snapshot can
            // miss committed rows.
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            let _ = snapshot_database(dir, &db_path, "pre-migration");
        }
        if version > LATEST_SCHEMA_VERSION {
            return Err(crate::error::CoreError::Other(format!(
                "This database was created by a newer version of Dona Bridge (schema v{version}). Please update the app."
            )));
        }
    }

    // Run all pending migrations (Blueprint §3 #6)
    migrations().to_latest(&mut conn)?;

    DB.set(Mutex::new(conn))
        .map_err(|_| crate::error::CoreError::Other("DB already initialised".into()))?;

    if let Err(err) = mark_session_started(dir) {
        tracing::warn!("Could not write the session marker: {err}");
    }

    tracing::info!("Database ready at {}", db_path.display());
    Ok(())
}

/// Whether the previous session ended without a clean exit.
pub fn last_session_unclean() -> bool {
    LAST_UNCLEAN.load(Ordering::SeqCst)
}

/// Whether the database passed its startup integrity check.
pub fn integrity_ok() -> bool {
    INTEGRITY_OK.load(Ordering::SeqCst)
}

/// A user-facing message set when the startup found or repaired a problem.
pub fn recovery_notice() -> Option<String> {
    RECOVERY_NOTICE.lock().clone()
}

fn set_recovery_notice(message: String) {
    tracing::error!("{message}");
    *RECOVERY_NOTICE.lock() = Some(message);
}

fn mark_session_started(dir: &Path) -> std::io::Result<()> {
    let content = format!(
        "{{\"pid\":{},\"started_at\":\"{}\"}}",
        std::process::id(),
        chrono::Utc::now().to_rfc3339()
    );
    std::fs::write(dir.join(SESSION_MARKER), content)
}

/// Finish a clean session: take a final snapshot, then clear the crash marker.
pub fn end_session() {
    let _ = auto_snapshot();
    if let Some(dir) = DATA_DIR.get() {
        let _ = std::fs::remove_file(dir.join(SESSION_MARKER));
    }
}

fn check_db_file(path: &Path) -> DbHealth {
    // Use a normal (not read-only) connection: a WAL database needs its shared
    // memory file, and a read-only open can fail with "unable to open database
    // file" on a perfectly healthy database.
    let conn = match Connection::open(path) {
        Ok(conn) => conn,
        Err(err) => {
            let message = err.to_string().to_lowercase();
            return if message.contains("locked") || message.contains("busy") {
                DbHealth::Busy
            } else {
                DbHealth::Corrupt
            };
        }
    };

    match conn.query_row("PRAGMA quick_check(1)", [], |row| row.get::<_, String>(0)) {
        Ok(value) if value.eq_ignore_ascii_case("ok") => DbHealth::Ok,
        Ok(_) => DbHealth::Corrupt,
        Err(err) => {
            let message = err.to_string().to_lowercase();
            if message.contains("locked") || message.contains("busy") {
                DbHealth::Busy
            } else {
                DbHealth::Corrupt
            }
        }
    }
}

/// Automatic snapshots, newest first.
fn auto_snapshot_files(backup_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(backup_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(AUTO_PREFIX) && name.ends_with(".db"))
        })
        .collect();
    files.sort_by(|a, b| b.cmp(a));
    files
}

/// Newest automatic snapshot that still opens cleanly.
fn newest_valid_auto_snapshot(backup_dir: &Path) -> Option<PathBuf> {
    auto_snapshot_files(backup_dir)
        .into_iter()
        .find(|path| check_db_file(path) == DbHealth::Ok)
}

fn recover_corrupt_database(dir: &Path, db_path: &Path) {
    let backup_dir = dir.join("backups");
    let quarantine_dir = backup_dir.join(format!(
        "corrupt-{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S")
    ));

    if std::fs::create_dir_all(&quarantine_dir).is_ok() {
        for name in DB_SIDECARS {
            let source = dir.join(name);
            if source.exists() {
                let _ = std::fs::rename(&source, quarantine_dir.join(name));
            }
        }
    }

    if let Some(snapshot) = newest_valid_auto_snapshot(&backup_dir) {
        if std::fs::copy(&snapshot, db_path).is_ok() && check_db_file(db_path) == DbHealth::Ok {
            INTEGRITY_OK.store(true, Ordering::SeqCst);
            let name = snapshot
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("automatic snapshot");
            set_recovery_notice(format!(
                "The database was damaged and has been restored from {name}. \
                 The damaged copy was preserved in {}.",
                quarantine_dir.display()
            ));
            return;
        }
    }

    INTEGRITY_OK.store(false, Ordering::SeqCst);
    set_recovery_notice(format!(
        "The database was damaged and no usable automatic snapshot was found. \
         A copy of the damaged database was preserved in {}. Restore a backup from \
         Settings → Data, or contact support with that folder.",
        quarantine_dir.display()
    ));
}

/// Take an automatic snapshot of the live database (rotated, newest 14 kept).
pub fn auto_snapshot() -> Result<Option<PathBuf>> {
    let Some(dir) = DATA_DIR.get() else {
        return Ok(None);
    };
    let Some(mutex) = DB.get() else {
        return Ok(None);
    };
    let Some(conn) = mutex.try_lock_for(Duration::from_secs(5)) else {
        tracing::warn!("Skipping automatic snapshot: database is busy");
        return Ok(None);
    };

    let backup_dir = dir.join("backups");
    std::fs::create_dir_all(&backup_dir)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let target = backup_dir.join(format!("{AUTO_PREFIX}{stamp}.db"));
    if target.exists() {
        return Ok(Some(target));
    }

    conn.execute(
        "VACUUM INTO ?1",
        rusqlite::params![target.to_string_lossy()],
    )?;
    prune_auto_snapshots(&backup_dir);
    tracing::info!(
        "Automatic database snapshot written to {}",
        target.display()
    );
    Ok(Some(target))
}

/// Take a snapshot if the newest one is older than six hours.
pub fn auto_snapshot_if_due() {
    let Some(dir) = DATA_DIR.get() else {
        return;
    };
    let backup_dir = dir.join("backups");
    let due = auto_snapshot_files(&backup_dir)
        .first()
        .and_then(|path| std::fs::metadata(path).ok())
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.elapsed().ok())
        .is_none_or(|elapsed| elapsed >= AUTO_INTERVAL);

    if due {
        let _ = auto_snapshot();
    }
}

fn prune_auto_snapshots(backup_dir: &Path) {
    let files = auto_snapshot_files(backup_dir);
    if files.len() <= AUTO_KEEP {
        return;
    }
    for old in &files[AUTO_KEEP..] {
        let _ = std::fs::remove_file(old);
    }
}

/// List the automatic snapshots, newest first.
pub fn list_auto_snapshots() -> Vec<(PathBuf, u64, Option<chrono::DateTime<chrono::Local>>)> {
    let Some(dir) = DATA_DIR.get() else {
        return Vec::new();
    };
    auto_snapshot_files(&dir.join("backups"))
        .into_iter()
        .map(|path| {
            let meta = std::fs::metadata(&path).ok();
            let bytes = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let created = meta
                .and_then(|m| m.modified().ok())
                .map(chrono::DateTime::<chrono::Local>::from);
            (path, bytes, created)
        })
        .collect()
}

/// Copy an existing database (plus WAL/SHM sidecars) from `legacy` to `target`.
/// Never overwrites an existing database in `target`.
fn migrate_from_legacy(legacy: &Path, target: &Path) {
    let source_db = legacy.join("dona.db");
    if !source_db.exists() {
        return;
    }

    // Refuse to copy obviously empty databases (0 bytes) — that is usually the
    // leftover of a failed write, not real user data.
    match std::fs::metadata(&source_db) {
        Ok(meta) if meta.len() > 0 => {}
        _ => return,
    }

    for name in DB_SIDECARS {
        let from: PathBuf = legacy.join(name);
        let to: PathBuf = target.join(name);
        if from.exists() && !to.exists() {
            match std::fs::copy(&from, &to) {
                Ok(bytes) => tracing::info!(
                    "Migrated {name} ({bytes} bytes) from {} to {}",
                    from.display(),
                    to.display()
                ),
                Err(err) => {
                    tracing::warn!("Could not migrate {name} from {}: {err}", from.display())
                }
            }
        }
    }
}

/// Flush pending WAL frames into the main database file.///
/// SQLite recovers the WAL on the next open, but checkpointing on exit makes a
/// hard shutdown (Windows fast startup, power loss) far less likely to leave
/// sidecar files behind that another process (antivirus, OneDrive) can mangle.
pub fn checkpoint() {
    let Some(mutex) = DB.get() else {
        return;
    };
    if let Some(conn) = mutex.try_lock_for(Duration::from_secs(3)) {
        match conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
            Ok(()) => tracing::info!("Database checkpoint complete"),
            Err(err) => tracing::warn!("Database checkpoint failed: {err}"),
        }
    } else {
        tracing::warn!("Skipping database checkpoint: database is busy");
    }
}

/// Get a reference to the global DB connection (use parking_lot — no poisoning).
pub fn get() -> &'static Mutex<Connection> {
    DB.get()
        .expect("Database not initialised — call db::init first")
}

/// Path of the live database inside the app data directory.
pub fn db_path(dir: &Path) -> PathBuf {
    dir.join(DB_SIDECARS[0])
}

/// Write a copy of an existing database (main file + sidecars) into
/// `<dir>/backups/<prefix>-<timestamp>/` and prune old copies.
pub fn snapshot_database(dir: &Path, _source: &Path, prefix: &str) -> std::io::Result<PathBuf> {
    let backup_dir = dir.join("backups");
    std::fs::create_dir_all(&backup_dir)?;

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let snapshot_dir = backup_dir.join(format!("{prefix}-{stamp}"));
    std::fs::create_dir_all(&snapshot_dir)?;

    for name in DB_SIDECARS {
        let from = dir.join(name);
        if from.exists() {
            std::fs::copy(&from, snapshot_dir.join(name))?;
        }
    }

    prune_snapshots(&backup_dir, prefix, 5);
    Ok(snapshot_dir.join(DB_SIDECARS[0]))
}

fn prune_snapshots(backup_dir: &Path, prefix: &str, keep: usize) {
    let Ok(entries) = std::fs::read_dir(backup_dir) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with(prefix))
        })
        .collect();
    dirs.sort();
    if dirs.len() <= keep {
        return;
    }
    for old in &dirs[..dirs.len() - keep] {
        let _ = std::fs::remove_dir_all(old);
    }
}

/// Stage a database restore: the file is validated by the caller and copied to
/// `dir`, then this marker makes the next startup swap it in before SQLite
/// opens the database.
pub fn note_pending_restore(dir: &Path, staging_file_name: &str) -> Result<()> {
    if staging_file_name.is_empty()
        || staging_file_name.contains("..")
        || staging_file_name.contains('/')
        || staging_file_name.contains('\\')
    {
        return Err(crate::error::CoreError::Other(
            "Invalid restore file name".into(),
        ));
    }
    std::fs::write(dir.join(RESTORE_MARKER), staging_file_name)?;
    Ok(())
}

fn apply_pending_restore(dir: &Path) -> Result<()> {
    let marker = dir.join(RESTORE_MARKER);
    if !marker.exists() {
        return Ok(());
    }

    let name = std::fs::read_to_string(&marker)
        .unwrap_or_default()
        .trim()
        .to_string();
    if name.is_empty() || name.contains("..") || name.contains('/') || name.contains('\\') {
        let _ = std::fs::remove_file(&marker);
        return Err(crate::error::CoreError::Other(
            "Invalid restore marker".into(),
        ));
    }

    let staging = dir.join(&name);
    if !staging.exists() {
        let _ = std::fs::remove_file(&marker);
        tracing::warn!("Restore marker found but {name} is missing — ignoring");
        return Ok(());
    }

    let live = db_path(dir);
    if live.exists() {
        if let Err(err) = snapshot_database(dir, &live, "pre-restore") {
            tracing::warn!("Could not snapshot current database before restore: {err}");
        }
    }

    for sidecar in DB_SIDECARS {
        let _ = std::fs::remove_file(dir.join(sidecar));
    }
    std::fs::rename(&staging, &live)?;
    let _ = std::fs::remove_file(&marker);

    tracing::info!("Restored database from staged backup {name}");
    Ok(())
}

/// Read a raw setting value from the `settings` table.
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    use rusqlite::{params, OptionalExtension};
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |r| r.get(0),
    )
    .optional()
    .map_err(Into::into)
}

/// Write a raw setting value to the `settings` table.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    use rusqlite::params;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Delete a setting from the `settings` table.
pub fn delete_setting(conn: &Connection, key: &str) -> Result<()> {
    use rusqlite::params;
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    Ok(())
}

/// Record an MCP tool call in `mcp_activity`.
pub fn log_mcp_activity(
    conn: &Connection,
    id: &str,
    tool: &str,
    account_id: Option<&str>,
    outcome: &str,
    detail: Option<&str>,
) -> Result<()> {
    use rusqlite::params;
    conn.execute(
        "INSERT INTO mcp_activity (id, tool, account_id, outcome, detail) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, tool, account_id, outcome, detail],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn migrations_run_cleanly_on_fresh_db() {
        let dir = TempDir::new().expect("create tempdir");
        let db_path = dir.path().join("test.db");
        let mut conn = Connection::open(&db_path).expect("open db");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("set pragmas");
        migrations().to_latest(&mut conn).expect("run migrations");

        // Verify key tables exist
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('accounts','contacts','notes','reminders','templates','settings','mcp_activity')",
                [],
                |row| row.get(0),
            )
            .expect("query tables");
        assert_eq!(count, 7);
    }

    #[test]
    fn quick_check_detects_valid_and_corrupt_databases() {
        let dir = TempDir::new().expect("tempdir");

        let valid = dir.path().join("valid.db");
        let conn = Connection::open(&valid).expect("open valid db");
        conn.execute_batch("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);")
            .expect("schema");
        drop(conn);
        assert_eq!(check_db_file(&valid), DbHealth::Ok);

        let corrupt = dir.path().join("corrupt.db");
        std::fs::write(&corrupt, b"this is definitely not a sqlite database").expect("write");
        assert_eq!(check_db_file(&corrupt), DbHealth::Corrupt);
    }

    #[test]
    fn recovers_from_the_newest_valid_auto_snapshot() {
        let dir = TempDir::new().expect("tempdir");
        let backups = dir.path().join("backups");
        std::fs::create_dir_all(&backups).expect("backups dir");

        let snapshot = backups.join("auto-20260101-000000.db");
        let conn = Connection::open(&snapshot).expect("snapshot db");
        conn.execute_batch(
            "CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
             INSERT INTO accounts (id, name) VALUES ('a', 'Alpha');",
        )
        .expect("snapshot schema");
        drop(conn);

        let live = dir.path().join("dona.db");
        std::fs::write(&live, b"garbage instead of a database").expect("write corrupt");

        recover_corrupt_database(dir.path(), &live);

        assert_eq!(check_db_file(&live), DbHealth::Ok);
        let conn = Connection::open(&live).expect("recovered db");
        let name: String = conn
            .query_row("SELECT name FROM accounts WHERE id = 'a'", [], |row| {
                row.get(0)
            })
            .expect("read recovered row");
        assert_eq!(name, "Alpha");
        assert!(recovery_notice().is_some());
        assert!(std::fs::read_dir(&backups)
            .expect("backups")
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with("corrupt-")));
    }

    #[test]
    fn auto_snapshots_sort_newest_first_and_prune() {
        let dir = TempDir::new().expect("tempdir");
        let backups = dir.path().join("backups");
        std::fs::create_dir_all(&backups).expect("backups dir");
        for index in 0..16 {
            std::fs::write(backups.join(format!("auto-20260101-{:06}.db", index)), b"x")
                .expect("snapshot file");
        }

        let files = auto_snapshot_files(&backups);
        assert_eq!(files.len(), 16);
        assert!(files[0].to_string_lossy().contains("000015"));

        prune_auto_snapshots(&backups);
        let remaining = auto_snapshot_files(&backups);
        assert_eq!(remaining.len(), AUTO_KEEP);
        assert!(!remaining
            .iter()
            .any(|path| path.to_string_lossy().contains("000000")));
    }
}
