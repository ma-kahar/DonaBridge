// commands/mcp.rs — Tauri commands to manage the local MCP server from Settings.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{mcp, secrets};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub has_token: bool,
}

#[tauri::command]
pub async fn mcp_status() -> Result<McpStatus, String> {
    Ok(McpStatus {
        running: mcp::is_running(),
        port: mcp::current_port(),
        has_token: secrets::has_secret("mcp-token"),
    })
}

#[tauri::command]
pub async fn mcp_start(app: AppHandle) -> Result<McpStatus, String> {
    let port = mcp::start_server(app).await?;
    Ok(McpStatus {
        running: true,
        port: Some(port),
        has_token: true,
    })
}

#[tauri::command]
pub async fn mcp_stop() -> Result<McpStatus, String> {
    mcp::stop_server();
    Ok(McpStatus {
        running: false,
        port: None,
        has_token: secrets::has_secret("mcp-token"),
    })
}

#[tauri::command]
pub async fn mcp_rotate_token() -> Result<String, String> {
    mcp::rotate_token()
}
