// commands/webhooks.rs — settings and delivery status for outbound webhooks.

use crate::webhooks::{self, WebhookSettings, WebhookTestResult};

#[tauri::command]
pub async fn webhook_settings() -> Result<WebhookSettings, String> {
    tokio::task::spawn_blocking(webhooks::settings)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_webhook_settings(settings: WebhookSettings) -> Result<WebhookSettings, String> {
    tokio::task::spawn_blocking(move || webhooks::save_settings(settings))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn webhook_secret() -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(webhooks::secret)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rotate_webhook_secret() -> Result<String, String> {
    tokio::task::spawn_blocking(webhooks::rotate_secret)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn test_webhook() -> Result<WebhookTestResult, String> {
    webhooks::send_test().await
}
