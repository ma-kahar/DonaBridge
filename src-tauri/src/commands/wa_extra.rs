// commands/wa_extra.rs — link preview fetch + DND schedule

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
}

/// Fetch OpenGraph/Twitter meta tags from a URL and return a preview.
#[tauri::command]
pub async fn fetch_link_preview(url: String) -> Result<LinkPreview, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (compatible; DonaBridge/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("fetch error: {e}"))?;

    if !res.status().is_success() {
        return Ok(LinkPreview {
            url,
            ..Default::default()
        });
    }

    let html = res.text().await.map_err(|e| e.to_string())?;
    let title = extract_meta(&html, "og:title")
        .or_else(|| extract_meta(&html, "twitter:title"))
        .or_else(|| extract_title_tag(&html));
    let description = extract_meta(&html, "og:description")
        .or_else(|| extract_meta(&html, "twitter:description"))
        .or_else(|| extract_meta(&html, "description"));
    let image = extract_meta(&html, "og:image").or_else(|| extract_meta(&html, "twitter:image"));

    Ok(LinkPreview {
        url,
        title,
        description,
        image,
    })
}

fn extract_meta(html: &str, name: &str) -> Option<String> {
    // Try og: (property="…") and name="…"
    let lower = html.to_lowercase();
    // property="og:title" content="VALUE"
    for attr in ["property", "name"] {
        let needle = format!("{}=\"{}\"", attr, name.to_lowercase());
        if let Some(pos) = lower.find(&needle) {
            let after = &html[pos..];
            // Find content="…"
            if let Some(c) = after.find("content=\"") {
                let start = pos + c + 9;
                let rest = &html[start..];
                if let Some(end) = rest.find('"') {
                    let val = rest[..end].trim().to_string();
                    if !val.is_empty() {
                        return Some(val);
                    }
                }
            }
        }
    }
    None
}

fn extract_title_tag(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    if let Some(start) = lower.find("<title>") {
        if let Some(end) = lower[start + 7..].find("</title>") {
            let val = html[start + 7..start + 7 + end].trim().to_string();
            if !val.is_empty() {
                return Some(val);
            }
        }
    }
    None
}

/// Set Do-Not-Disturb quiet-hours for an account (HH:MM format, e.g. "22:00").
#[tauri::command]
pub async fn set_dnd_schedule(
    account_id: String,
    start_hhmm: String,
    end_hhmm: String,
) -> Result<(), String> {
    let conn = dona_core::db::get().lock();
    let key = format!("dnd_{account_id}");
    let val = format!("{start_hhmm}-{end_hhmm}");
    dona_core::db::set_setting(&conn, &key, &val).map_err(|e| e.to_string())
}

/// Clear DND schedule for an account.
#[tauri::command]
pub async fn clear_dnd_schedule(account_id: String) -> Result<(), String> {
    let conn = dona_core::db::get().lock();
    let key = format!("dnd_{account_id}");
    dona_core::db::set_setting(&conn, &key, "").map_err(|e| e.to_string())
}

/// Check whether current time is within account's DND window.
pub fn is_dnd_active(account_id: &str) -> bool {
    let conn = dona_core::db::get().lock();
    is_dnd_active_with(&conn, account_id)
}

/// Same as [`is_dnd_active`] but reuses an existing connection (avoids
/// re-locking the global database mutex on the same thread).
pub fn is_dnd_active_with(conn: &rusqlite::Connection, account_id: &str) -> bool {
    let Ok(Some(val)) = dona_core::db::get_setting(conn, &format!("dnd_{account_id}")) else {
        return false;
    };
    if val.is_empty() {
        return false;
    }
    let parts: Vec<&str> = val.splitn(2, '-').collect();
    if parts.len() != 2 {
        return false;
    }
    let now = chrono::Local::now();
    let (hh, mm) = (now.hour(), now.minute());
    let current = hh * 60 + mm;
    fn parse_hhmm(s: &str) -> Option<u32> {
        let parts: Vec<&str> = s.splitn(2, ':').collect();
        if parts.len() != 2 {
            return None;
        }
        let h: u32 = parts[0].parse().ok()?;
        let m: u32 = parts[1].parse().ok()?;
        Some(h * 60 + m)
    }
    let Some(start) = parse_hhmm(parts[0]) else {
        return false;
    };
    let Some(end) = parse_hhmm(parts[1]) else {
        return false;
    };
    if start <= end {
        current >= start && current < end
    } else {
        // Overnight (e.g. 22:00-08:00)
        current >= start || current < end
    }
}

use chrono::Timelike;

// Backups live in `commands::data`.
