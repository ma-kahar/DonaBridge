// Dona Bridge — App Lock (Global Argon2 PIN + Per-Account Argon2 PIN + Windows Hello)
// Blueprint §7 & §8 #4:
//   • PINs are stored only as Argon2 hashes in SQLite `settings`.
//   • When locked, Rust hides every wa_* webview; notifications show "New message" only.

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use dona_core::db;
use parking_lot::Mutex;
use std::collections::HashSet;

const PIN_SETTING_KEY: &str = "app_lock_pin_hash";
/// Settings key prefix used for per-account PIN hashes:
/// `account_lock_pin_{account_id}`.
const ACCOUNT_PIN_PREFIX: &str = "account_lock_pin_";

#[derive(Default)]
pub struct LockState {
    pub locked: bool,
}

pub static LOCK_STATE: Mutex<LockState> = Mutex::new(LockState { locked: false });

pub fn is_locked() -> bool {
    LOCK_STATE.lock().locked
}

pub fn set_locked(locked: bool) {
    LOCK_STATE.lock().locked = locked;
}

fn account_pin_key(account_id: &str) -> String {
    format!("{ACCOUNT_PIN_PREFIX}{account_id}")
}

pub fn has_pin() -> Result<bool, String> {
    has_pin_for_key(PIN_SETTING_KEY)
}

pub fn set_pin(pin: &str) -> Result<(), String> {
    set_pin_for_key(PIN_SETTING_KEY, pin)
}

pub fn verify_pin(pin: &str) -> Result<bool, String> {
    verify_pin_for_key(PIN_SETTING_KEY, pin)
}

pub fn clear_pin() -> Result<(), String> {
    clear_pin_for_key(PIN_SETTING_KEY)?;
    set_locked(false);
    Ok(())
}

pub fn has_account_pin(account_id: &str) -> Result<bool, String> {
    let conn = db::get().lock();
    account_has_pin(&conn, account_id)
}

/// Like [`has_account_pin`] but reuses an existing connection.
///
/// IMPORTANT: never call `db::get().lock()` while already holding a database
/// guard on the same thread — `parking_lot::Mutex` is not re-entrant and that
/// deadlocks the whole app (this is exactly what made saved accounts disappear
/// on startup). Pass the guard's connection here instead.
pub fn account_has_pin(conn: &rusqlite::Connection, account_id: &str) -> Result<bool, String> {
    let value = db::get_setting(conn, &account_pin_key(account_id)).map_err(|e| e.to_string())?;
    Ok(value.is_some_and(|s| !s.is_empty() && s != "null"))
}

/// All account ids that currently have a PIN set, read with an existing
/// connection. Used by `list_accounts` so the whole list can be built while
/// holding the database guard exactly once.
pub fn locked_account_ids(conn: &rusqlite::Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("SELECT key FROM settings WHERE key LIKE 'account_lock_pin_%'")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut ids = HashSet::new();
    for row in rows {
        let key = row.map_err(|e| e.to_string())?;
        if let Some(id) = key.strip_prefix(ACCOUNT_PIN_PREFIX) {
            if !id.is_empty() {
                ids.insert(id.to_string());
            }
        }
    }
    Ok(ids)
}

pub fn set_account_pin(account_id: &str, pin: &str) -> Result<(), String> {
    set_pin_for_key(&account_pin_key(account_id), pin)
}

pub fn verify_account_pin(account_id: &str, pin: &str) -> Result<bool, String> {
    verify_pin_for_key(&account_pin_key(account_id), pin)
}

pub fn clear_account_pin(account_id: &str) -> Result<(), String> {
    clear_pin_for_key(&account_pin_key(account_id))
}

fn has_pin_for_key(key: &str) -> Result<bool, String> {
    let conn = db::get().lock();
    let val = db::get_setting(&conn, key).map_err(|e| e.to_string())?;
    Ok(val.is_some_and(|s| !s.is_empty() && s != "null"))
}

fn set_pin_for_key(key: &str, pin: &str) -> Result<(), String> {
    if pin.trim().len() < 4 {
        return Err("PIN must be at least 4 characters".into());
    }
    let salt =
        SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes()).map_err(|e| e.to_string())?;
    let hash = Argon2::default()
        .hash_password(pin.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    let conn = db::get().lock();
    db::set_setting(&conn, key, &hash).map_err(|e| e.to_string())?;
    Ok(())
}

fn verify_pin_for_key(key: &str, pin: &str) -> Result<bool, String> {
    let conn = db::get().lock();
    let hash_str = db::get_setting(&conn, key).map_err(|e| e.to_string())?;

    let Some(hash_str) = hash_str else {
        return Ok(false);
    };
    let parsed = PasswordHash::new(&hash_str).map_err(|e| e.to_string())?;
    Ok(Argon2::default()
        .verify_password(pin.as_bytes(), &parsed)
        .is_ok())
}

fn clear_pin_for_key(key: &str) -> Result<(), String> {
    let conn = db::get().lock();
    db::delete_setting(&conn, key).map_err(|e| e.to_string())?;
    Ok(())
}
