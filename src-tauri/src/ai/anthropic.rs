// ai/anthropic.rs — Anthropic Messages API provider.
// Blueprint §8: API key fetched from Windows Credential Manager in Rust; never sent to UI.

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct AnthropicRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: Vec<AnthropicMessage<'a>>,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicBlock>,
}

#[derive(Deserialize)]
struct AnthropicBlock {
    text: Option<String>,
}

pub async fn generate(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let body = AnthropicRequest {
        model,
        max_tokens: 512,
        system: system_prompt,
        messages: vec![AnthropicMessage {
            role: "user",
            content: user_prompt,
        }],
    };

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        anyhow::bail!("Anthropic error ({status}): {text}");
    }

    let parsed: AnthropicResponse = res.json().await?;
    Ok(parsed
        .content
        .into_iter()
        .filter_map(|b| b.text)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string())
}
