// dona-core/src/accounts.rs
// CRUD operations for WhatsApp accounts in SQLite.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;
use crate::models::{Account, AccountGroup};

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
            avatar_path = excluded.avatar_path,
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

/// List account groups ordered by `sort_order`, then name.
pub fn list_groups(conn: &Connection) -> Result<Vec<AccountGroup>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, sort_order
         FROM account_groups
         ORDER BY sort_order ASC, name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AccountGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            sort_order: row.get(3)?,
        })
    })?;

    let mut groups = Vec::new();
    for row in rows {
        groups.push(row?);
    }
    Ok(groups)
}

/// Insert or update an account group.
pub fn upsert_group(conn: &Connection, group: &AccountGroup) -> Result<AccountGroup> {
    conn.execute(
        "INSERT INTO account_groups (id, name, color, sort_order)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            color = excluded.color,
            sort_order = excluded.sort_order",
        params![group.id, group.name, group.color, group.sort_order],
    )?;

    Ok(AccountGroup {
        id: group.id.clone(),
        name: group.name.clone(),
        color: group.color.clone(),
        sort_order: group.sort_order,
    })
}

/// Delete an account group. Accounts in the group are kept and become ungrouped
/// (`ON DELETE SET NULL`).
pub fn delete_group(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM account_groups WHERE id = ?1", params![id])?;
    Ok(())
}

/// Persist a new account order. `ids` is the full, ordered list of account ids;
/// the position in the slice becomes the account's `sort_order`.
pub fn reorder_accounts(conn: &Connection, ids: &[String]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (index, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE accounts SET sort_order = ?1 WHERE id = ?2",
            params![index as i32, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

fn row_to_account(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    let dnd_str: Option<String> = row.get(14)?;
    let dnd_schedule = dnd_str.and_then(|s| serde_json::from_str(&s).ok());
    let created_str: Option<String> = row.get(15)?;
    let created_at = created_str.as_deref().and_then(parse_db_datetime);

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

/// Parse the timestamps SQLite produces.
///
/// `datetime('now')` (the column default) yields `2025-01-31 09:15:00`, which is
/// **not** RFC 3339, so a strict RFC 3339 parser silently turned every
/// `created_at` into `None`. Accept both formats.
fn parse_db_datetime(value: &str) -> Option<DateTime<Utc>> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
        return Some(dt.with_timezone(&Utc));
    }
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(value, fmt) {
            return Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
        }
    }
    None
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
        let migrations = Migrations::new(vec![
            M::up(include_str!("migrations/001_initial.sql")),
            M::up(include_str!("migrations/002_account_group_color.sql")),
            M::up(include_str!("migrations/003_crm_lite.sql")),
        ]);
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

    #[test]
    fn parses_sqlite_and_rfc3339_timestamps() {
        // SQLite `datetime('now')` format (the column default)
        let sqlite = parse_db_datetime("2025-01-31 09:15:00").expect("sqlite format");
        assert_eq!(sqlite.to_rfc3339(), "2025-01-31T09:15:00+00:00");

        // RFC 3339 format
        let rfc = parse_db_datetime("2025-01-31T09:15:00Z").expect("rfc3339 format");
        assert_eq!(rfc, sqlite);

        assert!(parse_db_datetime("").is_none());
        assert!(parse_db_datetime("not a date").is_none());
    }

    #[test]
    fn avatar_can_be_cleared() {
        let conn = setup_mem_db();
        let mut acc = Account {
            id: "acc_avatar".into(),
            name: "Avatar".into(),
            avatar_path: Some("data:image/jpeg;base64,AAAA".into()),
            zoom: 1.0,
            ..Default::default()
        };
        upsert_account(&conn, &acc).expect("insert with avatar");

        acc.avatar_path = None;
        let saved = upsert_account(&conn, &acc).expect("clear avatar");
        assert!(saved.avatar_path.is_none());
    }

    #[test]
    fn groups_and_reordering() {
        let conn = setup_mem_db();

        let group = AccountGroup {
            id: "grp_shop".into(),
            name: "Shop".into(),
            color: "#3B82F6".into(),
            sort_order: 0,
        };
        upsert_group(&conn, &group).expect("insert group");
        assert_eq!(list_groups(&conn).expect("list groups").len(), 1);

        for (id, order) in [("a", 0), ("b", 1), ("c", 2)] {
            let account = Account {
                id: id.into(),
                name: id.to_uppercase(),
                profile_name: id.into(),
                group_id: Some("grp_shop".into()),
                sort_order: order,
                zoom: 1.0,
                ..Default::default()
            };
            upsert_account(&conn, &account).expect("insert account");
        }

        reorder_accounts(&conn, &["c".into(), "a".into(), "b".into()]).expect("reorder");
        let ordered: Vec<String> = list_accounts(&conn)
            .expect("list")
            .into_iter()
            .map(|a| a.id)
            .collect();
        assert_eq!(ordered, vec!["c", "a", "b"]);
        assert_eq!(
            list_accounts(&conn).expect("list")[0].group_id.as_deref(),
            Some("grp_shop")
        );

        delete_group(&conn, "grp_shop").expect("delete group");
        assert!(list_groups(&conn).expect("groups").is_empty());
        // Accounts survive and become ungrouped.
        let accounts = list_accounts(&conn).expect("accounts");
        assert_eq!(accounts.len(), 3);
        assert!(accounts.iter().all(|a| a.group_id.is_none()));
    }
}
