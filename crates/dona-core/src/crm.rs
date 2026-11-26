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

/// Stages the UI understands; unknown values are imported as `new`.
const CONTACT_STAGES: [&str; 5] = ["new", "follow_up", "negotiating", "won", "do_not_contact"];

/// Parse one CSV record, honouring quoted fields, escaped quotes and commas
/// inside quotes (the exporter writes names like `"Doe, John"`).
fn parse_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' => {
                if in_quotes && chars.peek() == Some(&'"') {
                    current.push('"');
                    chars.next();
                } else {
                    in_quotes = !in_quotes;
                }
            }
            ',' if !in_quotes => {
                fields.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    fields.push(current.trim().to_string());
    fields
}

struct CsvHeader {
    phone: usize,
    name: Option<usize>,
    stage: Option<usize>,
}

fn detect_header(cols: &[String]) -> Option<CsvHeader> {
    let find = |names: &[&str]| {
        cols.iter().position(|column| {
            let value = column.trim().to_lowercase();
            names.contains(&value.as_str())
        })
    };
    let phone = find(&["phone_e164", "phone", "number", "mobile"])?;
    Some(CsvHeader {
        phone,
        name: find(&["display_name", "name", "full_name", "contact"]),
        stage: find(&["stage"]),
    })
}

fn stage_or_new(raw: &str) -> String {
    let normalized = raw.trim().to_lowercase().replace([' ', '-'], "_");
    if CONTACT_STAGES.contains(&normalized.as_str()) {
        normalized
    } else {
        "new".to_string()
    }
}

/// Import contacts from CSV text into the CRM (never used as a send list).
///
/// Accepts the export format (`id,account_id,phone_e164,display_name,stage`),
/// a simple `phone,name,stage` file, or any file with a header row containing
/// phone/name/stage columns. Quoted fields, CRLF and a UTF-8 BOM are handled.
pub fn import_contacts_csv(
    conn: &Connection,
    account_id: &str,
    csv_text: &str,
    id_gen: impl Fn() -> String,
) -> Result<usize> {
    let cleaned = csv_text.trim_start_matches('\u{FEFF}');
    let mut lines = cleaned.lines().filter(|line| !line.trim().is_empty());
    let Some(first) = lines.next() else {
        return Ok(0);
    };

    let first_cols = parse_csv_line(first);
    let header = detect_header(&first_cols);
    let mut imported = 0usize;

    let mut process = |cols: &[String]| -> Result<()> {
        let (phone_idx, name_idx, stage_idx) = match &header {
            Some(header) => (header.phone, header.name, header.stage),
            None if cols.len() >= 5 => (2, Some(3), Some(4)),
            None => (
                0,
                (cols.len() > 1).then_some(1),
                (cols.len() > 2).then_some(2),
            ),
        };
        let read = |index: Option<usize>| {
            index
                .and_then(|index| cols.get(index))
                .map(|value| value.trim())
                .unwrap_or("")
        };
        let raw_phone = cols.get(phone_idx).map(String::as_str).unwrap_or("");
        let phone = normalize_phone_e164(raw_phone, None);
        let digits = phone.trim_start_matches('+');
        if digits.len() < 5 || !digits.chars().all(|ch| ch.is_ascii_digit()) {
            return Ok(());
        }
        let name = read(name_idx);
        let stage = read(stage_idx);
        upsert_contact(
            conn,
            &Contact {
                id: id_gen(),
                account_id: account_id.to_string(),
                phone_e164: phone,
                display_name: (!name.is_empty()).then(|| name.to_string()),
                stage: stage_or_new(stage),
                ..Default::default()
            },
        )?;
        imported += 1;
        Ok(())
    };

    if header.is_some() {
        for line in lines {
            process(&parse_csv_line(line))?;
        }
    } else {
        process(&first_cols)?;
        for line in lines {
            process(&parse_csv_line(line))?;
        }
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
        Migrations::new(vec![
            M::up(include_str!("migrations/001_initial.sql")),
            M::up(include_str!("migrations/002_account_group_color.sql")),
            M::up(include_str!("migrations/003_crm_lite.sql")),
        ])
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
    fn csv_import_handles_quotes_headers_and_unknown_stages() {
        let conn = setup_db();
        let csv = "phone,name,stage\n+8801700000001,\"Doe, John\",won\n+8801700000002,Amina,not-a-stage\nnot-a-phone,No Phone,new\n";
        let imported =
            import_contacts_csv(&conn, "acc_1", csv, || uuid::Uuid::new_v4().to_string())
                .expect("import");
        assert_eq!(imported, 2);

        let contacts = list_contacts(&conn, "acc_1").expect("contacts");
        let john = contacts
            .iter()
            .find(|contact| contact.phone_e164 == "+8801700000001")
            .expect("john");
        assert_eq!(john.display_name.as_deref(), Some("Doe, John"));
        assert_eq!(john.stage, "won");
        let amina = contacts
            .iter()
            .find(|contact| contact.phone_e164 == "+8801700000002")
            .expect("amina");
        assert_eq!(amina.stage, "new");
    }

    #[test]
    fn csv_import_roundtrips_export_format_without_plus() {
        let conn = setup_db();
        let csv = "\u{FEFF}id,account_id,phone_e164,display_name,stage\nid-1,acc_1,8801700000003,Test User,follow_up\n";
        let imported =
            import_contacts_csv(&conn, "acc_1", csv, || "new-id".into()).expect("import");
        assert_eq!(imported, 1);
        let contacts = list_contacts(&conn, "acc_1").expect("contacts");
        assert!(contacts
            .iter()
            .any(|contact| contact.phone_e164 == "+8801700000003" && contact.stage == "follow_up"));
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
