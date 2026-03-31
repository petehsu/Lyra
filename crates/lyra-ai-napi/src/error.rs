use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

use napi::{Error, Result, Status};
use serde::de::DeserializeOwned;
use serde::Serialize;

pub fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

pub fn parse_json<T: DeserializeOwned>(payload: &str) -> Result<T> {
    serde_json::from_str(payload)
        .map_err(|error| to_error(format!("invalid json payload: {error}")))
}

pub fn to_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value)
        .map_err(|error| to_error(format!("failed to serialize json: {error}")))
}

pub fn now_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis() as i64,
        Err(_) => 0,
    }
}

pub fn normalize_required_text(value: &str, field_name: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(to_error(format!("{field_name} is required")));
    }
    Ok(trimmed.to_string())
}

pub fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn normalize_string_map(value: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    value
        .iter()
        .filter_map(|(key, entry)| {
            let normalized_key = key.trim();
            let normalized_value = entry.trim();
            if normalized_key.is_empty() || normalized_value.is_empty() {
                None
            } else {
                Some((normalized_key.to_string(), normalized_value.to_string()))
            }
        })
        .collect()
}

pub fn validate_chat_mode(value: &str) -> Result<String> {
    match value {
        "chat" | "agent" | "oma" => Ok(value.to_string()),
        _ => Err(to_error("invalid ai chat mode")),
    }
}

pub fn validate_provider_id(value: &str) -> Result<String> {
    match value {
        "openai"
        | "azure_openai"
        | "openrouter"
        | "anthropic"
        | "google_ai"
        | "vertex_ai"
        | "amazon_bedrock"
        | "ollama"
        | "lmstudio"
        | "deepseek"
        | "xai"
        | "mistral"
        | "moonshot"
        | "groq"
        | "together"
        | "fireworks"
        | "siliconflow"
        | "nebius"
        | "cerebras"
        | "vercel_ai_gateway"
        | "custom_openai_compatible" => Ok(value.to_string()),
        _ => Err(to_error("invalid ai provider id")),
    }
}

pub fn validate_protocol_id(value: &str) -> Result<String> {
    match value {
        "openai_compatible"
        | "anthropic_messages"
        | "gemini_generate_content"
        | "bedrock_converse"
        | "ollama_chat"
        | "lmstudio_openai" => Ok(value.to_string()),
        _ => Err(to_error("invalid ai protocol id")),
    }
}
