use serde_json::{Map, Value, json};

use crate::{AgentRuntimeError, AgentRuntimeResult};

use super::super::openai_common::{content_to_plain_text, parse_tool_arguments};

pub(crate) fn build_request_body(messages: &[Value], tools: &[Value]) -> AgentRuntimeResult<Value> {
    let (system, messages) = bedrock_messages_from_provider_messages(messages);
    let mut body = json!({
        "messages": messages,
    });
    if let Some(system) = system.filter(|value| !value.trim().is_empty()) {
        body["system"] = json!([{ "text": system }]);
    }
    let bedrock_tools = bedrock_tools_from_openai_tools(tools)?;
    if !bedrock_tools.is_empty() {
        body["toolConfig"] = json!({
            "tools": bedrock_tools,
            "toolChoice": { "auto": {} },
        });
    }
    Ok(body)
}

fn bedrock_messages_from_provider_messages(messages: &[Value]) -> (Option<String>, Vec<Value>) {
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
                    "toolResult": {
                        "toolUseId": message
                            .get("tool_call_id")
                            .or_else(|| message.get("toolCallId"))
                            .and_then(Value::as_str)
                            .unwrap_or("tool-result"),
                        "content": tool_result_content_blocks(&content),
                    }
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
    let mut blocks = text_blocks(content);
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        blocks.extend(tool_calls.iter().filter_map(bedrock_tool_use_block));
    }
    blocks
}

fn bedrock_tool_use_block(tool_call: &Value) -> Option<Value> {
    let function = tool_call.get("function")?;
    let name = function
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let id = tool_call
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("tool-use");
    let input = match function.get("arguments") {
        Some(Value::String(text)) => parse_tool_arguments(text),
        Some(value) => value.clone(),
        None => json!({}),
    };
    Some(json!({
        "toolUse": {
            "toolUseId": id,
            "name": name,
            "input": input,
        }
    }))
}

fn user_blocks(content: &Value) -> Vec<Value> {
    match content {
        Value::Array(parts) => parts.iter().filter_map(bedrock_user_block).collect(),
        _ => text_blocks(content),
    }
}

fn text_blocks(content: &Value) -> Vec<Value> {
    let text = content_to_plain_text(content);
    if text.trim().is_empty() {
        Vec::new()
    } else {
        vec![json!({ "text": text })]
    }
}

fn bedrock_user_block(part: &Value) -> Option<Value> {
    match part.get("type").and_then(Value::as_str) {
        Some("text") | Some("input_text") | Some("output_text") => Some(json!({
            "text": part.get("text").and_then(Value::as_str).unwrap_or_default(),
        })),
        Some("image_url") => bedrock_image_block(
            part.pointer("/image_url/url")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        Some("input_image") => part
            .get("image_url")
            .and_then(Value::as_str)
            .and_then(bedrock_image_block),
        Some("toolResult") | Some("toolUse") => Some(part.clone()),
        _ => None,
    }
}

fn bedrock_image_block(data_url: &str) -> Option<Value> {
    let (format, data) = parse_image_data_url(data_url.trim())?;
    Some(json!({
        "image": {
            "format": format,
            "source": { "bytes": data },
        }
    }))
}

fn parse_image_data_url(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix("data:image/")?;
    let (format, data) = rest.split_once(";base64,")?;
    let format = match format {
        "jpg" => "jpeg",
        "jpeg" | "png" | "gif" | "webp" => format,
        _ => return None,
    };
    (!data.trim().is_empty()).then_some((format, data))
}

fn tool_result_content_blocks(content: &Value) -> Vec<Value> {
    match content {
        Value::Object(_) => vec![json!({ "json": content })],
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .filter(Value::is_object)
            .map(|value| vec![json!({ "json": value })])
            .unwrap_or_else(|| vec![json!({ "text": text })]),
        _ => vec![json!({ "text": content_to_plain_text(content) })],
    }
}

fn bedrock_tools_from_openai_tools(tools: &[Value]) -> AgentRuntimeResult<Vec<Value>> {
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
                    AgentRuntimeError::Core("Bedrock tool spec is missing a name".to_string())
                })?;
            Ok(json!({
                "toolSpec": {
                    "name": name,
                    "description": function
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    "inputSchema": {
                        "json": bedrock_schema(
                            function
                                .get("parameters")
                                .cloned()
                                .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                        ),
                    },
                }
            }))
        })
        .collect()
}

fn bedrock_schema(mut schema: Value) -> Value {
    normalize_bedrock_schema(&mut schema);
    schema
}

fn normalize_bedrock_schema(schema: &mut Value) {
    let Some(object) = schema.as_object_mut() else {
        return;
    };
    normalize_nullable_type(object);
    object.remove("$schema");
    object.remove("strict");
    if let Some(properties) = object.get_mut("properties").and_then(Value::as_object_mut) {
        for property in properties.values_mut() {
            normalize_bedrock_schema(property);
        }
    }
    if let Some(items) = object.get_mut("items") {
        normalize_bedrock_schema(items);
    }
}

fn normalize_nullable_type(object: &mut Map<String, Value>) {
    let Some(Value::Array(types)) = object.get_mut("type") else {
        return;
    };
    let mut non_null_types = types
        .iter()
        .filter_map(Value::as_str)
        .filter(|kind| *kind != "null")
        .map(str::to_string)
        .collect::<Vec<_>>();
    if non_null_types.len() == 1 {
        object.insert("type".to_string(), Value::String(non_null_types.remove(0)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_converts_messages_tools_tool_results_and_images() {
        let body = build_request_body(
            &[
                json!({ "role": "system", "content": "Be helpful." }),
                json!({
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "Inspect this" },
                        { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } }
                    ]
                }),
                json!({
                    "role": "assistant",
                    "content": "I will inspect.",
                    "tool_calls": [{
                        "id": "call-tabs",
                        "type": "function",
                        "function": {
                            "name": "tool_fs_run",
                            "arguments": "{\"path\":\"/tools/workbench/list_tabs\",\"args\":{}}"
                        }
                    }]
                }),
                json!({ "role": "tool", "tool_call_id": "call-tabs", "content": "{\"tabs\":[\"settings\"]}" }),
            ],
            &[json!({
                "type": "function",
                "function": {
                    "name": "tool_fs_run",
                    "description": "Run a Lyra tool",
                    "parameters": {
                        "type": "object",
                        "properties": { "path": { "type": "string" } },
                        "required": ["path"]
                    }
                }
            })],
        )
        .expect("body");

        assert_eq!(body["system"][0]["text"], "Be helpful.");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"][1]["image"]["format"], "png");
        assert_eq!(body["messages"][1]["role"], "assistant");
        assert_eq!(
            body["messages"][1]["content"][1]["toolUse"]["name"],
            "tool_fs_run"
        );
        assert_eq!(
            body["messages"][2]["content"][0]["toolResult"]["toolUseId"],
            "call-tabs"
        );
        assert_eq!(
            body["toolConfig"]["tools"][0]["toolSpec"]["name"],
            "tool_fs_run"
        );
        assert_eq!(body["toolConfig"]["toolChoice"]["auto"], json!({}));
    }
}
