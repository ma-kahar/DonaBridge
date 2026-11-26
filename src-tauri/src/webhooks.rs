// webhooks.rs — outbound, HMAC-signed CRM events.
//
// Design notes:
// - Delivery never blocks or fails a CRM mutation: `emit` spawns a task and all
//   errors are logged/recorded.
// - The signing secret lives in Windows Credential Manager and is only shown
//   when the user explicitly reveals it.
// - The signature covers `timestamp.body` so a receiver can reject replays.
// - Only HTTPS/HTTP URLs are accepted; nothing is sent unless the user enables
//   webhooks and picks the event.

use std::time::Duration;

use crate::secrets;
use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const SECRET_KEY: &str = "webhook/signing-secret";
const SETTING_ENABLED: &str = "webhook_enabled";
const SETTING_URL: &str = "webhook_url";
const SETTING_EVENTS: &str = "webhook_events";
const SETTING_LAST_AT: &str = "webhook_last_at";
const SETTING_LAST_STATUS: &str = "webhook_last_status";
const SETTING_LAST_ERROR: &str = "webhook_last_error";

pub const EVENTS: &[&str] = &[
    "contact.created",
    "contact.updated",
    "contact.deleted",
    "deal.created",
    "deal.updated",
    "deal.deleted",
    "task.created",
    "task.updated",
    "task.deleted",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookSettings {
    pub enabled: bool,
    pub url: String,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub has_secret: bool,
    #[serde(default)]
    pub last_at: Option<String>,
    #[serde(default)]
    pub last_status: Option<String>,
    #[serde(default)]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WebhookTestResult {
    pub ok: bool,
    pub status: Option<u16>,
    pub response: String,
    pub error: Option<String>,
}

fn read_settings(conn: &rusqlite::Connection) -> WebhookSettings {
    let events = dona_core::db::get_setting(conn, SETTING_EVENTS)
        .ok()
        .flatten()
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|events| !events.is_empty())
        .unwrap_or_else(|| EVENTS.iter().map(ToString::to_string).collect());

    WebhookSettings {
        enabled: dona_core::db::get_setting(conn, SETTING_ENABLED)
            .ok()
            .flatten()
            .as_deref()
            == Some("1"),
        url: dona_core::db::get_setting(conn, SETTING_URL)
            .ok()
            .flatten()
            .unwrap_or_default(),
        events,
        has_secret: secrets::has_secret(SECRET_KEY),
        last_at: dona_core::db::get_setting(conn, SETTING_LAST_AT)
            .ok()
            .flatten()
            .filter(|value| !value.is_empty()),
        last_status: dona_core::db::get_setting(conn, SETTING_LAST_STATUS)
            .ok()
            .flatten()
            .filter(|value| !value.is_empty()),
        last_error: dona_core::db::get_setting(conn, SETTING_LAST_ERROR)
            .ok()
            .flatten()
            .filter(|value| !value.is_empty()),
    }
}

pub fn settings() -> Result<WebhookSettings, String> {
    let conn = dona_core::db::get().lock();
    Ok(read_settings(&conn))
}

fn validate_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() {
        return Err("Enter the HTTPS URL of your endpoint".into());
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| "That URL is not valid".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http:// and https:// endpoints are supported".into());
    }
    if parsed.host_str().unwrap_or_default().is_empty() {
        return Err("The URL needs a host name".into());
    }
    Ok(url.to_string())
}

fn new_secret() -> String {
    // Two v4 UUIDs give 256 bits of entropy without another dependency.
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn ensure_secret() -> Result<String, String> {
    if let Some(secret) = secrets::get_secret(SECRET_KEY)? {
        if secret.len() >= 16 {
            return Ok(secret);
        }
    }
    let secret = new_secret();
    secrets::set_secret(SECRET_KEY, &secret)?;
    Ok(secret)
}

pub fn save_settings(mut input: WebhookSettings) -> Result<WebhookSettings, String> {
    let url = if input.url.trim().is_empty() {
        String::new()
    } else {
        validate_url(&input.url)?
    };
    let mut events: Vec<String> = input
        .events
        .iter()
        .map(|event| event.trim().to_string())
        .filter(|event| EVENTS.contains(&event.as_str()))
        .collect();
    events.sort();
    events.dedup();

    if input.enabled && url.is_empty() {
        return Err("Add an endpoint URL before enabling webhooks".into());
    }
    if input.enabled && events.is_empty() {
        return Err("Choose at least one event to send".into());
    }
    if url.is_empty() {
        input.enabled = false;
    }
    if input.enabled {
        ensure_secret()?;
    }

    {
        let conn = dona_core::db::get().lock();
        let write = |key: &str, value: &str| dona_core::db::set_setting(&conn, key, value);
        write(SETTING_ENABLED, if input.enabled { "1" } else { "0" }).map_err(|e| e.to_string())?;
        write(SETTING_URL, &url).map_err(|e| e.to_string())?;
        write(SETTING_EVENTS, &events.join(",")).map_err(|e| e.to_string())?;
    }

    settings()
}

pub fn secret() -> Result<Option<String>, String> {
    secrets::get_secret(SECRET_KEY)
}

pub fn rotate_secret() -> Result<String, String> {
    let secret = new_secret();
    secrets::set_secret(SECRET_KEY, &secret)?;
    Ok(secret)
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// HMAC-SHA256 over `message`, hex encoded.
pub fn hmac_hex(secret: &str, message: &str) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(message.as_bytes());
    hex_encode(&mac.finalize().into_bytes())
}

fn truncate(text: &str, limit: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= limit {
        trimmed.to_string()
    } else {
        let shortened: String = trimmed.chars().take(limit).collect();
        format!("{shortened}…")
    }
}

fn store_status(status: Option<u16>, error: Option<&str>) {
    if let Some(conn) = dona_core::db::get().try_lock_for(Duration::from_secs(2)) {
        let _ = dona_core::db::set_setting(&conn, SETTING_LAST_AT, &Utc::now().to_rfc3339());
        let status_text = status
            .map(|code| format!("HTTP {code}"))
            .unwrap_or_default();
        let _ = dona_core::db::set_setting(&conn, SETTING_LAST_STATUS, &status_text);
        let _ = dona_core::db::set_setting(
            &conn,
            SETTING_LAST_ERROR,
            &error.map(|value| truncate(value, 500)).unwrap_or_default(),
        );
    }
}

fn describe_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        "The endpoint did not answer in time".to_string()
    } else if err.is_connect() {
        "Could not connect to the endpoint".to_string()
    } else {
        err.to_string()
    }
}

async fn deliver_with_retries(
    url: &str,
    secret: &str,
    event: &str,
    payload: &Value,
) -> WebhookTestResult {
    let body = json!({
        "event": event,
        "sent_at": Utc::now().to_rfc3339(),
        "data": payload,
    })
    .to_string();
    let timestamp = Utc::now().timestamp().to_string();
    let signature = hmac_hex(secret, &format!("{timestamp}.{body}"));
    let delivery_id = uuid::Uuid::new_v4().to_string();

    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(err) => {
            let error = err.to_string();
            store_status(None, Some(&error));
            return WebhookTestResult {
                ok: false,
                status: None,
                response: String::new(),
                error: Some(error),
            };
        }
    };

    let mut outcome = WebhookTestResult {
        ok: false,
        status: None,
        response: String::new(),
        error: None,
    };

    for attempt in 0..3u32 {
        let result = client
            .post(url)
            .header("content-type", "application/json")
            .header("x-dona-event", event)
            .header("x-dona-timestamp", &timestamp)
            .header("x-dona-signature", format!("sha256={signature}"))
            .header("x-dona-delivery", &delivery_id)
            .header(
                "user-agent",
                concat!("DonaBridge/", env!("CARGO_PKG_VERSION")),
            )
            .body(body.clone())
            .send()
            .await;

        match result {
            Ok(response) => {
                let status = response.status();
                let text = truncate(&response.text().await.unwrap_or_default(), 300);
                outcome.status = Some(status.as_u16());
                outcome.response = text.clone();
                if status.is_success() {
                    outcome.ok = true;
                    outcome.error = None;
                    store_status(Some(status.as_u16()), None);
                    return outcome;
                }
                outcome.error = Some(format!("HTTP {}: {text}", status.as_u16()));
                // Retry server errors and rate limits; give up on other 4xx.
                if !(status.is_server_error() || status.as_u16() == 429) {
                    break;
                }
            }
            Err(err) => {
                outcome.status = None;
                outcome.error = Some(describe_error(&err));
            }
        }

        if attempt < 2 {
            tokio::time::sleep(Duration::from_secs(1 + u64::from(attempt) * 3)).await;
        }
    }

    store_status(outcome.status, outcome.error.as_deref());
    outcome
}

/// Send a single test event, even when webhooks are currently disabled.
pub async fn send_test() -> Result<WebhookTestResult, String> {
    let settings = tokio::task::spawn_blocking(settings)
        .await
        .map_err(|e| e.to_string())??;
    if settings.url.trim().is_empty() {
        return Err("Add an endpoint URL first".into());
    }
    let url = validate_url(&settings.url)?;
    let secret = tokio::task::spawn_blocking(ensure_secret)
        .await
        .map_err(|e| e.to_string())??;

    let payload = json!({
        "message": "Dona Bridge test delivery",
        "app": "Dona Bridge",
        "version": env!("CARGO_PKG_VERSION"),
    });
    Ok(deliver_with_retries(&url, &secret, "test", &payload).await)
}

/// Fire an event in the background. Safe to call from any command; errors never
/// propagate to the caller.
pub fn emit(event: &str, payload: Value) {
    let event = event.to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(err) = emit_inner(&event, payload).await {
            tracing::debug!("Webhook {event} not delivered: {err}");
        }
    });
}

async fn emit_inner(event: &str, payload: Value) -> Result<(), String> {
    if !EVENTS.contains(&event) {
        return Ok(());
    }
    let settings = tokio::task::spawn_blocking(settings)
        .await
        .map_err(|e| e.to_string())??;
    if !settings.enabled || settings.url.trim().is_empty() {
        return Ok(());
    }
    if !settings.events.iter().any(|item| item == event) {
        return Ok(());
    }
    let url = validate_url(&settings.url)?;
    let secret = tokio::task::spawn_blocking(ensure_secret)
        .await
        .map_err(|e| e.to_string())??;
    let outcome = deliver_with_retries(&url, &secret, event, &payload).await;
    if outcome.ok {
        tracing::info!("Webhook {event} delivered ({:?})", outcome.status);
        Ok(())
    } else {
        Err(outcome.error.unwrap_or_else(|| "unknown error".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_matches_the_sha256_reference_vector() {
        // RFC 4231 / common reference vector.
        assert_eq!(
            hmac_hex("key", "The quick brown fox jumps over the lazy dog"),
            "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8"
        );
    }

    #[test]
    fn signature_covers_timestamp_and_body() {
        let body = r#"{"event":"contact.created","data":{"id":"1"}}"#;
        let first = hmac_hex("secret-value", &format!("1700000000.{body}"));
        let replay = hmac_hex("secret-value", &format!("1700000001.{body}"));
        assert_ne!(first, replay);
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn url_validation_accepts_https_and_localhost_http() {
        assert!(validate_url("https://hooks.example.com/dona").is_ok());
        assert!(validate_url("http://127.0.0.1:5678/webhook/dona").is_ok());
        assert!(validate_url("ftp://example.com").is_err());
        assert!(validate_url("not a url").is_err());
        assert!(validate_url("").is_err());
    }

    #[test]
    fn new_secret_is_long_and_random() {
        let first = new_secret();
        let second = new_secret();
        assert!(first.len() >= 32);
        assert_ne!(first, second);
    }
}
