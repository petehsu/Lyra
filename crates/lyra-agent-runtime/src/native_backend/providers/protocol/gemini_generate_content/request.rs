use std::collections::HashMap;

use serde_json::{Map, Value, json};

use crate::{AgentRuntimeError, AgentRuntimeResult};

use super::super::openai_common::{content_to_plain_text, parse_tool_arguments};

pub(crate) fn build_request_body(messages: &[Value], tools: &[Value]) -> AgentRuntimeResult<Value> {
    let (system_instruction, contents) = gemini_contents_from_provider_messages(messages);
    let mut body = json!({
        "contents": contents,
    });
    if let Some(system_instruction) = system_instruction.filter(|value| !value.trim().is_empty()) {
        body["systemInstruction"] = json!({
            "parts": [{ "text": system_instruction }],
        });
    }
    let declarations = gemini_function_declarations_from_openai_tools(tools)?;
    if !declarations.is_empty() {
        body["tools"] = json!([{ "functionDeclarations": declarations }]);
        body["toolConfig"] = json!({
            "functionCallingConfig": { "mode": "AUTO" },
        });
    }
    Ok(body)
}

fn gemini_contents_from_provider_messages(messages: &[Value]) -> (Option<String>, Vec<Value>) {
    let mut system = None;
    let mut contents = Vec::new();
    let mut tool_names_by_call_id = HashMap::<String, String>::new();

    for message in messages {
        let Some(role) = message.get("role").and_then(Value::as_str) else {
            continue;
        };
        let content = message.get("content").cloned().unwrap_or(Value::Null);
        match role {
            "system" | "developer" => {
                let text = content_to_plain_text(&content);
                if text.trim().is_empty() {
                    continue;
                }
                if system.is_none() {
                    system = Some(text);
                } else {
                    contents.push(json!({
                        "role": "user",
                        "parts": [{ "text": text }],
                    }));
                }
            }
            "assistant" => {
                let parts = assistant_parts(message, &content, &mut tool_names_by_call_id);
                if !parts.is_empty() {
                    contents.push(json!({
                        "role": "model",
                        "parts": parts,
                    }));
                }
            }
            "tool" => {
                let call_id = message
                    .get("tool_call_id")
                    .or_else(|| message.get("toolCallId"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let name = tool_names_by_call_id
                    .get(call_id)
                    .cloned()
                    .unwrap_or_else(|| "tool_result".to_string());
                contents.push(json!({
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "name": name,
                            "response": tool_response_value(&content),
                        }
                    }],
                }));
            }
            _ => {
                let parts = user_parts(&content);
                if !parts.is_empty() {
                    contents.push(json!({
                        "role": "user",
                        "parts": parts,
                    }));
                }
            }
        }
    }

    (system, contents)
}

fn assistant_parts(
    message: &Value,
    content: &Value,
    tool_names_by_call_id: &mut HashMap<String, String>,
) -> Vec<Value> {
    let mut parts = text_parts(content);
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        for tool_call in tool_calls {
            if let Some((id, name, args)) = gemini_function_call_part(tool_call) {
                tool_names_by_call_id.insert(id, name.clone());
                parts.push(json!({
                    "functionCall": {
                        "name": name,
                        "args": args,
                    }
                }));
            }
        }
    }
    parts
}

fn gemini_function_call_part(tool_call: &Value) -> Option<(String, String, Value)> {
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
        .unwrap_or(name)
        .to_string();
    let args = match function.get("arguments") {
        Some(Value::String(text)) => parse_tool_arguments(text),
        Some(value) => value.clone(),
        None => json!({}),
    };
    Some((id, name.to_string(), args))
}

fn user_parts(content: &Value) -> Vec<Value> {
    match content {
        Value::Array(parts) => parts.iter().filter_map(gemini_user_part).collect(),
        _ => text_parts(content),
    }
}

fn text_parts(content: &Value) -> Vec<Value> {
    let text = content_to_plain_text(content);
    if text.trim().is_empty() {
        Vec::new()
    } else {
        vec![json!({ "text": text })]
    }
}

fn gemini_user_part(part: &Value) -> Option<Value> {
    match part.get("type").and_then(Value::as_str) {
        Some("text") | Some("input_text") | Some("output_text") => Some(json!({
            "text": part.get("text").and_then(Value::as_str).unwrap_or_default(),
        })),
        Some("image_url") => gemini_inline_data_part(
            part.pointer("/image_url/url")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        Some("input_image") => part
            .get("image_url")
            .and_then(Value::as_str)
            .and_then(gemini_inline_data_part),
        Some("functionResponse") | Some("functionCall") => Some(part.clone()),
        _ => None,
    }
}

fn gemini_inline_data_part(data_url: &str) -> Option<Value> {
    let (mime_type, data) = parse_data_url(data_url.trim())?;
    Some(json!({
        "inlineData": {
            "mimeType": mime_type,
            "data": data,
        },
    }))
}

fn parse_data_url(value: &str) -> Option<(&str, &str)> {
    let rest = value.strip_prefix("data:")?;
    let (mime_type, data) = rest.split_once(";base64,")?;
    (!mime_type.trim().is_empty() && !data.trim().is_empty()).then_some((mime_type, data))
}

fn tool_response_value(content: &Value) -> Value {
    match content {
        Value::Object(_) => content.clone(),
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({ "content": text })),
        _ => json!({ "content": content_to_plain_text(content) }),
    }
}

fn gemini_function_declarations_from_openai_tools(
    tools: &[Value],
) -> AgentRuntimeResult<Vec<Value>> {
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
                    AgentRuntimeError::Core(
                        "Gemini function declaration is missing a name".to_string(),
                    )
                })?;
            Ok(json!({
                "name": name,
                "description": function
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                "parameters": gemini_schema(
                    function
                        .get("parameters")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                ),
            }))
        })
        .collect()
}

fn gemini_schema(mut schema: Value) -> Value {
    normalize_gemini_schema(&mut schema);
    schema
}

fn normalize_gemini_schema(schema: &mut Value) {
    let Some(object) = schema.as_object_mut() else {
        return;
    };
    normalize_nullable_type(object);
    object.remove("$schema");
    object.remove("additionalProperties");
    object.remove("strict");
    if let Some(properties) = object.get_mut("properties").and_then(Value::as_object_mut) {
        for property in properties.values_mut() {
            normalize_gemini_schema(property);
        }
    }
    if let Some(items) = object.get_mut("items") {
        normalize_gemini_schema(items);
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
    let nullable = types.iter().any(|kind| kind.as_str() == Some("null"));
    if non_null_types.len() == 1 {
        object.insert("type".to_string(), Value::String(non_null_types.remove(0)));
    }
    if nullable {
        object.insert("nullable".to_string(), Value::Bool(true));
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
                        "additionalProperties": false,
                        "properties": {
                            "path": { "type": "string" },
                            "limit": { "type": ["integer", "null"] }
                        },
                        "required": ["path"]
                    }
                }
            })],
        )
        .expect("body");

        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "Be helpful.");
        assert_eq!(body["contents"][0]["role"], "user");
        assert_eq!(
            body["contents"][0]["parts"][1]["inlineData"]["mimeType"],
            "image/png"
        );
        assert_eq!(body["contents"][1]["role"], "model");
        assert_eq!(
            body["contents"][1]["parts"][1]["functionCall"]["name"],
            "tool_fs_run"
        );
        assert_eq!(
            body["contents"][2]["parts"][0]["functionResponse"]["name"],
            "tool_fs_run"
        );
        assert_eq!(
            body["tools"][0]["functionDeclarations"][0]["name"],
            "tool_fs_run"
        );
        assert!(
            body["tools"][0]["functionDeclarations"][0]["parameters"]
                .get("additionalProperties")
                .is_none()
        );
        assert_eq!(
            body["tools"][0]["functionDeclarations"][0]["parameters"]["properties"]["limit"]["nullable"],
            true
        );
    }

    #[test]
    fn only_the_first_system_message_is_the_stable_instruction() {
        let body = build_request_body(
            &[
                json!({ "role": "system", "content": "stable" }),
                json!({ "role": "system", "content": "later context" }),
                json!({ "role": "user", "content": "hello" }),
            ],
            &[],
        )
        .expect("body");

        assert_eq!(body["systemInstruction"]["parts"][0]["text"], "stable");
        assert_eq!(body["contents"][0]["parts"][0]["text"], "later context");
        assert_eq!(body["contents"][1]["parts"][0]["text"], "hello");
    }
}
