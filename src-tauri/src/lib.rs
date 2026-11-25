// Dona Bridge — library root
// All Tauri setup, plugin registration, and command wiring lives here.

use tauri::Manager;
use tracing::info;

pub mod ai;
pub mod backup;
pub mod commands;
pub mod lock;
pub mod mcp;
pub mod secrets;
pub mod tray;
pub mod webviews;

#[cfg(target_os = "windows")]
pub mod windows;

/// Application entry point called from main.rs.
pub fn run() {
    init_logging();

    info!("Dona Bridge starting up");

    let app = tauri::Builder::default()
        // ── Plugins ────────────────────────────────────────────────────────
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: focus the existing window instead of opening another
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // ── Commands ───────────────────────────────────────────────────────
        .invoke_handler(tauri::generate_handler![
            commands::accounts::list_accounts,
            commands::accounts::prewarm_accounts,
            commands::accounts::upsert_account,
            commands::accounts::delete_account,
            commands::accounts::switch_account,
            commands::accounts::account_set_pin,
            commands::accounts::account_verify_pin,
            commands::accounts::account_clear_pin,
            commands::accounts::set_overlay_open,
            commands::accounts::list_account_groups,
            commands::accounts::upsert_account_group,
            commands::accounts::delete_account_group,
            commands::accounts::reorder_accounts,
            commands::crm::crm_list_contacts,
            commands::crm::crm_upsert_contact,
            commands::crm::crm_delete_contact,
            commands::crm::crm_list_notes,
            commands::crm::crm_add_note,
            commands::crm::crm_list_reminders,
            commands::crm::crm_upsert_reminder,
            commands::crm::crm_list_templates,
            commands::crm::crm_upsert_template,
            commands::crm::crm_delete_template,
            commands::crm::crm_export_csv,
            commands::crm::crm_insert_draft,
            commands::crm::crm_open_chat,
            commands::crm::crm_set_drawer_open,
            commands::crm::crm_list_tags,
            commands::crm::crm_upsert_tag,
            commands::crm::crm_list_contact_tags,
            commands::crm::crm_assign_tag,
            commands::crm::crm_remove_tag,
            commands::crm::crm_import_csv,
            commands::security::security_lock_status,
            commands::security::security_set_pin,
            commands::security::security_clear_pin,
            commands::security::security_lock_app,
            commands::security::security_unlock_pin,
            commands::security::security_unlock_hello,
            commands::security::secret_set,
            commands::security::secret_has,
            commands::security::secret_delete,
            commands::ai::ai_get_config,
            commands::ai::ai_save_config,
            commands::ai::ai_list_profiles,
            commands::ai::ai_upsert_profile,
            commands::ai::ai_set_active_profile,
            commands::ai::ai_delete_profile,
            commands::ai::ai_detect_models,
            commands::ai::ai_read_active_chat,
            commands::ai::ai_suggest_reply,
            commands::mcp::mcp_status,
            commands::mcp::mcp_start,
            commands::mcp::mcp_stop,
            commands::mcp::mcp_rotate_token,
            commands::wa::wa_notify,
            commands::wa::wa_unread,
            commands::wa::wa_avatar,
            commands::wa::wa_chat_context,
            commands::wa::wa_shortcut,
            commands::wa::wa_auto_read,
            commands::wa::wa_session_state,
            commands::wa_extra::fetch_link_preview,
            commands::wa_extra::set_dnd_schedule,
            commands::wa_extra::clear_dnd_schedule,
            commands::data::backup_encrypted,
            commands::data::restore_encrypted,
            commands::data::app_health,
        ])
        // ── Setup ──────────────────────────────────────────────────────────
        .setup(|app| {
            tray::setup_tray(app)?;

            // Initialise the database (migrations run automatically).
            // Local AppData is used on purpose: the WebView2 profiles live
            // there too, and Roaming AppData may be synced by OneDrive —
            // SQLite + a syncing folder is a classic way to "lose" accounts.
            let local_data = app
                .path()
                .app_local_data_dir()
                .expect("Could not resolve LocalAppData directory");
            let legacy_data = app.path().app_data_dir().ok();
            dona_core::db::init_with_legacy(&local_data, legacy_data.as_deref())?;

            // Ensure any pending WAL frames from an unexpected shutdown/restart are flushed
            dona_core::db::checkpoint();

            // Clean up any WebView2 folders queued from deleted accounts (Blueprint §3 #15)
            let pending_deletes = {
                let conn = dona_core::db::get().lock();
                dona_core::accounts::take_pending_profile_deletions(&conn).unwrap_or_default()
            };
            webviews::manager::cleanup_deleted_profiles(app.handle(), &pending_deletes);

            // Engage App Lock on start if a PIN is configured (Blueprint §8 #4)
            if lock::has_pin().unwrap_or(false) {
                lock::set_locked(true);
            }

            // Spawn 30s background timer for due CRM follow-up reminders
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_notification::NotificationExt;
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
                loop {
                    interval.tick().await;
                    // Use try_lock() so the background timer never blocks Tauri commands
                    // that are concurrently trying to acquire the same DB mutex.
                    let due = {
                        match dona_core::db::get().try_lock() {
                            Some(conn) => dona_core::crm::due_reminders(&conn, chrono::Utc::now())
                                .unwrap_or_default(),
                            None => continue, // DB busy — skip this tick, try again in 30s
                        }
                    };
                    for mut rem in due {
                        let body = rem
                            .note
                            .clone()
                            .unwrap_or_else(|| "Follow-up due".to_string());
                        let _ = app_handle
                            .notification()
                            .builder()
                            .title("Dona Bridge · Reminder")
                            .body(body)
                            .show();
                        rem.status = "notified".to_string();
                        // Also use try_lock here — skip update if DB is momentarily busy
                        if let Some(conn) = dona_core::db::get().try_lock() {
                            let _ = dona_core::crm::upsert_reminder(&conn, &rem);
                        }
                    }
                }
            });

            info!("Setup complete");

            // The window is created hidden (see tauri.conf.json). Autostart
            // passes `--minimized`, so a login launch stays in the tray while
            // a manual launch shows the window immediately.
            let start_minimized = std::env::args().any(|arg| arg == "--minimized");
            if let Some(window) = app.get_webview_window("main") {
                if start_minimized {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::Resized(_) => {
                        webviews::manager::resize_all_webviews(window.app_handle());
                    }
                    tauri::WindowEvent::Destroyed => {
                        // Last chance to flush the WAL before the process exits.
                        dona_core::db::checkpoint();
                    }
                    _ => {}
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Dona Bridge");

    app.run(|_app, event| {
        if let tauri::RunEvent::Exit = event {
            dona_core::db::checkpoint();
            info!("Dona Bridge exited cleanly");
        }
    });
}

/// Initialise structured logging to stdout **and** to a rotating log file.
///
/// The file matters: without it a release build has no diagnostics at all,
/// which is why "accounts disappeared after a reboot" was so hard to trace.
fn init_logging() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let log_dir = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("com.makahar.donabridge")
        .join("logs");

    if let Err(err) = std::fs::create_dir_all(&log_dir) {
        tracing_subscriber::registry()
            .with(filter)
            .with(fmt::layer())
            .init();
        eprintln!(
            "Could not create log directory {}: {err}",
            log_dir.display()
        );
        return;
    }

    let file_appender = tracing_appender::rolling::daily(&log_dir, "dona-bridge.log");
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    // Keep the worker guard alive for the whole process lifetime.
    Box::leak(Box::new(guard));

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer())
        .with(fmt::layer().with_writer(file_writer).with_ansi(false))
        .init();
}
