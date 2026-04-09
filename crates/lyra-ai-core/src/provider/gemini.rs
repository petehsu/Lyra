use std::collections::{BTreeMap, BTreeSet};

use napi::Result;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::types::{
    build_client, fallback_models, optional_connection_value, secret_value,
    AgentInferenceDeltaCallback, AgentInferenceMessage, AgentInferenceMessageRole,
    AgentInferenceResponse, AgentInferenceUsage, AgentReasoningDeltaCallback, AgentToolDefinition,
    AgentToolInvocation,
};

fn base_url(profile: &AiProviderProfile) -> String {
    optional_connection_value(profile, "baseUrl")
        .unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn api_key<'a>(secrets: &'a BTreeMap<String, String>) -> Result<&'a str> {
    secret_value(secrets, "apiKey").ok_or_else(|| to_error("apiKey is required"))
}

fn model_path(model: &str) -> String {
    let trimmed = model.trim().trim_start_matches('/');
    if trimmed.starts_with("models/") {
        trimmed.to_string()
    } else {
        format!("models/{trimmed}")
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
    let mut used_wire_names = BTreeSet::new();

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

fn resolve_wire_tool_name(
    canonical_name: &str,
    canonical_to_wire: &BTreeMap<String, String>,
) -> String {
    canonical_to_wire
        .get(canonical_name)
        .cloned()
        .unwrap_or_else(|| sanitize_tool_name(canonical_name))
}

fn resolve_canonical_tool_name(
    wire_name: &str,
    wire_to_canonical: &BTreeMap<String, String>,
) -> String {
    wire_to_canonical
        .get(wire_name)
        .cloned()
        .unwrap_or_else(|| wire_name.to_string())
}

fn collect_system_prompt(messages: &[AgentInferenceMessage]) -> Option<String> {
    let parts = messages
        .iter()
        .filter(|message| matches!(message.role, AgentInferenceMessageRole::System))
        .map(|message| message.content.trim())
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

fn collect_tool_name_by_call_id(
    messages: &[AgentInferenceMessage],
    canonical_to_wire: &BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for message in messages {
        if !matches!(message.role, AgentInferenceMessageRole::Assistant) {
            continue;
        }
        for tool_call in &message.tool_calls {
            map.insert(
                tool_call.id.clone(),
                resolve_wire_tool_name(&tool_call.name, canonical_to_wire),
            );
        }
    }
    map
}

fn parse_tool_result_payload(content: &str) -> Value {
    serde_json::from_str::<Value>(content).unwrap_or_else(|_| {
        json!({
            "content": content,
        })
    })
}

pub(crate) fn map_generate_content_messages(
    messages: &[AgentInferenceMessage],
    canonical_to_wire: &BTreeMap<String, String>,
) -> Result<Vec<Value>> {
    let tool_name_by_call_id = collect_tool_name_by_call_id(messages, canonical_to_wire);
    let mut mapped = Vec::with_capacity(messages.len());

    for message in messages {
        match message.role {
            AgentInferenceMessageRole::System => {}
            AgentInferenceMessageRole::User => {
                mapped.push(json!({
                    "role": "user",
                    "parts": [{ "text": message.content }],
                }));
            }
            AgentInferenceMessageRole::Assistant => {
                let mut parts = Vec::new();
                if !message.content.trim().is_empty() {
                    parts.push(json!({ "text": message.content }));
                }
                for tool_call in &message.tool_calls {
                    parts.push(json!({
                        "functionCall": {
                            "name": resolve_wire_tool_name(&tool_call.name, canonical_to_wire),
                            "args": tool_call.input.clone(),
                        }
                    }));
                }
                if parts.is_empty() {
                    parts.push(json!({ "text": "" }));
                }
                mapped.push(json!({
                    "role": "model",
                    "parts": parts,
                }));
            }
            AgentInferenceMessageRole::Tool => {
                let tool_call_id = message
                    .tool_call_id
                    .as_deref()
                    .ok_or_else(|| to_error("gemini tool result message missing tool_call_id"))?;
                let tool_name = tool_name_by_call_id
                    .get(tool_call_id)
                    .cloned()
                    .unwrap_or_else(|| "tool".to_string());
                mapped.push(json!({
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "name": tool_name,
                            "response": parse_tool_result_payload(&message.content),
                        }
                    }],
                }));
            }
        }
    }

    Ok(mapped)
}

pub(crate) fn map_generate_content_tools(
    tools: &[AgentToolDefinition],
    canonical_to_wire: &BTreeMap<String, String>,
) -> Value {
    if tools.is_empty() {
        return json!([]);
    }
    let declarations = tools
        .iter()
        .map(|tool| {
            json!({
                "name": resolve_wire_tool_name(&tool.name, canonical_to_wire),
                "description": tool.description,
                "parameters": tool.input_schema.clone(),
            })
        })
        .collect::<Vec<_>>();
    json!([{
        "functionDeclarations": declarations
    }])
}

pub(crate) fn parse_generate_content_response(
    payload: &Value,
    wire_to_canonical: &BTreeMap<String, String>,
) -> Result<AgentInferenceResponse> {
    let parts = payload
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|candidates| candidates.first())
        .and_then(|candidate| candidate.get("content"))
        .and_then(|content| content.get("parts"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut assistant_text_parts = Vec::new();
    let mut tool_calls = Vec::new();

    for part in parts {
        if let Some(text) = part.get("text").and_then(Value::as_str) {
            if !text.trim().is_empty() {
                assistant_text_parts.push(text.to_string());
            }
        }
        if let Some(function_call) = part.get("functionCall").and_then(Value::as_object) {
            let wire_name = function_call
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let call_id = function_call
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("tool-call-{}", Uuid::new_v4()));
            let input = function_call
                .get("args")
                .cloned()
                .unwrap_or_else(|| json!({}));
            tool_calls.push(AgentToolInvocation {
                id: call_id,
                name: resolve_canonical_tool_name(wire_name, wire_to_canonical),
                input,
            });
        }
    }

    let usage = AgentInferenceUsage {
        input_tokens: payload
            .get("usageMetadata")
            .and_then(|usage| usage.get("promptTokenCount"))
            .and_then(Value::as_i64),
        output_tokens: payload
            .get("usageMetadata")
            .and_then(|usage| usage.get("candidatesTokenCount"))
            .and_then(Value::as_i64),
        total_tokens: payload
            .get("usageMetadata")
            .and_then(|usage| usage.get("totalTokenCount"))
            .and_then(Value::as_i64),
    };

    Ok(AgentInferenceResponse {
        assistant_text: assistant_text_parts.join("\n"),
        reasoning_content: String::new(),
        tool_calls,
        usage,
    })
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

pub fn run_agent_inference(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
    on_assistant_delta: Option<&mut AgentInferenceDeltaCallback<'_>>,
    _on_reasoning_delta: Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<AgentInferenceResponse> {
    if profile.provider_id == "vertex_ai" {
        return Err(to_error(
            "Vertex AI inference must use vertex transport (provider_id=vertex_ai)",
        ));
    }

    let (canonical_to_wire, wire_to_canonical) = build_tool_name_maps(tools);
    let endpoint = format!(
        "{}/{}:generateContent?key={}",
        base_url(profile),
        model_path(&profile.model),
        api_key(secrets)?,
    );
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
    let response = client
        .post(endpoint)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .map_err(|error| to_error(format!("gemini inference request failed: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "gemini inference failed ({status}): {body}"
        )));
    }
    let payload = response
        .json::<Value>()
        .map_err(|error| to_error(format!("failed to parse gemini inference payload: {error}")))?;

    let result = parse_generate_content_response(&payload, &wire_to_canonical)?;
    if let Some(callback) = on_assistant_delta {
        if !result.assistant_text.is_empty() {
            callback(&result.assistant_text);
        }
    }
    Ok(result)
}
