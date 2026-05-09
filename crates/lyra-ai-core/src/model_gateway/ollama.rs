use super::{client, entry, normalize_base_url, parse_tool_arguments, read_line_json_stream};
use super::{request_error, ChatMessage, ChatResponse, ModelResponse, ProviderRuntimeConfig};
use super::{ToolCall, ToolDefinition};
use crate::storage::{trim_to_string, AiProviderModelEntry};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;

pub(super) fn chat_body(
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
        body["tools"] = json!(tools
            .iter()
            .map(|tool| json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                }
            }))
            .collect::<Vec<_>>());
    }
    body
}

pub(super) fn discover_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let url = format!("{}/api/tags", normalize_base_url(config));
    let response = client()?.get(url).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let models = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Ollama did not return models"))?;
    Ok(models
        .iter()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .filter_map(trim_to_string)
        .map(|id| entry(id, "dynamic"))
        .collect())
}

pub(super) fn generate_response(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let body = chat_body(&config, &messages, &[]);
    let url = format!("{}/api/chat", normalize_base_url(&config));
    let response = client()?.post(url).json(&body).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    read_line_json_stream(response, cancel, |value| {
        if let Some(delta) = ollama_text_delta(value) {
            if !delta.is_empty() {
                on_delta(&delta)?;
            }
        }
        Ok(())
    })
}

pub(super) fn stream_completion_with_tools(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    let body = chat_body(&config, &messages, &tools);
    let url = format!("{}/api/chat", normalize_base_url(&config));
    let response = client()?.post(url).json(&body).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let mut text = String::new();
    let mut tool_calls = Vec::new();
    read_line_json_stream(response, cancel, |value| {
        if let Some(delta) = ollama_text_delta(value) {
            if !delta.is_empty() {
                text.push_str(&delta);
                on_delta(&delta)?;
            }
        }
        tool_calls.extend(ollama_tool_calls(value));
        Ok(())
    })?;
    Ok(ChatResponse {
        text,
        usage: None,
        tool_calls,
    })
}

fn ollama_text_delta(value: &Value) -> Option<String> {
    value
        .get("message")
        .and_then(|message| message.get("content"))
        .or_else(|| value.get("response"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn ollama_tool_calls(value: &Value) -> Vec<ToolCall> {
    value
        .get("message")
        .and_then(|message| message.get("tool_calls"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|call| {
            let function = call.get("function")?;
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .and_then(trim_to_string)?;
            let arguments = match function.get("arguments") {
                Some(Value::String(raw)) => parse_tool_arguments(raw),
                Some(value) => value.clone(),
                None => parse_tool_arguments(""),
            };
            Some(ToolCall {
                id: call
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToString::to_string)
                    .unwrap_or_else(|| format!("ollama_{name}")),
                name,
                arguments,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ProviderRuntimeConfig {
        ProviderRuntimeConfig {
            provider_id: "ollama".to_string(),
            protocol_id: "ollama_chat".to_string(),
            base_url: String::new(),
            api_key: None,
            auth_scheme: None,
            headers: Default::default(),
            connection_config: Default::default(),
            model_runtime_metadata: None,
            model: "llama".to_string(),
        }
    }

    #[test]
    fn body_includes_ollama_tools() {
        let body = chat_body(
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

        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["function"]["name"], "read_file");
    }

    #[test]
    fn parses_ollama_tool_calls() {
        let calls = ollama_tool_calls(&json!({
            "message": {
                "tool_calls": [{
                    "function": {
                        "name": "read_file",
                        "arguments": { "path": "README.md" }
                    }
                }]
            }
        }));

        assert_eq!(calls[0].name, "read_file");
        assert_eq!(calls[0].arguments["path"], "README.md");
    }
}
