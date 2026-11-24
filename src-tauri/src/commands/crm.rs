// commands/crm.rs
// CRM commands exposed ONLY to the "main" shell capability (never wa-remote).
// Blueprint §2: draft-only — crm_insert_draft inserts text into the composer, never presses Send.

use chrono::{DateTime, Utc};
use dona_core::{
    crm as core_crm, db,
    models::{Contact, Note, Reminder, Tag, Template},
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::webviews::manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactDto {
    pub id: String,
    pub account_id: String,
    pub phone_e164: String,
    pub display_name: Option<String>,
    pub stage: String,
}

impl From<Contact> for ContactDto {
    fn from(c: Contact) -> Self {
        Self {
            id: c.id,
            account_id: c.account_id,
            phone_e164: c.phone_e164,
            display_name: c.display_name,
            stage: c.stage,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDto {
    pub id: String,
    pub account_id: String,
    pub contact_id: Option<String>,
    pub body: String,
    pub created_at: Option<String>,
}

impl From<Note> for NoteDto {
    fn from(n: Note) -> Self {
        Self {
            id: n.id,
            account_id: n.account_id,
            contact_id: n.contact_id,
            body: n.body,
            created_at: n.created_at.map(|d| d.to_rfc3339()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReminderDto {
    pub id: String,
    pub contact_id: String,
    pub due_at: Option<String>,
    pub note: Option<String>,
    pub status: String,
}

impl From<Reminder> for ReminderDto {
    fn from(r: Reminder) -> Self {
        Self {
            id: r.id,
            contact_id: r.contact_id,
            due_at: r.due_at.map(|d| d.to_rfc3339()),
            note: r.note,
            status: r.status,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateDto {
    pub id: String,
    pub account_id: Option<String>,
    pub name: String,
    pub body: String,
    pub language: String,
    pub shortcut: Option<String>,
}

impl From<Template> for TemplateDto {
    fn from(t: Template) -> Self {
        Self {
            id: t.id,
            account_id: t.account_id,
            name: t.name,
            body: t.body,
            language: t.language,
            shortcut: t.shortcut,
        }
    }
}

#[tauri::command]
pub async fn crm_list_contacts(account_id: String) -> Result<Vec<ContactDto>, String> {
    let conn = db::get().lock();
    let list = core_crm::list_contacts(&conn, &account_id).map_err(|e| e.to_string())?;
    Ok(list.into_iter().map(ContactDto::from).collect())
}

#[tauri::command]
pub async fn crm_upsert_contact(contact: ContactDto) -> Result<ContactDto, String> {
    let id = if contact.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        contact.id
    };
    let phone = core_crm::normalize_phone_e164(&contact.phone_e164, None);
    let model = Contact {
        id,
        account_id: contact.account_id,
        phone_e164: phone,
        display_name: contact.display_name,
        stage: contact.stage,
        created_at: None,
        updated_at: None,
    };
    let conn = db::get().lock();
    let saved = core_crm::upsert_contact(&conn, &model).map_err(|e| e.to_string())?;
    Ok(ContactDto::from(saved))
}

#[tauri::command]
pub async fn crm_delete_contact(id: String) -> Result<(), String> {
    let conn = db::get().lock();
    core_crm::delete_contact(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_list_notes(contact_id: String) -> Result<Vec<NoteDto>, String> {
    let conn = db::get().lock();
    let list = core_crm::list_notes(&conn, &contact_id).map_err(|e| e.to_string())?;
    Ok(list.into_iter().map(NoteDto::from).collect())
}

#[tauri::command]
pub async fn crm_add_note(
    account_id: String,
    contact_id: Option<String>,
    body: String,
) -> Result<(), String> {
    let note = Note {
        id: uuid::Uuid::new_v4().to_string(),
        account_id,
        contact_id,
        body,
        created_at: None,
        updated_at: None,
    };
    let conn = db::get().lock();
    core_crm::add_note(&conn, &note).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_list_reminders(account_id: String) -> Result<Vec<ReminderDto>, String> {
    let conn = db::get().lock();
    let list = core_crm::list_reminders(&conn, &account_id).map_err(|e| e.to_string())?;
    Ok(list.into_iter().map(ReminderDto::from).collect())
}

#[tauri::command]
pub async fn crm_upsert_reminder(reminder: ReminderDto) -> Result<(), String> {
    let id = if reminder.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        reminder.id
    };
    let due_at = reminder.due_at.and_then(|s| {
        DateTime::parse_from_rfc3339(&s)
            .map(|d| d.with_timezone(&Utc))
            .ok()
    });
    let model = Reminder {
        id,
        contact_id: reminder.contact_id,
        due_at,
        note: reminder.note,
        status: reminder.status,
        snoozed_until: None,
    };
    let conn = db::get().lock();
    core_crm::upsert_reminder(&conn, &model).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_list_templates(account_id: Option<String>) -> Result<Vec<TemplateDto>, String> {
    let conn = db::get().lock();
    let list = core_crm::list_templates(&conn, account_id.as_deref()).map_err(|e| e.to_string())?;
    Ok(list.into_iter().map(TemplateDto::from).collect())
}

#[tauri::command]
pub async fn crm_upsert_template(template: TemplateDto) -> Result<(), String> {
    let id = if template.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        template.id
    };
    let model = Template {
        id,
        account_id: template.account_id,
        name: template.name,
        body: template.body,
        language: template.language,
        shortcut: template.shortcut,
    };
    let conn = db::get().lock();
    core_crm::upsert_template(&conn, &model).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_delete_template(id: String) -> Result<(), String> {
    let conn = db::get().lock();
    core_crm::delete_template(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_export_csv(account_id: String) -> Result<String, String> {
    let conn = db::get().lock();
    let contacts = core_crm::list_contacts(&conn, &account_id).map_err(|e| e.to_string())?;
    Ok(core_crm::export_contacts_csv(&contacts))
}

/// Insert text as a draft into the active WhatsApp chat composer.
/// NEVER presses Enter or clicks Send (Blueprint §2).
#[tauri::command]
pub async fn crm_insert_draft(
    app: AppHandle,
    account_id: String,
    text: String,
) -> Result<(), String> {
    manager::insert_draft(&app, &account_id, &text).map_err(|e| e.to_string())
}

/// Notify the webview manager when the right-side CRM drawer opens or closes,
/// so the active WhatsApp webview resizes without overlapping the drawer.
#[tauri::command]
pub async fn crm_set_drawer_open(app: AppHandle, open: bool) -> Result<(), String> {
    manager::set_drawer_open(&app, open);
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagDto {
    pub id: String,
    pub name: String,
    pub color: String,
}

impl From<Tag> for TagDto {
    fn from(t: Tag) -> Self {
        Self {
            id: t.id,
            name: t.name,
            color: t.color,
        }
    }
}

#[tauri::command]
pub async fn crm_list_tags() -> Result<Vec<TagDto>, String> {
    let conn = db::get().lock();
    let list = core_crm::list_tags(&conn).map_err(|e| e.to_string())?;
    Ok(list.into_iter().map(TagDto::from).collect())
}

#[tauri::command]
pub async fn crm_upsert_tag(tag: TagDto) -> Result<TagDto, String> {
    let id = if tag.id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        tag.id
    };
    let model = Tag {
        id: id.clone(),
        name: tag.name,
        color: tag.color,
    };
    let conn = db::get().lock();
    core_crm::upsert_tag(&conn, &model).map_err(|e| e.to_string())?;
    Ok(TagDto::from(model))
}

#[tauri::command]
pub async fn crm_list_contact_tags(contact_id: String) -> Result<Vec<TagDto>, String> {
    let conn = db::get().lock();
    let list = core_crm::list_contact_tags(&conn, &contact_id).map_err(|e| e.to_string())?;
    Ok(list.into_iter().map(TagDto::from).collect())
}

#[tauri::command]
pub async fn crm_assign_tag(contact_id: String, tag_id: String) -> Result<(), String> {
    let conn = db::get().lock();
    core_crm::assign_tag(&conn, &contact_id, &tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_remove_tag(contact_id: String, tag_id: String) -> Result<(), String> {
    let conn = db::get().lock();
    core_crm::remove_tag(&conn, &contact_id, &tag_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn crm_import_csv(account_id: String, csv_text: String) -> Result<usize, String> {
    let conn = db::get().lock();
    core_crm::import_contacts_csv(&conn, &account_id, &csv_text, || {
        uuid::Uuid::new_v4().to_string()
    })
    .map_err(|e| e.to_string())
}
