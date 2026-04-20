use std::cell::Cell;
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};

use napi::Result;
use serde_json::{json, Value};

use crate::agent::error_recovery::{classify_network_error, ExponentialBackoff};
use crate::error::{now_ms, to_error};
use crate::profile::types::{AiProfileValidationResult, AiProviderModelEntry, AiProviderProfile};
use crate::provider::types::{
    apply_custom_headers, build_client, fallback_models, optional_connection_value, secret_value,
    AgentInferenceDeltaCallback, AgentInferenceMessage, AgentInferenceMessageRole,
    AgentInferenceResponse, AgentInferenceUsage, AgentReasoningDeltaCallback, AgentToolDefinition,
    AgentToolInvocation,
};

fn base_url(profile: &AiProviderProfile) -> String {
    optional_connection_value(profile, "baseUrl")
        .unwrap_or_else(|| "https://api.anthropic.com".to_string())
        .trim_end_matches('/')
        .to_string()
}

pub(crate) fn apply_headers(
    builder: reqwest::blocking::RequestBuilder,
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
) -> Result<reqwest::blocking::RequestBuilder> {
    let api_key = secret_value(secrets, "apiKey").ok_or_else(|| to_error("apiKey is required"))?;
    Ok(apply_custom_headers(builder, profile)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01"))
}

fn map_anthropic_tools(tools: &[AgentToolDefinition]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.input_schema.clone(),
            })
        })
        .collect()
}

fn map_anthropic_messages(messages: &[AgentInferenceMessage]) -> Result<Vec<Value>> {
    let mut mapped = Vec::with_capacity(messages.len());
    for message in messages {
        match message.role {
            AgentInferenceMessageRole::System => {
                // Anthropic system prompt is provided via top-level "system" field.
                continue;
            }
            AgentInferenceMessageRole::User => {
                mapped.push(json!({
                    "role": "user",
                    "content": [{ "type": "text", "text": message.content }],
                }));
            }
            AgentInferenceMessageRole::Assistant => {
                let mut blocks = Vec::new();
                if message.content.trim().is_empty() == false {
                    blocks.push(json!({
                        "type": "text",
                        "text": message.content,
                    }));
                }
                for tool_call in &message.tool_calls {
                    blocks.push(json!({
                        "type": "tool_use",
                        "id": tool_call.id,
                        "name": tool_call.name,
                        "input": tool_call.input.clone(),
                    }));
                }
                if blocks.is_empty() {
                    blocks.push(json!({
                        "type": "text",
                        "text": "",
                    }));
                }
                mapped.push(json!({
                    "role": "assistant",
                    "content": blocks,
                }));
            }
            AgentInferenceMessageRole::Tool => {
                let tool_use_id = message.tool_call_id.clone().ok_or_else(|| {
                    to_error("anthropic tool result message missing tool_call_id")
                })?;
                mapped.push(json!({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": [{ "type": "text", "text": message.content }],
                    }],
                }));
            }
        }
    }
    Ok(mapped)
}

fn split_anthropic_system_prompt(
    messages: &[AgentInferenceMessage],
) -> (Option<String>, Vec<AgentInferenceMessage>) {
    let mut system_fragments = Vec::new();
    let mut conversational = Vec::new();

    for message in messages {
        if matches!(message.role, AgentInferenceMessageRole::System) {
            let trimmed = message.content.trim();
            if !trimmed.is_empty() {
                system_fragments.push(trimmed.to_string());
            }
            continue;
        }
        conversational.push(message.clone());
    }

    let system_prompt = if system_fragments.is_empty() {
        None
    } else {
        Some(system_fragments.join("\n\n"))
    };
    (system_prompt, conversational)
}

fn build_anthropic_request_payload(
    profile: &AiProviderProfile,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
    stream: bool,
) -> Result<Value> {
    let (system_prompt, conversational_messages) = split_anthropic_system_prompt(messages);
    let mut payload = json!({
        "model": profile.model,
        "max_tokens": 2048,
        "messages": map_anthropic_messages(&conversational_messages)?,
        "tools": map_anthropic_tools(tools),
    });
    if let Some(object) = payload.as_object_mut() {
        if stream {
            object.insert("stream".to_string(), Value::Bool(true));
        }
        if let Some(system_prompt) = system_prompt {
            object.insert("system".to_string(), Value::String(system_prompt));
        }
    }
    Ok(payload)
}

pub fn run_agent_inference(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
    on_assistant_delta: Option<&mut AgentInferenceDeltaCallback<'_>>,
    on_reasoning_delta: Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<AgentInferenceResponse> {
    let mut on_assistant_delta = on_assistant_delta;
    let mut on_reasoning_delta = on_reasoning_delta;
    let has_delta_listener = on_assistant_delta.is_some();
    let emitted_delta = Cell::new(false);
    let mut bridge = |delta: &str| {
        if has_delta_listener {
            emitted_delta.set(true);
            if let Some(callback) = on_assistant_delta.as_deref_mut() {
                callback(delta);
            }
        }
    };

    // Retry with backoff: up to 2 attempts for recoverable errors
    let backoff = ExponentialBackoff::default();
    let max_retries = 2;

    for attempt in 0..=max_retries {
        match run_agent_inference_stream(
            profile,
            secrets,
            messages,
            tools,
            Some(&mut bridge),
            on_reasoning_delta.as_deref_mut(),
        ) {
            Ok(response) => return Ok(response),
            Err(_error) if !emitted_delta.get() => {
                // Stream failed before emitting any content — try non-stream fallback
                return run_agent_inference_non_stream(profile, secrets, messages, tools).map(
                    |response| {
                        if !response.assistant_text.is_empty() {
                            if let Some(callback) = on_assistant_delta.as_deref_mut() {
                                callback(&response.assistant_text);
                            }
                        }
                        response
                    },
                );
            }
            Err(error) => {
                // Classify the error to determine if retry is worthwhile
                let error_msg = error.to_string();
                let severity = classify_network_error(&error_msg);

                if !severity.is_recoverable() || attempt >= max_retries {
                    return Err(error);
                }

                // Backoff before retry
                let delay = backoff.delay_ms(attempt).max(severity.retry_after_ms());
                std::thread::sleep(std::time::Duration::from_millis(delay));
            }
        }
    }

    // Should not reach here, but satisfy the compiler
    run_agent_inference_stream(profile, secrets, messages, tools, Some(&mut bridge), None)
}

#[derive(Default)]
struct AnthropicPartialToolUse {
    id: Option<String>,
    name: Option<String>,
    input_json: String,
    input_value: Option<Value>,
}

fn append_anthropic_delta_content(
    chunk: &str,
    assistant_text: &mut String,
    on_assistant_delta: &mut Option<&mut AgentInferenceDeltaCallback<'_>>,
) {
    if chunk.is_empty() {
        return;
    }
    assistant_text.push_str(chunk);
    if let Some(callback) = on_assistant_delta.as_deref_mut() {
        callback(chunk);
    }
}

fn process_anthropic_stream_event(
    raw_data: &str,
    assistant_text: &mut String,
    partial_tools: &mut Vec<AnthropicPartialToolUse>,
    usage: &mut AgentInferenceUsage,
    on_assistant_delta: &mut Option<&mut AgentInferenceDeltaCallback<'_>>,
    on_reasoning_delta: &mut Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<bool> {
    let event_data = raw_data.trim();
    if event_data.is_empty() {
        return Ok(false);
    }
    if event_data == "[DONE]" {
        return Ok(true);
    }

    let payload = serde_json::from_str::<Value>(event_data).map_err(|error| {
        to_error(format!(
            "failed to parse anthropic stream event payload: {error}"
        ))
    })?;
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if event_type == "message_start" {
        if let Some(input_tokens) = payload
            .get("message")
            .and_then(|message| message.get("usage"))
            .and_then(|usage| usage.get("input_tokens"))
            .and_then(Value::as_i64)
        {
            usage.input_tokens = Some(input_tokens);
        }
        if let Some(output_tokens) = payload
            .get("message")
            .and_then(|message| message.get("usage"))
            .and_then(|usage| usage.get("output_tokens"))
            .and_then(Value::as_i64)
        {
            usage.output_tokens = Some(output_tokens);
        }
        return Ok(false);
    }

    if event_type == "message_delta" {
        if let Some(output_tokens) = payload
            .get("usage")
            .and_then(|usage| usage.get("output_tokens"))
            .and_then(Value::as_i64)
        {
            usage.output_tokens = Some(output_tokens);
        }
        return Ok(false);
    }

    if event_type == "content_block_start" {
        let index = payload
            .get("index")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(partial_tools.len());
        if partial_tools.len() <= index {
            partial_tools.resize_with(index + 1, AnthropicPartialToolUse::default);
        }
        if let Some(content_block) = payload.get("content_block").and_then(Value::as_object) {
            let block_type = content_block
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if block_type == "text" {
                if let Some(text) = content_block.get("text").and_then(Value::as_str) {
                    append_anthropic_delta_content(text, assistant_text, on_assistant_delta);
                }
                return Ok(false);
            }
            if block_type == "tool_use" {
                let entry = &mut partial_tools[index];
                if let Some(id) = content_block
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::trim)
                {
                    if !id.is_empty() {
                        entry.id = Some(id.to_string());
                    }
                }
                if let Some(name) = content_block
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::trim)
                {
                    if !name.is_empty() {
                        entry.name = Some(name.to_string());
                    }
                }
                if let Some(input) = content_block.get("input") {
                    entry.input_value = Some(input.clone());
                }
            }
        }
        return Ok(false);
    }

    if event_type == "content_block_delta" {
        let index = payload
            .get("index")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(0);
        if partial_tools.len() <= index {
            partial_tools.resize_with(index + 1, AnthropicPartialToolUse::default);
        }
        if let Some(delta) = payload.get("delta").and_then(Value::as_object) {
            let delta_type = delta
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if delta_type == "text_delta" {
                if let Some(text) = delta.get("text").and_then(Value::as_str) {
                    append_anthropic_delta_content(text, assistant_text, on_assistant_delta);
                }
                return Ok(false);
            }
            if delta_type == "input_json_delta" {
                if let Some(partial_json) = delta.get("partial_json").and_then(Value::as_str) {
                    partial_tools[index].input_json.push_str(partial_json);
                }
            }
            if delta_type == "thinking_delta" {
                if let Some(thinking) = delta.get("thinking").and_then(Value::as_str) {
                    if let Some(callback) = on_reasoning_delta.as_deref_mut() {
                        callback(thinking);
                    }
                }
            }
        }
        return Ok(false);
    }

    if event_type == "message_stop" {
        return Ok(true);
    }

    Ok(false)
}

fn run_agent_inference_stream(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
    mut on_assistant_delta: Option<&mut AgentInferenceDeltaCallback<'_>>,
    mut on_reasoning_delta: Option<&mut AgentReasoningDeltaCallback<'_>>,
) -> Result<AgentInferenceResponse> {
    let client = build_client()?;
    let payload = build_anthropic_request_payload(profile, messages, tools, true)?;
    let response = apply_headers(
        client.post(format!("{}/v1/messages", base_url(profile))),
        profile,
        secrets,
    )?
    .json(&payload)
    .send()
    .map_err(|error| to_error(format!("anthropic inference request failed: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "anthropic inference failed ({status}): {body}"
        )));
    }

    let mut reader = BufReader::new(response);
    let mut assistant_text = String::new();
    let mut partial_tools = Vec::<AnthropicPartialToolUse>::new();
    let mut usage = AgentInferenceUsage::default();
    let mut line = String::new();
    let mut event_data = String::new();

    loop {
        line.clear();
        let bytes = reader.read_line(&mut line).map_err(|error| {
            to_error(format!("failed reading anthropic stream response: {error}"))
        })?;
        if bytes == 0 {
            if !event_data.is_empty() {
                let _ = process_anthropic_stream_event(
                    &event_data,
                    &mut assistant_text,
                    &mut partial_tools,
                    &mut usage,
                    &mut on_assistant_delta,
                    &mut on_reasoning_delta,
                )?;
                event_data.clear();
            }
            break;
        }

        let stripped = line.trim_end_matches(['\r', '\n']);
        if stripped.is_empty() {
            if !event_data.is_empty() {
                let should_stop = process_anthropic_stream_event(
                    &event_data,
                    &mut assistant_text,
                    &mut partial_tools,
                    &mut usage,
                    &mut on_assistant_delta,
                    &mut on_reasoning_delta,
                )?;
                event_data.clear();
                if should_stop {
                    break;
                }
            }
            continue;
        }

        if let Some(value) = stripped.strip_prefix("data:") {
            if !event_data.is_empty() {
                event_data.push('\n');
            }
            event_data.push_str(value.trim_start());
        }
    }

    let tool_calls = partial_tools
        .into_iter()
        .filter_map(|entry| {
            let id = entry.id?;
            let name = entry.name?;
            let input = if let Some(input) = entry.input_value {
                input
            } else if entry.input_json.trim().is_empty() {
                json!({})
            } else {
                serde_json::from_str::<Value>(&entry.input_json).unwrap_or_else(|_| json!({}))
            };
            Some(AgentToolInvocation { id, name, input })
        })
        .collect::<Vec<_>>();

    Ok(AgentInferenceResponse {
        assistant_text,
        reasoning_content: String::new(),
        tool_calls,
        usage,
    })
}

fn run_agent_inference_non_stream(
    profile: &AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    messages: &[AgentInferenceMessage],
    tools: &[AgentToolDefinition],
) -> Result<AgentInferenceResponse> {
    let client = build_client()?;
    let payload = build_anthropic_request_payload(profile, messages, tools, false)?;
    let response = apply_headers(
        client.post(format!("{}/v1/messages", base_url(profile))),
        profile,
        secrets,
    )?
    .json(&payload)
    .send()
    .map_err(|error| to_error(format!("anthropic inference request failed: {error}")))?;
    if response.status().is_success() == false {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(to_error(format!(
            "anthropic inference failed ({status}): {body}"
        )));
    }
    let payload = response.json::<Value>().map_err(|error| {
        to_error(format!(
            "failed to parse anthropic inference payload: {error}"
        ))
    })?;

    let mut assistant_text_fragments = Vec::new();
    let mut tool_calls = Vec::new();

    for item in payload
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let Some(item_type) = item.get("type").and_then(Value::as_str) else {
            continue;
        };
        if item_type == "text" {
            if let Some(text) = item.get("text").and_then(Value::as_str) {
                let normalized = text.trim();
                if normalized.is_empty() == false {
                    assistant_text_fragments.push(normalized.to_string());
                }
            }
            continue;
        }
        if item_type == "tool_use" {
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| to_error("anthropic tool_use item missing id"))?
                .to_string();
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| to_error("anthropic tool_use item missing name"))?
                .to_string();
            let input = item.get("input").cloned().unwrap_or_else(|| json!({}));
            tool_calls.push(AgentToolInvocation { id, name, input });
        }
    }

    let usage = AgentInferenceUsage {
        input_tokens: payload
            .get("usage")
            .and_then(|usage| usage.get("input_tokens"))
            .and_then(Value::as_i64),
        output_tokens: payload
            .get("usage")
            .and_then(|usage| usage.get("output_tokens"))
            .and_then(Value::as_i64),
        total_tokens: None,
    };

    Ok(AgentInferenceResponse {
        assistant_text: assistant_text_fragments.join("\n"),
        reasoning_content: String::new(),
        tool_calls,
        usage,
    })
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::{
        build_anthropic_request_payload, map_anthropic_messages, split_anthropic_system_prompt,
    };
    use crate::profile::types::{AiModelDiscoveryState, AiProviderProfile};
    use crate::provider::types::{
        AgentInferenceMessage, AgentInferenceMessageRole, AgentToolDefinition,
    };

    fn sample_profile() -> AiProviderProfile {
        AiProviderProfile {
            id: "profile-1".to_string(),
            name: "Anthropic".to_string(),
            provider_id: "anthropic".to_string(),
            protocol_id: "anthropic_messages".to_string(),
            preset_id: None,
            connection_config: BTreeMap::new(),
            auth_config: BTreeMap::new(),
            configured_secret_fields: Vec::new(),
            headers: BTreeMap::new(),
            model: "claude-test".to_string(),
            custom_models: Vec::new(),
            discovery_state: AiModelDiscoveryState {
                status: "idle".to_string(),
                last_checked_at: None,
                error_message: None,
                models: Vec::new(),
            },
            is_default: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn anthropic_splits_system_prompt_from_conversation_messages() {
        let messages = vec![
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::System,
                content: "You are Lyra.".to_string(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::User,
                content: "hello".to_string(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
        ];
        let (system_prompt, conversational) = split_anthropic_system_prompt(&messages);
        assert_eq!(system_prompt.as_deref(), Some("You are Lyra."));
        assert_eq!(conversational.len(), 1);
        assert!(matches!(
            conversational[0].role,
            AgentInferenceMessageRole::User
        ));
    }

    #[test]
    fn anthropic_message_mapper_ignores_system_role_messages() {
        let messages = vec![
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::System,
                content: "You are Lyra.".to_string(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::User,
                content: "hello".to_string(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
        ];
        let mapped = map_anthropic_messages(&messages).expect("map anthropic messages");
        assert_eq!(mapped.len(), 1);
        assert_eq!(
            mapped[0].get("role").and_then(serde_json::Value::as_str),
            Some("user")
        );
    }

    #[test]
    fn anthropic_payload_places_system_at_top_level() {
        let profile = sample_profile();
        let messages = vec![
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::System,
                content: "You are Lyra.".to_string(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::User,
                content: "hello".to_string(),
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
        ];
        let payload = build_anthropic_request_payload(
            &profile,
            &messages,
            &[AgentToolDefinition {
                name: "filesystem.list".to_string(),
                description: "list".to_string(),
                input_schema: json!({"type":"object"}),
            }],
            true,
        )
        .expect("build anthropic payload");
        assert_eq!(
            payload.get("system").and_then(serde_json::Value::as_str),
            Some("You are Lyra.")
        );
        assert_eq!(
            payload
                .get("messages")
                .and_then(serde_json::Value::as_array)
                .map(|entries| entries.len()),
            Some(1)
        );
    }
}
