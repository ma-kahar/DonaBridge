// ai/ollama.rs — Local Ollama provider (default, offline, free).
// Blueprint §6 & §8: AI calls run in Rust only.

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct OllamaMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct OllamaRequest<'a> {
    model: &'a str,
    messages: Vec<OllamaMessage<'a>>,
    stream: bool,
}

#[derive(Deserialize)]
struct OllamaResponse {
    message: Option<OllamaResponseMessage>,
}

#[derive(Deserialize)]
struct OllamaResponseMessage {
    content: String,
}

pub async fn generate(
    base_url: &str,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
) -> anyhow::Result<String> {
    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let body = OllamaRequest {
        model,
        messages: vec![
            OllamaMessage {
                role: "system",
                content: system_prompt,
            },
            OllamaMessage {
                role: "user",
                content: user_prompt,
            },
        ],
        stream: false,
    };

    let res = client.post(&url).json(&body).send().await?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        anyhow::bail!("Ollama error ({status}): {text}");
    }

    let parsed: OllamaResponse = res.json().await?;
    Ok(parsed
        .message
        .map(|m| m.content.trim().to_string())
        .unwrap_or_default())
}
