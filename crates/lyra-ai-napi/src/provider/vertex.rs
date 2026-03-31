use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};

use napi::Result;
use reqwest::blocking::RequestBuilder;
use serde_json::{json, Value};

use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::google_auth::fetch_service_account_access_token;
use crate::provider::types::{
    build_client, fallback_models, required_connection_value, ProviderChatMessage,
};

fn region(profile: &AiProviderProfile) -> Result<String> {
    required_connection_value(profile, "region")
}

fn project_id(profile: &AiProviderProfile) -> Result<String> {
    required_connection_value(profile, "projectId")
}

fn api_base(profile: &AiProviderProfile) -> Result<String> {
    let region = region(profile)?;
    let project_id = project_id(profile)?;
    Ok(format!(
        "https://{region}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{region}"
    ))
}

fn model_path(model: &str) -> String {
    let trimmed = model.trim().trim_start_matches('/');
    if trimmed.starts_with("publishers/")
        || trimmed.starts_with("projects/")
        || trimmed.starts_with("endpoints/")
    {
        trimmed.to_string()
    } else {
        format!("publishers/google/models/{trimmed}")
    }
}

fn apply_auth(
    builder: RequestBuilder,
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<RequestBuilder> {
    let token = fetch_service_account_access_token(&build_client()?, profile, secrets)?;
    Ok(builder
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json"))
}

fn convert_messages(messages: &[ProviderChatMessage]) -> (Vec<Value>, Vec<Value>) {
    let mut contents = Vec::new();
    let mut system = Vec::new();

    for message in messages {
        if message.content.trim().is_empty() {
            continue;
        }
        if message.role == "system" {
            system.push(json!({ "text": message.content }));
            continue;
        }
        contents.push(json!({
            "role": if message.role == "assistant" { "model" } else { "user" },
            "parts": [{ "text": message.content }]
        }));
    }

    (contents, system)
}

fn stream_payload_to_delta(payload: &Value) -> String {
    payload
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
        .unwrap_or_default()
}

pub fn validate_profile_connection(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AiProfileValidationResult> {
    let client = build_client()?;
    let endpoint = format!(
        "{}/{}:generateContent",
        api_base(profile)?,
        model_path(&profile.model)
    );
    let response = apply_auth(client.post(endpoint), profile, secrets)?
        .json(&json!({
            "contents": [{
                "role": "user",
                "parts": [{ "text": "ping" }]
            }],
            "generationConfig": {
                "maxOutputTokens": 1,
                "temperature": 0
            }
        }))
        .send()
        .map_err(|error| to_error(format!("failed to connect to Vertex AI: {error}")))?;

    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "provider validation failed ({status}): {body}"
        )));
    }

    Ok(AiProfileValidationResult {
        ok: true,
        message: "Connected to Vertex AI".to_string(),
        checked_at: now_ms(),
    })
}

pub fn discover_models(
    profile: &AiProviderProfile,
    _secrets: &BTreeMap<String, String>,
) -> Result<Vec<AiProviderModelEntry>> {
    Ok(fallback_models(profile))
}

pub fn stream_chat_completion(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[ProviderChatMessage],
    cancel_flag: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<String> {
    let client = build_client()?;
    let endpoint = format!(
        "{}/{}:streamGenerateContent?alt=sse",
        api_base(profile)?,
        model_path(&profile.model)
    );
    let (contents, system) = convert_messages(messages);
    let response = apply_auth(client.post(endpoint), profile, secrets)?
        .json(&json!({
            "contents": contents,
            "systemInstruction": if system.is_empty() {
                Value::Null
            } else {
                json!({ "parts": system })
            },
            "generationConfig": {
                "maxOutputTokens": 4096
            }
        }))
        .send()
        .map_err(|error| to_error(format!("failed to send Vertex AI request: {error}")))?;

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
            line.map_err(|error| to_error(format!("failed to read Vertex AI stream: {error}")))?;
        let Some(payload) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(payload).map_err(|error| {
            to_error(format!("failed to parse Vertex AI stream event: {error}"))
        })?;
        let delta = stream_payload_to_delta(&value);
        if delta.is_empty() {
            continue;
        }
        full_response.push_str(&delta);
        on_delta(&delta)?;
    }

    Ok(full_response)
}
