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
        .unwrap_or_else(|| "http://localhost:11434".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn maybe_auth(
    builder: reqwest::blocking::RequestBuilder,
    secrets: &BTreeMap<String, String>,
) -> reqwest::blocking::RequestBuilder {
    if let Some(api_key) = secret_value(secrets, "apiKey") {
        builder.bearer_auth(api_key)
    } else {
        builder
    }
}

pub fn validate_profile_connection(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AiProfileValidationResult> {
    let client = build_client()?;
    let response = maybe_auth(
        client.get(format!("{}/api/tags", base_url(profile))),
        secrets,
    )
    .send()
    .map_err(|error| to_error(format!("failed to connect to Ollama: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "provider validation failed ({status}): {body}"
        )));
    }
    Ok(AiProfileValidationResult {
        ok: true,
        message: format!("Connected to {}", profile.provider_id),
        checked_at: now_ms(),
    })
}

pub fn discover_models(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<Vec<AiProviderModelEntry>> {
    let client = build_client()?;
    let response = maybe_auth(
        client.get(format!("{}/api/tags", base_url(profile))),
        secrets,
    )
    .send()
    .map_err(|error| to_error(format!("failed to discover Ollama models: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "model discovery failed ({status}): {body}"
        )));
    }
    let payload = response
        .json::<Value>()
        .map_err(|error| to_error(format!("failed to parse Ollama models payload: {error}")))?;
    let mut models = payload
        .get("models")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry.get("name").and_then(Value::as_str)?.to_string();
                    Some(AiProviderModelEntry {
                        id: id.clone(),
                        name: id,
                        description: entry
                            .get("details")
                            .and_then(|detail| detail.get("family"))
                            .and_then(Value::as_str)
                            .map(|value| value.to_string()),
                        context_window: None,
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
    let client = build_client()?;
    let body = json!({
        "model": profile.model,
        "stream": true,
        "messages": messages
            .iter()
            .map(|message| json!({ "role": message.role, "content": message.content }))
            .collect::<Vec<_>>()
    });
    let response = maybe_auth(
        client
            .post(format!("{}/api/chat", base_url(profile)))
            .json(&body),
        secrets,
    )
    .send()
    .map_err(|error| to_error(format!("failed to send Ollama request: {error}")))?;
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
            line.map_err(|error| to_error(format!("failed to read Ollama stream: {error}")))?;
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(&line)
            .map_err(|error| to_error(format!("failed to parse Ollama stream event: {error}")))?;
        if value.get("done").and_then(Value::as_bool) == Some(true) {
            break;
        }
        if let Some(delta) = value
            .get("message")
            .and_then(|entry| entry.get("content"))
            .and_then(Value::as_str)
        {
            if delta.is_empty() {
                continue;
            }
            full_response.push_str(delta);
            on_delta(delta)?;
        }
    }
    Ok(full_response)
}
