use super::{
    apply_headers, client, entry, normalize_base_url, parse_tool_arguments, read_text_lines,
    request_error, system_prompt_from_messages,
};
use super::{
    ChatMessage, ChatResponse, ModelResponse, ProviderRuntimeConfig, ToolCall, ToolDefinition,
};
use crate::storage::{trim_to_string, AiProviderModelEntry};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) fn generate_content_body(messages: &[ChatMessage]) -> Value {
    generate_content_body_with_tools(messages, &[])
}

pub(super) fn generate_content_body_with_tools(
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
) -> Value {
    let contents = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(|message| {
            json!({
                "role": if message.role == "assistant" { "model" } else { "user" },
                "parts": [{ "text": message.content }]
            })
        })
        .collect::<Vec<_>>();
    let mut body = json!({ "contents": contents });
    if let Some(system) = system_prompt_from_messages(messages) {
        body["systemInstruction"] = json!({
            "parts": [{ "text": system }]
        });
    }
    if !tools.is_empty() {
        body["tools"] = json!([{
            "functionDeclarations": tools
                .iter()
                .map(gemini_tool_definition)
                .collect::<Vec<_>>()
        }]);
    }
    body
}

fn gemini_tool_definition(tool: &ToolDefinition) -> Value {
    json!({
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.input_schema,
    })
}

pub(super) fn discover_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Google AI API key is required"))?;
    let url = format!(
        "{}/v1beta/models?key={}",
        normalize_base_url(config),
        api_key
    );
    let response = apply_headers(client()?.get(url), config).send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let models = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Google AI did not return models"))?;
    Ok(models
        .iter()
        .filter(|item| {
            item.get("supportedGenerationMethods")
                .and_then(Value::as_array)
                .map(|methods| {
                    methods
                        .iter()
                        .any(|method| method.as_str() == Some("generateContent"))
                })
                .unwrap_or(true)
        })
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .filter_map(|name| trim_to_string(name.trim_start_matches("models/")))
        .map(|id| entry(id, "dynamic"))
        .collect())
}

pub(super) fn generate_response(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    if cancel.load(Ordering::Relaxed) {
        return Err(anyhow!("turn cancelled"));
    }
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Google AI API key is required"))?;
    let body = generate_content_body(&messages);
    let response = apply_headers(
        client()?
            .post(generate_content_url(&config, &api_key))
            .json(&body),
        &config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let value: Value = response.json()?;
    let text = gemini_text_from_response(&value);
    if !text.is_empty() {
        on_delta(&text)?;
    }
    Ok(ModelResponse { text, usage: None })
}

pub(super) fn stream_completion_with_tools(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    let api_key = config
        .api_key
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("Google AI API key is required"))?;
    let body = generate_content_body_with_tools(&messages, &tools);
    let response = apply_headers(
        client()?
            .post(stream_generate_content_url(&config, &api_key))
            .json(&body),
        &config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let mut text = String::new();
    let mut tool_calls = Vec::new();
    read_text_lines(response, cancel, |line| {
        let Some(value) = parse_gemini_stream_line(line) else {
            return Ok(());
        };
        let delta = gemini_text_from_response(&value);
        if !delta.is_empty() {
            text.push_str(&delta);
            on_delta(&delta)?;
        }
        tool_calls.extend(gemini_tool_calls_from_response(&value));
        Ok(())
    })?;
    Ok(ChatResponse {
        text,
        usage: None,
        tool_calls,
    })
}

fn generate_content_url(config: &ProviderRuntimeConfig, api_key: &str) -> String {
    let model = config.model.trim_start_matches("models/");
    format!(
        "{}/v1beta/models/{}:generateContent?key={}",
        normalize_base_url(config),
        model,
        api_key
    )
}

fn stream_generate_content_url(config: &ProviderRuntimeConfig, api_key: &str) -> String {
    let model = config.model.trim_start_matches("models/");
    format!(
        "{}/v1beta/models/{}:streamGenerateContent?key={}&alt=sse",
        normalize_base_url(config),
        model,
        api_key
    )
}

fn parse_gemini_stream_line(line: &str) -> Option<Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed == "data: [DONE]" {
        return None;
    }
    let data = trimmed
        .strip_prefix("data:")
        .map(str::trim)
        .unwrap_or(trimmed);
    serde_json::from_str(data).ok()
}

fn gemini_text_from_response(value: &Value) -> String {
    candidate_parts(value)
        .into_iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("")
}

fn gemini_tool_calls_from_response(value: &Value) -> Vec<ToolCall> {
    candidate_parts(value)
        .into_iter()
        .filter_map(|part| part.get("functionCall"))
        .filter_map(|function_call| {
            let name = function_call
                .get("name")
                .and_then(Value::as_str)
                .and_then(trim_to_string)?;
            let arguments = function_call
                .get("args")
                .cloned()
                .unwrap_or_else(|| parse_tool_arguments(""));
            Some(ToolCall {
                id: format!("gemini_{name}"),
                name,
                arguments,
            })
        })
        .collect()
}

fn candidate_parts(value: &Value) -> Vec<&Value> {
    value
        .get("candidates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|candidate| candidate.get("content"))
        .filter_map(|content| content.get("parts"))
        .filter_map(Value::as_array)
        .flatten()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn messages() -> Vec<ChatMessage> {
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: "System".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: "hello".to_string(),
            },
            ChatMessage {
                role: "assistant".to_string(),
                content: "hi".to_string(),
            },
        ]
    }

    #[test]
    fn body_uses_system_instruction_and_filters_contents() {
        let body = generate_content_body(&messages());
        let contents = body["contents"].as_array().expect("contents");

        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "System");
        assert_eq!(contents.len(), 2);
        assert_eq!(contents[0]["role"], "user");
        assert_eq!(contents[1]["role"], "model");
    }

    #[test]
    fn body_includes_function_declarations() {
        let body = generate_content_body_with_tools(
            &messages(),
            &[ToolDefinition {
                name: "read_file".to_string(),
                description: "Read a file".to_string(),
                input_schema: json!({ "type": "object" }),
            }],
        );

        assert_eq!(
            body["tools"][0]["functionDeclarations"][0]["name"],
            "read_file"
        );
        assert_eq!(
            body["tools"][0]["functionDeclarations"][0]["parameters"]["type"],
            "object"
        );
    }

    #[test]
    fn parses_function_call_parts() {
        let calls = gemini_tool_calls_from_response(&json!({
            "candidates": [{
                "content": {
                    "parts": [{
                        "functionCall": {
                            "name": "read_file",
                            "args": { "path": "README.md" }
                        }
                    }]
                }
            }]
        }));

        assert_eq!(calls[0].name, "read_file");
        assert_eq!(calls[0].arguments["path"], "README.md");
    }
}
