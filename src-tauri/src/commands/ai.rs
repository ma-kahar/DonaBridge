// commands/ai.rs — Draft-only AI Copilot + Multi-Profile Management + Model Auto-Detection.
// Blueprint §2 & §8:
//   • AI calls run in Rust only; API keys live exclusively in Windows Credential Manager.
//   • Multiple AI profiles can be saved; only ONE is active at a time.
//   • Chat is read ONLY on explicit click, ONLY open chat, last 20 messages.
//   • AI never sends a message — returns a draft only.

use dona_core::db;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::{ai, secrets, webviews::manager};

const AI_SETTINGS_KEY: &str = "ai_config";
const AI_PROFILES_KEY: &str = "ai_profiles";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AiConfig {
    pub provider: String,
    pub model: String,
    pub base_url: String,
    pub cloud_consent: bool,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: "ollama".to_string(),
            model: "llama3.2".to_string(),
            base_url: "http://localhost:11434".to_string(),
            cloud_consent: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AiProfile {
    pub id: String,
    pub name: String,
    pub provider: String, // "ollama" | "openai" | "anthropic" | "deepseek" | "kimi" | "openrouter" | "custom"
    pub model: String,
    pub base_url: String,
    pub active: bool,
    pub has_key: bool,
}

fn load_profiles_internal() -> Result<Vec<AiProfile>, String> {
    let conn = db::get().lock();
    let val = db::get_setting(&conn, AI_PROFILES_KEY).map_err(|e| e.to_string())?;
    let mut list: Vec<AiProfile> = val
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    for p in &mut list {
        p.has_key = p.provider == "ollama" || secrets::has_secret(&format!("ai/profile/{}", p.id));
    }
    Ok(list)
}

fn save_profiles_internal(list: &[AiProfile]) -> Result<(), String> {
    let json = serde_json::to_string(list).map_err(|e| e.to_string())?;
    let conn = db::get().lock();
    db::set_setting(&conn, AI_PROFILES_KEY, &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_get_config() -> Result<AiConfig, String> {
    let conn = db::get().lock();
    let val = db::get_setting(&conn, AI_SETTINGS_KEY).map_err(|e| e.to_string())?;
    Ok(val
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

#[tauri::command]
pub async fn ai_save_config(config: AiConfig) -> Result<(), String> {
    let json = serde_json::to_string(&config).map_err(|e| e.to_string())?;
    let conn = db::get().lock();
    db::set_setting(&conn, AI_SETTINGS_KEY, &json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ai_list_profiles() -> Result<Vec<AiProfile>, String> {
    load_profiles_internal()
}

#[tauri::command]
pub async fn ai_upsert_profile(
    mut profile: AiProfile,
    api_key: Option<String>,
) -> Result<Vec<AiProfile>, String> {
    let mut list = load_profiles_internal()?;
    if profile.id.trim().is_empty() {
        profile.id = uuid::Uuid::new_v4().to_string();
    }
    if let Some(key) = api_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            secrets::set_secret(&format!("ai/profile/{}", profile.id), trimmed)?;
        }
    }
    if list.is_empty() {
        profile.active = true;
    }
    if profile.active {
        for p in &mut list {
            p.active = false;
        }
    }
    if let Some(existing) = list.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile;
    } else {
        list.push(profile);
    }
    save_profiles_internal(&list)?;
    load_profiles_internal()
}

#[tauri::command]
pub async fn ai_set_active_profile(id: String) -> Result<Vec<AiProfile>, String> {
    let mut list = load_profiles_internal()?;
    for p in &mut list {
        p.active = p.id == id;
    }
    save_profiles_internal(&list)?;
    load_profiles_internal()
}

#[tauri::command]
pub async fn ai_delete_profile(id: String) -> Result<Vec<AiProfile>, String> {
    let mut list = load_profiles_internal()?;
    list.retain(|p| p.id != id);
    let _ = secrets::delete_secret(&format!("ai/profile/{id}"));
    if !list.is_empty() && !list.iter().any(|p| p.active) {
        list[0].active = true;
    }
    save_profiles_internal(&list)?;
    load_profiles_internal()
}

/// Auto-detect available models and verify API connectivity for a provider.
#[tauri::command]
pub async fn ai_detect_models(
    provider: String,
    base_url: String,
    profile_id: Option<String>,
    api_key_override: Option<String>,
) -> Result<Vec<String>, String> {
    let key = if let Some(k) = api_key_override.filter(|s| !s.trim().is_empty()) {
        k
    } else if let Some(pid) = profile_id.filter(|s| !s.trim().is_empty()) {
        secrets::get_secret(&format!("ai/profile/{pid}"))?.unwrap_or_default()
    } else {
        secrets::get_secret(&format!("ai/{provider}"))?.unwrap_or_default()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let base = default_base_url(&provider, &base_url);

    if provider == "ollama" {
        let url = format!("{base}/api/tags");
        let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Ollama returned {}", res.status()));
        }
        let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let models = body["models"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["name"].as_str().map(ToString::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        return Ok(models);
    }

    if provider == "anthropic" {
        if key.trim().is_empty() {
            return Err("API key is required to test Anthropic".into());
        }
        let res = client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(format!("Anthropic returned {}", res.status()));
        }
        let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let models = body["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["id"].as_str().map(ToString::to_string))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        return Ok(models);
    }

    // OpenAI-compatible: openai, deepseek, kimi, openrouter, custom
    if key.trim().is_empty() {
        return Err("API key is required to test this provider".into());
    }
    let url = format!("{base}/v1/models");
    let res = client
        .get(&url)
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Provider returned {}", res.status()));
    }
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut models = body["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(ToString::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    models.sort();
    models.truncate(50);
    Ok(models)
}

fn default_base_url(provider: &str, custom: &str) -> String {
    let trimmed = custom.trim().trim_end_matches('/');
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    match provider {
        "ollama" => "http://localhost:11434".to_string(),
        "openai" => "https://api.openai.com".to_string(),
        "anthropic" => "https://api.anthropic.com".to_string(),
        "deepseek" => "https://api.deepseek.com".to_string(),
        "kimi" => "https://api.moonshot.cn".to_string(),
        "openrouter" => "https://openrouter.ai/api".to_string(),
        _ => String::new(),
    }
}

/// Triggered ONLY by explicit user click: reads up to 20 messages from the open chat
/// of `account_id` and emits `wa:chat-context` back to the main shell.
#[tauri::command]
pub async fn ai_read_active_chat(app: AppHandle, account_id: String) -> Result<(), String> {
    manager::request_active_chat(&app, &account_id).map_err(|e| e.to_string())
}

/// Generate a draft reply using the currently active AI profile. Never sends anything.
#[tauri::command]
pub async fn ai_suggest_reply(
    account_id: String,
    contact: String,
    messages: Vec<String>,
    tone: String,
    language: String,
) -> Result<String, String> {
    let config = ai_get_config().await?;
    let profiles = load_profiles_internal().unwrap_or_default();
    let active_profile = profiles.into_iter().find(|p| p.active);

    let (provider, model, base_url, profile_id) = match active_profile {
        Some(p) => (p.provider, p.model, p.base_url, Some(p.id)),
        None => (config.provider, config.model, config.base_url, None),
    };

    let is_cloud = provider != "ollama";
    if is_cloud && !config.cloud_consent {
        return Err("CLOUD_CONSENT_REQUIRED".to_string());
    }

    // Sign drafts as the WhatsApp account the user is writing from, never as
    // the application name.
    let account_name = {
        let conn = dona_core::db::get().lock();
        dona_core::accounts::get_account(&conn, &account_id)
            .ok()
            .flatten()
            .map(|a| a.name)
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| "this account".to_string())
    };

    let system_prompt = format!(
        "You are a helpful messaging assistant drafting a WhatsApp reply on behalf of the \
         account \"{account_name}\". \
         Draft a concise, polite reply in language '{language}' with a '{tone}' tone. \
         Never mention or sign as \"Dona Bridge\", \"DonaBridge\" or any software name. \
         If the reply needs a signature, use \"{account_name}\". \
         Return ONLY the reply text, with no quotes or preamble."
    );

    let history = messages
        .into_iter()
        .rev()
        .take(20)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    let user_prompt = format!("Contact: {contact}\nRecent messages:\n{history}\n\nDraft reply:");
    let base = default_base_url(&provider, &base_url);

    if provider == "ollama" {
        return ai::ollama::generate(&base, &model, &system_prompt, &user_prompt)
            .await
            .map_err(|e| e.to_string());
    }

    let key = if let Some(pid) = profile_id {
        secrets::get_secret(&format!("ai/profile/{pid}"))?
    } else {
        secrets::get_secret(&format!("ai/{provider}"))?
    }
    .ok_or_else(|| format!("API key not configured for {provider}"))?;

    if provider == "anthropic" {
        return ai::anthropic::generate(&key, &model, &system_prompt, &user_prompt)
            .await
            .map_err(|e| e.to_string());
    }

    if base.is_empty() {
        return Err("Base URL is required for custom provider".into());
    }

    ai::openai_compat::generate(&base, &key, &model, &system_prompt, &user_prompt)
        .await
        .map_err(|e| e.to_string())
}
