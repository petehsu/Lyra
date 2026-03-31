use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};

use napi::Result;
use serde_json::{json, Value};

use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::types::{
    apply_custom_headers, build_client, fallback_models, optional_connection_value, secret_value,
    ProviderChatMessage,
};

fn base_url(profile: &AiProviderProfile) -> String {
    optional_connection_value(profile, "baseUrl")
        .unwrap_or_else(|| "https://api.anthropic.com".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn apply_headers(
    builder: reqwest::blocking::RequestBuilder,
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<reqwest::blocking::RequestBuilder> {
    let api_key = secret_value(secrets, "apiKey").ok_or_else(|| to_error("apiKey is required"))?;
    Ok(apply_custom_headers(builder, profile)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01"))
}

pub fn validate_profile_connection(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AiProfileValidationResult> {
    let client = build_client()?;
    let response = apply_headers(
        client.get(format!("{}/v1/models", base_url(profile))),
        profile,
        secrets,
    )?
    .send()
    .map_err(|error| to_error(format!("failed to connect to Anthropic: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "provider validation failed ({status}): {body}"
        )));
    }
    Ok(AiProfileValidationResult {
        ok: true,
        message: "Connected to Anthropic".to_string(),
        checked_at: now_ms(),
    })
}

pub fn discover_models(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<Vec<AiProviderModelEntry>> {
    let client = build_client()?;
    let response = apply_headers(
        client.get(format!("{}/v1/models", base_url(profile))),
        profile,
        secrets,
    )?
    .send()
    .map_err(|error| to_error(format!("failed to discover Anthropic models: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "model discovery failed ({status}): {body}"
        )));
    }
    let payload = response
        .json::<Value>()
        .map_err(|error| to_error(format!("failed to parse Anthropic model payload: {error}")))?;
    let mut models = payload
        .get("data")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry.get("id").and_then(Value::as_str)?.to_string();
                    let name = entry
                        .get("display_name")
                        .and_then(Value::as_str)
                        .unwrap_or(id.as_str())
                        .to_string();
                    Some(AiProviderModelEntry {
                        id,
                        name,
                        description: None,
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
        "max_tokens": 4096,
        "stream": true,
        "messages": messages
            .iter()
            .map(|message| json!({
                "role": if message.role == "assistant" { "assistant" } else { "user" },
                "content": [{ "type": "text", "text": message.content }]
            }))
            .collect::<Vec<_>>()
    });
    let response = apply_headers(
        client
            .post(format!("{}/v1/messages", base_url(profile)))
            .json(&body),
        profile,
        secrets,
    )?
    .send()
    .map_err(|error| to_error(format!("failed to send Anthropic request: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "chat completion failed ({status}): {body}"
        )));
    }

    let reader = BufReader::new(response);
    let mut current_event = String::new();
    let mut full_response = String::new();

    for line in reader.lines() {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(to_error("chat turn cancelled"));
        }
        let line =
            line.map_err(|error| to_error(format!("failed to read Anthropic stream: {error}")))?;
        if let Some(event) = line.strip_prefix("event:") {
            current_event = event.trim().to_string();
            continue;
        }
        let Some(payload) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(payload).map_err(|error| {
            to_error(format!("failed to parse Anthropic stream event: {error}"))
        })?;
        if current_event == "error" || value.get("type").and_then(Value::as_str) == Some("error") {
            return Err(to_error(value.to_string()));
        }
        if value.get("type").and_then(Value::as_str) == Some("message_stop") {
            break;
        }
        if let Some(delta) = value
            .get("delta")
            .and_then(|entry| entry.get("text"))
            .and_then(Value::as_str)
        {
            full_response.push_str(delta);
            on_delta(delta)?;
        }
    }

    Ok(full_response)
}
