// dona-core/src/crm_ext.rs
// LiteCRM domain logic: pipelines, deals, custom fields, unified tasks,
// the contact activity timeline and reporting aggregates.
//
// Everything here is local bookkeeping. It never sends, schedules or automates
// a WhatsApp message.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::Result;
use crate::models::{
    ContactFieldValue, CrmReport, CrmTask, CustomField, Deal, Pipeline, PipelineStage,
    PipelineWithStages, StageReport, TimelineEntry,
};

fn parse_dt(s: Option<String>) -> Option<DateTime<Utc>> {
    s.and_then(|v| {
        DateTime::parse_from_rfc3339(&v)
            .map(|dt| dt.with_timezone(&Utc))
            .ok()
    })
}

fn as_iso(s: Option<String>) -> Option<String> {
    parse_dt(s).map(|dt| dt.to_rfc3339())
}

// ── Pipelines & stages ───────────────────────────────────────────────────────

pub fn list_pipelines(conn: &Connection) -> Result<Vec<PipelineWithStages>> {
    let mut p_stmt = conn.prepare(
        "SELECT id, name, is_default, sort_order
         FROM pipelines
         ORDER BY is_default DESC, sort_order ASC, name ASC",
    )?;
    let pipelines = p_stmt
        .query_map([], |row| {
            Ok(Pipeline {
                id: row.get(0)?,
                name: row.get(1)?,
                is_default: row.get::<_, i32>(2)? != 0,
                sort_order: row.get(3)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let mut s_stmt = conn.prepare(
        "SELECT id, pipeline_id, name, color, sort_order, wip_limit, is_won, is_lost
         FROM pipeline_stages
         WHERE pipeline_id = ?1
         ORDER BY sort_order ASC, name ASC",
    )?;

    let mut out = Vec::with_capacity(pipelines.len());
    for pipeline in pipelines {
        let stages = s_stmt
            .query_map(params![pipeline.id], |row| {
                Ok(PipelineStage {
                    id: row.get(0)?,
                    pipeline_id: row.get(1)?,
                    name: row.get(2)?,
                    color: row.get(3)?,
                    sort_order: row.get(4)?,
                    wip_limit: row.get(5)?,
                    is_won: row.get::<_, i32>(6)? != 0,
                    is_lost: row.get::<_, i32>(7)? != 0,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        out.push(PipelineWithStages { pipeline, stages });
    }
    Ok(out)
}

pub fn upsert_pipeline(conn: &Connection, pipeline: &Pipeline) -> Result<()> {
    if pipeline.is_default {
        conn.execute("UPDATE pipelines SET is_default = 0", [])?;
    }
    conn.execute(
        "INSERT INTO pipelines (id, name, is_default, sort_order)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            is_default = excluded.is_default,
            sort_order = excluded.sort_order",
        params![
            pipeline.id,
            pipeline.name,
            pipeline.is_default as i32,
            pipeline.sort_order
        ],
    )?;
    Ok(())
}

pub fn delete_pipeline(conn: &Connection, id: &str) -> Result<()> {
    let count: i64 = conn.query_row("SELECT count(*) FROM pipelines", [], |row| row.get(0))?;
    if count <= 1 {
        return Err(crate::error::CoreError::Other(
            "At least one pipeline is required".into(),
        ));
    }
    let is_default: bool = conn
        .query_row(
            "SELECT is_default FROM pipelines WHERE id = ?1",
            params![id],
            |row| row.get::<_, i32>(0).map(|v| v != 0),
        )
        .optional()?
        .unwrap_or(false);
    if is_default {
        return Err(crate::error::CoreError::Other(
            "Mark another pipeline as default before deleting this one".into(),
        ));
    }
    conn.execute("DELETE FROM pipelines WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn upsert_stage(conn: &Connection, stage: &PipelineStage) -> Result<()> {
    conn.execute(
        "INSERT INTO pipeline_stages
            (id, pipeline_id, name, color, sort_order, wip_limit, is_won, is_lost)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            color = excluded.color,
            sort_order = excluded.sort_order,
            wip_limit = excluded.wip_limit,
            is_won = excluded.is_won,
            is_lost = excluded.is_lost",
        params![
            stage.id,
            stage.pipeline_id,
            stage.name,
            stage.color,
            stage.sort_order,
            stage.wip_limit,
            stage.is_won as i32,
            stage.is_lost as i32,
        ],
    )?;
    Ok(())
}

/// Delete a stage, moving its deals to the first remaining stage of the pipeline.
pub fn delete_stage(conn: &Connection, id: &str) -> Result<()> {
    let pipeline_id: String = conn
        .query_row(
            "SELECT pipeline_id FROM pipeline_stages WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| crate::error::CoreError::Other("Stage not found".into()))?;

    let fallback: Option<String> = conn
        .query_row(
            "SELECT id FROM pipeline_stages
             WHERE pipeline_id = ?1 AND id <> ?2
             ORDER BY sort_order ASC
             LIMIT 1",
            params![pipeline_id, id],
            |row| row.get(0),
        )
        .optional()?;

    match fallback {
        Some(target) => {
            conn.execute(
                "UPDATE deals SET stage_id = ?1, updated_at = datetime('now') WHERE stage_id = ?2",
                params![target, id],
            )?;
            conn.execute("DELETE FROM pipeline_stages WHERE id = ?1", params![id])?;
            Ok(())
        }
        None => Err(crate::error::CoreError::Other(
            "A pipeline needs at least one stage".into(),
        )),
    }
}

// ── Deals ────────────────────────────────────────────────────────────────────

fn deal_status_for_stage(conn: &Connection, stage_id: &str) -> Result<String> {
    let (is_won, is_lost): (i32, i32) = conn.query_row(
        "SELECT is_won, is_lost FROM pipeline_stages WHERE id = ?1",
        params![stage_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(if is_won != 0 {
        "won".into()
    } else if is_lost != 0 {
        "lost".into()
    } else {
        "open".into()
    })
}

fn deal_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Deal> {
    Ok(Deal {
        id: row.get(0)?,
        account_id: row.get(1)?,
        contact_id: row.get(2)?,
        pipeline_id: row.get(3)?,
        stage_id: row.get(4)?,
        title: row.get(5)?,
        value: row.get(6)?,
        currency: row.get(7)?,
        probability: row.get(8)?,
        expected_close: row.get(9)?,
        owner: row.get(10)?,
        status: row.get(11)?,
        lost_reason: row.get(12)?,
        sort_order: row.get(13)?,
        created_at: parse_dt(row.get(14)?),
        updated_at: parse_dt(row.get(15)?),
    })
}

const DEAL_COLUMNS: &str = "id, account_id, contact_id, pipeline_id, stage_id, title, value,
     currency, probability, expected_close, owner, status, lost_reason, sort_order,
     created_at, updated_at";

pub fn list_deals(conn: &Connection, account_id: &str, pipeline_id: &str) -> Result<Vec<Deal>> {
    let sql = format!(
        "SELECT {DEAL_COLUMNS} FROM deals
         WHERE account_id = ?1 AND pipeline_id = ?2
         ORDER BY sort_order ASC, updated_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![account_id, pipeline_id], deal_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get_deal(conn: &Connection, id: &str) -> Result<Option<Deal>> {
    let sql = format!("SELECT {DEAL_COLUMNS} FROM deals WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt.query_row(params![id], deal_row).optional()?)
}

pub fn upsert_deal(conn: &Connection, deal: &Deal) -> Result<Deal> {
    let status = deal_status_for_stage(conn, &deal.stage_id)?;
    let currency = if deal.currency.trim().is_empty() {
        "USD".to_string()
    } else {
        deal.currency.to_uppercase()
    };

    conn.execute(
        "INSERT INTO deals
            (id, account_id, contact_id, pipeline_id, stage_id, title, value, currency,
             probability, expected_close, owner, status, lost_reason, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
            contact_id = excluded.contact_id,
            pipeline_id = excluded.pipeline_id,
            stage_id = excluded.stage_id,
            title = excluded.title,
            value = excluded.value,
            currency = excluded.currency,
            probability = excluded.probability,
            expected_close = excluded.expected_close,
            owner = excluded.owner,
            status = excluded.status,
            lost_reason = excluded.lost_reason,
            sort_order = excluded.sort_order,
            updated_at = datetime('now')",
        params![
            deal.id,
            deal.account_id,
            deal.contact_id,
            deal.pipeline_id,
            deal.stage_id,
            deal.title,
            deal.value,
            currency,
            deal.probability.clamp(0, 100),
            deal.expected_close,
            deal.owner,
            status,
            deal.lost_reason,
            deal.sort_order,
        ],
    )?;

    get_deal(conn, &deal.id)?
        .ok_or_else(|| crate::error::CoreError::Other("Deal missing after upsert".into()))
}

pub fn move_deal(conn: &Connection, id: &str, stage_id: &str, sort_order: i32) -> Result<Deal> {
    let status = deal_status_for_stage(conn, stage_id)?;
    conn.execute(
        "UPDATE deals SET stage_id = ?1, sort_order = ?2, status = ?3,
            updated_at = datetime('now')
         WHERE id = ?4",
        params![stage_id, sort_order, status, id],
    )?;
    get_deal(conn, id)?.ok_or_else(|| crate::error::CoreError::Other("Deal not found".into()))
}

pub fn delete_deal(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM deals WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Custom fields ────────────────────────────────────────────────────────────

pub fn list_custom_fields(conn: &Connection, account_id: &str) -> Result<Vec<CustomField>> {
    let mut stmt = conn.prepare(
        "SELECT id, account_id, name, field_type, options, sort_order
         FROM custom_fields
         WHERE account_id IS NULL OR account_id = ?1
         ORDER BY sort_order ASC, name ASC",
    )?;
    let rows = stmt.query_map(params![account_id], |row| {
        Ok(CustomField {
            id: row.get(0)?,
            account_id: row.get(1)?,
            name: row.get(2)?,
            field_type: row.get(3)?,
            options: row.get(4)?,
            sort_order: row.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn upsert_custom_field(conn: &Connection, field: &CustomField) -> Result<()> {
    let field_type = match field.field_type.as_str() {
        "number" | "date" | "select" => field.field_type.as_str(),
        _ => "text",
    };
    conn.execute(
        "INSERT INTO custom_fields (id, account_id, name, field_type, options, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            field_type = excluded.field_type,
            options = excluded.options,
            sort_order = excluded.sort_order",
        params![
            field.id,
            field.account_id,
            field.name,
            field_type,
            field.options,
            field.sort_order
        ],
    )?;
    Ok(())
}

pub fn delete_custom_field(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM custom_fields WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_contact_fields(conn: &Connection, contact_id: &str) -> Result<Vec<ContactFieldValue>> {
    let mut stmt =
        conn.prepare("SELECT field_id, value FROM contact_field_values WHERE contact_id = ?1")?;
    let rows = stmt.query_map(params![contact_id], |row| {
        Ok(ContactFieldValue {
            field_id: row.get(0)?,
            value: row.get(1)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn set_contact_field(
    conn: &Connection,
    contact_id: &str,
    field_id: &str,
    value: &str,
) -> Result<()> {
    if value.trim().is_empty() {
        conn.execute(
            "DELETE FROM contact_field_values WHERE contact_id = ?1 AND field_id = ?2",
            params![contact_id, field_id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO contact_field_values (contact_id, field_id, value)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(contact_id, field_id) DO UPDATE SET value = excluded.value",
            params![contact_id, field_id, value],
        )?;
    }
    Ok(())
}

// ── Tasks ────────────────────────────────────────────────────────────────────

fn task_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CrmTask> {
    Ok(CrmTask {
        id: row.get(0)?,
        account_id: row.get(1)?,
        contact_id: row.get(2)?,
        deal_id: row.get(3)?,
        title: row.get(4)?,
        notes: row.get(5)?,
        due_at: row.get(6)?,
        priority: row.get(7)?,
        status: row.get(8)?,
        notified: row.get::<_, i32>(9)? != 0,
        completed_at: row.get(10)?,
        created_at: parse_dt(row.get(11)?),
    })
}

const TASK_COLUMNS: &str = "id, account_id, contact_id, deal_id, title, notes, due_at,
     priority, status, notified, completed_at, created_at";

pub fn list_tasks(conn: &Connection, account_id: &str) -> Result<Vec<CrmTask>> {
    let sql = format!(
        "SELECT {TASK_COLUMNS} FROM crm_tasks
         WHERE account_id = ?1
         ORDER BY (status = 'done') ASC, due_at IS NULL, due_at ASC, created_at DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![account_id], task_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get_task(conn: &Connection, id: &str) -> Result<Option<CrmTask>> {
    let sql = format!("SELECT {TASK_COLUMNS} FROM crm_tasks WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    Ok(stmt.query_row(params![id], task_row).optional()?)
}

pub fn upsert_task(conn: &Connection, task: &CrmTask) -> Result<CrmTask> {
    let status = if task.status.is_empty() {
        "open".to_string()
    } else {
        task.status.clone()
    };
    let priority = match task.priority.as_str() {
        "low" | "high" => task.priority.as_str(),
        _ => "medium",
    };
    let completed_at = if status == "done" {
        Some(Utc::now().to_rfc3339())
    } else {
        None
    };

    conn.execute(
        "INSERT INTO crm_tasks
            (id, account_id, contact_id, deal_id, title, notes, due_at, priority,
             status, notified, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10)
         ON CONFLICT(id) DO UPDATE SET
            contact_id = excluded.contact_id,
            deal_id = excluded.deal_id,
            title = excluded.title,
            notes = excluded.notes,
            due_at = excluded.due_at,
            priority = excluded.priority,
            status = excluded.status,
            notified = CASE
                WHEN excluded.due_at IS NOT crm_tasks.due_at THEN 0
                ELSE crm_tasks.notified
            END,
            completed_at = CASE
                WHEN excluded.status = 'done' THEN COALESCE(crm_tasks.completed_at, excluded.completed_at)
                ELSE NULL
            END",
        params![
            task.id,
            task.account_id,
            task.contact_id,
            task.deal_id,
            task.title,
            task.notes,
            task.due_at,
            priority,
            status,
            completed_at,
        ],
    )?;

    let sql = format!("SELECT {TASK_COLUMNS} FROM crm_tasks WHERE id = ?1");
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_row(params![task.id], task_row)
        .map_err(Into::into)
}

pub fn delete_task(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM crm_tasks WHERE id = ?1", params![id])?;
    Ok(())
}

/// Tasks that are open, have a due date in the past and were not notified yet.
pub fn due_tasks(conn: &Connection, now: DateTime<Utc>) -> Result<Vec<CrmTask>> {
    let sql = format!(
        "SELECT {TASK_COLUMNS} FROM crm_tasks
         WHERE status = 'open' AND notified = 0 AND due_at IS NOT NULL"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], task_row)?;
    let mut out = Vec::new();
    for row in rows {
        let task = row?;
        // Parse instead of comparing strings: timestamps can carry different
        // UTC offsets (e.g. +06:00 vs Z).
        let is_due = task
            .due_at
            .as_deref()
            .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
            .is_some_and(|due| due.with_timezone(&Utc) <= now);
        if is_due {
            out.push(task);
        }
    }
    Ok(out)
}

pub fn mark_task_notified(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE crm_tasks SET notified = 1 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

// ── Activity timeline ────────────────────────────────────────────────────────

pub fn add_activity(
    conn: &Connection,
    account_id: &str,
    contact_id: Option<&str>,
    deal_id: Option<&str>,
    kind: &str,
    body: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO crm_activities (id, account_id, contact_id, deal_id, kind, body)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            uuid::Uuid::new_v4().to_string(),
            account_id,
            contact_id,
            deal_id,
            kind,
            body
        ],
    )?;
    Ok(())
}

/// Everything that happened with a contact: notes, stage changes, deals, tasks.
pub fn contact_timeline(conn: &Connection, contact_id: &str) -> Result<Vec<TimelineEntry>> {
    let mut out: Vec<TimelineEntry> = Vec::new();

    let mut stmt = conn.prepare(
        "SELECT id, kind, body, created_at FROM crm_activities
         WHERE contact_id = ?1 ORDER BY created_at DESC LIMIT 200",
    )?;
    for row in stmt.query_map(params![contact_id], |row| {
        Ok(TimelineEntry {
            id: row.get(0)?,
            kind: row.get(1)?,
            title: String::new(),
            body: row.get(2)?,
            at: as_iso(row.get(3)?),
        })
    })? {
        let mut entry = row?;
        entry.title = match entry.kind.as_str() {
            "stage" => "Stage changed".into(),
            "deal" => "Deal".into(),
            "task" => "Task".into(),
            _ => "Activity".into(),
        };
        out.push(entry);
    }

    let mut notes = conn.prepare(
        "SELECT id, body, created_at FROM notes
         WHERE contact_id = ?1 ORDER BY created_at DESC LIMIT 200",
    )?;
    for row in notes.query_map(params![contact_id], |row| {
        Ok(TimelineEntry {
            id: row.get(0)?,
            kind: "note".into(),
            title: "Note".into(),
            body: row.get(1)?,
            at: as_iso(row.get(2)?),
        })
    })? {
        out.push(row?);
    }

    let mut deals = conn.prepare(
        "SELECT id, title, value, currency, status, created_at FROM deals
         WHERE contact_id = ?1 ORDER BY created_at DESC LIMIT 100",
    )?;
    for row in deals.query_map(params![contact_id], |row| {
        let title: String = row.get(1)?;
        let value: f64 = row.get(2)?;
        let currency: String = row.get(3)?;
        let status: String = row.get(4)?;
        Ok(TimelineEntry {
            id: row.get(0)?,
            kind: "deal".into(),
            title: "Deal created".into(),
            body: format!("{title} · {value:.2} {currency} · {status}"),
            at: as_iso(row.get(5)?),
        })
    })? {
        out.push(row?);
    }

    let mut tasks = conn.prepare(
        "SELECT id, title, status, due_at, created_at FROM crm_tasks
         WHERE contact_id = ?1 ORDER BY created_at DESC LIMIT 100",
    )?;
    for row in tasks.query_map(params![contact_id], |row| {
        let title: String = row.get(1)?;
        let status: String = row.get(2)?;
        let due: Option<String> = row.get(3)?;
        Ok(TimelineEntry {
            id: row.get(0)?,
            kind: "task".into(),
            title: format!("Task · {status}"),
            body: format!(
                "{title}{}",
                due.map(|d| format!(" · due {d}")).unwrap_or_default()
            ),
            at: as_iso(row.get(4)?),
        })
    })? {
        out.push(row?);
    }

    out.sort_by(|a, b| b.at.cmp(&a.at));
    Ok(out)
}

// ── Reports ──────────────────────────────────────────────────────────────────

pub fn report(conn: &Connection, account_id: &str, pipeline_id: &str) -> Result<CrmReport> {
    let (pipeline_name,): (String,) = conn.query_row(
        "SELECT name FROM pipelines WHERE id = ?1",
        params![pipeline_id],
        |row| Ok((row.get(0)?,)),
    )?;

    let mut stages = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.color,
                (SELECT count(*) FROM deals d
                  WHERE d.stage_id = s.id AND d.account_id = ?1),
                (SELECT coalesce(sum(d.value), 0) FROM deals d
                  WHERE d.stage_id = s.id AND d.account_id = ?1)
         FROM pipeline_stages s
         WHERE s.pipeline_id = ?2
         ORDER BY s.sort_order ASC, s.name ASC",
    )?;
    for row in stmt.query_map(params![account_id, pipeline_id], |row| {
        Ok(StageReport {
            stage_id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            count: row.get(3)?,
            value: row.get(4)?,
        })
    })? {
        stages.push(row?);
    }

    let open_count: i64 = conn.query_row(
        "SELECT count(*) FROM deals WHERE account_id = ?1 AND pipeline_id = ?2 AND status = 'open'",
        params![account_id, pipeline_id],
        |row| row.get(0),
    )?;
    let open_value: f64 = conn.query_row(
        "SELECT coalesce(sum(value), 0) FROM deals WHERE account_id = ?1 AND pipeline_id = ?2 AND status = 'open'",
        params![account_id, pipeline_id],
        |row| row.get(0),
    )?;
    let won_count: i64 = conn.query_row(
        "SELECT count(*) FROM deals WHERE account_id = ?1 AND pipeline_id = ?2 AND status = 'won'",
        params![account_id, pipeline_id],
        |row| row.get(0),
    )?;
    let won_value: f64 = conn.query_row(
        "SELECT coalesce(sum(value), 0) FROM deals WHERE account_id = ?1 AND pipeline_id = ?2 AND status = 'won'",
        params![account_id, pipeline_id],
        |row| row.get(0),
    )?;
    let lost_count: i64 = conn.query_row(
        "SELECT count(*) FROM deals WHERE account_id = ?1 AND pipeline_id = ?2 AND status = 'lost'",
        params![account_id, pipeline_id],
        |row| row.get(0),
    )?;
    let lost_value: f64 = conn.query_row(
        "SELECT coalesce(sum(value), 0) FROM deals WHERE account_id = ?1 AND pipeline_id = ?2 AND status = 'lost'",
        params![account_id, pipeline_id],
        |row| row.get(0),
    )?;
    let open_tasks: i64 = conn.query_row(
        "SELECT count(*) FROM crm_tasks WHERE account_id = ?1 AND status = 'open'",
        params![account_id],
        |row| row.get(0),
    )?;
    let overdue_tasks: i64 = conn.query_row(
        "SELECT count(*) FROM crm_tasks WHERE account_id = ?1 AND status = 'open'
            AND due_at IS NOT NULL AND datetime(due_at) < datetime('now')",
        params![account_id],
        |row| row.get(0),
    )?;
    let deals_last_30_days: i64 = conn.query_row(
        "SELECT count(*) FROM deals
          WHERE account_id = ?1 AND created_at >= datetime('now', '-30 days')",
        params![account_id],
        |row| row.get(0),
    )?;
    let won_last_30_days: i64 = conn.query_row(
        "SELECT count(*) FROM deals
          WHERE account_id = ?1 AND status = 'won' AND updated_at >= datetime('now', '-30 days')",
        params![account_id],
        |row| row.get(0),
    )?;

    let decided = won_count + lost_count;
    let win_rate = if decided > 0 {
        (won_count as f64 / decided as f64) * 100.0
    } else {
        0.0
    };
    let avg_deal_value = if open_count > 0 {
        open_value / open_count as f64
    } else {
        0.0
    };
    let currency: String = conn
        .query_row(
            "SELECT currency FROM deals
              WHERE account_id = ?1 AND pipeline_id = ?2
              GROUP BY currency ORDER BY count(*) DESC LIMIT 1",
            params![account_id, pipeline_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| "USD".to_string());

    Ok(CrmReport {
        pipeline_id: pipeline_id.to_string(),
        pipeline_name,
        currency,
        stages,
        open_count,
        open_value,
        won_count,
        won_value,
        lost_count,
        lost_value,
        win_rate,
        avg_deal_value,
        open_tasks,
        overdue_tasks,
        deals_last_30_days,
        won_last_30_days,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::accounts::upsert_account;
    use crate::crm::{add_note, upsert_contact};
    use crate::models::{Account, Contact, Note};
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
                id: "acc_1".into(),
                name: "Shop".into(),
                zoom: 1.0,
                ..Default::default()
            },
        )
        .expect("account");

        upsert_contact(
            &conn,
            &Contact {
                id: "c_1".into(),
                account_id: "acc_1".into(),
                phone_e164: "+33612345678".into(),
                display_name: Some("Jean".into()),
                stage: "new".into(),
                ..Default::default()
            },
        )
        .expect("contact");
        conn
    }

    #[test]
    fn default_pipeline_and_deal_flow() {
        let conn = setup();
        let pipelines = list_pipelines(&conn).expect("pipelines");
        assert_eq!(pipelines.len(), 1);
        assert_eq!(pipelines[0].stages.len(), 6);

        let deal = upsert_deal(
            &conn,
            &Deal {
                id: "d_1".into(),
                account_id: "acc_1".into(),
                contact_id: Some("c_1".into()),
                pipeline_id: "pipe_sales".into(),
                stage_id: "stage_new".into(),
                title: "50 units".into(),
                value: 1500.0,
                currency: "usd".into(),
                probability: 40,
                ..Default::default()
            },
        )
        .expect("deal");
        assert_eq!(deal.status, "open");
        assert_eq!(deal.currency, "USD");

        let moved = move_deal(&conn, "d_1", "stage_won", 0).expect("move");
        assert_eq!(moved.status, "won");

        let report = report(&conn, "acc_1", "pipe_sales").expect("report");
        assert_eq!(report.won_count, 1);
        assert_eq!(report.won_value, 1500.0);
        assert_eq!(report.win_rate, 100.0);
        assert!(report
            .stages
            .iter()
            .any(|s| s.stage_id == "stage_won" && s.count == 1));
    }

    #[test]
    fn tasks_fields_and_timeline() {
        let conn = setup();

        upsert_custom_field(
            &conn,
            &CustomField {
                id: "cf_city".into(),
                name: "City".into(),
                field_type: "text".into(),
                ..Default::default()
            },
        )
        .expect("field");
        set_contact_field(&conn, "c_1", "cf_city", "Dhaka").expect("value");
        assert_eq!(get_contact_fields(&conn, "c_1").expect("values").len(), 1);

        let task = upsert_task(
            &conn,
            &CrmTask {
                id: "t_1".into(),
                account_id: "acc_1".into(),
                contact_id: Some("c_1".into()),
                title: "Call back".into(),
                due_at: Some("2020-01-01T00:00:00+00:00".into()),
                priority: "high".into(),
                status: "open".into(),
                ..Default::default()
            },
        )
        .expect("task");
        assert_eq!(task.priority, "high");
        assert_eq!(due_tasks(&conn, Utc::now()).expect("due").len(), 1);

        add_note(
            &conn,
            &Note {
                id: "n_1".into(),
                account_id: "acc_1".into(),
                contact_id: Some("c_1".into()),
                body: "Asked for a quote".into(),
                ..Default::default()
            },
        )
        .expect("note");
        add_activity(
            &conn,
            "acc_1",
            Some("c_1"),
            None,
            "stage",
            "new → negotiating",
        )
        .expect("activity");

        let timeline = contact_timeline(&conn, "c_1").expect("timeline");
        assert!(timeline.iter().any(|e| e.kind == "note"));
        assert!(timeline.iter().any(|e| e.kind == "task"));
        assert!(timeline.iter().any(|e| e.kind == "stage"));
    }

    #[test]
    fn deleting_a_stage_reassigns_its_deals() {
        let conn = setup();
        upsert_deal(
            &conn,
            &Deal {
                id: "d_1".into(),
                account_id: "acc_1".into(),
                contact_id: Some("c_1".into()),
                pipeline_id: "pipe_sales".into(),
                stage_id: "stage_proposal".into(),
                title: "Deal".into(),
                value: 100.0,
                currency: "USD".into(),
                ..Default::default()
            },
        )
        .expect("deal");

        delete_stage(&conn, "stage_proposal").expect("delete stage");
        let deals = list_deals(&conn, "acc_1", "pipe_sales").expect("deals");
        assert_eq!(deals.len(), 1);
        assert_eq!(deals[0].stage_id, "stage_new");
    }
}
