// crm_portable.rs — portable CRM export/import.
//
// A bundle is a plain JSON document so a user can keep their CRM data outside
// Dona Bridge or move it to another PC. Tables are dumped generically (column
// names come from SQLite), which keeps the format working when the schema gains
// columns: unknown columns are skipped on import and missing ones use defaults.
//
// Import replaces the CRM tables only (accounts and WhatsApp sessions are never
// touched) and runs in one transaction. The Tauri command takes an automatic
// snapshot first, so a bad import can always be rolled back.

use std::collections::{BTreeMap, BTreeSet};

use chrono::Utc;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};

use crate::error::{CoreError, Result};

pub const FORMAT: &str = "dona-bridge-crm";
pub const FORMAT_VERSION: u32 = 1;

/// Tables written to the bundle, in foreign-key order (parents first).
pub const EXPORT_TABLES: &[&str] = &[
    "pipelines",
    "pipeline_stages",
    "contacts",
    "tags",
    "contact_tags",
    "notes",
    "reminders",
    "templates",
    "deals",
    "custom_fields",
    "contact_field_values",
    "crm_tasks",
    "crm_activities",
];

/// Delete order (children first) so foreign keys stay satisfied.
const DELETE_ORDER: &[&str] = &[
    "crm_activities",
    "contact_field_values",
    "crm_tasks",
    "deals",
    "notes",
    "reminders",
    "contact_tags",
    "contacts",
    "custom_fields",
    "templates",
    "pipeline_stages",
    "pipelines",
    "tags",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleAccount {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrmBundle {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub app_version: String,
    #[serde(default)]
    pub accounts: Vec<BundleAccount>,
    #[serde(default)]
    pub tables: BTreeMap<String, Vec<Map<String, Value>>>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ImportSummary {
    pub contacts: usize,
    pub deals: usize,
    pub tasks: usize,
    pub notes: usize,
    pub tags: usize,
    pub templates: usize,
    pub pipelines: usize,
    pub total_rows: usize,
}

fn table_rows(conn: &Connection, table: &str) -> Result<Vec<Map<String, Value>>> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table}"))?;
    let names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    let mut rows = stmt.query([])?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut map = Map::with_capacity(names.len());
        for (index, name) in names.iter().enumerate() {
            let value = match row.get_ref(index)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(number) => Value::from(number),
                ValueRef::Real(number) => Number::from_f64(number)
                    .map(Value::Number)
                    .unwrap_or(Value::Null),
                ValueRef::Text(text) => Value::String(String::from_utf8_lossy(text).to_string()),
                // These tables contain no binary columns; keep the JSON portable.
                ValueRef::Blob(_) => Value::Null,
            };
            map.insert(name.clone(), value);
        }
        out.push(map);
    }
    Ok(out)
}

/// Dump every CRM table plus the account id/name mapping.
pub fn export_bundle(conn: &Connection) -> Result<CrmBundle> {
    let mut tables = BTreeMap::new();
    for table in EXPORT_TABLES {
        tables.insert((*table).to_string(), table_rows(conn, table)?);
    }

    let mut stmt = conn.prepare("SELECT id, name FROM accounts ORDER BY sort_order, created_at")?;
    let accounts = stmt
        .query_map([], |row| {
            Ok(BundleAccount {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(CrmBundle {
        format: FORMAT.to_string(),
        version: FORMAT_VERSION,
        exported_at: Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        accounts,
        tables,
    })
}

pub fn to_pretty_json(bundle: &CrmBundle) -> Result<String> {
    serde_json::to_string_pretty(bundle).map_err(|err| CoreError::Other(err.to_string()))
}

pub fn from_json(text: &str) -> Result<CrmBundle> {
    let bundle: CrmBundle = serde_json::from_str(text)
        .map_err(|err| CoreError::Other(format!("Invalid JSON: {err}")))?;
    if bundle.format != FORMAT {
        return Err(CoreError::Other(
            "This file is not a Dona Bridge CRM export".into(),
        ));
    }
    if bundle.version > FORMAT_VERSION {
        return Err(CoreError::Other(
            "This export was created by a newer version of Dona Bridge".into(),
        ));
    }
    Ok(bundle)
}

fn existing_accounts(conn: &Connection) -> Result<Vec<BundleAccount>> {
    let mut stmt = conn.prepare("SELECT id, name FROM accounts")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(BundleAccount {
                id: row.get(0)?,
                name: row.get(1)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Map exported account ids onto local accounts. Ids win; otherwise the account
/// name is used so a bundle can be imported on a PC where the same WhatsApp
/// accounts have different UUIDs.
fn account_mapping(conn: &Connection, bundle: &CrmBundle) -> Result<BTreeMap<String, String>> {
    let local = existing_accounts(conn)?;
    let by_id: BTreeSet<&str> = local.iter().map(|account| account.id.as_str()).collect();
    let mut mapping = BTreeMap::new();
    let mut missing = Vec::new();

    for account in &bundle.accounts {
        if by_id.contains(account.id.as_str()) {
            mapping.insert(account.id.clone(), account.id.clone());
            continue;
        }
        let wanted = account.name.trim().to_lowercase();
        if let Some(found) = local
            .iter()
            .find(|candidate| candidate.name.trim().to_lowercase() == wanted)
        {
            mapping.insert(account.id.clone(), found.id.clone());
        } else {
            missing.push(account.name.clone());
        }
    }

    if !missing.is_empty() {
        missing.sort();
        missing.dedup();
        return Err(CoreError::Other(format!(
            "This export belongs to account(s) that are not set up here: {}. Add the account, then import again.",
            missing.join(", ")
        )));
    }
    Ok(mapping)
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(columns)
}

fn json_to_sql(value: Option<&Value>) -> SqlValue {
    match value {
        None | Some(Value::Null) => SqlValue::Null,
        Some(Value::Bool(flag)) => SqlValue::Integer(if *flag { 1 } else { 0 }),
        Some(Value::Number(number)) => {
            if let Some(int) = number.as_i64() {
                SqlValue::Integer(int)
            } else {
                SqlValue::Real(number.as_f64().unwrap_or(0.0))
            }
        }
        Some(Value::String(text)) => SqlValue::Text(text.clone()),
        Some(other) => SqlValue::Text(other.to_string()),
    }
}

fn insert_rows(
    tx: &Connection,
    table: &str,
    rows: &[Map<String, Value>],
    account_map: &BTreeMap<String, String>,
) -> Result<usize> {
    if rows.is_empty() {
        return Ok(0);
    }
    let columns = table_columns(tx, table)?;
    if columns.is_empty() {
        return Ok(0);
    }
    let placeholders = vec!["?"; columns.len()].join(", ");
    let sql = format!(
        "INSERT OR REPLACE INTO {table} ({}) VALUES ({placeholders})",
        columns.join(", ")
    );
    let mut stmt = tx.prepare(&sql)?;

    let mut written = 0usize;
    for row in rows {
        let mut values = Vec::with_capacity(columns.len());
        for column in &columns {
            let original = row.get(column);
            // Rewrite account references so a bundle can move between PCs.
            if column == "account_id" {
                if let Some(account_id) = original.and_then(Value::as_str) {
                    if let Some(mapped) = account_map.get(account_id) {
                        values.push(SqlValue::Text(mapped.clone()));
                        continue;
                    }
                }
            }
            values.push(json_to_sql(original));
        }
        stmt.execute(rusqlite::params_from_iter(values))?;
        written += 1;
    }
    Ok(written)
}

/// Replace the CRM tables with the bundle contents.
///
/// Accounts, settings, WhatsApp sessions and AI configuration are untouched.
pub fn import_bundle(conn: &Connection, bundle: &CrmBundle) -> Result<ImportSummary> {
    let account_map = account_mapping(conn, bundle)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch("PRAGMA defer_foreign_keys = ON;")?;

    for table in DELETE_ORDER {
        tx.execute(&format!("DELETE FROM {table}"), [])?;
    }

    let mut summary = ImportSummary::default();
    for table in EXPORT_TABLES {
        let rows = bundle.tables.get(*table).map(Vec::as_slice).unwrap_or(&[]);
        summary.total_rows += insert_rows(&tx, table, rows, &account_map)?;
    }

    tx.commit()?;

    let count = |name: &str| bundle.tables.get(name).map(|rows| rows.len()).unwrap_or(0);
    summary.contacts = count("contacts");
    summary.deals = count("deals");
    summary.tasks = count("crm_tasks");
    summary.notes = count("notes");
    summary.tags = count("tags");
    summary.templates = count("templates");
    summary.pipelines = count("pipelines");
    Ok(summary)
}

// ── Spreadsheet-friendly exports ────────────────────────────────────────────

fn csv_field(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn csv_row(fields: &[String]) -> String {
    let mut line = fields
        .iter()
        .map(|field| csv_field(field))
        .collect::<Vec<_>>()
        .join(",");
    line.push_str("\r\n");
    line
}

/// Deals for one account, with pipeline/stage and contact names resolved.
pub fn export_deals_csv(conn: &Connection, account_id: &str) -> Result<(String, usize)> {
    let mut stmt = conn.prepare(
        "SELECT d.title, d.value, d.currency, d.probability, d.status,
                p.name, s.name, d.expected_close, d.owner,
                c.phone_e164, c.display_name, d.created_at, d.updated_at
         FROM deals d
         INNER JOIN pipelines p ON p.id = d.pipeline_id
         INNER JOIN pipeline_stages s ON s.id = d.stage_id
         LEFT JOIN contacts c ON c.id = d.contact_id
         WHERE d.account_id = ?1
         ORDER BY p.sort_order, s.sort_order, d.sort_order, d.created_at",
    )?;
    let mut out = csv_row(&[
        "Title".into(),
        "Value".into(),
        "Currency".into(),
        "Probability".into(),
        "Status".into(),
        "Pipeline".into(),
        "Stage".into(),
        "Expected close".into(),
        "Owner".into(),
        "Contact phone".into(),
        "Contact name".into(),
        "Created at".into(),
        "Updated at".into(),
    ]);
    let mut count = 0usize;
    let mut rows = stmt.query([account_id])?;
    while let Some(row) = rows.next()? {
        let value: f64 = row.get(1)?;
        out.push_str(&csv_row(&[
            row.get::<_, String>(0)?,
            format!("{value:.2}"),
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?.to_string(),
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            row.get::<_, Option<String>>(8)?.unwrap_or_default(),
            row.get::<_, Option<String>>(9)?.unwrap_or_default(),
            row.get::<_, Option<String>>(10)?.unwrap_or_default(),
            row.get::<_, Option<String>>(11)?.unwrap_or_default(),
            row.get::<_, Option<String>>(12)?.unwrap_or_default(),
        ]));
        count += 1;
    }
    Ok((out, count))
}

/// Tasks for one account.
pub fn export_tasks_csv(conn: &Connection, account_id: &str) -> Result<(String, usize)> {
    let mut stmt = conn.prepare(
        "SELECT t.title, t.status, t.priority, t.due_at, t.notes,
                c.phone_e164, c.display_name, t.completed_at, t.created_at
         FROM crm_tasks t
         LEFT JOIN contacts c ON c.id = t.contact_id
         WHERE t.account_id = ?1
         ORDER BY t.status, t.due_at, t.created_at",
    )?;
    let mut out = csv_row(&[
        "Title".into(),
        "Status".into(),
        "Priority".into(),
        "Due at".into(),
        "Notes".into(),
        "Contact phone".into(),
        "Contact name".into(),
        "Completed at".into(),
        "Created at".into(),
    ]);
    let mut count = 0usize;
    let mut rows = stmt.query([account_id])?;
    while let Some(row) = rows.next()? {
        out.push_str(&csv_row(&[
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            row.get::<_, Option<String>>(8)?.unwrap_or_default(),
        ]));
        count += 1;
    }
    Ok((out, count))
}

/// True when at least one CRM row exists (used to word the import warning).
pub fn has_crm_data(conn: &Connection) -> Result<bool> {
    let exists: Option<i64> = conn
        .query_row("SELECT 1 FROM contacts LIMIT 1", [], |row| row.get(0))
        .optional()?;
    Ok(exists.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::upsert_account;
    use crate::crm::{add_note, assign_tag, upsert_contact, upsert_tag};
    use crate::crm_ext::{list_deals, upsert_deal, upsert_task};
    use crate::models::{Account, Contact, CrmTask, Deal, Note, Tag};
    use rusqlite::Connection;
    use rusqlite_migration::{Migrations, M};

    fn setup() -> Connection {
        let mut conn = Connection::open_in_memory().expect("db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("pragma");
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
                id: "acc-1".into(),
                name: "Sales".into(),
                color: "#25D366".into(),
                created_at: None,
                ..Default::default()
            },
        )
        .expect("account");
        conn
    }

    fn seed(conn: &Connection) {
        upsert_contact(
            conn,
            &Contact {
                id: "c-1".into(),
                account_id: "acc-1".into(),
                phone_e164: "+8801700000000".into(),
                display_name: Some("Rahim".into()),
                stage: "qualified".into(),
                ..Default::default()
            },
        )
        .expect("contact");
        upsert_tag(
            conn,
            &Tag {
                id: "tag-1".into(),
                name: "VIP".into(),
                color: "#F59E0B".into(),
            },
        )
        .expect("tag");
        assign_tag(conn, "c-1", "tag-1").expect("assign tag");
        add_note(
            conn,
            &Note {
                id: "n-1".into(),
                account_id: "acc-1".into(),
                contact_id: Some("c-1".into()),
                body: "Interested in the annual plan".into(),
                ..Default::default()
            },
        )
        .expect("note");
        upsert_deal(
            conn,
            &Deal {
                id: "d-1".into(),
                account_id: "acc-1".into(),
                contact_id: Some("c-1".into()),
                pipeline_id: "pipe_sales".into(),
                stage_id: "stage_proposal".into(),
                title: "Annual plan".into(),
                value: 1200.0,
                currency: "USD".into(),
                probability: 60,
                ..Default::default()
            },
        )
        .expect("deal");
        upsert_task(
            conn,
            &CrmTask {
                id: "t-1".into(),
                account_id: "acc-1".into(),
                contact_id: Some("c-1".into()),
                deal_id: Some("d-1".into()),
                title: "Send the contract".into(),
                priority: "high".into(),
                status: "open".into(),
                ..Default::default()
            },
        )
        .expect("task");
    }

    #[test]
    fn export_import_roundtrip_replaces_crm_data() {
        let source = setup();
        seed(&source);
        let bundle = export_bundle(&source).expect("export");
        let json = to_pretty_json(&bundle).expect("serialize");
        let parsed = from_json(&json).expect("parse");

        // A second database with the same account but different CRM data.
        let target = setup();
        let summary = import_bundle(&target, &parsed).expect("import");
        assert_eq!(summary.contacts, 1);
        assert_eq!(summary.deals, 1);
        assert_eq!(summary.tasks, 1);
        assert_eq!(summary.notes, 1);

        let contacts = crate::crm::list_contacts(&target, "acc-1").expect("contacts");
        assert_eq!(contacts[0].display_name.as_deref(), Some("Rahim"));
        let tags = crate::crm::list_contact_tags(&target, "c-1").expect("tags");
        assert_eq!(tags[0].name, "VIP");
        let deals = list_deals(&target, "acc-1", "pipe_sales").expect("deals");
        assert_eq!(deals.len(), 1);
        assert_eq!(deals[0].title, "Annual plan");
        let tasks = crate::crm_ext::list_tasks(&target, "acc-1").expect("tasks");
        assert_eq!(tasks.len(), 1);
    }

    #[test]
    fn import_maps_accounts_by_name_for_another_pc() {
        let source = setup();
        seed(&source);
        let bundle = export_bundle(&source).expect("export");

        let target = setup();
        // Simulate a different machine: same account name, different UUID.
        target
            .execute("DELETE FROM accounts WHERE id = 'acc-1'", [])
            .expect("delete account");
        upsert_account(
            &target,
            &Account {
                id: "local-acc".into(),
                name: "sales".into(),
                color: "#25D366".into(),
                ..Default::default()
            },
        )
        .expect("new account");

        let summary = import_bundle(&target, &bundle).expect("import");
        assert_eq!(summary.contacts, 1);
        let contacts = crate::crm::list_contacts(&target, "local-acc").expect("contacts");
        assert_eq!(contacts.len(), 1);
    }

    #[test]
    fn import_rejects_unknown_accounts() {
        let source = setup();
        seed(&source);
        let bundle = export_bundle(&source).expect("export");

        let target = setup();
        target
            .execute("DELETE FROM accounts", [])
            .expect("clear accounts");
        let err = import_bundle(&target, &bundle).expect_err("must reject");
        assert!(err.to_string().contains("Sales"));
    }

    #[test]
    fn csv_exports_are_escaped() {
        let conn = setup();
        seed(&conn);
        conn.execute(
            "UPDATE deals SET title = 'Plan, \"annual\"' WHERE id = 'd-1'",
            [],
        )
        .expect("update");
        let (csv, count) = export_deals_csv(&conn, "acc-1").expect("csv");
        assert_eq!(count, 1);
        assert!(csv.contains("\"Plan, \"\"annual\"\"\""));
        assert!(csv.contains("Proposal"));
        let (tasks, task_count) = export_tasks_csv(&conn, "acc-1").expect("tasks csv");
        assert_eq!(task_count, 1);
        assert!(tasks.contains("Send the contract"));
    }
}
