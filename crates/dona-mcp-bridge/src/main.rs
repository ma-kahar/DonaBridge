// dona-mcp-bridge/src/main.rs
// MCP stdio bridge — forwards line-delimited JSON-RPC from stdin to the local
// Dona Bridge HTTP MCP server (http://127.0.0.1:39420) and writes responses to stdout.
// Blueprint §3 #11: ships as `dona-bridge-mcp.exe` for stdio-only MCP clients.

use std::io::{self, BufRead, Write};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url =
        std::env::var("DONA_MCP_URL").unwrap_or_else(|_| "http://127.0.0.1:39420".to_string());
    let token = std::env::var("DONA_MCP_TOKEN").unwrap_or_default();

    let client = reqwest::Client::new();
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let res = client
            .post(&url)
            .bearer_auth(&token)
            .header("Content-Type", "application/json")
            .body(trimmed.to_string())
            .send()
            .await;

        match res {
            Ok(resp) => {
                let text = resp.text().await.unwrap_or_default();
                if !text.is_empty() {
                    writeln!(stdout, "{text}")?;
                    stdout.flush()?;
                }
            }
            Err(err) => {
                let err_json = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32000, "message": format!("Bridge error: {err}") }
                });
                writeln!(stdout, "{err_json}")?;
                stdout.flush()?;
            }
        }
    }

    Ok(())
}
