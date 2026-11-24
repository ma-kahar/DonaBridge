// commands/wa.rs
// Report-only commands called from WhatsApp webviews (wa_* label).
// These 5 commands are the ONLY ones listed in the wa-remote capability.
// Each derives the account id from the calling webview's label — never from an argument.
// (Blueprint §3 #2, #3)

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::LazyLock;
use tauri::{command, AppHandle, Emitter, Manager, Webview};

static UNREAD_COUNTS: LazyLock<Mutex<HashMap<String, u32>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
struct UnreadPayload {
    account_id: String,
    count: u32,
}

#[derive(Clone, Serialize)]
struct ShortcutPayload {
    account_id: String,
    key: String,
}

#[derive(Clone, Serialize)]
struct ChatContextPayload {
    account_id: String,
    contact: String,
    messages: Vec<String>,
}

/// WhatsApp page reports a new notification (unread message).
/// Sends a Windows native toast notification via `tauri-plugin-notification`.
/// Blueprint §8 #4: when locked, show "New message" only (no sender or text).
#[command]
pub async fn wa_notify(
    app: AppHandle,
    webview: Webview,
    title: String,
    body: String,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    let account_id = account_id_from_label(webview.label())?;
    let account = {
        let conn = dona_core::db::get().lock();
        dona_core::accounts::get_account(&conn, &account_id)
            .ok()
            .flatten()
    };

    if account.as_ref().is_some_and(|a| a.muted) {
        return Ok(());
    }

    if crate::lock::is_locked() {
        let _ = app
            .notification()
            .builder()
            .title("Dona Bridge")
            .body("New message")
            .show();
    } else {
        let account_label = account
            .map(|a| a.name)
            .unwrap_or_else(|| "Dona Bridge".into());
        let notif_title = if title.trim().is_empty() {
            account_label
        } else {
            format!("{account_label} · {title}")
        };
        let _ = app
            .notification()
            .builder()
            .title(notif_title)
            .body(body)
            .show();
    }
    Ok(())
}

/// WhatsApp page reports updated unread count (from document.title MutationObserver).
/// Blueprint §3 #14: watch document.title "(3) WhatsApp" for muted/phone-read cases.
#[command]
pub async fn wa_unread(app: AppHandle, webview: Webview, count: u32) -> Result<(), String> {
    let account_id = account_id_from_label(webview.label())?;
    tracing::debug!("wa_unread from {account_id}: {count}");
    let total: u32 = {
        let mut map = UNREAD_COUNTS.lock();
        map.insert(account_id.clone(), count);
        map.values().copied().sum()
    };

    #[cfg(target_os = "windows")]
    if let Some(win) = app.get_window("main") {
        if let Ok(hwnd) = win.hwnd() {
            crate::windows::taskbar::set_badge_for_hwnd(hwnd.0 as isize, total);
        }
    }

    let _ = app.emit_to("main", "wa:unread", UnreadPayload { account_id, count });
    Ok(())
}

/// WhatsApp page reports the account owner's avatar (downloaded once, cached locally).
/// Blueprint §3 #13: download once into local avatar cache, never use CDN URL directly.
#[command]
pub async fn wa_avatar(webview: Webview, data_url: String) -> Result<(), String> {
    let account_id = account_id_from_label(webview.label())?;
    tracing::debug!("wa_avatar from {account_id}: {} bytes", data_url.len());
    // TODO: save to avatars/{account_id}.png, store path in DB
    Ok(())
}

/// WhatsApp page reports the active chat context (only on explicit user click).
/// Blueprint §2: only on click, only open chat, last 20 messages, cleared on account switch.
#[command]
pub async fn wa_chat_context(
    app: AppHandle,
    webview: Webview,
    contact: String,
    messages: Vec<String>,
) -> Result<(), String> {
    let account_id = account_id_from_label(webview.label())?;
    // Tag event with source account (Blueprint §3 #12)
    tracing::debug!(
        "wa_chat_context from {account_id} for contact {contact}: {} msgs",
        messages.len()
    );
    let _ = app.emit_to(
        "main",
        "wa:chat-context",
        ChatContextPayload {
            account_id,
            contact,
            messages,
        },
    );
    Ok(())
}

/// WhatsApp page forwards a shortcut key the user pressed while focused inside the webview.
/// Blueprint §3 #5: inject key forwarder into each wa_* webview.
#[command]
pub async fn wa_shortcut(app: AppHandle, webview: Webview, key: String) -> Result<(), String> {
    let account_id = account_id_from_label(webview.label())?;
    tracing::debug!("wa_shortcut from {account_id}: {key}");
    let _ = app.emit_to("main", "wa:shortcut", ShortcutPayload { account_id, key });
    Ok(())
}

/// Auto-read incoming messages when chat is open.
/// Called automatically when new messages arrive in the active chat.
/// Compliance: Only marks read when chat is actively open, never in background.
#[command]
pub async fn wa_auto_read(app: AppHandle, webview: Webview) -> Result<(), String> {
    let account_id = account_id_from_label(webview.label())?;
    tracing::debug!("wa_auto_read from {account_id}");

    // Emit event to UI that new message was received and auto-read
    // UI can then trigger AI suggest reply if enabled
    let _ = app.emit_to(
        "main",
        "wa:auto-read",
        serde_json::json!({
            "account_id": account_id
        }),
    );

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Extract the account id from a webview label like "wa_abc123".
/// Never trusts an account id passed as an argument (Blueprint §8).
fn account_id_from_label(label: &str) -> Result<String, String> {
    label
        .strip_prefix("wa_")
        .map(|id| id.to_string())
        .ok_or_else(|| format!("Invalid webview label: {label}"))
}
