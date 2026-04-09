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

fn map_messages(
    messages: &[AgentInferenceMessage],
    canonical_to_wire: &BTreeMap<String, String>,
) -> Result<Vec<Value>> {
    let tool_name_by_call_id = collect_tool_name_by_call_id(messages, canonical_to_wire);
    let mut mapped = Vec::with_capacity(messages.len());

    for message in messages {
        match message.role {
            AgentInferenceMessageRole::System => {
                mapped.push(json!({
                    "role": "system",
                    "content": message.content,
                }));
            }
            AgentInferenceMessageRole::User => {
                mapped.push(json!({
                    "role": "user",
                    "content": message.content,
                }));
            }
            AgentInferenceMessageRole::Assistant => {
                if message.tool_calls.is_empty() {
                    mapped.push(json!({
                        "role": "assistant",
                        "content": message.content,
                    }));
                } else {
                    let tool_calls = message
                        .tool_calls
                        .iter()
                        .map(|tool_call| {
                            json!({
                                "function": {
                                    "name": resolve_wire_tool_name(&tool_call.name, canonical_to_wire),
                                    "arguments": tool_call.input.clone(),
                                }
                            })
                        })
                        .collect::<Vec<_>>();
                    mapped.push(json!({
                        "role": "assistant",
                        "content": message.content,
                        "tool_calls": tool_calls,
                    }));
                }
            }
            AgentInferenceMessageRole::Tool => {
                let tool_name = message
                    .tool_call_id
                    .as_deref()
                    .and_then(|id| tool_name_by_call_id.get(id))
                    .cloned();
                mapped.push(json!({
                    "role": "tool",
                    "content": message.content,
                    "name": tool_name,
                }));
            }
        }
    }
    Ok(mapped)
}

fn map_tools(
    tools: &[AgentToolDefinition],
    canonical_to_wire: &BTreeMap<String, String>,
) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": resolve_wire_tool_name(&tool.name, canonical_to_wire),
                    "description": tool.description,
                    "parameters": tool.input_schema.clone(),
                }
            })
        })
        .collect()
}

fn parse_tool_call_arguments(raw: &Value) -> Value {
    if let Some(object) = raw.as_object() {
        return Value::Object(object.clone());
    }
    if let Some(text) = raw.as_str() {
        return serde_json::from_str::<Value>(text).unwrap_or_else(|_| json!({}));
    }
    json!({})
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

pub fn run_agent_inference(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
    on_assistant_delta: Option<&mut AgentInferenceDeltaCallback<'_>>,
    _on_reasoning_delta: Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<AgentInferenceResponse> {
    let (canonical_to_wire, wire_to_canonical) = build_tool_name_maps(tools);
    let request_payload = json!({
        "model": profile.model,
        "stream": false,
        "messages": map_messages(messages, &canonical_to_wire)?,
        "tools": map_tools(tools, &canonical_to_wire),
    });

    let client = build_client()?;
    let response = maybe_auth(
        client.post(format!("{}/api/chat", base_url(profile))),
        secrets,
    )
    .json(&request_payload)
    .send()
    .map_err(|error| to_error(format!("ollama inference request failed: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "ollama inference failed ({status}): {body}"
        )));
    }
    let payload = response
        .json::<Value>()
        .map_err(|error| to_error(format!("failed to parse ollama inference payload: {error}")))?;

    let message = payload
        .get("message")
        .and_then(Value::as_object)
        .ok_or_else(|| to_error("ollama response missing message"))?;
    let assistant_text = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let tool_calls = message
        .get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .filter_map(|call| {
                    let function = call.get("function")?.as_object()?;
                    let wire_name = function.get("name")?.as_str()?.trim().to_string();
                    let input =
                        parse_tool_call_arguments(function.get("arguments").unwrap_or(&json!({})));
                    let id = call
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("tool-call-{}", Uuid::new_v4()));
                    Some(AgentToolInvocation {
                        id,
                        name: resolve_canonical_tool_name(&wire_name, &wire_to_canonical),
                        input,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let input_tokens = payload.get("prompt_eval_count").and_then(Value::as_i64);
    let output_tokens = payload.get("eval_count").and_then(Value::as_i64);
    let total_tokens = match (input_tokens, output_tokens) {
        (Some(input), Some(output)) => Some(input + output),
        _ => None,
    };
    let usage = AgentInferenceUsage {
        input_tokens,
        output_tokens,
        total_tokens,
    };

    let result = AgentInferenceResponse {
        assistant_text,
        reasoning_content: String::new(),
        tool_calls,
        usage,
    };
    if let Some(callback) = on_assistant_delta {
        if !result.assistant_text.is_empty() {
            callback(&result.assistant_text);
        }
    }
    Ok(result)
}
