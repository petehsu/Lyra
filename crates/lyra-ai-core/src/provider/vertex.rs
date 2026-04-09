use std::collections::BTreeMap;

use napi::Result;
use reqwest::blocking::RequestBuilder;
use serde_json::{json, Value};

use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::gemini::{
    map_generate_content_messages, map_generate_content_tools, parse_generate_content_response,
};
use crate::provider::google_auth::fetch_service_account_access_token;
use crate::provider::types::{
    build_client, fallback_models, required_connection_value, AgentInferenceDeltaCallback,
    AgentInferenceMessage, AgentInferenceResponse, AgentReasoningDeltaCallback,
    AgentToolDefinition,
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

fn collect_system_prompt(messages: &[AgentInferenceMessage]) -> Option<String> {
    let parts = messages
        .iter()
        .filter(|message| {
            matches!(
                message.role,
                crate::provider::types::AgentInferenceMessageRole::System
            )
        })
        .map(|message| message.content.trim())
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

fn sanitize_tool_name(name: &str) -> String {
    let mut sanitized = name
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() || char == '_' || char == '-' {
                char
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.trim().is_empty() {
        sanitized = "tool".to_string();
    }
    sanitized
}

fn build_tool_name_maps(
    tools: &[AgentToolDefinition],
) -> (BTreeMap<String, String>, BTreeMap<String, String>) {
    let mut canonical_to_wire = BTreeMap::new();
    let mut wire_to_canonical = BTreeMap::new();
    let mut used_wire_names = std::collections::BTreeSet::new();

    for tool in tools {
        let canonical_name = tool.name.trim().to_string();
        let base_wire_name = sanitize_tool_name(&canonical_name);
        let mut wire_name = base_wire_name.clone();
        let mut counter: usize = 2;
        while used_wire_names.contains(&wire_name) {
            wire_name = format!("{base_wire_name}_{counter}");
            counter += 1;
        }
        used_wire_names.insert(wire_name.clone());
        canonical_to_wire.insert(canonical_name.clone(), wire_name.clone());
        wire_to_canonical.insert(wire_name, canonical_name);
    }

    (canonical_to_wire, wire_to_canonical)
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

pub fn run_agent_inference(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
    on_assistant_delta: Option<&mut AgentInferenceDeltaCallback<'_>>,
    _on_reasoning_delta: Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<AgentInferenceResponse> {
    let (canonical_to_wire, wire_to_canonical) = build_tool_name_maps(tools);
    let mut payload = json!({
        "contents": map_generate_content_messages(messages, &canonical_to_wire)?,
        "tools": map_generate_content_tools(tools, &canonical_to_wire),
    });
    if let Some(system_prompt) = collect_system_prompt(messages) {
        if let Some(object) = payload.as_object_mut() {
            object.insert(
                "systemInstruction".to_string(),
                json!({
                    "parts": [{ "text": system_prompt }]
                }),
            );
        }
    }

    let client = build_client()?;
    let endpoint = format!(
        "{}/{}:generateContent",
        api_base(profile)?,
        model_path(&profile.model)
    );
    let response = apply_auth(client.post(endpoint), profile, secrets)?
        .json(&payload)
        .send()
        .map_err(|error| to_error(format!("failed to run Vertex AI inference: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "Vertex AI inference failed ({status}): {body}"
        )));
    }
    let payload = response.json::<Value>().map_err(|error| {
        to_error(format!(
            "failed to parse Vertex AI inference payload: {error}"
        ))
    })?;

    let result = parse_generate_content_response(&payload, &wire_to_canonical)?;
    if let Some(callback) = on_assistant_delta {
        if !result.assistant_text.is_empty() {
            callback(&result.assistant_text);
        }
    }
    Ok(result)
}
