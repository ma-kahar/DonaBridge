// secrets.rs — Windows Credential Manager storage via `keyring`.
// Blueprint §8 #3: API keys, MCP token and backup key live in Windows Credential Manager.
// The React UI only ever sees whether a key is saved (bool) — never the secret itself.

use keyring::Entry;

const SERVICE: &str = "dona-bridge";

pub fn set_secret(key_name: &str, value: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, key_name).map_err(|e| e.to_string())?;
    if value.trim().is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

pub fn get_secret(key_name: &str) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, key_name).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pw) => Ok(Some(pw)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn has_secret(key_name: &str) -> bool {
    matches!(get_secret(key_name), Ok(Some(v)) if !v.is_empty())
}

pub fn delete_secret(key_name: &str) -> Result<(), String> {
    let entry = Entry::new(SERVICE, key_name).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
