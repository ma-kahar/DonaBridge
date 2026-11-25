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
pub struct AccountGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub sort_order: i32,
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
pub struct Pipeline {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PipelineStage {
    pub id: String,
    pub pipeline_id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub sort_order: i32,
    #[serde(default)]
    pub wip_limit: i32,
    #[serde(default)]
    pub is_won: bool,
    #[serde(default)]
    pub is_lost: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PipelineWithStages {
    pub pipeline: Pipeline,
    pub stages: Vec<PipelineStage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Deal {
    pub id: String,
    pub account_id: String,
    #[serde(default)]
    pub contact_id: Option<String>,
    pub pipeline_id: String,
    pub stage_id: String,
    pub title: String,
    #[serde(default)]
    pub value: f64,
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub probability: i32,
    #[serde(default)]
    pub expected_close: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub lost_reason: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CustomField {
    pub id: String,
    #[serde(default)]
    pub account_id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub field_type: String,
    #[serde(default)]
    pub options: Option<String>,
    #[serde(default)]
    pub sort_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContactFieldValue {
    pub field_id: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CrmTask {
    pub id: String,
    pub account_id: String,
    #[serde(default)]
    pub contact_id: Option<String>,
    #[serde(default)]
    pub deal_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub priority: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub notified: bool,
    #[serde(default)]
    pub completed_at: Option<String>,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CrmActivity {
    pub id: String,
    pub account_id: String,
    #[serde(default)]
    pub contact_id: Option<String>,
    #[serde(default)]
    pub deal_id: Option<String>,
    pub kind: String,
    #[serde(default)]
    pub body: String,
    pub created_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TimelineEntry {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StageReport {
    pub stage_id: String,
    pub name: String,
    pub color: String,
    pub count: i64,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CrmReport {
    pub pipeline_id: String,
    pub pipeline_name: String,
    pub currency: String,
    pub stages: Vec<StageReport>,
    pub open_count: i64,
    pub open_value: f64,
    pub won_count: i64,
    pub won_value: f64,
    pub lost_count: i64,
    pub lost_value: f64,
    pub win_rate: f64,
    pub avg_deal_value: f64,
    pub open_tasks: i64,
    pub overdue_tasks: i64,
    pub deals_last_30_days: i64,
    pub won_last_30_days: i64,
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
