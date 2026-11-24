// dona-core/src/crm.rs
// Local CRM domain logic: contacts, tags, notes, reminders, quick-reply templates, CSV export.
// Blueprint §2: imported contacts can NEVER become a send list; templates are draft-only.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;
use crate::models::{Contact, Note, Reminder, Tag, Template};

/// Normalize a phone number toward E.164 format (strips spaces, dashes, parentheses).
/// Handles common French (`06...` -> `+336...`) and Bangladeshi (`01...` -> `+8801...`) local formats
/// when `default_country_code` is provided (e.g. `"+33"` or `"+880"`).
pub fn normalize_phone_e164(raw: &str, default_country_code: Option<&str>) -> String {
    let trimmed = raw.trim();
    let has_plus = trimmed.starts_with('+');
    let digits: String = trimmed.chars().filter(|c| c.is_ascii_digit()).collect();

    if digits.is_empty() {
        return String::new();
    }
    if has_plus {
        return format!("+{digits}");
    }
    if let Some(stripped) = digits.strip_prefix("00") {
        return format!("+{stripped}");
    }
    if let (Some(cc), Some(local)) = (default_country_code, digits.strip_prefix('0')) {
        let cc_clean = cc.trim_start_matches('+');
        return format!("+{cc_clean}{local}");
    }
    format!("+{digits}")
}

// ── Contacts ─────────────────────────────────────────────────────────────────

pub fn list_contacts(conn: &Connection, account_id: &str) -> Result<Vec<Contact>> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, phone_e164, display_name, stage, created_at, updated_at
         FROM contacts
         WHERE account_id = ?1
         ORDER BY updated_at DESC, created_at DESC",
    )?;
    let rows = stmt.query_map(params![account_id], |row| {
        Ok(Contact {
            id: row.get(0)?,
            account_id: row.get(1)?,
            phone_e164: row.get(2)?,
            display_name: row.get(3)?,
            stage: row.get(4)?,
            created_at: parse_dt(row.get(5)?),
            updated_at: parse_dt(row.get(6)?),
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn upsert_contact(conn: &Connection, contact: &Contact) -> Result<Contact> {
    let stage = if contact.stage.is_empty() {
        "new".to_string()
    } else {
        contact.stage.clone()
    };

    conn.execute(
        "INSERT INTO contacts (id, account_id, phone_e164, display_name, stage)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(account_id, phone_e164) DO UPDATE SET
            display_name = COALESCE(excluded.display_name, contacts.display_name),
            stage = excluded.stage,
            updated_at = datetime('now')",
        params![
            contact.id,
            contact.account_id,
            contact.phone_e164,
            contact.display_name,
            stage,
        ],
    )?;

    let mut stmt = conn.prepare(
        "SELECT id, account_id, phone_e164, display_name, stage, created_at, updated_at
         FROM contacts
         WHERE account_id = ?1 AND phone_e164 = ?2",
    )?;
    stmt.query_row(params![contact.account_id, contact.phone_e164], |row| {
        Ok(Contact {
            id: row.get(0)?,
            account_id: row.get(1)?,
            phone_e164: row.get(2)?,
            display_name: row.get(3)?,
            stage: row.get(4)?,
            created_at: parse_dt(row.get(5)?),
            updated_at: parse_dt(row.get(6)?),
        })
    })
    .map_err(Into::into)
}

pub fn delete_contact(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM contacts WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Tags ─────────────────────────────────────────────────────────────────────

pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare("SELECT id, name, color FROM tags ORDER BY name ASC")?;
    let rows = stmt.query_map([], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn upsert_tag(conn: &Connection, tag: &Tag) -> Result<()> {
    conn.execute(
        "INSERT INTO tags (id, name, color) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET color = excluded.color",
        params![tag.id, tag.name, tag.color],
    )?;
    Ok(())
}

pub fn list_contact_tags(conn: &Connection, contact_id: &str) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color
         FROM tags t
         INNER JOIN contact_tags ct ON ct.tag_id = t.id
         WHERE ct.contact_id = ?1
         ORDER BY t.name ASC",
    )?;
    let rows = stmt.query_map(params![contact_id], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn assign_tag(conn: &Connection, contact_id: &str, tag_id: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO contact_tags (contact_id, tag_id) VALUES (?1, ?2)",
        params![contact_id, tag_id],
    )?;
    Ok(())
}

pub fn remove_tag(conn: &Connection, contact_id: &str, tag_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM contact_tags WHERE contact_id = ?1 AND tag_id = ?2",
        params![contact_id, tag_id],
    )?;
    Ok(())
}

// ── Notes ────────────────────────────────────────────────────────────────────

pub fn list_notes(conn: &Connection, contact_id: &str) -> Result<Vec<Note>> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, contact_id, body, created_at, updated_at
         FROM notes
         WHERE contact_id = ?1
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map(params![contact_id], |row| {
        Ok(Note {
            id: row.get(0)?,
            account_id: row.get(1)?,
            contact_id: row.get(2)?,
            body: row.get(3)?,
            created_at: parse_dt(row.get(4)?),
            updated_at: parse_dt(row.get(5)?),
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn add_note(conn: &Connection, note: &Note) -> Result<()> {
    conn.execute(
        "INSERT INTO notes (id, account_id, contact_id, body) VALUES (?1, ?2, ?3, ?4)",
        params![note.id, note.account_id, note.contact_id, note.body],
    )?;
    Ok(())
}

pub fn delete_note(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Reminders ────────────────────────────────────────────────────────────────

pub fn list_reminders(conn: &Connection, account_id: &str) -> Result<Vec<Reminder>> {
    let mut stmt = conn.prepare(
        "SELECT r.id, r.contact_id, r.due_at, r.note, r.status, r.snoozed_until
         FROM reminders r
         INNER JOIN contacts c ON c.id = r.contact_id
         WHERE c.account_id = ?1
         ORDER BY r.due_at ASC",
    )?;
    let rows = stmt.query_map(params![account_id], |row| {
        Ok(Reminder {
            id: row.get(0)?,
            contact_id: row.get(1)?,
            due_at: parse_dt(row.get(2)?),
            note: row.get(3)?,
            status: row.get(4)?,
            snoozed_until: parse_dt(row.get(5)?),
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn upsert_reminder(conn: &Connection, reminder: &Reminder) -> Result<()> {
    let due_str = reminder.due_at.map(|d| d.to_rfc3339());
    let snooze_str = reminder.snoozed_until.map(|d| d.to_rfc3339());
    let status = if reminder.status.is_empty() {
        "pending".to_string()
    } else {
        reminder.status.clone()
    };

    conn.execute(
        "INSERT INTO reminders (id, contact_id, due_at, note, status, snoozed_until)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            due_at = excluded.due_at,
            note = excluded.note,
            status = excluded.status,
            snoozed_until = excluded.snoozed_until",
        params![
            reminder.id,
            reminder.contact_id,
            due_str,
            reminder.note,
            status,
            snooze_str,
        ],
    )?;
    Ok(())
}

// ── Quick-Reply Templates ────────────────────────────────────────────────────

pub fn list_templates(conn: &Connection, account_id: Option<&str>) -> Result<Vec<Template>> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, name, body, language, shortcut
         FROM templates
         WHERE account_id IS NULL OR account_id = ?1
         ORDER BY name ASC",
    )?;
    let rows = stmt.query_map(params![account_id], |row| {
        Ok(Template {
            id: row.get(0)?,
            account_id: row.get(1)?,
            name: row.get(2)?,
            body: row.get(3)?,
            language: row.get(4)?,
            shortcut: row.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn upsert_template(conn: &Connection, tpl: &Template) -> Result<()> {
    let lang = if tpl.language.is_empty() {
        "en".to_string()
    } else {
        tpl.language.clone()
    };
    conn.execute(
        "INSERT INTO templates (id, account_id, name, body, language, shortcut)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            account_id = excluded.account_id,
            name = excluded.name,
            body = excluded.body,
            language = excluded.language,
            shortcut = excluded.shortcut",
        params![
            tpl.id,
            tpl.account_id,
            tpl.name,
            tpl.body,
            lang,
            tpl.shortcut,
        ],
    )?;
    Ok(())
}

pub fn delete_template(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM templates WHERE id = ?1", params![id])?;
    Ok(())
}

/// Substitute `{name}`, `{phone}`, `{date}` variables in a quick-reply template.
pub fn render_template(body: &str, name: &str, phone: &str, date: &str) -> String {
    body.replace("{name}", name)
        .replace("{phone}", phone)
        .replace("{date}", date)
}

/// Export contacts to UTF-8 CSV with BOM for Excel compatibility (Blueprint §4).
pub fn export_contacts_csv(contacts: &[Contact]) -> String {
    let mut out = String::from("\u{FEFF}id,account_id,phone_e164,display_name,stage\n");
    for c in contacts {
        let name = c.display_name.as_deref().unwrap_or("");
        out.push_str(&format!(
            "{},{},{},{},{}\n",
            csv_escape(&c.id),
            csv_escape(&c.account_id),
            csv_escape(&c.phone_e164),
            csv_escape(name),
            csv_escape(&c.stage),
        ));
    }
    out
}

/// Import contacts from CSV text into the CRM (never used as a send list).
/// Accepts headers or plain `phone,name,stage` rows.
pub fn import_contacts_csv(
    conn: &Connection,
    account_id: &str,
    csv_text: &str,
    id_gen: impl Fn() -> String,
) -> Result<usize> {
    let cleaned = csv_text.trim_start_matches('\u{FEFF}');
    let mut imported = 0usize;
    for (idx, line) in cleaned.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let cols: Vec<&str> = trimmed
            .split(',')
            .map(|s| s.trim().trim_matches('"'))
            .collect();
        if idx == 0
            && cols
                .iter()
                .any(|c| c.eq_ignore_ascii_case("phone_e164") || c.eq_ignore_ascii_case("phone"))
        {
            continue;
        }
        // Support either `id,account_id,phone,name,stage` (export format) or `phone,name,stage`
        let (raw_phone, raw_name, raw_stage) = if cols.len() >= 5 && cols[2].starts_with('+') {
            (cols[2], Some(cols[3]), cols[4])
        } else if !cols.is_empty() {
            (
                cols[0],
                cols.get(1).copied().filter(|s| !s.is_empty()),
                cols.get(2).copied().unwrap_or("new"),
            )
        } else {
            continue;
        };
        let phone = normalize_phone_e164(raw_phone, None);
        if phone.is_empty() {
            continue;
        }
        upsert_contact(
            conn,
            &Contact {
                id: id_gen(),
                account_id: account_id.to_string(),
                phone_e164: phone,
                display_name: raw_name.map(ToString::to_string),
                stage: if raw_stage.is_empty() {
                    "new".to_string()
                } else {
                    raw_stage.to_string()
                },
                ..Default::default()
            },
        )?;
        imported += 1;
    }
    Ok(imported)
}

/// Return pending reminders whose `due_at` is <= `now` (and not snoozed past `now`).
pub fn due_reminders(conn: &Connection, now: DateTime<Utc>) -> Result<Vec<Reminder>> {
    let mut stmt = conn.prepare(
        "SELECT id, contact_id, due_at, note, status, snoozed_until
         FROM reminders
         WHERE status = 'pending' AND due_at IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Reminder {
            id: row.get(0)?,
            contact_id: row.get(1)?,
            due_at: parse_dt(row.get(2)?),
            note: row.get(3)?,
            status: row.get(4)?,
            snoozed_until: parse_dt(row.get(5)?),
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        let rem = r?;
        let is_due =
            rem.due_at.is_some_and(|d| d <= now) && rem.snoozed_until.is_none_or(|s| s <= now);
        if is_due {
            out.push(rem);
        }
    }
    Ok(out)
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn parse_dt(s: Option<String>) -> Option<DateTime<Utc>> {
    s.and_then(|v| {
        DateTime::parse_from_rfc3339(&v)
            .map(|dt| dt.with_timezone(&Utc))
            .ok()
    })
}

/// Look up a single contact by id.
pub fn get_contact(conn: &Connection, id: &str) -> Result<Option<Contact>> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, phone_e164, display_name, stage, created_at, updated_at
         FROM contacts WHERE id = ?1",
    )?;
    stmt.query_row(params![id], |row| {
        Ok(Contact {
            id: row.get(0)?,
            account_id: row.get(1)?,
            phone_e164: row.get(2)?,
            display_name: row.get(3)?,
            stage: row.get(4)?,
            created_at: parse_dt(row.get(5)?),
            updated_at: parse_dt(row.get(6)?),
        })
    })
    .optional()
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::upsert_account;
    use crate::models::Account;
    use rusqlite_migration::{Migrations, M};

    fn setup_db() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open mem db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("pragmas");
        Migrations::new(vec![M::up(include_str!("migrations/001_initial.sql"))])
            .to_latest(&mut conn)
            .expect("migrate");

        upsert_account(
            &conn,
            &Account {
                id: "acc_1".into(),
                name: "Donatek".into(),
                category: "business".into(),
                color: "#3B82F6".into(),
                icon_text: "D".into(),
                zoom: 1.0,
                ..Default::default()
            },
        )
        .expect("insert account");
        conn
    }

    #[test]
    fn phone_normalization_fr_and_bd() {
        assert_eq!(
            normalize_phone_e164("06 12 34 56 78", Some("+33")),
            "+33612345678"
        );
        assert_eq!(
            normalize_phone_e164("01712-345678", Some("+880")),
            "+8801712345678"
        );
        assert_eq!(
            normalize_phone_e164("+33 6 12 34 56 78", None),
            "+33612345678"
        );
        assert_eq!(
            normalize_phone_e164("008801712345678", None),
            "+8801712345678"
        );
    }

    #[test]
    fn contacts_notes_reminders_and_csv() {
        let conn = setup_db();

        let c = upsert_contact(
            &conn,
            &Contact {
                id: "c_1".into(),
                account_id: "acc_1".into(),
                phone_e164: "+33612345678".into(),
                display_name: Some("Jean Dupont".into()),
                stage: "negotiating".into(),
                ..Default::default()
            },
        )
        .expect("upsert contact");
        assert_eq!(c.stage, "negotiating");

        add_note(
            &conn,
            &Note {
                id: "n_1".into(),
                account_id: "acc_1".into(),
                contact_id: Some("c_1".into()),
                body: "Interested in 50 units".into(),
                ..Default::default()
            },
        )
        .expect("add note");
        assert_eq!(list_notes(&conn, "c_1").expect("notes").len(), 1);

        upsert_reminder(
            &conn,
            &Reminder {
                id: "r_1".into(),
                contact_id: "c_1".into(),
                due_at: Some(Utc::now()),
                note: Some("Call back".into()),
                status: "pending".into(),
                ..Default::default()
            },
        )
        .expect("add reminder");
        assert_eq!(list_reminders(&conn, "acc_1").expect("reminders").len(), 1);

        let csv = export_contacts_csv(&list_contacts(&conn, "acc_1").expect("contacts"));
        assert!(csv.starts_with('\u{FEFF}'));
        assert!(csv.contains("Jean Dupont"));
    }

    #[test]
    fn template_variable_substitution() {
        let rendered = render_template(
            "Hello {name} ({phone}), meeting on {date}.",
            "Amina",
            "+8801712345678",
            "2026-11-25",
        );
        assert_eq!(
            rendered,
            "Hello Amina (+8801712345678), meeting on 2026-11-25."
        );
    }
}
