pub(crate) mod credentials;
pub(crate) mod sigv4;

use std::collections::BTreeMap;

use napi::Result;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::bedrock::credentials::{load_bedrock_auth, BedrockAuth};
use crate::provider::bedrock::sigv4::{encode_model_id, sign_headers};
use crate::provider::types::{
    build_client, fallback_models, optional_connection_value, required_connection_value,
    AgentInferenceDeltaCallback, AgentInferenceMessage, AgentInferenceMessageRole,
    AgentInferenceResponse, AgentInferenceUsage, AgentReasoningDeltaCallback, AgentToolDefinition,
    AgentToolInvocation,
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

pub fn validate_profile_connection(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<AiProfileValidationResult> {
    let client = build_client()?;
    let body = serde_json::to_vec(&json!({
        "messages": [{
            "role": "user",
            "content": [{ "text": "ping" }]
        }],
        "system": [],
        "inferenceConfig": {
            "maxTokens": 1,
            "temperature": 0.2,
            "topP": 0.9,
        }
    }))
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

fn parse_tool_result_content(content: &str) -> Vec<Value> {
    let parsed = serde_json::from_str::<Value>(content)
        .unwrap_or_else(|_| Value::String(content.to_string()));
    match parsed {
        Value::String(text) => vec![json!({ "text": text })],
        other => vec![json!({ "json": other })],
    }
}

fn map_bedrock_messages(
    messages: &[AgentInferenceMessage],
    canonical_to_wire: &BTreeMap<String, String>,
) -> Result<Vec<Value>> {
    let mut mapped = Vec::new();
    for message in messages {
        match message.role {
            AgentInferenceMessageRole::System => {}
            AgentInferenceMessageRole::User => {
                mapped.push(json!({
                    "role": "user",
                    "content": [{ "text": message.content }],
                }));
            }
            AgentInferenceMessageRole::Assistant => {
                let mut content = Vec::new();
                if !message.content.trim().is_empty() {
                    content.push(json!({ "text": message.content }));
                }
                for tool_call in &message.tool_calls {
                    content.push(json!({
                        "toolUse": {
                            "toolUseId": tool_call.id,
                            "name": resolve_wire_tool_name(&tool_call.name, canonical_to_wire),
                            "input": tool_call.input.clone(),
                        }
                    }));
                }
                if content.is_empty() {
                    content.push(json!({ "text": "" }));
                }
                mapped.push(json!({
                    "role": "assistant",
                    "content": content,
                }));
            }
            AgentInferenceMessageRole::Tool => {
                let tool_call_id = message
                    .tool_call_id
                    .as_deref()
                    .ok_or_else(|| to_error("bedrock tool result message missing tool_call_id"))?;
                mapped.push(json!({
                    "role": "user",
                    "content": [{
                        "toolResult": {
                            "toolUseId": tool_call_id,
                            "content": parse_tool_result_content(&message.content),
                        }
                    }],
                }));
            }
        }
    }
    Ok(mapped)
}

fn map_bedrock_tools(
    tools: &[AgentToolDefinition],
    canonical_to_wire: &BTreeMap<String, String>,
) -> Value {
    json!({
        "tools": tools.iter().map(|tool| {
            json!({
                "toolSpec": {
                    "name": resolve_wire_tool_name(&tool.name, canonical_to_wire),
                    "description": tool.description,
                    "inputSchema": {
                        "json": tool.input_schema.clone(),
                    },
                }
            })
        }).collect::<Vec<_>>()
    })
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
        "messages": map_bedrock_messages(messages, &canonical_to_wire)?,
        "toolConfig": map_bedrock_tools(tools, &canonical_to_wire),
        "inferenceConfig": {
            "maxTokens": 2048,
        },
    });
    if let Some(system_prompt) = collect_system_prompt(messages) {
        if let Some(object) = payload.as_object_mut() {
            object.insert(
                "system".to_string(),
                json!([{
                    "text": system_prompt
                }]),
            );
        }
    }

    let body = serde_json::to_vec(&payload).map_err(|error| {
        to_error(format!(
            "failed to encode Amazon Bedrock inference body: {error}"
        ))
    })?;
    let auth = load_bedrock_auth(profile, secrets)?;
    let request_url = endpoint(profile, "converse")?;
    let client = build_client()?;
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
    .map_err(|error| to_error(format!("bedrock inference request failed: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "bedrock inference failed ({status}): {body}"
        )));
    }

    let payload = response.json::<Value>().map_err(|error| {
        to_error(format!(
            "failed to parse bedrock inference payload: {error}"
        ))
    })?;

    let mut assistant_parts = Vec::new();
    let mut tool_calls = Vec::new();
    let content = payload
        .get("output")
        .and_then(|output| output.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for item in content {
        if let Some(text) = item.get("text").and_then(Value::as_str) {
            if !text.trim().is_empty() {
                assistant_parts.push(text.to_string());
            }
        }
        if let Some(tool_use) = item.get("toolUse").and_then(Value::as_object) {
            let id = tool_use
                .get("toolUseId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("tool-call-{}", Uuid::new_v4()));
            let wire_name = tool_use
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let input = tool_use.get("input").cloned().unwrap_or_else(|| json!({}));
            tool_calls.push(AgentToolInvocation {
                id,
                name: resolve_canonical_tool_name(wire_name, &wire_to_canonical),
                input,
            });
        }
    }

    let usage = AgentInferenceUsage {
        input_tokens: payload
            .get("usage")
            .and_then(|usage| usage.get("inputTokens"))
            .and_then(Value::as_i64),
        output_tokens: payload
            .get("usage")
            .and_then(|usage| usage.get("outputTokens"))
            .and_then(Value::as_i64),
        total_tokens: payload
            .get("usage")
            .and_then(|usage| usage.get("totalTokens"))
            .and_then(Value::as_i64),
    };

    let result = AgentInferenceResponse {
        assistant_text: assistant_parts.join("\n"),
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
