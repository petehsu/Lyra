use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};

use napi::Result;
use serde_json::{json, Value};

use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::types::{
    build_client, fallback_models, optional_connection_value, secret_value, ProviderChatMessage,
};

fn base_url(profile: &AiProviderProfile) -> String {
    optional_connection_value(profile, "baseUrl")
        .unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn model_name(model: &str) -> String {
    if model.starts_with("models/") {
        model.to_string()
    } else {
        format!("models/{model}")
    }
}

fn api_key<'a>(secrets: &'a BTreeMap<String, String>) -> Result<&'a str> {
    secret_value(secrets, "apiKey").ok_or_else(|| to_error("apiKey is required"))
}

pub fn validate_profile_connection(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AiProfileValidationResult> {
    if profile.provider_id == "vertex_ai" {
        return Err(to_error(
            "Vertex AI runtime is not implemented in this build yet",
        ));
    }
    let client = build_client()?;
    let response = client
        .get(format!(
            "{}/models?key={}",
            base_url(profile),
            api_key(secrets)?
        ))
        .send()
        .map_err(|error| to_error(format!("failed to connect to Gemini: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "provider validation failed ({status}): {body}"
        )));
    }
    Ok(AiProfileValidationResult {
        ok: true,
        message: "Connected to Google AI".to_string(),
        checked_at: now_ms(),
    })
}

pub fn discover_models(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<Vec<AiProviderModelEntry>> {
    if profile.provider_id == "vertex_ai" {
        return Ok(fallback_models(profile));
    }
    let client = build_client()?;
    let response = client
        .get(format!(
            "{}/models?key={}",
            base_url(profile),
            api_key(secrets)?
        ))
        .send()
        .map_err(|error| to_error(format!("failed to discover Gemini models: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "model discovery failed ({status}): {body}"
        )));
    }
    let payload = response
        .json::<Value>()
        .map_err(|error| to_error(format!("failed to parse Gemini model payload: {error}")))?;
    let mut models = payload
        .get("models")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry.get("name").and_then(Value::as_str)?.to_string();
                    let name = entry
                        .get("displayName")
                        .and_then(Value::as_str)
                        .unwrap_or(id.as_str())
                        .to_string();
                    Some(AiProviderModelEntry {
                        id,
                        name,
                        description: entry
                            .get("description")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        context_window: entry.get("inputTokenLimit").and_then(Value::as_i64),
                        supports_images: None,
                        supports_tools: None,
                        source: "dynamic".to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if models.is_empty() {
        models = fallback_models(profile);
    }
    Ok(models)
}

pub fn stream_chat_completion(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[ProviderChatMessage],
    cancel_flag: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<String> {
    if profile.provider_id == "vertex_ai" {
        return Err(to_error(
            "Vertex AI runtime is not implemented in this build yet",
        ));
    }
    let client = build_client()?;
    let endpoint = format!(
        "{}/{}:streamGenerateContent?alt=sse&key={}",
        base_url(profile),
        model_name(&profile.model),
        api_key(secrets)?
    );
    let body = json!({
        "contents": messages
            .iter()
            .map(|message| json!({
                "role": if message.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": message.content }]
            }))
            .collect::<Vec<_>>()
    });
    let response = client
        .post(endpoint)
        .json(&body)
        .send()
        .map_err(|error| to_error(format!("failed to send Gemini request: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "chat completion failed ({status}): {body}"
        )));
    }

    let reader = BufReader::new(response);
    let mut full_response = String::new();
    for line in reader.lines() {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(to_error("chat turn cancelled"));
        }
        let line =
            line.map_err(|error| to_error(format!("failed to read Gemini stream: {error}")))?;
        let Some(payload) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(payload)
            .map_err(|error| to_error(format!("failed to parse Gemini stream event: {error}")))?;
        let delta = value
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|entries| entries.first())
            .and_then(|entry| entry.get("content"))
            .and_then(|entry| entry.get("parts"))
            .and_then(Value::as_array)
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|part| part.get("text").and_then(Value::as_str))
                    .collect::<String>()
            })
            .unwrap_or_default();
        if delta.is_empty() {
            continue;
        }
        full_response.push_str(&delta);
        on_delta(&delta)?;
    }
    Ok(full_response)
}
