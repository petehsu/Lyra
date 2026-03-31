use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};

use napi::Result;
use reqwest::blocking::RequestBuilder;
use serde_json::{json, Value};

use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::stream_parser::{parse_stream_event, StreamEvent};
use crate::provider::types::{
    apply_custom_headers, build_client, fallback_models, optional_connection_value,
    required_connection_value, secret_value, ProviderChatMessage,
};

fn apply_auth_headers(
    builder: RequestBuilder,
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> RequestBuilder {
    let builder = apply_custom_headers(builder, profile);
    if profile.provider_id == "azure_openai" {
        if let Some(api_key) = secret_value(secrets, "apiKey") {
            return builder.header("api-key", api_key);
        }
        return builder;
    }
    if let Some(api_key) = secret_value(secrets, "apiKey") {
        builder.bearer_auth(api_key)
    } else {
        builder
    }
}

fn models_endpoint(profile: &AiProviderProfile) -> Result<Option<String>> {
    if profile.provider_id == "azure_openai" {
        return Ok(None);
    }
    let base_url = required_connection_value(profile, "baseUrl")?;
    Ok(Some(format!("{}/models", base_url.trim_end_matches('/'))))
}

fn chat_endpoint(profile: &AiProviderProfile) -> Result<String> {
    if profile.provider_id == "azure_openai" {
        let endpoint = required_connection_value(profile, "baseUrl")?;
        let api_version = optional_connection_value(profile, "apiVersion")
            .unwrap_or_else(|| "2024-10-21".to_string());
        let deployment = optional_connection_value(profile, "deployment")
            .unwrap_or_else(|| profile.model.clone());
        return Ok(format!(
            "{}/openai/deployments/{}/chat/completions?api-version={api_version}",
            endpoint.trim_end_matches('/'),
            deployment
        ));
    }

    let base_url = required_connection_value(profile, "baseUrl")?;
    Ok(format!(
        "{}/chat/completions",
        base_url.trim_end_matches('/')
    ))
}

pub fn validate_profile_connection(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AiProfileValidationResult> {
    if let Some(endpoint) = models_endpoint(profile)? {
        let client = build_client()?;
        let response = apply_auth_headers(client.get(endpoint), profile, secrets)
            .send()
            .map_err(|error| to_error(format!("failed to connect to model provider: {error}")))?;
        if response.status().is_success() == false {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(to_error(format!(
                "provider validation failed ({status}): {body}"
            )));
        }
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
    let Some(endpoint) = models_endpoint(profile)? else {
        return Ok(fallback_models(profile));
    };
    let client = build_client()?;
    let response = apply_auth_headers(client.get(endpoint), profile, secrets)
        .send()
        .map_err(|error| to_error(format!("failed to discover models: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "model discovery failed ({status}): {body}"
        )));
    }
    let payload = response
        .json::<Value>()
        .map_err(|error| to_error(format!("failed to parse model discovery payload: {error}")))?;
    let mut models = payload
        .get("data")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let id = entry.get("id").and_then(Value::as_str)?.to_string();
                    let name = entry
                        .get("name")
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
                        context_window: entry.get("context_window").and_then(Value::as_i64),
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
    let endpoint = chat_endpoint(profile)?;
    let request = json!({
        "model": profile.model,
        "stream": true,
        "messages": messages
            .iter()
            .map(|message| json!({ "role": message.role, "content": message.content }))
            .collect::<Vec<_>>()
    });

    let response = apply_auth_headers(client.post(endpoint).json(&request), profile, secrets)
        .send()
        .map_err(|error| to_error(format!("failed to send chat completion request: {error}")))?;
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
            line.map_err(|error| to_error(format!("failed to read streaming response: {error}")))?;
        let Some(event) = parse_stream_event(&line)? else {
            continue;
        };

        match event {
            StreamEvent::Done => break,
            StreamEvent::Delta(delta) => {
                full_response.push_str(&delta);
                on_delta(&delta)?;
            }
        }
    }

    Ok(full_response)
}
