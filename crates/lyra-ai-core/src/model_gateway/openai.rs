use super::{
    apply_headers, client, entry, normalize_base_url, parse_tool_arguments, provider_auth,
    read_sse_stream, read_text_lines, request_error,
};
use super::{
    ChatMessage, ChatResponse, ModelResponse, ProviderRuntimeConfig, ToolCall, ToolDefinition,
};
use crate::storage::{trim_to_string, AiProviderModelEntry};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;

#[derive(Default)]
struct PendingToolCall {
    id: String,
    name: String,
    arguments: String,
}

pub(super) fn chat_body(config: &ProviderRuntimeConfig, messages: &[ChatMessage]) -> Value {
    chat_body_with_tools(config, messages, &[])
}

pub(super) fn chat_body_with_tools(
    config: &ProviderRuntimeConfig,
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
) -> Value {
    let body_messages = messages
        .iter()
        .map(|message| json!({ "role": message.role, "content": message.content }))
        .collect::<Vec<_>>();
    let mut body = json!({
        "model": config.model,
        "messages": body_messages,
        "stream": true
    });
    if !tools.is_empty() {
        body["tools"] = json!(tools.iter().map(openai_tool_definition).collect::<Vec<_>>());
        body["tool_choice"] = json!("auto");
    }
    body
}

fn openai_tool_definition(tool: &ToolDefinition) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description,
            "parameters": tool.input_schema,
        }
    })
}

pub(super) fn discover_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let url = format!("{}/models", normalize_base_url(config));
    let response = apply_headers(provider_auth(client()?.get(url), config), config).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("provider did not return a data array"))?;
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
    let body = chat_body(&config, &messages);
    let url = format!("{}/chat/completions", normalize_base_url(&config));
    let response = apply_headers(
        provider_auth(client()?.post(url).json(&body), &config),
        &config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    read_sse_stream(response, cancel, on_delta, extract_openai_text_delta)
}

pub(super) fn stream_completion_with_tools(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    let body = chat_body_with_tools(&config, &messages, &tools);
    let url = format!("{}/chat/completions", normalize_base_url(&config));
    let response = apply_headers(
        provider_auth(client()?.post(url).json(&body), &config),
        &config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let mut text = String::new();
    let mut pending = Vec::<PendingToolCall>::new();
    read_text_lines(response, cancel, |line| {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            return Ok(());
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data == "[DONE]" || data.is_empty() {
            return Ok(());
        }
        let value: Value = serde_json::from_str(data).unwrap_or(Value::Null);
        if let Some(delta) = extract_openai_text_delta(&value) {
            if !delta.is_empty() {
                text.push_str(&delta);
                on_delta(&delta)?;
            }
        }
        accumulate_openai_tool_calls(&value, &mut pending);
        Ok(())
    })?;
    Ok(ChatResponse {
        text,
        usage: None,
        tool_calls: finish_tool_calls(pending),
    })
}

fn extract_openai_text_delta(value: &Value) -> Option<String> {
    value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta").or_else(|| choice.get("message")))
        .and_then(|delta| delta.get("content"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn accumulate_openai_tool_calls(value: &Value, pending: &mut Vec<PendingToolCall>) {
    let Some(tool_calls) = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta").or_else(|| choice.get("message")))
        .and_then(|delta| delta.get("tool_calls"))
        .and_then(Value::as_array)
    else {
        return;
    };
    for call in tool_calls {
        let index = call.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
        while pending.len() <= index {
            pending.push(PendingToolCall::default());
        }
        let current = &mut pending[index];
        if let Some(id) = call.get("id").and_then(Value::as_str) {
            current.id = id.to_string();
        }
        if let Some(function) = call.get("function") {
            if let Some(name) = function.get("name").and_then(Value::as_str) {
                current.name = name.to_string();
            }
            if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                current.arguments.push_str(arguments);
            }
        }
    }
}

fn finish_tool_calls(pending: Vec<PendingToolCall>) -> Vec<ToolCall> {
    pending
        .into_iter()
        .enumerate()
        .filter(|(_, call)| !call.name.trim().is_empty())
        .map(|(index, call)| ToolCall {
            id: if call.id.trim().is_empty() {
                format!("tool_call_{index}")
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
            provider_id: "openai".to_string(),
            protocol_id: "openai_chat_completions".to_string(),
            base_url: String::new(),
            api_key: Some("key".to_string()),
            auth_scheme: None,
            headers: Default::default(),
            connection_config: Default::default(),
            model_runtime_metadata: None,
            model: "model-a".to_string(),
        }
    }

    fn messages() -> Vec<ChatMessage> {
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: "You are Lyra.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            },
        ]
    }

    #[test]
    fn body_preserves_system_role_message() {
        let body = chat_body(&config(), &messages());
        let messages = body["messages"].as_array().expect("messages");

        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "You are Lyra.");
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn body_includes_function_tool_schema() {
        let body = chat_body_with_tools(
            &config(),
            &messages(),
            &[ToolDefinition {
                name: "read_file".to_string(),
                description: "Read a file".to_string(),
                input_schema: json!({ "type": "object" }),
            }],
        );

        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "read_file");
        assert_eq!(body["tool_choice"], "auto");
    }

    #[test]
    fn streaming_tool_call_deltas_are_assembled() {
        let mut pending = Vec::new();
        accumulate_openai_tool_calls(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_1", "function": { "name": "read_file", "arguments": "{\"path\"" } }
            ] } }] }),
            &mut pending,
        );
        accumulate_openai_tool_calls(
            &json!({ "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "function": { "arguments": ":\"README.md\"}" } }
            ] } }] }),
            &mut pending,
        );
        let calls = finish_tool_calls(pending);

        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].name, "read_file");
        assert_eq!(calls[0].arguments["path"], "README.md");
    }
}
