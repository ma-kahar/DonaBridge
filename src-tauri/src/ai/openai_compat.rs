// ai/openai_compat.rs — OpenAI / OpenRouter / OpenAI-compatible provider.
// Blueprint §8: API key fetched from Windows Credential Manager in Rust; never sent to UI.

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    temperature: f32,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    content: String,
}

pub async fn generate(
    base_url: &str,
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<String> {
    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let body = ChatRequest {
        model,
        messages: vec![
            ChatMessage {
                role: "system",
                content: system_prompt,
            },
            ChatMessage {
                role: "user",
                content: user_prompt,
            },
        ],
        temperature: 0.4,
    };

    let res = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        anyhow::bail!("OpenAI-compatible error ({status}): {text}");
    }

    let parsed: ChatResponse = res.json().await?;
    Ok(parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content.trim().to_string())
        .unwrap_or_default())
}
