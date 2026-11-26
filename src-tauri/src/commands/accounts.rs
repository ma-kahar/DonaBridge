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
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AccountGroupInfo {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
}

impl From<dona_core::models::AccountGroup> for AccountGroupInfo {
    fn from(g: dona_core::models::AccountGroup) -> Self {
        Self {
            id: g.id,
            name: g.name,
            color: g.color,
            sort_order: g.sort_order,
        }
    }
}

impl AccountInfo {
    /// Build the IPC DTO from a stored account.
    ///
    /// `has_lock` is passed in (instead of being looked up here) because this
    /// is called while a database guard may still be alive. Locking `db::get()`
    /// twice on one thread deadlocks, which used to freeze `list_accounts`
    /// forever and made every saved account disappear after a restart.
    pub fn from_account(a: Account, has_lock: bool) -> Self {
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
            group_id: a.group_id,
        }
    }
}

/// List all accounts from the database.
#[tauri::command]
#[specta::specta]
pub async fn list_accounts(_app: AppHandle) -> Result<Vec<AccountInfo>, String> {
    load_account_infos().await
}

/// Read every account and attach its lock state.
///
/// Split out from the Tauri command so it can be covered by a regression test:
/// this specific query used to call `db::get().lock()` a second time from the
/// same thread while building `AccountInfo`, which deadlocked the account list
/// forever (and made all saved accounts "disappear" after a restart).
async fn load_account_infos() -> Result<Vec<AccountInfo>, String> {
    // Run blocking DB work on the blocking thread pool so the async runtime is not starved.
    // The guard is dropped inside the closure — the DTOs are assembled afterwards.
    let (list, locked) = tokio::task::spawn_blocking(|| {
        let conn = db::get().lock();
        let list = core_accounts::list_accounts(&conn).map_err(|e| e.to_string())?;
        let locked = lock::locked_account_ids(&conn)?;
        Ok::<_, String>((list, locked))
    })
    .await
    .map_err(|e| e.to_string())??;

    tracing::info!("Loaded {} account(s) from the database", list.len());
    Ok(list
        .into_iter()
        .map(|a| {
            let has_lock = locked.contains(&a.id);
            AccountInfo::from_account(a, has_lock)
        })
        .collect())
}

/// Pre-warm background `wa_*` webviews for all accounts so notifications & unread counts
/// arrive even for accounts not yet clicked in this session.
#[tauri::command]
pub async fn prewarm_accounts(app: AppHandle, active_id: Option<String>) -> Result<(), String> {
    let list = tokio::task::spawn_blocking(|| {
        let conn = db::get().lock();
        let list = core_accounts::list_accounts(&conn).map_err(|e| e.to_string())?;
        let locked = lock::locked_account_ids(&conn)?;
        Ok::<_, String>((list, locked))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (list, locked) = list;

    // Create at most one webview every 1200 ms. Booting every account webview
    // at once after login is a CPU/RAM spike and can stall the whole app.
    let mut started = 0usize;
    for acc in list {
        // Never pre-warm a locked account: its messages must not load until
        // the user actually unlocks it.
        if locked.contains(&acc.id) {
            continue;
        }
        if active_id.as_deref() == Some(acc.id.as_str()) {
            continue;
        }
        if started > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
        }
        started += 1;
        let _ =
            manager::ensure_background_webview(&app, &acc.id, &acc.profile_name, acc.zoom).await;
    }
    Ok(())
}

/// Create or update an account.
/// MUST be async — creates a WebView2 webview (sync would deadlock on Windows).
#[tauri::command]
#[specta::specta]
pub async fn upsert_account(_app: AppHandle, info: AccountInfo) -> Result<AccountInfo, String> {
    let is_new = info.id.trim().is_empty();
    let id = if is_new {
        uuid::Uuid::new_v4().to_string()
    } else {
        info.id.clone()
    };

    // Run blocking DB work on a dedicated blocking thread so the async runtime is not starved.
    // parking_lot::Mutex::lock() blocks the calling OS thread; inside spawn_blocking that is safe.
    let id_clone = id.clone();
    let (saved, has_lock) = tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        let existing = core_accounts::get_account(&conn, &id_clone).map_err(|e| e.to_string())?;
        let mut account = existing.unwrap_or_else(|| Account {
            id: id_clone.clone(),
            profile_name: id_clone.clone(),
            zoom: 1.0,
            ..Default::default()
        });
        account.name = info.name;
        account.color = info.color;
        account.icon_text = info.icon_text;
        account.category = info.category;
        account.muted = info.muted;
        account.sort_order = info.sort_order;
        account.group_id = info.group_id;
        if let Some(av) = info.avatar_data_url {
            // An empty string means "remove the avatar" — storing `Some("")`
            // left a broken <img> behind.
            account.avatar_path = if av.trim().is_empty() { None } else { Some(av) };
        }
        let saved = core_accounts::upsert_account(&conn, &account).map_err(|e| e.to_string())?;
        let has_lock = lock::account_has_pin(&conn, &saved.id)?;
        Ok::<_, String>((saved, has_lock))
    })
    .await
    .map_err(|e| e.to_string())??;

    tracing::info!(
        "Saved account {} ({}) — persisted to the database",
        saved.name,
        saved.id
    );
    Ok(AccountInfo::from_account(saved, has_lock))
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
    // Keep the native child webviews in sync from the Rust side: a webview that
    // is created or switched while a modal is open must stay hidden.
    tracing::debug!("set_overlay_open: open={open}");
    manager::set_overlay_state(&app, open);
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

/// List all account groups.
#[tauri::command]
pub async fn list_account_groups() -> Result<Vec<AccountGroupInfo>, String> {
    tokio::task::spawn_blocking(|| {
        let conn = db::get().lock();
        let groups = dona_core::accounts::list_groups(&conn).map_err(|e| e.to_string())?;
        Ok::<_, String>(groups.into_iter().map(AccountGroupInfo::from).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Create (empty id) or update an account group.
#[tauri::command]
pub async fn upsert_account_group(mut group: AccountGroupInfo) -> Result<AccountGroupInfo, String> {
    if group.id.trim().is_empty() {
        group.id = uuid::Uuid::new_v4().to_string();
    }
    if group.name.trim().is_empty() {
        return Err("Group name must not be empty".into());
    }

    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        let saved = dona_core::models::AccountGroup {
            id: group.id,
            name: group.name,
            color: group.color,
            sort_order: group.sort_order,
        };
        let saved = dona_core::accounts::upsert_group(&conn, &saved).map_err(|e| e.to_string())?;
        Ok::<_, String>(AccountGroupInfo::from(saved))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Delete an account group (its accounts are kept and become ungrouped).
#[tauri::command]
pub async fn delete_account_group(id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        dona_core::accounts::delete_group(&conn, &id).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Persist a new account order (`ids` is the complete, ordered account list).
#[tauri::command]
pub async fn reorder_accounts(ids: Vec<String>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let conn = db::get().lock();
        dona_core::accounts::reorder_accounts(&conn, &ids).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use dona_core::models::Account;
    use std::time::Duration;

    /// Regression test for the "all accounts disappeared after restart" bug.
    ///
    /// `load_account_infos` used to build `AccountInfo` while still holding the
    /// database guard, and building an `AccountInfo` locked the database again
    /// to look up the per-account PIN. `parking_lot::Mutex` is not re-entrant,
    /// so the very first account made this future hang forever. A timeout makes
    /// that failure mode explicit instead of freezing the test suite.
    #[test]
    fn listing_accounts_with_a_pin_does_not_deadlock() {
        let dir = std::env::temp_dir().join(format!("dona-test-{}", uuid::Uuid::new_v4()));
        dona_core::db::init(&dir).expect("init test db");

        {
            let conn = dona_core::db::get().lock();

            for (id, name) in [("acc_a", "Alpha"), ("acc_b", "Beta")] {
                let account = Account {
                    id: id.into(),
                    name: name.into(),
                    profile_name: id.into(),
                    zoom: 1.0,
                    ..Default::default()
                };
                dona_core::accounts::upsert_account(&conn, &account).expect("insert account");
            }

            // Give the second account a PIN so the old code path re-locked the
            // database while building the account list.
            dona_core::db::set_setting(&conn, "account_lock_pin_acc_b", "test-hash")
                .expect("set pin");
        }

        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("runtime");
            let result = rt.block_on(load_account_infos());
            let _ = tx.send(result);
        });

        let result = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("load_account_infos deadlocked (database mutex was locked twice)");
        let list = result.expect("load accounts");
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|a| a.id == "acc_b" && a.has_lock));
        assert!(list.iter().any(|a| a.id == "acc_a" && !a.has_lock));
    }
}
