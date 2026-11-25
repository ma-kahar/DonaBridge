// dona-core/src/db.rs
// SQLite in WAL mode with numbered migrations (Blueprint §3 #6, #7).
// Blueprint §3 #6: structs have #[serde(default)]; never overwrite a file that failed to parse.
// Blueprint §3 #7: SQLite in WAL mode; images as files, path in DB, never base64 inline.

use parking_lot::Mutex;
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};
use std::{path::Path, sync::OnceLock};

use crate::error::Result;

static DB: OnceLock<Mutex<Connection>> = OnceLock::new();

/// All migrations in order. Never modify an existing migration — add a new one.
fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        // M001: initial schema
        M::up(include_str!("migrations/001_initial.sql")),
    ])
}

/// Initialise the database. Called once at app startup.
pub fn init(app_data_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("dona.db");
    let mut conn = Connection::open(&db_path)?;

    // WAL mode for better performance and crash safety (Blueprint §3 #7)
    // busy_timeout: SQLite will retry internally for up to 5 s before returning SQLITE_BUSY.
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    )?;

    // Run all pending migrations (Blueprint §3 #6)
    migrations().to_latest(&mut conn)?;

    DB.set(Mutex::new(conn))
        .map_err(|_| crate::error::CoreError::Other("DB already initialised".into()))?;

    tracing::info!("Database ready at {}", db_path.display());
    Ok(())
}

/// Get a reference to the global DB connection (use parking_lot — no poisoning).
pub fn get() -> &'static Mutex<Connection> {
    DB.get()
        .expect("Database not initialised — call db::init first")
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
}
