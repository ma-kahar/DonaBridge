// dona-core/src/accounts.rs
// CRUD operations for WhatsApp accounts in SQLite.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;
use crate::models::Account;

/// List all accounts ordered by `sort_order`, then `created_at`.
pub fn list_accounts(conn: &Connection) -> Result<Vec<Account>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, category, color, icon_text, avatar_path, profile_name,
                group_id, sort_order, muted, hibernate_minutes, zoom,
                mcp_draft, mcp_read, dnd_schedule, created_at
         FROM accounts
         ORDER BY sort_order ASC, created_at ASC",
    )?;

    let rows = stmt.query_map([], row_to_account)?;
    let mut accounts = Vec::new();
    for row in rows {
        accounts.push(row?);
    }
    Ok(accounts)
}

/// Get a single account by id.
pub fn get_account(conn: &Connection, id: &str) -> Result<Option<Account>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, category, color, icon_text, avatar_path, profile_name,
                group_id, sort_order, muted, hibernate_minutes, zoom,
                mcp_draft, mcp_read, dnd_schedule, created_at
         FROM accounts
         WHERE id = ?1",
    )?;

    Ok(stmt.query_row(params![id], row_to_account).optional()?)
}

/// Insert or update an account. Returns the saved account.
pub fn upsert_account(conn: &Connection, account: &Account) -> Result<Account> {
    let dnd_json = account
        .dnd_schedule
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());

    let profile_name = if account.profile_name.is_empty() {
        account.id.clone()
    } else {
        account.profile_name.clone()
    };

    conn.execute(
        "INSERT INTO accounts (
            id, name, category, color, icon_text, avatar_path, profile_name,
            group_id, sort_order, muted, hibernate_minutes, zoom,
            mcp_draft, mcp_read, dnd_schedule
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            color = excluded.color,
            icon_text = excluded.icon_text,
            avatar_path = COALESCE(excluded.avatar_path, accounts.avatar_path),
            group_id = excluded.group_id,
            sort_order = excluded.sort_order,
            muted = excluded.muted,
            hibernate_minutes = excluded.hibernate_minutes,
            zoom = excluded.zoom,
            mcp_draft = excluded.mcp_draft,
            mcp_read = excluded.mcp_read,
            dnd_schedule = excluded.dnd_schedule",
        params![
            account.id,
            account.name,
            account.category,
            account.color,
            account.icon_text,
            account.avatar_path,
            profile_name,
            account.group_id,
            account.sort_order,
            account.muted as i32,
            account.hibernate_minutes,
            account.zoom,
            account.mcp_draft as i32,
            account.mcp_read as i32,
            dnd_json,
        ],
    )?;

    get_account(conn, &account.id)?
        .ok_or_else(|| crate::error::CoreError::Other("Account missing after upsert".into()))
}

/// Delete an account by id. Returns the `profile_name` if the account existed,
/// so the caller can queue its WebView2 folder for deletion on next startup.
pub fn delete_account(conn: &Connection, id: &str) -> Result<Option<String>> {
    let existing = get_account(conn, id)?;
    conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
    Ok(existing.map(|a| a.profile_name))
}

/// Queue a WebView2 profile folder name for deletion on next app start (Blueprint §3 #15).
pub fn queue_profile_deletion(conn: &Connection, profile_name: &str) -> Result<()> {
    let current: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'pending_profile_deletes'",
            [],
            |r| r.get(0),
        )
        .optional()?;

    let mut list: Vec<String> = current
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    if !list.iter().any(|p| p == profile_name) {
        list.push(profile_name.to_string());
    }

    let json = serde_json::to_string(&list).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('pending_profile_deletes', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![json],
    )?;
    Ok(())
}

/// Drain and return all queued profile names to delete on startup.
pub fn take_pending_profile_deletions(conn: &Connection) -> Result<Vec<String>> {
    let current: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'pending_profile_deletes'",
            [],
            |r| r.get(0),
        )
        .optional()?;

    let list: Vec<String> = current
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    if !list.is_empty() {
        conn.execute(
            "DELETE FROM settings WHERE key = 'pending_profile_deletes'",
            [],
        )?;
    }

    Ok(list)
}

fn row_to_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    let dnd_str: Option<String> = row.get(14)?;
    let dnd_schedule = dnd_str.and_then(|s| serde_json::from_str(&s).ok());
    let created_str: Option<String> = row.get(15)?;
    let created_at = created_str.and_then(|s| {
        DateTime::parse_from_rfc3339(&s)
            .map(|dt| dt.with_timezone(&Utc))
            .ok()
    });

    Ok(Account {
        id: row.get(0)?,
        name: row.get(1)?,
        category: row.get(2)?,
        color: row.get(3)?,
        icon_text: row.get(4)?,
        avatar_path: row.get(5)?,
        profile_name: row.get(6)?,
        group_id: row.get(7)?,
        sort_order: row.get(8)?,
        muted: row.get::<_, i32>(9)? != 0,
        hibernate_minutes: row.get(10)?,
        zoom: row.get(11)?,
        mcp_draft: row.get::<_, i32>(12)? != 0,
        mcp_read: row.get::<_, i32>(13)? != 0,
        dnd_schedule,
        created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use rusqlite_migration::{Migrations, M};

    fn setup_mem_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("pragmas");
        let migrations = Migrations::new(vec![M::up(include_str!("migrations/001_initial.sql"))]);
        migrations.to_latest(&mut conn).expect("migrate");
        conn
    }

    #[test]
    fn account_crud_roundtrip() {
        let conn = setup_mem_db();

        let acc1 = Account {
            id: "acc_1".into(),
            name: "Donatek Shop".into(),
            category: "business".into(),
            color: "#3B82F6".into(),
            icon_text: "DS".into(),
            sort_order: 2,
            zoom: 1.0,
            ..Default::default()
        };
        let acc2 = Account {
            id: "acc_2".into(),
            name: "Personal".into(),
            category: "personal".into(),
            color: "#10B981".into(),
            icon_text: "P".into(),
            sort_order: 1,
            zoom: 1.0,
            ..Default::default()
        };

        upsert_account(&conn, &acc1).expect("insert acc1");
        upsert_account(&conn, &acc2).expect("insert acc2");

        let list = list_accounts(&conn).expect("list");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "acc_2"); // sort_order 1 first
        assert_eq!(list[1].id, "acc_1");

        // Update acc1
        let mut updated = acc1.clone();
        updated.name = "Donatek Support".into();
        updated.muted = true;
        let saved = upsert_account(&conn, &updated).expect("update acc1");
        assert_eq!(saved.name, "Donatek Support");
        assert!(saved.muted);

        // Delete acc2
        let deleted_profile = delete_account(&conn, "acc_2").expect("delete");
        assert_eq!(deleted_profile, Some("acc_2".into()));
        assert_eq!(list_accounts(&conn).expect("list after delete").len(), 1);
    }

    #[test]
    fn pending_profile_deletion_queue() {
        let conn = setup_mem_db();
        queue_profile_deletion(&conn, "acc_old").expect("queue 1");
        queue_profile_deletion(&conn, "acc_old").expect("queue duplicate");
        queue_profile_deletion(&conn, "acc_other").expect("queue 2");

        let pending = take_pending_profile_deletions(&conn).expect("take");
        assert_eq!(pending, vec!["acc_old", "acc_other"]);

        let empty = take_pending_profile_deletions(&conn).expect("take again");
        assert!(empty.is_empty());
    }
}
