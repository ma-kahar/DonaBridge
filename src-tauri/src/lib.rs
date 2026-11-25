// Dona Bridge — library root
// All Tauri setup, plugin registration, and command wiring lives here.

use tauri::Manager;
use tracing::info;

pub mod ai;
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
    // Initialise structured logging (logs/dona-bridge.log in AppData)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    info!("Dona Bridge starting up");

    tauri::Builder::default()
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
            commands::wa_extra::fetch_link_preview,
            commands::wa_extra::set_dnd_schedule,
            commands::wa_extra::clear_dnd_schedule,
            commands::wa_extra::backup_encrypted,
            commands::wa_extra::restore_encrypted,
        ])
        // ── Setup ──────────────────────────────────────────────────────────
        .setup(|app| {
            tray::setup_tray(app)?;

            // Initialise the database (migrations run automatically)
            let app_data = app
                .path()
                .app_data_dir()
                .expect("Could not resolve AppData directory");
            dona_core::db::init(&app_data)?;

            // Ensure any pending WAL frames from an unexpected shutdown/restart are flushed
            {
                let conn = dona_core::db::get().lock();
                let _ = conn
                    .execute_batch("PRAGMA synchronous = FULL; PRAGMA wal_checkpoint(TRUNCATE);");
            }

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
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::Resized(_) = event {
                    webviews::manager::resize_all_webviews(window.app_handle());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Dona Bridge");
}
