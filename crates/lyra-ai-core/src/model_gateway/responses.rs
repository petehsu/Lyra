use super::{
    apply_headers, client, normalize_base_url, parse_tool_arguments, provider_auth,
    read_sse_stream, read_text_lines, request_error, system_prompt_from_messages,
};
use super::{
    ChatMessage, ChatResponse, ModelResponse, ProviderRuntimeConfig, ToolCall, ToolDefinition,
};
use crate::storage::AiProviderModelEntry;
use anyhow::Result;
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;

#[derive(Default)]
struct PendingResponseToolCall {
    key: String,
    id: String,
    name: String,
    arguments: String,
}

pub(super) fn responses_body(config: &ProviderRuntimeConfig, messages: &[ChatMessage]) -> Value {
    responses_body_with_tools(config, messages, &[])
}

pub(super) fn responses_body_with_tools(
    config: &ProviderRuntimeConfig,
    messages: &[ChatMessage],
    tools: &[ToolDefinition],
) -> Value {
    let input = messages
        .iter()
        .filter(|message| message.role != "system")
        .map(response_input_message)
        .collect::<Vec<_>>();
    let mut body = json!({
        "model": config.model,
        "input": input,
        "stream": true
    });
    if let Some(instructions) = system_prompt_from_messages(messages) {
        body["instructions"] = json!(instructions);
    }
    if tools.is_empty() == false {
        body["tools"] = json!(tools
            .iter()
            .map(responses_tool_definition)
            .collect::<Vec<_>>());
        body["tool_choice"] = json!("auto");
    }
    body
}

fn response_input_message(message: &ChatMessage) -> Value {
    let role = match message.role.as_str() {
        "assistant" => "assistant",
        _ => "user",
    };
    json!({
        "role": role,
        "content": message.content
    })
}

fn responses_tool_definition(tool: &ToolDefinition) -> Value {
    json!({
        "type": "function",
        "name": tool.name,
        "description": tool.description,
        "parameters": tool.input_schema,
    })
}

pub(super) fn discover_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    super::openai::discover_models(config)
}

pub(super) fn generate_response(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let body = responses_body(&config, &messages);
    let url = format!("{}/responses", normalize_base_url(&config));
    let response = apply_headers(
        provider_auth(client()?.post(url).json(&body), &config),
        &config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    read_sse_stream(response, cancel, on_delta, extract_responses_text_delta)
}

pub(super) fn stream_completion_with_tools(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    let body = responses_body_with_tools(&config, &messages, &tools);
    let url = format!("{}/responses", normalize_base_url(&config));
    let response = apply_headers(
        provider_auth(client()?.post(url).json(&body), &config),
        &config,
    )
    .send()?;
    if !response.status().is_success() {
        return Err(request_error(response));
    }
    let mut text = String::new();
    let mut pending = Vec::<PendingResponseToolCall>::new();
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
        if let Some(delta) = extract_responses_text_delta(&value) {
            if !delta.is_empty() {
                text.push_str(&delta);
                on_delta(&delta)?;
            }
        }
        accumulate_responses_tool_calls(&value, &mut pending);
        Ok(())
    })?;
    Ok(ChatResponse {
        text,
        usage: None,
        tool_calls: finish_tool_calls(pending),
    })
}

fn extract_responses_text_delta(value: &Value) -> Option<String> {
    match value.get("type").and_then(Value::as_str) {
        Some("response.output_text.delta") => value
            .get("delta")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        _ => None,
    }
}

fn accumulate_responses_tool_calls(value: &Value, pending: &mut Vec<PendingResponseToolCall>) {
    match value.get("type").and_then(Value::as_str) {
        Some("response.output_item.added") | Some("response.output_item.done") => {
            if let Some(item) = value.get("item") {
                accumulate_response_function_item(value, item, pending);
            }
        }
        Some("response.function_call_arguments.delta") => {
            let key = event_tool_key(value);
            let call = pending_tool_call(pending, key);
            if let Some(delta) = value.get("delta").and_then(Value::as_str) {
                call.arguments.push_str(delta);
            }
        }
        Some("response.function_call_arguments.done") => {
            let key = event_tool_key(value);
            let call = pending_tool_call(pending, key);
            if let Some(arguments) = value.get("arguments").and_then(Value::as_str) {
                call.arguments = arguments.to_string();
            }
        }
        _ => {}
    }
}

fn accumulate_response_function_item(
    event: &Value,
    item: &Value,
    pending: &mut Vec<PendingResponseToolCall>,
) {
    if item.get("type").and_then(Value::as_str) != Some("function_call") {
        return;
    }
    let key = item
        .get("id")
        .or_else(|| item.get("call_id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| event_tool_key(event));
    let call = pending_tool_call(pending, key);
    if let Some(id) = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
    {
        call.id = id.to_string();
    }
    if let Some(name) = item.get("name").and_then(Value::as_str) {
        call.name = name.to_string();
    }
    if let Some(arguments) = item.get("arguments").and_then(Value::as_str) {
        call.arguments = arguments.to_string();
    }
}

fn pending_tool_call(
    pending: &mut Vec<PendingResponseToolCall>,
    key: String,
) -> &mut PendingResponseToolCall {
    if let Some(index) = pending.iter().position(|call| call.key == key) {
        return &mut pending[index];
    }
    pending.push(PendingResponseToolCall {
        key,
        ..Default::default()
    });
    pending.last_mut().expect("pending call")
}

fn event_tool_key(value: &Value) -> String {
    value
        .get("item_id")
        .or_else(|| value.get("call_id"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            value
                .get("output_index")
                .and_then(Value::as_i64)
                .map(|index| format!("output_index:{index}"))
        })
        .unwrap_or_else(|| "output_index:0".to_string())
}

fn finish_tool_calls(pending: Vec<PendingResponseToolCall>) -> Vec<ToolCall> {
    pending
        .into_iter()
        .enumerate()
        .filter(|(_, call)| !call.name.trim().is_empty())
        .map(|(index, call)| ToolCall {
            id: if call.id.trim().is_empty() {
                format!("response_tool_call_{index}")
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
            protocol_id: "openai_responses".to_string(),
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
    fn body_moves_system_messages_to_instructions() {
        let body = responses_body(&config(), &messages());

        assert_eq!(body["instructions"], "You are Lyra.");
        assert_eq!(body["input"][0]["role"], "user");
        assert_eq!(body["input"][0]["content"], "hello");
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn body_uses_responses_function_tool_schema() {
        let body = responses_body_with_tools(
            &config(),
            &messages(),
            &[ToolDefinition {
                name: "read_file".to_string(),
                description: "Read a file".to_string(),
                input_schema: json!({ "type": "object" }),
            }],
        );

        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["name"], "read_file");
        assert_eq!(body["tools"][0]["parameters"]["type"], "object");
        assert_eq!(body["tool_choice"], "auto");
    }

    #[test]
    fn streaming_tool_call_deltas_are_assembled() {
        let mut pending = Vec::new();
        accumulate_responses_tool_calls(
            &json!({
                "type": "response.output_item.added",
                "output_index": 0,
                "item": {
                    "id": "fc_1",
                    "call_id": "call_1",
                    "type": "function_call",
                    "name": "read_file"
                }
            }),
            &mut pending,
        );
        accumulate_responses_tool_calls(
            &json!({
                "type": "response.function_call_arguments.delta",
                "item_id": "fc_1",
                "delta": "{\"path\""
            }),
            &mut pending,
        );
        accumulate_responses_tool_calls(
            &json!({
                "type": "response.function_call_arguments.delta",
                "item_id": "fc_1",
                "delta": ":\"README.md\"}"
            }),
            &mut pending,
        );
        let calls = finish_tool_calls(pending);

        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].name, "read_file");
        assert_eq!(calls[0].arguments["path"], "README.md");
    }
}
