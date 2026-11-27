// Dona Bridge — library root
// All Tauri setup, plugin registration, and command wiring lives here.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::Manager;
use tracing::info;

pub mod ai;
pub mod backup;
pub mod commands;
pub mod downloads;
pub mod local_api;
pub mod lock;
pub mod mcp;
pub mod mic;
pub mod paths;
pub mod secrets;
pub mod tray;
pub mod webdav;
pub mod webhooks;
pub mod webviews;

#[cfg(target_os = "windows")]
pub mod windows;

/// Log directory resolved during startup; also used by the panic hook.
static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
/// Set once Tauri setup finished, so background-thread panics later do not
/// pop up the fatal-startup dialog.
static STARTUP_COMPLETE: AtomicBool = AtomicBool::new(false);

fn default_log_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("com.makahar.donabridge")
        .join("logs")
}

/// Application entry point called from main.rs.
pub fn run() {
    init_logging();
    install_panic_hook();

    info!("Dona Bridge starting up");

    let app = tauri::Builder::default()
        // Media permissions (microphone for voice messages, camera) are granted
        // without an invisible WebView2 prompt that the user can never answer.
        // Child WhatsApp webviews also set this at build time; this covers the
        // React shell and any webview created later.
        .on_permission_request(|_webview, kind| webviews::manager::permission_response(kind))
        // ── Plugins ────────────────────────────────────────────────────────
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: focus the existing window instead of opening another
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        // Keep size, position and maximized state across launches, but never
        // restore `decorations`: the app uses its own frameless title bar and an
        // old saved state would bring the native caption back.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
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
            commands::crm::crm_export_json,
            commands::crm::crm_import_json,
            commands::crm::crm_has_data,
            commands::crm::crm_export_deals_csv,
            commands::crm::crm_export_tasks_csv,
            commands::crm::crm_insert_draft,
            commands::crm::crm_open_chat,
            commands::crm::crm_set_drawer_open,
            commands::crm::crm_list_tags,
            commands::crm::crm_upsert_tag,
            commands::crm::crm_list_contact_tags,
            commands::crm::crm_assign_tag,
            commands::crm::crm_remove_tag,
            commands::crm::crm_import_csv,
            commands::crm_ext::crm_list_pipelines,
            commands::crm_ext::crm_upsert_pipeline,
            commands::crm_ext::crm_delete_pipeline,
            commands::crm_ext::crm_upsert_stage,
            commands::crm_ext::crm_delete_stage,
            commands::crm_ext::crm_list_deals,
            commands::crm_ext::crm_upsert_deal,
            commands::crm_ext::crm_move_deal,
            commands::crm_ext::crm_delete_deal,
            commands::crm_ext::crm_list_custom_fields,
            commands::crm_ext::crm_upsert_custom_field,
            commands::crm_ext::crm_delete_custom_field,
            commands::crm_ext::crm_get_contact_fields,
            commands::crm_ext::crm_set_contact_field,
            commands::crm_ext::crm_list_tasks,
            commands::crm_ext::crm_upsert_task,
            commands::crm_ext::crm_delete_task,
            commands::crm_ext::crm_contact_timeline,
            commands::crm_ext::crm_report,
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
            commands::data::create_snapshot,
            commands::data::restore_snapshot,
            commands::data::export_diagnostics,
            commands::data::auto_backup_settings,
            commands::data::save_auto_backup_settings,
            commands::data::create_auto_backup_now,
            commands::data::backup_recovery_code,
            commands::data::set_backup_recovery_code,
            commands::webhooks::webhook_settings,
            commands::webhooks::save_webhook_settings,
            commands::webhooks::webhook_secret,
            commands::webhooks::rotate_webhook_secret,
            commands::webhooks::test_webhook,
            commands::webdav::webdav_settings,
            commands::webdav::save_webdav_settings,
            commands::webdav::webdav_test,
            commands::webdav::webdav_upload_now,
            commands::downloads::downloads_list,
            commands::downloads::downloads_folder,
            commands::downloads::download_open,
            commands::downloads::download_reveal,
            commands::downloads::download_remove,
            commands::downloads::downloads_clear,
            commands::local_api::api_settings,
            commands::local_api::save_api_settings,
            commands::local_api::api_token,
            commands::local_api::rotate_api_token,
            mic::mic_permission,
            mic::mic_start,
            mic::mic_stop,
        ])
        // ── Setup ──────────────────────────────────────────────────────────
        .setup(|app| {
            tray::setup_tray(app)?;

            // Initialise the database (migrations run automatically).
            // Local AppData is used on purpose: the WebView2 profiles live
            // there too, and Roaming AppData may be synced by OneDrive —
            // SQLite + a syncing folder is a classic way to "lose" accounts.
            // `DONA_DATA_DIR` can relocate everything for an isolated profile.
            let local_data =
                paths::data_root(app.handle()).expect("Could not resolve LocalAppData directory");
            let legacy_data = app.path().app_data_dir().ok();
            dona_core::db::init_with_legacy(&local_data, legacy_data.as_deref())?;

            // Ensure any pending WAL frames from an unexpected shutdown/restart are flushed
            dona_core::db::checkpoint();

            // Take an automatic safety snapshot if the newest one is stale.
            dona_core::db::auto_snapshot_if_due();

            // Encrypted folder backup, if enabled and due.
            let _ = backup::auto_backup_if_due(app.handle());

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
                    // Keep the automatic snapshot fresh while the app is open.
                    dona_core::db::auto_snapshot_if_due();
                    // Encrypted folder backup (checks its own interval). Run on
                    // the blocking pool so encryption never stalls the runtime.
                    let backup_handle = app_handle.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let _ = crate::backup::auto_backup_if_due(&backup_handle);
                    });
                    // WebDAV upload (checks its own interval and never overlaps).
                    let webdav_handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(err) = crate::webdav::auto_upload_if_due(webdav_handle).await {
                            tracing::warn!("Automatic WebDAV backup failed: {err}");
                        }
                    });
                    // Use try_lock() so the background timer never blocks Tauri commands
                    // that are concurrently trying to acquire the same DB mutex.
                    let (due, due_tasks) = {
                        match dona_core::db::get().try_lock() {
                            Some(conn) => (
                                dona_core::crm::due_reminders(&conn, chrono::Utc::now())
                                    .unwrap_or_default(),
                                dona_core::crm_ext::due_tasks(&conn, chrono::Utc::now())
                                    .unwrap_or_default(),
                            ),
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
                    for task in due_tasks {
                        let _ = app_handle
                            .notification()
                            .builder()
                            .title("Dona Bridge · Task due")
                            .body(task.title.clone())
                            .show();
                        if let Some(conn) = dona_core::db::get().try_lock() {
                            let _ = dona_core::crm_ext::mark_task_notified(&conn, &task.id);
                        }
                    }
                }
            });

            // Read-only local API (disabled by default).
            match local_api::start() {
                Ok(settings) if settings.running => {
                    info!("Local API listening on 127.0.0.1:{}", settings.port);
                }
                Ok(_) => {}
                Err(err) => tracing::warn!("Local API could not start: {err}"),
            }

            info!("Setup complete");

            // The window is created hidden (see tauri.conf.json). Autostart
            // passes `--minimized`, so a login launch stays in the tray while
            // a manual launch shows the window immediately.
            let start_minimized = std::env::args().any(|arg| arg == "--minimized");
            if let Some(window) = app.get_webview_window("main") {
                if start_minimized {
                    let _ = window.hide();
                } else {
                    // The window-state plugin may maximise/hide the window
                    // before this hook runs; `show()` alone leaves it minimised.
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            } else {
                tracing::error!("Main window was not created");
            }

            STARTUP_COMPLETE.store(true, Ordering::SeqCst);
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

    app.run(|app, event| {
        if let tauri::RunEvent::Exit = event {
            // Close the local API listener before the process goes away.
            crate::local_api::stop();
            // Encrypted folder backup (if enabled and due) before we close.
            let _ = crate::backup::auto_backup_if_due(app);
            // Final automatic snapshot + clear the crash marker.
            dona_core::db::end_session();
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

    let log_dir = default_log_dir();
    let _ = LOG_DIR.set(log_dir.clone());

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

/// Turn a startup panic into something the user can actually see.
///
/// In a release build stderr goes nowhere, so a failure while building the app
/// looked exactly like “clicking the icon does nothing”. Every panic is written
/// to `logs/crash.log`; panics before setup completes also show a native dialog.
fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info.to_string();
        let dir = LOG_DIR.get().cloned().unwrap_or_else(default_log_dir);
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("crash.log");
        let line = format!(
            "[{}] {message}\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        );
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            use std::io::Write;
            let _ = file.write_all(line.as_bytes());
        }

        if !STARTUP_COMPLETE.load(Ordering::SeqCst) {
            show_fatal_dialog(&format!(
                "Dona Bridge could not start.\n\n{message}\n\nDetails were saved to:\n{}",
                path.display()
            ));
        }

        default_hook(info);
    }));
}

#[cfg(target_os = "windows")]
fn show_fatal_dialog(message: &str) {
    use ::windows::core::HSTRING;
    use ::windows::Win32::Foundation::HWND;
    use ::windows::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND, MB_TOPMOST,
    };

    let text = HSTRING::from(message);
    let caption = HSTRING::from("Dona Bridge");
    unsafe {
        MessageBoxW(
            HWND(std::ptr::null_mut()),
            &text,
            &caption,
            MB_OK | MB_ICONERROR | MB_TOPMOST | MB_SETFOREGROUND,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn show_fatal_dialog(message: &str) {
    eprintln!("{message}");
}
