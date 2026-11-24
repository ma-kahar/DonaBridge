// commands/security.rs — App Lock, Windows Hello, and Credential Manager commands.
// Blueprint §8: secrets never leave Rust; UI only gets `has_secret` bools.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{lock, secrets, webviews::manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LockStatus {
    pub locked: bool,
    pub has_pin: bool,
    pub hello_available: bool,
}

#[tauri::command]
pub async fn security_lock_status() -> Result<LockStatus, String> {
    let has_pin = lock::has_pin()?;
    #[cfg(target_os = "windows")]
    let hello_available = crate::windows::hello::is_available().await;
    #[cfg(not(target_os = "windows"))]
    let hello_available = false;

    Ok(LockStatus {
        locked: lock::is_locked(),
        has_pin,
        hello_available,
    })
}

#[tauri::command]
pub async fn security_set_pin(pin: String) -> Result<(), String> {
    lock::set_pin(&pin)
}

#[tauri::command]
pub async fn security_clear_pin() -> Result<(), String> {
    lock::clear_pin()
}

#[tauri::command]
pub async fn security_lock_app(app: AppHandle) -> Result<(), String> {
    lock::set_locked(true);
    manager::hide_all_webviews(&app);
    Ok(())
}

#[tauri::command]
pub async fn security_unlock_pin(pin: String) -> Result<bool, String> {
    let ok = lock::verify_pin(&pin)?;
    if ok {
        lock::set_locked(false);
    }
    Ok(ok)
}

#[tauri::command]
pub async fn security_unlock_hello() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let ok = crate::windows::hello::verify_identity("Unlock Dona Bridge")
            .await
            .map_err(|e| e.to_string())?;
        if ok {
            lock::set_locked(false);
        }
        Ok(ok)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub async fn secret_set(key_name: String, value: String) -> Result<(), String> {
    secrets::set_secret(&key_name, &value)
}

#[tauri::command]
pub async fn secret_has(key_name: String) -> Result<bool, String> {
    Ok(secrets::has_secret(&key_name))
}

#[tauri::command]
pub async fn secret_delete(key_name: String) -> Result<(), String> {
    secrets::delete_secret(&key_name)
}
