// local_api.rs — read-only HTTP API for the CRM, bound to loopback only.
//
// Security model:
// - listens on 127.0.0.1 only (never the LAN);
// - every request needs `Authorization: Bearer <token>`;
// - only GET is allowed, and only a fixed set of read routes exist;
// - no CORS headers, so a web page in a browser cannot read responses even if
//   it could reach the port.
//
// The API is off by default.

use std::collections::HashMap;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::OnceLock;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use chrono::Utc;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::secrets;

const TOKEN_KEY: &str = "api/token";
const SETTING_ENABLED: &str = "api_enabled";
const SETTING_PORT: &str = "api_port";
pub const DEFAULT_PORT: u16 = 8787;
const MIN_PORT: u16 = 1024;

struct Running {
    server: Arc<Server>,
    thread: Option<JoinHandle<()>>,
    stop: Arc<AtomicBool>,
}

static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();

fn running() -> &'static Mutex<Option<Running>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

fn read_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    dona_core::db::get_setting(conn, key).ok().flatten()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiSettings {
    pub enabled: bool,
    pub port: u16,
    pub has_token: bool,
    #[serde(default)]
    pub running: bool,
}

pub fn settings() -> Result<ApiSettings, String> {
    let (enabled, port) = read_config();
    Ok(ApiSettings {
        enabled,
        port,
        has_token: secrets::has_secret(TOKEN_KEY),
        running: running().lock().is_some(),
    })
}

fn read_config() -> (bool, u16) {
    let conn = dona_core::db::get().lock();
    let enabled = read_setting(&conn, SETTING_ENABLED).as_deref() == Some("1");
    let port = read_setting(&conn, SETTING_PORT)
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port >= MIN_PORT)
        .unwrap_or(DEFAULT_PORT);
    (enabled, port)
}

fn new_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn ensure_token() -> Result<String, String> {
    if let Some(token) = secrets::get_secret(TOKEN_KEY)? {
        if token.len() >= 32 {
            return Ok(token);
        }
    }
    let token = new_token();
    secrets::set_secret(TOKEN_KEY, &token)?;
    Ok(token)
}

pub fn token() -> Result<Option<String>, String> {
    secrets::get_secret(TOKEN_KEY)
}

/// Stop the server if it is running.
pub fn stop() {
    let taken = running().lock().take();
    if let Some(mut run) = taken {
        run.stop.store(true, Ordering::SeqCst);
        // Wakes the thread; `recv_timeout` then returns Ok(None), which the loop
        // turns into an exit because of the shutdown flag above.
        run.server.unblock();
        if let Some(handle) = run.thread.take() {
            let _ = handle.join();
        }
    }
}

/// Start the server with the current settings. Idempotent (restarts).
pub fn start() -> Result<ApiSettings, String> {
    stop();
    let (enabled, port) = read_config();
    if !enabled {
        return settings();
    }
    let token = Arc::new(ensure_token()?);
    let server = Arc::new(
        Server::http(("127.0.0.1", port))
            .map_err(|err| format!("Could not listen on 127.0.0.1:{port}: {err}"))?,
    );
    let thread_server = server.clone();
    let thread_token = token.clone();
    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop = stop_flag.clone();
    let handle = thread::Builder::new()
        .name("dona-local-api".into())
        .spawn(move || {
            loop {
                if thread_stop.load(Ordering::SeqCst) {
                    break;
                }
                match thread_server.recv_timeout(Duration::from_millis(500)) {
                    Ok(Some(request)) => {
                        let _ = handle_request(request, &thread_token);
                    }
                    // A timeout and `unblock()` both produce None; only the
                    // shutdown flag decides whether to keep waiting.
                    Ok(None) => continue,
                    Err(_) => break,
                }
            }
        })
        .map_err(|err| format!("Could not start the API thread: {err}"))?;

    *running().lock() = Some(Running {
        server,
        thread: Some(handle),
        stop: stop_flag,
    });
    tracing::info!("Local API listening on http://127.0.0.1:{port}/v1");
    settings()
}

pub fn save_settings(input: ApiSettings, new_token: Option<String>) -> Result<ApiSettings, String> {
    if input.port < MIN_PORT {
        return Err(format!("Choose a port between {MIN_PORT} and 65535"));
    }
    if let Some(value) = new_token {
        if !value.trim().is_empty() {
            if value.trim().len() < 32 {
                return Err("The API token must be at least 32 characters".into());
            }
            secrets::set_secret(TOKEN_KEY, value.trim())?;
        }
    }
    {
        let conn = dona_core::db::get().lock();
        let write = |key: &str, value: &str| dona_core::db::set_setting(&conn, key, value);
        write(SETTING_ENABLED, if input.enabled { "1" } else { "0" }).map_err(|e| e.to_string())?;
        write(SETTING_PORT, &input.port.to_string()).map_err(|e| e.to_string())?;
    }

    if input.enabled {
        match start() {
            Ok(settings) => Ok(settings),
            Err(err) => {
                // Never leave the UI claiming the API is enabled when it is not.
                let conn = dona_core::db::get().lock();
                let _ = dona_core::db::set_setting(&conn, SETTING_ENABLED, "0");
                Err(format!("{err}. The local API is disabled."))
            }
        }
    } else {
        stop();
        settings()
    }
}

pub fn rotate_token() -> Result<String, String> {
    let token = new_token();
    secrets::set_secret(TOKEN_KEY, &token)?;
    if running().lock().is_some() {
        start()?;
    }
    Ok(token)
}

// ── HTTP handling ───────────────────────────────────────────────────────────

fn secure_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

fn bearer_token(request: &Request) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))
        .and_then(|header| header.value.as_str().strip_prefix("Bearer "))
        .map(|value| value.trim().to_string())
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                match (hex_value(bytes[index + 1]), hex_value(bytes[index + 2])) {
                    (Some(high), Some(low)) => {
                        out.push(high * 16 + low);
                        index += 3;
                    }
                    _ => {
                        out.push(bytes[index]);
                        index += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn query_params(url: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Some((_, query)) = url.split_once('?') {
        for pair in query.split('&') {
            if pair.is_empty() {
                continue;
            }
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            out.insert(percent_decode(key), percent_decode(value));
        }
    }
    out
}

fn respond_json(request: Request, status: u16, body: Value) -> io::Result<()> {
    let header = Header::from_bytes(
        &b"Content-Type"[..],
        &b"application/json; charset=utf-8"[..],
    )
    .expect("static header");
    let nosniff =
        Header::from_bytes(&b"X-Content-Type-Options"[..], &b"nosniff"[..]).expect("static header");
    let cache = Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).expect("static header");
    request.respond(
        Response::from_string(body.to_string())
            .with_status_code(status)
            .with_header(header)
            .with_header(nosniff)
            .with_header(cache),
    )
}

fn handle_request(request: Request, token: &str) -> io::Result<()> {
    if request.method() != &Method::Get {
        return respond_json(request, 405, json!({ "error": "method_not_allowed" }));
    }
    let presented = bearer_token(&request);
    if !presented
        .as_deref()
        .map(|value| secure_eq(value, token))
        .unwrap_or(false)
    {
        return respond_json(request, 401, json!({ "error": "unauthorized" }));
    }

    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("/").to_string();
    match route(&path, &url) {
        Ok(body) => respond_json(request, 200, body),
        Err((status, message)) => respond_json(request, status, json!({ "error": message })),
    }
}

type ApiResult = Result<Value, (u16, String)>;

fn internal(error: impl ToString) -> (u16, String) {
    (500, error.to_string())
}

fn require_account(params: &HashMap<String, String>) -> Result<String, (u16, String)> {
    params
        .get("account_id")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or((400, "account_id is required".into()))
}

fn default_pipeline(conn: &rusqlite::Connection) -> Result<String, (u16, String)> {
    let pipelines = dona_core::crm_ext::list_pipelines(conn).map_err(internal)?;
    pipelines
        .iter()
        .find(|item| item.pipeline.is_default)
        .or_else(|| pipelines.first())
        .map(|item| item.pipeline.id.clone())
        .ok_or((500, "No pipeline is configured".into()))
}

fn route(path: &str, url: &str) -> ApiResult {
    let params = query_params(url);
    match path {
        "/v1/health" => Ok(json!({
            "status": "ok",
            "app": "Dona Bridge",
            "version": env!("CARGO_PKG_VERSION"),
            "time": Utc::now().to_rfc3339(),
            "read_only": true,
        })),
        "/v1/accounts" => {
            let conn = dona_core::db::get().lock();
            let accounts = dona_core::accounts::list_accounts(&conn).map_err(internal)?;
            let rows: Vec<Value> = accounts
                .into_iter()
                .map(|account| {
                    json!({
                        "id": account.id,
                        "name": account.name,
                        "category": account.category,
                        "color": account.color,
                        "icon_text": account.icon_text,
                        "group_id": account.group_id,
                        "profile_name": account.profile_name,
                    })
                })
                .collect();
            Ok(json!({ "accounts": rows, "count": rows.len() }))
        }
        "/v1/contacts" => {
            let account_id = require_account(&params)?;
            let conn = dona_core::db::get().lock();
            let contacts = dona_core::crm::list_contacts(&conn, &account_id).map_err(internal)?;
            Ok(json!({ "contacts": contacts, "count": contacts.len() }))
        }
        "/v1/deals" => {
            let account_id = require_account(&params)?;
            let conn = dona_core::db::get().lock();
            let pipeline_id = params
                .get("pipeline_id")
                .cloned()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default_pipeline(&conn)?);
            let deals = dona_core::crm_ext::list_deals(&conn, &account_id, &pipeline_id)
                .map_err(internal)?;
            Ok(json!({
                "pipeline_id": pipeline_id,
                "deals": deals,
                "count": deals.len(),
            }))
        }
        "/v1/tasks" => {
            let account_id = require_account(&params)?;
            let conn = dona_core::db::get().lock();
            let tasks = dona_core::crm_ext::list_tasks(&conn, &account_id).map_err(internal)?;
            Ok(json!({ "tasks": tasks, "count": tasks.len() }))
        }
        "/v1/report" => {
            let account_id = require_account(&params)?;
            let conn = dona_core::db::get().lock();
            let pipeline_id = params
                .get("pipeline_id")
                .cloned()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(default_pipeline(&conn)?);
            let report =
                dona_core::crm_ext::report(&conn, &account_id, &pipeline_id).map_err(internal)?;
            Ok(serde_json::to_value(report).map_err(internal)?)
        }
        "/v1/templates" => {
            let account_id = params
                .get("account_id")
                .cloned()
                .filter(|value| !value.trim().is_empty());
            let conn = dona_core::db::get().lock();
            let templates =
                dona_core::crm::list_templates(&conn, account_id.as_deref()).map_err(internal)?;
            Ok(json!({ "templates": templates, "count": templates.len() }))
        }
        _ => {
            if let Some(rest) = path.strip_prefix("/v1/contacts/") {
                if let Some(contact_id) = rest.strip_suffix("/timeline") {
                    if contact_id.is_empty() || contact_id.contains('/') {
                        return Err((404, "not_found".into()));
                    }
                    let conn = dona_core::db::get().lock();
                    let timeline = dona_core::crm_ext::contact_timeline(&conn, contact_id)
                        .map_err(internal)?;
                    return Ok(json!({ "timeline": timeline, "count": timeline.len() }));
                }
            }
            Err((404, "not_found".into()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_parser_decodes_values() {
        let params = query_params("/v1/contacts?account_id=abc-123&name=John%20Doe&x=1+2");
        assert_eq!(
            params.get("account_id").map(String::as_str),
            Some("abc-123")
        );
        assert_eq!(params.get("name").map(String::as_str), Some("John Doe"));
        assert_eq!(params.get("x").map(String::as_str), Some("1 2"));
    }

    #[test]
    fn token_comparison_is_exact() {
        assert!(secure_eq("abcdef", "abcdef"));
        assert!(!secure_eq("abcdef", "abcdeg"));
        assert!(!secure_eq("abcdef", "abcde"));
        assert!(!secure_eq("", "a"));
    }

    #[test]
    fn tokens_are_long_and_unique() {
        let first = new_token();
        let second = new_token();
        assert!(first.len() >= 64);
        assert_ne!(first, second);
    }

    #[test]
    fn routes_reject_unknown_paths() {
        let err = route("/v1/nope", "/v1/nope").expect_err("must 404");
        assert_eq!(err.0, 404);
    }

    #[test]
    fn contacts_route_requires_account() {
        let err = route("/v1/contacts", "/v1/contacts").expect_err("must 400");
        assert_eq!(err.0, 400);
    }
}
