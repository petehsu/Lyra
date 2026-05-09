use super::{
    apply_headers, client, entry, normalize_base_url, parse_tool_arguments, read_sse_stream,
    read_text_lines, request_error, system_prompt_from_messages,
};
use super::{
    ChatMessage, ChatResponse, ModelResponse, ProviderRuntimeConfig, ToolCall, ToolDefinition,
};
use crate::storage::{trim_to_string, AiProviderModelEntry};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

#[derive(Default)]
struct PendingToolUse {
    id: String,
    name: String,
    arguments: String,
}

pub(super) fn messages_body(config: &ProviderRuntimeConfig, messages: &[ChatMessage]) -> Value {
    messages_body_with_tools(config, messages, &[])
}

pub(super) fn messages_body_with_tools(
    config: &ProviderRuntimeConfig,
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
) -> Value {
    let body_messages = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            json!({
                "role": if message.role == "assistant" { "assistant" } else { "user" },
                "content": message.content
            })
        })
        .collect::<Vec<_>>();
    let mut body = json!({
        "model": config.model,
        "max_tokens": 4096,
        "messages": body_messages,
        "stream": true
    });
    if let Some(system) = system_prompt_from_messages(messages) {
        body["system"] = json!(system);
    }
    if !tools.is_empty() {
        body["tools"] = json!(tools
            .iter()
            .map(anthropic_tool_definition)
            .collect::<Vec<_>>());
    }
    body
}

fn anthropic_tool_definition(tool: &ToolDefinition) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.input_schema,
    })
}

pub(super) fn discover_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Anthropic API key is required"))?;
    let url = format!("{}/v1/models", normalize_base_url(config));
    let response = apply_headers(
        client()?
            .get(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01"),
        config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Anthropic did not return a data array"))?;
    Ok(data
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .filter_map(trim_to_string)
        .map(|id| entry(id, "dynamic"))
        .collect())
}

pub(super) fn generate_response(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Anthropic API key is required"))?;
    let body = messages_body(&config, &messages);
    let request = client()?
        .post(format!("{}/v1/messages", normalize_base_url(&config)))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body);
    send_anthropic_request(config, request, cancel, on_delta)
}

pub(super) fn stream_completion_with_tools(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Anthropic API key is required"))?;
    let body = messages_body_with_tools(&config, &messages, &tools);
    let request = client()?
        .post(format!("{}/v1/messages", normalize_base_url(&config)))
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body);
    send_anthropic_request_with_tools(config, request, cancel, on_delta)
}

pub(super) fn send_anthropic_request(
    config: ProviderRuntimeConfig,
    request: reqwest::blocking::RequestBuilder,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let response = apply_headers(request, &config).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    read_sse_stream(response, cancel, on_delta, extract_text_delta)
}

pub(super) fn send_anthropic_request_with_tools(
    config: ProviderRuntimeConfig,
    request: reqwest::blocking::RequestBuilder,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    let response = apply_headers(request, &config).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let mut text = String::new();
    let mut pending = HashMap::<i64, PendingToolUse>::new();
    read_text_lines(response, cancel, |line| {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            return Ok(());
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data.is_empty() {
            return Ok(());
        }
        let value: Value = serde_json::from_str(data).unwrap_or(Value::Null);
        if let Some(delta) = extract_text_delta(&value) {
            if !delta.is_empty() {
                text.push_str(&delta);
                on_delta(&delta)?;
            }
        }
        accumulate_tool_use(&value, &mut pending);
        Ok(())
    })?;
    Ok(ChatResponse {
        text,
        usage: None,
        tool_calls: finish_tool_uses(pending),
    })
}

fn extract_text_delta(value: &Value) -> Option<String> {
    value
        .get("delta")
        .and_then(|delta| delta.get("text"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn accumulate_tool_use(value: &Value, pending: &mut HashMap<i64, PendingToolUse>) {
    let index = value.get("index").and_then(Value::as_i64).unwrap_or(0);
    if value.get("type").and_then(Value::as_str) == Some("content_block_start") {
        if let Some(block) = value.get("content_block") {
            if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                let entry = pending.entry(index).or_default();
                if let Some(id) = block.get("id").and_then(Value::as_str) {
                    entry.id = id.to_string();
                }
                if let Some(name) = block.get("name").and_then(Value::as_str) {
                    entry.name = name.to_string();
                }
                if let Some(input) = block.get("input").filter(|input| {
                    !input
                        .as_object()
                        .map(|object| object.is_empty())
                        .unwrap_or(false)
                }) {
                    entry.arguments.push_str(&input.to_string());
                }
            }
        }
    }
    if let Some(partial) = value
        .get("delta")
        .and_then(|delta| delta.get("partial_json"))
        .and_then(Value::as_str)
    {
        pending
            .entry(index)
            .or_default()
            .arguments
            .push_str(partial);
    }
}

fn finish_tool_uses(pending: HashMap<i64, PendingToolUse>) -> Vec<ToolCall> {
    let mut entries = pending.into_iter().collect::<Vec<_>>();
    entries.sort_by_key(|(index, _)| *index);
    entries
        .into_iter()
        .filter(|(_, call)| !call.name.trim().is_empty())
        .map(|(index, call)| ToolCall {
            id: if call.id.trim().is_empty() {
                format!("tool_use_{index}")
            } else {
                call.id
            },
            name: call.name,
            arguments: parse_tool_arguments(&call.arguments),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ProviderRuntimeConfig {
        ProviderRuntimeConfig {
            provider_id: "anthropic".to_string(),
            protocol_id: "anthropic_messages".to_string(),
            base_url: String::new(),
            api_key: Some("key".to_string()),
            auth_scheme: None,
            headers: Default::default(),
            connection_config: Default::default(),
            model_runtime_metadata: None,
            model: "claude-test".to_string(),
        }
    }

    #[test]
    fn body_moves_system_to_top_level_and_filters_messages() {
        let body = messages_body(
            &config(),
            &[
                ChatMessage {
                    role: "system".to_string(),
                    content: "System".to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: "hello".to_string(),
                },
            ],
        );

        assert_eq!(body["system"], "System");
        assert_eq!(body["messages"].as_array().expect("messages").len(), 1);
    }

    #[test]
    fn body_includes_anthropic_tool_schema() {
        let body = messages_body_with_tools(
            &config(),
            &[ChatMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            }],
            &[ToolDefinition {
                name: "read_file".to_string(),
                description: "Read a file".to_string(),
                input_schema: json!({ "type": "object" }),
            }],
        );

        assert_eq!(body["tools"][0]["name"], "read_file");
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
    }

    #[test]
    fn streaming_tool_use_deltas_are_assembled() {
        let mut pending = HashMap::new();
        accumulate_tool_use(
            &json!({
                "type": "content_block_start",
                "index": 1,
                "content_block": { "type": "tool_use", "id": "toolu_1", "name": "read_file", "input": {} }
            }),
            &mut pending,
        );
        accumulate_tool_use(
            &json!({ "index": 1, "delta": { "partial_json": "{\"path\":\"README.md\"}" } }),
            &mut pending,
        );
        let calls = finish_tool_uses(pending);

        assert_eq!(calls[0].id, "toolu_1");
        assert_eq!(calls[0].name, "read_file");
        assert_eq!(calls[0].arguments["path"], "README.md");
    }
}
