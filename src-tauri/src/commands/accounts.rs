// commands/accounts.rs
// IMPORTANT: Commands that create webviews MUST be async (Tauri Windows deadlock, Blueprint §3 #1)

use dona_core::{accounts as core_accounts, db, models::Account};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::AppHandle;

use crate::{lock, webviews::manager};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AccountInfo {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon_text: String,
    pub category: String,
    pub muted: bool,
    pub sort_order: i32,
    #[serde(default)]
    pub avatar_data_url: Option<String>,
    #[serde(default)]
    pub has_lock: bool,
}

impl From<Account> for AccountInfo {
    fn from(a: Account) -> Self {
        let has_lock = lock::has_account_pin(&a.id).unwrap_or(false);
        Self {
            id: a.id,
            name: a.name,
            color: a.color,
            icon_text: a.icon_text,
            category: a.category,
            muted: a.muted,
            sort_order: a.sort_order,
            avatar_data_url: a.avatar_path,
            has_lock,
        }
    }
}

/// List all accounts from the database.
#[tauri::command]
#[specta::specta]
pub async fn list_accounts(_app: AppHandle) -> Result<Vec<AccountInfo>, String> {
    let conn = db::get().lock();
    let list = core_accounts::list_accounts(&conn).map_err(|e| e.to_string())?;
    Ok(list.into_iter().map(AccountInfo::from).collect())
}

/// Pre-warm background `wa_*` webviews for all accounts so notifications & unread counts
/// arrive even for accounts not yet clicked in this session.
#[tauri::command]
pub async fn prewarm_accounts(app: AppHandle, active_id: Option<String>) -> Result<(), String> {
    let list = {
        let conn = db::get().lock();
        core_accounts::list_accounts(&conn).map_err(|e| e.to_string())?
    };
    for acc in list {
        if active_id.as_deref() == Some(acc.id.as_str()) {
            continue;
        }
        let _ =
            manager::ensure_background_webview(&app, &acc.id, &acc.profile_name, acc.zoom).await;
    }
    Ok(())
}

/// Create or update an account.
/// MUST be async — creates a WebView2 webview (sync would deadlock on Windows).
#[tauri::command]
#[specta::specta]
pub async fn upsert_account(app: AppHandle, info: AccountInfo) -> Result<AccountInfo, String> {
    let is_new = info.id.trim().is_empty();
    let id = if is_new {
        uuid::Uuid::new_v4().to_string()
    } else {
        info.id.clone()
    };

    let saved = {
        let conn = db::get().lock();
        let existing = core_accounts::get_account(&conn, &id).map_err(|e| e.to_string())?;
        let mut account = existing.unwrap_or_else(|| Account {
            id: id.clone(),
            profile_name: id.clone(),
            zoom: 1.0,
            ..Default::default()
        });
        account.name = info.name;
        account.color = info.color;
        account.icon_text = info.icon_text;
        account.category = info.category;
        account.muted = info.muted;
        account.sort_order = info.sort_order;
        if let Some(av) = info.avatar_data_url {
            account.avatar_path = if av.is_empty() { None } else { Some(av) };
        }
        core_accounts::upsert_account(&conn, &account).map_err(|e| e.to_string())?
    };

    Ok(AccountInfo::from(saved))
}

/// Delete an account.
/// Queues WebView2 data folder deletion for next start (Blueprint §3 #15).
#[tauri::command]
#[specta::specta]
pub async fn delete_account(app: AppHandle, id: String) -> Result<(), String> {
    manager::close_account_webview(&app, &id);
    let _ = lock::clear_account_pin(&id);

    let conn = db::get().lock();
    if let Some(profile_name) =
        core_accounts::delete_account(&conn, &id).map_err(|e| e.to_string())?
    {
        core_accounts::queue_profile_deletion(&conn, &profile_name).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Switch the visible WhatsApp webview to a different account.
/// MUST be async — manipulates webviews (Blueprint §3 #1).
#[tauri::command]
#[specta::specta]
pub async fn switch_account(app: AppHandle, id: String) -> Result<(), String> {
    let account = {
        let conn = db::get().lock();
        core_accounts::get_account(&conn, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Account not found: {id}"))?
    };

    manager::switch_to_account(&app, &account.id, &account.profile_name, account.zoom)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn account_set_pin(account_id: String, pin: String) -> Result<(), String> {
    lock::set_account_pin(&account_id, &pin)
}

#[tauri::command]
pub async fn account_verify_pin(account_id: String, pin: String) -> Result<bool, String> {
    lock::verify_account_pin(&account_id, &pin)
}

#[tauri::command]
pub async fn account_clear_pin(account_id: String) -> Result<(), String> {
    lock::clear_account_pin(&account_id)
}

/// Hide child `wa_*` webviews while a React modal/overlay is open, and restore the
/// active account's webview when all overlays close (native HWND sits above HTML modals).
#[tauri::command]
pub async fn set_overlay_open(
    app: AppHandle,
    open: bool,
    active_account_id: Option<String>,
) -> Result<(), String> {
    if open || lock::is_locked() {
        manager::hide_all_webviews(&app);
        return Ok(());
    }
    if let Some(id) = active_account_id {
        let account = {
            let conn = db::get().lock();
            core_accounts::get_account(&conn, &id).map_err(|e| e.to_string())?
        };
        if let Some(acc) = account {
            manager::switch_to_account(&app, &acc.id, &acc.profile_name, acc.zoom)
                .await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
