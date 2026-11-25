// webviews/manager.rs
// Manages per-account WhatsApp WebView2 child webviews.
// Each webview: label = "wa_{account_id}", data_directory = WebView2/{profile_name}, URL = web.whatsapp.com
// Blueprint §3 #1: all webview-creating operations must be async.
// Blueprint §3 #4: per-account data_directory for v1 (tauri 2.12 WebviewBuilder does not expose with_profile_name yet).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager, Position, Rect,
    Size, WebviewUrl,
};

use super::init_script;

/// Width in logical pixels reserved for the right CRM drawer when open (`w-[340px]`).
const DRAWER_WIDTH: f64 = 340.0;
/// Height of the bottom application taskbar (`h-12` = 48px).
const TASKBAR_HEIGHT: f64 = 48.0;

static DRAWER_OPEN: AtomicBool = AtomicBool::new(false);

/// Update drawer open state and resize all `wa_*` webviews accordingly.
pub fn set_drawer_open(app: &AppHandle, open: bool) {
    DRAWER_OPEN.store(open, Ordering::Relaxed);
    resize_all_webviews(app);
}

/// Compute the child webview bounds inside the main window.
fn webview_bounds(app: &AppHandle) -> tauri::Result<Rect> {
    let window = app
        .get_window("main")
        .ok_or_else(|| tauri::Error::WebviewNotFound)?;
    let scale = window.scale_factor()?;
    let physical = window.inner_size()?;
    let right_reserved = if DRAWER_OPEN.load(Ordering::Relaxed) {
        DRAWER_WIDTH
    } else {
        0.0
    };
    let logical_w = (physical.width as f64 / scale - right_reserved).max(200.0);
    let logical_h = (physical.height as f64 / scale - TASKBAR_HEIGHT).max(200.0);

    Ok(Rect {
        position: Position::Logical(LogicalPosition::new(0.0, 0.0)),
        size: Size::Logical(LogicalSize::new(logical_w, logical_h)),
    })
}

/// Directory where per-account WebView2 data folders live.
pub fn webview2_base_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_local_data_dir()?.join("WebView2"))
}

/// Delete any WebView2 profile folders queued from previous account deletions (Blueprint §3 #15).
pub fn cleanup_deleted_profiles(app: &AppHandle, profiles: &[String]) {
    let Ok(base) = webview2_base_dir(app) else {
        return;
    };
    for profile in profiles {
        let dir = base.join(profile);
        if dir.exists() {
            if let Err(err) = std::fs::remove_dir_all(&dir) {
                tracing::warn!(
                    "Could not remove old WebView2 folder {}: {err}",
                    dir.display()
                );
            } else {
                tracing::info!("Cleaned up deleted WebView2 folder {}", dir.display());
            }
        }
    }
}

/// Open (or show) the WhatsApp webview for `account_id`, hiding all other `wa_*` webviews.
/// Must be called from an async Tauri command only.
pub async fn switch_to_account(
    app: &AppHandle,
    account_id: &str,
    profile_name: &str,
    zoom: f64,
) -> tauri::Result<()> {
    let target_label = format!("wa_{account_id}");

    // Hide all other wa_* webviews
    for (label, webview) in app.webviews() {
        if label.starts_with("wa_") && label != target_label {
            let _ = webview.hide();
        }
    }

    // If webview already exists, resize and show it
    if let Some(existing) = app.get_webview(&target_label) {
        if let Ok(bounds) = webview_bounds(app) {
            let _ = existing.set_bounds(bounds);
        }
        let _ = existing.set_zoom(zoom);
        existing.show()?;
        return Ok(());
    }

    create_account_webview(app, account_id, profile_name, zoom, true).await
}

/// Pre-create a background `wa_*` webview hidden so notifications & unread counts
/// arrive even for accounts that have not been clicked yet in this session.
pub async fn ensure_background_webview(
    app: &AppHandle,
    account_id: &str,
    profile_name: &str,
    zoom: f64,
) -> tauri::Result<()> {
    let target_label = format!("wa_{account_id}");
    if app.get_webview(&target_label).is_some() {
        return Ok(());
    }
    create_account_webview(app, account_id, profile_name, zoom, false).await
}

async fn create_account_webview(
    app: &AppHandle,
    account_id: &str,
    profile_name: &str,
    zoom: f64,
    visible: bool,
) -> tauri::Result<()> {
    let target_label = format!("wa_{account_id}");

    // Create a new child webview inside the "main" window
    let window = app
        .get_window("main")
        .ok_or_else(|| tauri::Error::WebviewNotFound)?;
    let bounds = webview_bounds(app)?;
    let data_dir = webview2_base_dir(app)?.join(profile_name);
    std::fs::create_dir_all(&data_dir)?;

    let url: tauri::Url = "https://web.whatsapp.com"
        .parse()
        .expect("static WhatsApp URL must parse");

    let builder = WebviewBuilder::new(&target_label, WebviewUrl::External(url))
        .data_directory(data_dir)
        .initialization_script(init_script::build_init_script(account_id))
        .on_new_window(|_url, _features| tauri::webview::NewWindowResponse::Allow);

    let webview = match bounds.position {
        Position::Logical(pos) => match bounds.size {
            Size::Logical(size) => window.add_child(builder, pos, size)?,
            Size::Physical(size) => window.add_child(builder, pos, size)?,
        },
        Position::Physical(pos) => match bounds.size {
            Size::Logical(size) => window.add_child(builder, pos, size)?,
            Size::Physical(size) => window.add_child(builder, pos, size)?,
        },
    };

    if (zoom - 1.0).abs() > f64::EPSILON {
        let _ = webview.set_zoom(zoom);
    }
    if !visible {
        let _ = webview.hide();
    }

    // Grant Microphone, Camera, Notifications & Clipboard permissions for WhatsApp Web calls
    #[cfg(target_os = "windows")]
    {
        let _ = webview.with_webview(|platform_wv| {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
                COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ,
                COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
            };
            use webview2_com::PermissionRequestedEventHandler;
            unsafe {
                if let Ok(core) = platform_wv.controller().CoreWebView2() {
                    let mut token = 0i64;
                    let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
                        if let Some(args) = args {
                            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                            args.PermissionKind(&mut kind)?;
                            if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                                || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                                || kind == COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS
                                || kind == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ
                            {
                                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                            }
                        }
                        Ok(())
                    }));
                    let _ = core.add_PermissionRequested(&handler, &mut token);
                }
            }
        });
    }

    tracing::info!("Created webview {target_label} (profile: {profile_name})");
    Ok(())
}

/// Resize all `wa_*` child webviews when the main window resizes.
pub fn resize_all_webviews(app: &AppHandle) {
    let Ok(bounds) = webview_bounds(app) else {
        return;
    };
    for (label, webview) in app.webviews() {
        if label.starts_with("wa_") {
            let _ = webview.set_bounds(bounds);
        }
    }
}

/// Close an account's webview if currently open (folder deletion is queued for next start).
pub fn close_account_webview(app: &AppHandle, account_id: &str) {
    let label = format!("wa_{account_id}");
    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.close();
    }
}

/// Hide all `wa_*` webviews (e.g. when App Lock engages, Blueprint §8 #4).
pub fn hide_all_webviews(app: &AppHandle) {
    for (label, webview) in app.webviews() {
        if label.starts_with("wa_") {
            let _ = webview.hide();
        }
    }
}

/// Insert a draft message into the active WhatsApp chat composer for `account_id`.
/// Uses `selectors.json` (`message_input`) and `serde_json::to_string` for safe escaping.
/// NEVER presses Enter or clicks Send (Blueprint §2).
pub fn insert_draft(app: &AppHandle, account_id: &str, text: &str) -> tauri::Result<()> {
    let label = format!("wa_{account_id}");
    let webview = app
        .get_webview(&label)
        .ok_or(tauri::Error::WebviewNotFound)?;

    let selectors: serde_json::Value = serde_json::from_str(include_str!("selectors.json"))
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    let selector = selectors["message_input"]
        .as_str()
        .unwrap_or("div[data-testid='conversation-compose-box-input']");

    let selector_json =
        serde_json::to_string(selector).map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    let text_json =
        serde_json::to_string(text).map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;

    let js = format!(
        r#"
(function() {{
    const box = document.querySelector({selector_json});
    if (!box) return;
    box.focus();
    document.execCommand('insertText', false, {text_json});
}})();
"#
    );

    webview.eval(&js)
}

/// Read the open chat's title and last 20 messages on explicit user click (Blueprint §2).
/// Reports back via `wa_chat_context` so the event is tagged with the source account.
pub fn request_active_chat(app: &AppHandle, account_id: &str) -> tauri::Result<()> {
    let label = format!("wa_{account_id}");
    let webview = app
        .get_webview(&label)
        .ok_or(tauri::Error::WebviewNotFound)?;

    let selectors: serde_json::Value = serde_json::from_str(include_str!("selectors.json"))
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    let title_sel = serde_json::to_string(
        selectors["chat_title"]
            .as_str()
            .unwrap_or("header [data-testid='conversation-header'] span[dir='auto']"),
    )
    .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    let item_sel = serde_json::to_string(
        selectors["message_item"]
            .as_str()
            .unwrap_or("div.message-in, div.message-out"),
    )
    .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    let text_sel = serde_json::to_string(
        selectors["message_text"]
            .as_str()
            .unwrap_or("span.selectable-text span"),
    )
    .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;

    let js = format!(
        r#"
(function() {{
    const titleEl = document.querySelector({title_sel});
    const contact = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';
    const items = Array.from(document.querySelectorAll({item_sel})).slice(-20);
    const messages = items.map((el) => {{
        const isOut = el.classList.contains('message-out') || !!el.querySelector('.message-out');
        const dir = isOut ? 'Me' : (contact || 'Contact');
        const spans = Array.from(el.querySelectorAll({text_sel}));
        const txt = spans.map((s) => s.textContent).join(' ').trim();
        return txt ? (dir + ': ' + txt) : '';
    }}).filter(Boolean);
    window.__TAURI_INTERNALS__.invoke('wa_chat_context', {{ contact, messages }}).catch(() => {{}});
}})();
"#
    );

    webview.eval(&js)
}

/// Insert a draft only if the currently open chat's title matches `expected_contact`
/// (Blueprint §3 #10: prevent MCP agent from drafting into the wrong customer's chat).
pub fn insert_draft_checked(
    app: &AppHandle,
    account_id: &str,
    expected_contact: &str,
    text: &str,
) -> tauri::Result<()> {
    let label = format!("wa_{account_id}");
    let webview = app
        .get_webview(&label)
        .ok_or(tauri::Error::WebviewNotFound)?;

    let selectors: serde_json::Value = serde_json::from_str(include_str!("selectors.json"))
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    let title_sel = serde_json::to_string(
        selectors["chat_title"]
            .as_str()
            .unwrap_or("header [data-testid='conversation-header'] span[dir='auto']"),
    )
    .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    let input_sel = serde_json::to_string(
        selectors["message_input"]
            .as_str()
            .unwrap_or("div[data-testid='conversation-compose-box-input']"),
    )
    .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;

    let expected_json = serde_json::to_string(expected_contact)
        .map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;
    let text_json =
        serde_json::to_string(text).map_err(|e| tauri::Error::Io(std::io::Error::other(e)))?;

    let js = format!(
        r#"
(function() {{
    const titleEl = document.querySelector({title_sel});
    const current = titleEl ? titleEl.textContent.trim().toLowerCase() : '';
    const expected = {expected_json}.trim().toLowerCase();
    if (!current || !expected || !current.includes(expected)) return;
    const box = document.querySelector({input_sel});
    if (!box) return;
    box.focus();
    document.execCommand('insertText', false, {text_json});
}})();
"#
    );

    webview.eval(&js)
}
