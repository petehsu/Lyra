use serde_json::{Value, json};

use crate::{AgentRuntimeError, AgentRuntimeResult};

use super::super::openai_common::{content_to_plain_text, parse_tool_arguments};
use super::DEFAULT_MAX_TOKENS;

pub(crate) fn build_request_body(
    model: &str,
    messages: &[Value],
    tools: &[Value],
    stream: bool,
) -> AgentRuntimeResult<Value> {
    let (system, messages) = anthropic_messages_from_provider_messages(messages);
    let mut body = json!({
        "model": model,
        "max_tokens": DEFAULT_MAX_TOKENS,
        "messages": messages,
        "stream": stream,
    });
    if let Some(system) = system.filter(|value| !value.trim().is_empty()) {
        body["system"] = Value::String(system);
    }
    let tools = anthropic_tools_from_openai_tools(tools)?;
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools);
        body["tool_choice"] = json!({ "type": "auto" });
    }
    Ok(body)
}

fn anthropic_messages_from_provider_messages(messages: &[Value]) -> (Option<String>, Vec<Value>) {
    let mut system = Vec::new();
    let mut output = Vec::new();
    for message in messages {
        let Some(role) = message.get("role").and_then(Value::as_str) else {
            continue;
        };
        let content = message.get("content").cloned().unwrap_or(Value::Null);
        match role {
            "system" | "developer" => {
                let text = content_to_plain_text(&content);
                if !text.trim().is_empty() {
                    system.push(text);
                }
            }
            "assistant" => {
                let blocks = assistant_blocks(message, &content);
                if !blocks.is_empty() {
                    output.push(json!({
                        "role": "assistant",
                        "content": blocks,
                    }));
                }
            }
            "tool" => output.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": message
                        .get("tool_call_id")
                        .or_else(|| message.get("toolCallId"))
                        .and_then(Value::as_str)
                        .unwrap_or("tool-result"),
                    "content": content_to_plain_text(&content),
                }],
            })),
            _ => {
                let blocks = user_blocks(&content);
                if !blocks.is_empty() {
                    output.push(json!({
                        "role": "user",
                        "content": blocks,
                    }));
                }
            }
        }
    }
    (Some(system.join("\n\n")), output)
}

fn assistant_blocks(message: &Value, content: &Value) -> Vec<Value> {
    let mut blocks = Vec::new();
    if let Some(reasoning_content) = message
        .get("reasoning_content")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        blocks.push(json!({
            "type": "thinking",
            "thinking": reasoning_content,
        }));
    }
    blocks.extend(text_blocks(content));
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        blocks.extend(tool_calls.iter().filter_map(anthropic_tool_use_block));
    }
    blocks
}

fn anthropic_tool_use_block(tool_call: &Value) -> Option<Value> {
    let function = tool_call.get("function")?;
    let name = function.get("name").and_then(Value::as_str)?.trim();
    if name.is_empty() {
        return None;
    }
    let id = tool_call
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("tool-call");
    let input = match function.get("arguments") {
        Some(Value::String(text)) => parse_tool_arguments(text),
        Some(value) => value.clone(),
        None => json!({}),
    };
    Some(json!({
        "type": "tool_use",
        "id": id,
        "name": name,
        "input": input,
    }))
}

fn user_blocks(content: &Value) -> Vec<Value> {
    match content {
        Value::Array(parts) => parts
            .iter()
            .filter_map(anthropic_user_content_block)
            .collect(),
        _ => text_blocks(content),
    }
}

fn text_blocks(content: &Value) -> Vec<Value> {
    let text = content_to_plain_text(content);
    if text.trim().is_empty() {
        Vec::new()
    } else {
        vec![json!({ "type": "text", "text": text })]
    }
}

fn anthropic_user_content_block(part: &Value) -> Option<Value> {
    match part.get("type").and_then(Value::as_str) {
        Some("text") | Some("input_text") | Some("output_text") => Some(json!({
            "type": "text",
            "text": part.get("text").and_then(Value::as_str).unwrap_or_default(),
        })),
        Some("image_url") => anthropic_image_block(
            part.pointer("/image_url/url")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        Some("input_image") => {
            if let Some(data_url) = part.get("image_url").and_then(Value::as_str) {
                anthropic_image_block(data_url)
            } else if let Some(source) = part.get("source").filter(|value| value.is_object()) {
                Some(json!({ "type": "image", "source": source }))
            } else {
                None
            }
        }
        Some("tool_result") | Some("tool_use") => Some(part.clone()),
        _ => None,
    }
}

fn anthropic_image_block(image_url: &str) -> Option<Value> {
    let image_url = image_url.trim();
    if image_url.is_empty() {
        return None;
    }
    if let Some((media_type, data)) = parse_data_url(image_url) {
        return Some(json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": data,
            },
        }));
    }
    Some(json!({
        "type": "image",
        "source": {
            "type": "url",
            "url": image_url,
        },
    }))
}

fn parse_data_url(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix("data:")?;
    let (media_type, data) = rest.split_once(";base64,")?;
    (!media_type.trim().is_empty() && !data.trim().is_empty()).then_some((media_type, data))
}

fn anthropic_tools_from_openai_tools(tools: &[Value]) -> AgentRuntimeResult<Vec<Value>> {
    tools
        .iter()
        .filter_map(|tool| tool.get("function"))
        .map(|function| {
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    AgentRuntimeError::Core("Anthropic tool is missing a name".to_string())
                })?;
            Ok(json!({
                "name": name,
                "description": function
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                "input_schema": function
                    .get("parameters")
                    .cloned()
                    .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
            }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_converts_chat_messages_tools_and_tool_results() {
        let body = build_request_body(
            "claude-sonnet-4-6",
            &[
                json!({ "role": "system", "content": "Be helpful." }),
                json!({ "role": "user", "content": "List tabs" }),
                json!({
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call-tabs",
                        "type": "function",
                        "function": {
                            "name": "tool_fs_run",
                            "arguments": "{\"path\":\"/tools/workbench/list_tabs\",\"args\":{}}"
                        }
                    }]
                }),
                json!({ "role": "tool", "tool_call_id": "call-tabs", "content": "tabs: settings" }),
            ],
            &[json!({
                "type": "function",
                "function": {
                    "name": "tool_fs_run",
                    "description": "Run a Lyra tool",
                    "parameters": { "type": "object", "properties": {} }
                }
            })],
            true,
        )
        .expect("body");

        assert_eq!(body["system"], "Be helpful.");
        assert_eq!(body["max_tokens"], DEFAULT_MAX_TOKENS);
        assert_eq!(body["stream"], true);
        assert_eq!(body["messages"][1]["content"][0]["type"], "tool_use");
        assert_eq!(body["messages"][2]["content"][0]["type"], "tool_result");
        assert_eq!(body["tools"][0]["name"], "tool_fs_run");
        assert_eq!(body["tool_choice"]["type"], "auto");
    }

    #[test]
    fn request_body_replays_reasoning_content_as_thinking_block() {
        let body = build_request_body(
            "mimo-v2.5-pro",
            &[
                json!({ "role": "user", "content": "List tabs" }),
                json!({
                    "role": "assistant",
                    "content": "",
                    "reasoning_content": "I need to inspect tabs first.",
                    "tool_calls": [{
                        "id": "call-tabs",
                        "type": "function",
                        "function": {
                            "name": "tool_fs_run",
                            "arguments": "{\"path\":\"/tools/workbench/list_tabs\",\"args\":{}}"
                        }
                    }]
                }),
                json!({ "role": "tool", "tool_call_id": "call-tabs", "content": "tabs: settings" }),
            ],
            &[],
            false,
        )
        .expect("body");

        assert_eq!(body["messages"][1]["content"][0]["type"], "thinking");
        assert_eq!(
            body["messages"][1]["content"][0]["thinking"],
            "I need to inspect tabs first."
        );
        assert_eq!(body["messages"][1]["content"][1]["type"], "tool_use");
    }
}
