// ai/mod.rs — AI provider stubs (Phase 3)
// Providers: Ollama (default/offline), OpenAI-compatible, Anthropic.
// Blueprint §8: AI calls run from Rust only; keys never reach the UI.

pub mod anthropic;
pub mod ollama;
pub mod openai_compat;
