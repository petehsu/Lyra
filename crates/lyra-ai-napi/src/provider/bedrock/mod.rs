pub(crate) mod credentials;
pub(crate) mod event_stream;
pub(crate) mod sigv4;

use std::collections::BTreeMap;
use std::sync::atomic::AtomicBool;

use napi::Result;
use serde_json::{json, Value};

use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::bedrock::credentials::{load_bedrock_auth, BedrockAuth};
use crate::provider::bedrock::event_stream::consume_event_stream;
use crate::provider::bedrock::sigv4::{encode_model_id, sign_headers};
use crate::provider::types::{
    build_client, fallback_models, optional_connection_value, required_connection_value,
    ProviderChatMessage,
};

fn region(profile: &AiProviderProfile) -> Result<String> {
    required_connection_value(profile, "region")
}

fn endpoint_base(profile: &AiProviderProfile) -> Result<String> {
    Ok(optional_connection_value(profile, "endpointOverride")
        .unwrap_or_else(|| {
            format!(
                "https://bedrock-runtime.{}.amazonaws.com",
                region(profile).unwrap_or_else(|_| "us-east-1".to_string())
            )
        })
        .trim_end_matches('/')
        .to_string())
}

fn endpoint(profile: &AiProviderProfile, operation: &str) -> Result<String> {
    Ok(format!(
        "{}/model/{}/{}",
        endpoint_base(profile)?,
        encode_model_id(profile.model.trim()),
        operation,
    ))
}

fn apply_auth_headers(
    builder: reqwest::blocking::RequestBuilder,
    request_url: &str,
    profile: &AiProviderProfile,
    auth: &BedrockAuth,
    body: &[u8],
    accept: &str,
) -> Result<reqwest::blocking::RequestBuilder> {
    let builder = builder
        .header("Accept", accept)
        .header("Content-Type", "application/json");
    match auth {
        BedrockAuth::ApiKey(api_key) => {
            Ok(builder.header("Authorization", format!("Bearer {api_key}")))
        }
        BedrockAuth::Aws(credentials) => {
            let mut next = builder;
            for (key, value) in
                sign_headers("POST", request_url, &region(profile)?, body, credentials)?
            {
                next = next.header(&key, value);
            }
            Ok(next)
        }
    }
}

fn build_converse_payload(messages: &[ProviderChatMessage], max_tokens: i64) -> Value {
    let mut system = Vec::new();
    let mut conversation = Vec::new();

    for message in messages {
        if message.content.trim().is_empty() {
            continue;
        }
        if message.role == "system" {
            system.push(json!({ "text": message.content }));
            continue;
        }
        conversation.push(json!({
            "role": if message.role == "assistant" { "assistant" } else { "user" },
            "content": [{ "text": message.content }]
        }));
    }

    json!({
        "messages": conversation,
        "system": system,
        "inferenceConfig": {
            "maxTokens": max_tokens,
            "temperature": 0.2,
            "topP": 0.9,
        }
    })
}

pub fn validate_profile_connection(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AiProfileValidationResult> {
    let client = build_client()?;
    let body = serde_json::to_vec(&build_converse_payload(
        &[ProviderChatMessage {
            role: "user".to_string(),
            content: "ping".to_string(),
        }],
        1,
    ))
    .map_err(|error| {
        to_error(format!(
            "failed to encode Amazon Bedrock validation body: {error}"
        ))
    })?;
    let auth = load_bedrock_auth(profile, secrets)?;
    let request_url = endpoint(profile, "converse")?;
    let response = apply_auth_headers(
        client.post(&request_url),
        &request_url,
        profile,
        &auth,
        &body,
        "application/json",
    )?
    .body(body)
    .send()
    .map_err(|error| to_error(format!("failed to connect to Amazon Bedrock: {error}")))?;

    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "provider validation failed ({status}): {body}"
        )));
    }

    Ok(AiProfileValidationResult {
        ok: true,
        message: "Connected to Amazon Bedrock".to_string(),
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
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<String> {
    let client = build_client()?;
    let body = serde_json::to_vec(&build_converse_payload(messages, 4096)).map_err(|error| {
        to_error(format!(
            "failed to encode Amazon Bedrock request body: {error}"
        ))
    })?;
    let auth = load_bedrock_auth(profile, secrets)?;
    let request_url = endpoint(profile, "converse-stream")?;
    let response = apply_auth_headers(
        client.post(&request_url),
        &request_url,
        profile,
        &auth,
        &body,
        "application/vnd.amazon.eventstream",
    )?
    .body(body)
    .send()
    .map_err(|error| to_error(format!("failed to send Amazon Bedrock request: {error}")))?;

    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "chat completion failed ({status}): {body}"
        )));
    }

    consume_event_stream(response, cancel_flag, on_delta)
}
