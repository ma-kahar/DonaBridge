// paths.rs - resolve where Dona Bridge keeps its local state.
//
// Everything the app owns (SQLite database, WebView2 profiles, downloads
// history, backups) lives under one directory. `DONA_DATA_DIR` can relocate
// that directory, which makes it possible to run a fully isolated second
// profile - handy for support, testing and privacy-safe demo screenshots.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// Environment variable that overrides the app data directory.
pub const DATA_DIR_ENV: &str = "DONA_DATA_DIR";

/// Base directory for all local state.
pub fn data_root(app: &AppHandle) -> tauri::Result<PathBuf> {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV) {
        if !dir.is_empty() {
            return Ok(PathBuf::from(dir));
        }
    }
    app.path().app_local_data_dir()
}
