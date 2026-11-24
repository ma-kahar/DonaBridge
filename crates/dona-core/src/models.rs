// dona-core/src/models.rs
// Blueprint §7: data model — all tables defined here as Rust structs.
// All structs have #[serde(default)] to survive schema migrations (Blueprint §3 #6).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub category: String,
    pub color: String,
    pub icon_text: String,
    #[serde(default)]
    pub avatar_path: Option<String>,
    #[serde(default)]
    pub profile_name: String,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
    #[serde(default)]
    pub muted: bool,
    #[serde(default)]
    pub hibernate_minutes: i32,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
    #[serde(default)]
    pub mcp_draft: bool,
    #[serde(default)]
    pub mcp_read: bool,
    #[serde(default)]
    pub dnd_schedule: Option<serde_json::Value>,
    pub created_at: Option<DateTime<Utc>>,
}

fn default_zoom() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Contact {
    pub id: String,
    pub account_id: String,
    pub phone_e164: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub stage: String,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Tag {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Note {
    pub id: String,
    pub account_id: String,
    #[serde(default)]
    pub contact_id: Option<String>,
    pub body: String,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Reminder {
    pub id: String,
    pub contact_id: String,
    pub due_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub snoozed_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Template {
    pub id: String,
    #[serde(default)]
    pub account_id: Option<String>,
    pub name: String,
    pub body: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub shortcut: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpActivity {
    pub id: String,
    pub at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub client_name: Option<String>,
    pub tool: String,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub outcome: String,
    #[serde(default)]
    pub detail: Option<String>,
}
