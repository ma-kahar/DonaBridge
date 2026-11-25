// commands/crm_ext.rs — LiteCRM: pipelines, deals, custom fields, tasks,
// timeline and reports. Local bookkeeping only; nothing here sends messages.

use dona_core::{
    crm_ext, db,
    models::{
        ContactFieldValue, CrmReport, CrmTask, CustomField, Deal, Pipeline, PipelineStage,
        PipelineWithStages, TimelineEntry,
    },
};

#[tauri::command]
pub async fn crm_list_pipelines() -> Result<Vec<PipelineWithStages>, String> {
    tokio::task::spawn_blocking(|| {
        let conn = db::get().lock();
        crm_ext::list_pipelines(&conn).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_upsert_pipeline(mut pipeline: Pipeline) -> Result<Pipeline, String> {
    if pipeline.id.trim().is_empty() {
        pipeline.id = uuid::Uuid::new_v4().to_string();
    }
    if pipeline.name.trim().is_empty() {
        return Err("Pipeline name must not be empty".into());
    }
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::upsert_pipeline(&conn, &pipeline).map_err(|e| e.to_string())?;
        Ok::<_, String>(pipeline)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_delete_pipeline(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::delete_pipeline(&conn, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_upsert_stage(mut stage: PipelineStage) -> Result<PipelineStage, String> {
    if stage.id.trim().is_empty() {
        stage.id = uuid::Uuid::new_v4().to_string();
    }
    if stage.name.trim().is_empty() {
        return Err("Stage name must not be empty".into());
    }
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::upsert_stage(&conn, &stage).map_err(|e| e.to_string())?;
        Ok::<_, String>(stage)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_delete_stage(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::delete_stage(&conn, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_list_deals(account_id: String, pipeline_id: String) -> Result<Vec<Deal>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::list_deals(&conn, &account_id, &pipeline_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_upsert_deal(mut deal: Deal) -> Result<Deal, String> {
    let is_new = deal.id.trim().is_empty();
    if is_new {
        deal.id = uuid::Uuid::new_v4().to_string();
    }
    if deal.title.trim().is_empty() {
        return Err("Deal title must not be empty".into());
    }

    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        let saved = crm_ext::upsert_deal(&conn, &deal).map_err(|e| e.to_string())?;
        if is_new {
            if let Some(contact_id) = saved.contact_id.as_deref() {
                let _ = crm_ext::add_activity(
                    &conn,
                    &saved.account_id,
                    Some(contact_id),
                    Some(&saved.id),
                    "deal",
                    &format!(
                        "Deal created: {} ({:.2} {})",
                        saved.title, saved.value, saved.currency
                    ),
                );
            }
        }
        Ok::<_, String>(saved)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_move_deal(id: String, stage_id: String, sort_order: i32) -> Result<Deal, String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        let moved =
            crm_ext::move_deal(&conn, &id, &stage_id, sort_order).map_err(|e| e.to_string())?;
        if let Some(contact_id) = moved.contact_id.as_deref() {
            let stage_name: String = conn
                .query_row(
                    "SELECT name FROM pipeline_stages WHERE id = ?1",
                    rusqlite::params![stage_id],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| stage_id.clone());
            let _ = crm_ext::add_activity(
                &conn,
                &moved.account_id,
                Some(contact_id),
                Some(&moved.id),
                "deal",
                &format!("Deal moved to {stage_name}: {}", moved.title),
            );
        }
        Ok::<_, String>(moved)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_delete_deal(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::delete_deal(&conn, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_list_custom_fields(account_id: String) -> Result<Vec<CustomField>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::list_custom_fields(&conn, &account_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_upsert_custom_field(mut field: CustomField) -> Result<CustomField, String> {
    if field.id.trim().is_empty() {
        field.id = uuid::Uuid::new_v4().to_string();
    }
    if field.name.trim().is_empty() {
        return Err("Field name must not be empty".into());
    }
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::upsert_custom_field(&conn, &field).map_err(|e| e.to_string())?;
        Ok::<_, String>(field)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_delete_custom_field(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::delete_custom_field(&conn, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_get_contact_fields(contact_id: String) -> Result<Vec<ContactFieldValue>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::get_contact_fields(&conn, &contact_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_set_contact_field(
    contact_id: String,
    field_id: String,
    value: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::set_contact_field(&conn, &contact_id, &field_id, &value).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_list_tasks(account_id: String) -> Result<Vec<CrmTask>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::list_tasks(&conn, &account_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_upsert_task(mut task: CrmTask) -> Result<CrmTask, String> {
    let is_new = task.id.trim().is_empty();
    if is_new {
        task.id = uuid::Uuid::new_v4().to_string();
    }
    if task.title.trim().is_empty() {
        return Err("Task title must not be empty".into());
    }

    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        let saved = crm_ext::upsert_task(&conn, &task).map_err(|e| e.to_string())?;
        if is_new {
            if let Some(contact_id) = saved.contact_id.as_deref() {
                let _ = crm_ext::add_activity(
                    &conn,
                    &saved.account_id,
                    Some(contact_id),
                    None,
                    "task",
                    &format!("Task added: {}", saved.title),
                );
            }
        }
        Ok::<_, String>(saved)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_delete_task(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::delete_task(&conn, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_contact_timeline(contact_id: String) -> Result<Vec<TimelineEntry>, String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::contact_timeline(&conn, &contact_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn crm_report(account_id: String, pipeline_id: String) -> Result<CrmReport, String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        crm_ext::report(&conn, &account_id, &pipeline_id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
