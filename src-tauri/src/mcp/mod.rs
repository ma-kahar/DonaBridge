// mcp/mod.rs — Hardened local MCP server (JSON-RPC 2.0 over HTTP on 127.0.0.1).
// Blueprint §2, §3 #9-10, §8 #5:
//   • Off by default; bound to 127.0.0.1 only (39420, fallback to free port)
//   • 256-bit bearer token in Windows Credential Manager
//   • Rejects any browser Origin header (403) and non-localhost Host (403)
//   • Rate limit: 30 calls/min overall, 10 drafts/min
//   • Draft-only: checks account.mcp_draft, checks open chat contact, caps at 4,000 chars
//   • Logs every call to `mcp_activity`
//   • No send tool exists, by design

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use dona_core::{accounts as core_accounts, db};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::{secrets, webviews::manager};

pub const DEFAULT_MCP_PORT: u16 = 39420;
const MAX_DRAFT_CHARS: usize = 4000;
const RATE_LIMIT_CALLS_PER_MIN: usize = 30;
const RATE_LIMIT_DRAFTS_PER_MIN: usize = 10;

static MCP_RUNNING: AtomicBool = AtomicBool::new(false);
static MCP_PORT: Mutex<Option<u16>> = Mutex::new(None);
static CALL_TIMESTAMPS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
static DRAFT_TIMESTAMPS: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());

pub fn is_running() -> bool {
    MCP_RUNNING.load(Ordering::Relaxed)
}

pub fn current_port() -> Option<u16> {
    *MCP_PORT.lock()
}

/// Generate or rotate a 256-bit (32-byte hex) bearer token in Credential Manager.
pub fn rotate_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    let u1 = uuid::Uuid::new_v4();
    let u2 = uuid::Uuid::new_v4();
    bytes[..16].copy_from_slice(u1.as_bytes());
    bytes[16..].copy_from_slice(u2.as_bytes());
    let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    secrets::set_secret("mcp-token", &token)?;
    Ok(token)
}

/// Ensure a token exists in Credential Manager, creating one if missing.
pub fn ensure_token() -> Result<String, String> {
    if let Some(tok) = secrets::get_secret("mcp-token")? {
        if !tok.is_empty() {
            return Ok(tok);
        }
    }
    rotate_token()
}

/// Start the local MCP HTTP server on `127.0.0.1:39420` (or a free port if busy).
pub async fn start_server(app: AppHandle) -> Result<u16, String> {
    if is_running() {
        return Ok(current_port().unwrap_or(DEFAULT_MCP_PORT));
    }
    ensure_token()?;

    let listener = match TcpListener::bind(("127.0.0.1", DEFAULT_MCP_PORT)).await {
        Ok(l) => l,
        Err(_) => TcpListener::bind(("127.0.0.1", 0))
            .await
            .map_err(|e| e.to_string())?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *MCP_PORT.lock() = Some(port);
    MCP_RUNNING.store(true, Ordering::Relaxed);

    tokio::spawn(async move {
        tracing::info!("MCP server listening on http://127.0.0.1:{port}");
        while MCP_RUNNING.load(Ordering::Relaxed) {
            match tokio::time::timeout(Duration::from_millis(500), listener.accept()).await {
                Ok(Ok((stream, addr))) => {
                    let app_clone = app.clone();
                    tokio::spawn(async move {
                        handle_connection(stream, addr, Some(app_clone)).await;
                    });
                }
                Ok(Err(err)) => {
                    tracing::warn!("MCP accept error: {err}");
                }
                Err(_) => continue,
            }
        }
        *MCP_PORT.lock() = None;
        tracing::info!("MCP server stopped");
    });

    Ok(port)
}

pub fn stop_server() {
    MCP_RUNNING.store(false, Ordering::Relaxed);
}

#[derive(Debug, Deserialize)]
struct JsonRpcReq {
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    id: Option<serde_json::Value>,
    method: String,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct JsonRpcRes {
    jsonrpc: &'static str,
    id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcErr>,
}

#[derive(Debug, Serialize)]
struct JsonRpcErr {
    code: i32,
    message: String,
}

/// Validate `Host`, `Origin`, and `Authorization` headers.
/// Returns `Ok(())` or `(http_status, reason)`.
pub fn validate_http_headers(
    host: Option<&str>,
    origin: Option<&str>,
    auth_header: Option<&str>,
    expected_token: &str,
) -> Result<(), (u16, &'static str)> {
    // Reject any browser Origin header (stops DNS rebinding / CSRF)
    if origin.is_some() {
        return Err((403, "Forbidden: Origin header not allowed"));
    }

    // Validate Host header is 127.0.0.1 or localhost
    let host_ok = host.is_some_and(|h| {
        let bare = h.split(':').next().unwrap_or("");
        bare.eq_ignore_ascii_case("127.0.0.1") || bare.eq_ignore_ascii_case("localhost")
    });
    if !host_ok {
        return Err((403, "Forbidden: invalid Host header"));
    }

    // Constant-time-like bearer check
    let provided = auth_header
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if provided.is_empty() || !constant_time_eq(provided.as_bytes(), expected_token.as_bytes()) {
        return Err((401, "Unauthorized: invalid bearer token"));
    }

    Ok(())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn check_rate_limit(queue: &Mutex<VecDeque<Instant>>, max_per_min: usize) -> bool {
    let now = Instant::now();
    let mut q = queue.lock();
    while let Some(&front) = q.front() {
        if now.duration_since(front) > Duration::from_secs(60) {
            q.pop_front();
        } else {
            break;
        }
    }
    if q.len() >= max_per_min {
        return false;
    }
    q.push_back(now);
    true
}

async fn handle_connection(mut stream: TcpStream, _addr: SocketAddr, app: Option<AppHandle>) {
    let (read_half, mut write_half) = stream.split();
    let mut reader = BufReader::new(read_half);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await.unwrap_or(0) == 0 {
        return;
    }

    let mut host: Option<String> = None;
    let mut origin: Option<String> = None;
    let mut auth: Option<String> = None;
    let mut content_length: usize = 0;

    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await.unwrap_or(0) == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((name, val)) = trimmed.split_once(':') {
            let val = val.trim().to_string();
            if name.eq_ignore_ascii_case("host") {
                host = Some(val);
            } else if name.eq_ignore_ascii_case("origin") {
                origin = Some(val);
            } else if name.eq_ignore_ascii_case("authorization") {
                auth = Some(val);
            } else if name.eq_ignore_ascii_case("content-length") {
                content_length = val.parse().unwrap_or(0);
            }
        }
    }

    let expected_token = secrets::get_secret("mcp-token")
        .ok()
        .flatten()
        .unwrap_or_default();

    if let Err((status, msg)) = validate_http_headers(
        host.as_deref(),
        origin.as_deref(),
        auth.as_deref(),
        &expected_token,
    ) {
        let _ = write_http(&mut write_half, status, msg).await;
        return;
    }

    if !check_rate_limit(&CALL_TIMESTAMPS, RATE_LIMIT_CALLS_PER_MIN) {
        let _ = write_http(&mut write_half, 429, "Rate limit exceeded (30/min)").await;
        return;
    }

    if content_length > 65_536 {
        let _ = write_http(&mut write_half, 413, "Payload too large").await;
        return;
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 && reader.read_exact(&mut body).await.is_err() {
        let _ = write_http(&mut write_half, 400, "Incomplete request body").await;
        return;
    }

    let Ok(req) = serde_json::from_slice::<JsonRpcReq>(&body) else {
        let _ = write_http(&mut write_half, 400, "Invalid JSON-RPC payload").await;
        return;
    };

    let id = req.id.clone().unwrap_or(serde_json::Value::Null);
    let res = dispatch_rpc(req, app.as_ref()).await;
    let json = serde_json::to_string(&JsonRpcRes {
        jsonrpc: "2.0",
        id,
        result: res.as_ref().ok().cloned(),
        error: res.err(),
    })
    .unwrap_or_else(|_| "{}".into());

    let _ = write_http_json(&mut write_half, 200, &json).await;
}

async fn dispatch_rpc(
    req: JsonRpcReq,
    app: Option<&AppHandle>,
) -> Result<serde_json::Value, JsonRpcErr> {
    match req.method.as_str() {
        "initialize" => Ok(serde_json::json!({
            "protocolVersion": "2025-03-26",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "dona-bridge", "version": env!("CARGO_PKG_VERSION") }
        })),
        "tools/list" => Ok(serde_json::json!({
            "tools": [
                {
                    "name": "draft_reply",
                    "description": "Insert a draft reply into the active WhatsApp chat for a matching contact. Never sends.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "account_id": { "type": "string" },
                            "contact": { "type": "string" },
                            "text": { "type": "string" }
                        },
                        "required": ["account_id", "contact", "text"]
                    }
                }
            ]
        })),
        "tools/call" => {
            let name = req.params["name"].as_str().unwrap_or("");
            if name != "draft_reply" {
                return Err(JsonRpcErr {
                    code: -32601,
                    message: format!("Unknown tool: {name}"),
                });
            }
            let args = &req.params["arguments"];
            let account_id = args["account_id"].as_str().unwrap_or("");
            let contact = args["contact"].as_str().unwrap_or("");
            let text = args["text"].as_str().unwrap_or("");

            handle_draft_reply(app, account_id, contact, text).map_err(|msg| JsonRpcErr {
                code: -32000,
                message: msg,
            })
        }
        other => Err(JsonRpcErr {
            code: -32601,
            message: format!("Method not found: {other}"),
        }),
    }
}

fn handle_draft_reply(
    app: Option<&AppHandle>,
    account_id: &str,
    contact: &str,
    text: &str,
) -> Result<serde_json::Value, String> {
    if text.chars().count() > MAX_DRAFT_CHARS {
        return Err(format!("Draft exceeds {MAX_DRAFT_CHARS} character limit"));
    }
    if !check_rate_limit(&DRAFT_TIMESTAMPS, RATE_LIMIT_DRAFTS_PER_MIN) {
        return Err("Draft rate limit exceeded (10/min)".into());
    }

    let account = {
        let conn = db::get().lock();
        core_accounts::get_account(&conn, account_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Account not found: {account_id}"))?
    };

    if !account.mcp_draft {
        log_mcp_activity(
            "draft_reply",
            Some(account_id),
            "denied",
            Some("mcp_draft off"),
        );
        return Err("MCP draft is disabled for this account".into());
    }

    if let Some(app_handle) = app {
        manager::insert_draft_checked(app_handle, account_id, contact, text)
            .map_err(|e| e.to_string())?;
    }

    log_mcp_activity("draft_reply", Some(account_id), "ok", Some(contact));
    Ok(serde_json::json!({
        "content": [{ "type": "text", "text": "Draft inserted (human must press Send)" }]
    }))
}

fn log_mcp_activity(tool: &str, account_id: Option<&str>, outcome: &str, detail: Option<&str>) {
    let conn = db::get().lock();
    let id = uuid::Uuid::new_v4().to_string();
    let _ = db::log_mcp_activity(&conn, &id, tool, account_id, outcome, detail);
}

async fn write_http(
    w: &mut tokio::net::tcp::WriteHalf<'_>,
    status: u16,
    body: &str,
) -> std::io::Result<()> {
    let reason = match status {
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        413 => "Payload Too Large",
        429 => "Too Many Requests",
        _ => "Error",
    };
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    w.write_all(resp.as_bytes()).await
}

async fn write_http_json(
    w: &mut tokio::net::tcp::WriteHalf<'_>,
    status: u16,
    json: &str,
) -> std::io::Result<()> {
    let resp = format!(
        "HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{json}",
        json.len()
    );
    w.write_all(resp.as_bytes()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_validation_enforces_token_origin_and_host() {
        let token = "secret123";
        // Valid request
        assert!(validate_http_headers(
            Some("127.0.0.1:39420"),
            None,
            Some("Bearer secret123"),
            token
        )
        .is_ok());

        // Browser Origin header -> 403
        assert_eq!(
            validate_http_headers(
                Some("127.0.0.1:39420"),
                Some("https://evil.com"),
                Some("Bearer secret123"),
                token
            ),
            Err((403, "Forbidden: Origin header not allowed"))
        );

        // DNS rebinding Host -> 403
        assert_eq!(
            validate_http_headers(
                Some("evil.com:39420"),
                None,
                Some("Bearer secret123"),
                token
            ),
            Err((403, "Forbidden: invalid Host header"))
        );

        // Wrong token -> 401
        assert_eq!(
            validate_http_headers(Some("localhost:39420"), None, Some("Bearer wrong"), token),
            Err((401, "Unauthorized: invalid bearer token"))
        );
    }
}
