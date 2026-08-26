use serde_json::{Value, json};

use crate::{AgentRuntimeError, AgentRuntimeResult};

use super::super::openai_common::{content_to_plain_text, parse_tool_arguments};

pub(crate) fn build_request_body(
    model: &str,
    messages: &[Value],
    tools: &[Value],
    stream: bool,
) -> AgentRuntimeResult<Value> {
    let mut body = json!({
        "model": model,
        "messages": ollama_messages(messages),
        "stream": stream,
    });
    let tools = ollama_tools(tools)?;
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools);
    }
    Ok(body)
}

fn ollama_messages(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .filter_map(|message| {
            let role = match message.get("role").and_then(Value::as_str)? {
                "developer" => "system",
                other => other,
            };
            let content = message.get("content").cloned().unwrap_or(Value::Null);
            let mut item = json!({
                "role": role,
                "content": content_to_plain_text(&content),
            });
            if role == "assistant" {
                let tool_calls = message
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(ollama_message_tool_call)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if !tool_calls.is_empty() {
                    item["tool_calls"] = Value::Array(tool_calls);
                }
            }
            if role == "tool"
                && let Some(tool_call_id) = message.get("tool_call_id").and_then(Value::as_str)
                && !tool_call_id.trim().is_empty()
            {
                item["tool_call_id"] = Value::String(tool_call_id.trim().to_string());
            }
            let images = ollama_images(&content);
            if !images.is_empty() {
                item["images"] = Value::Array(images);
            }
            Some(item)
        })
        .collect()
}

fn ollama_message_tool_call(tool_call: &Value) -> Option<Value> {
    let function = tool_call.get("function")?;
    let name = function.get("name").and_then(Value::as_str)?.trim();
    if name.is_empty() {
        return None;
    }
    let arguments = match function.get("arguments") {
        Some(Value::String(text)) => parse_tool_arguments(text),
        Some(value) => value.clone(),
        None => json!({}),
    };
    // Never echo internal parse diagnostics back to the provider; fall back to
    // an empty object so the request body stays a valid tool call.
    let arguments = if arguments.get("parseError").is_some() {
        json!({})
    } else {
        arguments
    };
    let mut item = json!({
        "function": {
            "name": name,
            "arguments": arguments,
        }
    });
    if let Some(id) = tool_call.get("id").and_then(Value::as_str)
        && !id.trim().is_empty()
    {
        item["id"] = Value::String(id.trim().to_string());
    }
    Some(item)
}

fn ollama_tools(tools: &[Value]) -> AgentRuntimeResult<Vec<Value>> {
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
                    AgentRuntimeError::Core("Ollama tool definition is missing a name".to_string())
                })?;
            Ok(json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": function
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    "parameters": function
                        .get("parameters")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                }
            }))
        })
        .collect()
}

fn ollama_images(content: &Value) -> Vec<Value> {
    let Some(parts) = content.as_array() else {
        return Vec::new();
    };
    parts
        .iter()
        .filter_map(|part| {
            part.pointer("/image_url/url")
                .or_else(|| part.get("image_url"))
                .and_then(Value::as_str)
                .and_then(data_url_base64)
        })
        .map(|data| Value::String(data.to_string()))
        .collect()
}

fn data_url_base64(value: &str) -> Option<&str> {
    let (_, data) = value.trim().split_once(";base64,")?;
    (!data.trim().is_empty()).then_some(data.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_messages_and_tools_to_ollama_chat_body() {
        let body = build_request_body(
            "llama3.2",
            &[
                json!({ "role": "developer", "content": "Be useful." }),
                json!({ "role": "user", "content": "List files." }),
                json!({
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "tool_fs_run",
                            "arguments": "{\"path\":\"/tools/filesystem/list\",\"args\":{}}"
                        }
                    }]
                }),
                json!({ "role": "tool", "tool_call_id": "call-1", "content": "[]" }),
            ],
            &[json!({
                "type": "function",
                "function": {
                    "name": "tool_fs_run",
                    "parameters": { "type": "object", "properties": {} }
                }
            })],
            false,
        )
        .expect("body");

        assert_eq!(body["model"], "llama3.2");
        assert_eq!(body["stream"], false);
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(
            body["messages"][2]["tool_calls"][0]["function"]["arguments"]["path"],
            "/tools/filesystem/list"
        );
        assert_eq!(body["tools"][0]["function"]["name"], "tool_fs_run");
    }
}
