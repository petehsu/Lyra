use serde_json::{Value, json};

use crate::{AgentRuntimeError, AgentRuntimeResult};

use super::super::openai_common::{content_to_plain_text, strict_tool_schema};

#[derive(Clone, Debug, Default)]
pub(crate) struct RequestOptions {
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) verbosity: Option<String>,
    pub(crate) service_tier: Option<String>,
    pub(crate) stateful_prompt_contract: bool,
    pub(crate) previous_response_id: Option<String>,
}

pub(crate) fn build_request_body(
    model: &str,
    messages: &[Value],
    tools: &[Value],
    stream: bool,
    options: RequestOptions,
) -> AgentRuntimeResult<Value> {
    let (instructions, input) = responses_input_from_provider_messages(messages);
    let mut body = json!({
        "model": model,
        "input": input,
        "stream": stream,
        "store": false,
        "include": ["reasoning.encrypted_content"],
    });
    if options.stateful_prompt_contract {
        body["store"] = Value::Bool(true);
        if let Some(previous_response_id) = options
            .previous_response_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            body["previous_response_id"] = Value::String(previous_response_id.to_string());
        }
    }
    if let Some(instructions) = instructions.filter(|value| !value.trim().is_empty()) {
        body["instructions"] = Value::String(instructions);
    }
    let converted_tools = responses_tools_from_chat_tools(tools)?;
    if !converted_tools.is_empty() {
        body["tools"] = Value::Array(converted_tools);
        body["tool_choice"] = Value::String("auto".to_string());
    }
    if let Some(effort) = validated_reasoning_effort(options.reasoning_effort)? {
        body["reasoning"] = json!({ "effort": effort });
    }
    if let Some(verbosity) = validated_verbosity(options.verbosity)? {
        body["text"] = json!({ "verbosity": verbosity });
    }
    if let Some(service_tier) = options
        .service_tier
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "auto")
    {
        body["service_tier"] = Value::String(service_tier.to_string());
    }
    Ok(body)
}

pub(crate) fn function_call_output_item(call_id: &str, output: String) -> Value {
    json!({
        "type": "function_call_output",
        "call_id": call_id,
        "output": output,
    })
}

fn validated_reasoning_effort(value: Option<String>) -> AgentRuntimeResult<Option<String>> {
    let Some(value) = value.map(|value| value.trim().to_ascii_lowercase()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    match value.as_str() {
        "none" | "low" | "medium" | "high" | "xhigh" => Ok(Some(value)),
        other => Err(AgentRuntimeError::Core(format!(
            "unsupported OpenAI Responses reasoning effort `{other}`; expected none, low, medium, high, or xhigh"
        ))),
    }
}

fn validated_verbosity(value: Option<String>) -> AgentRuntimeResult<Option<String>> {
    let Some(value) = value.map(|value| value.trim().to_ascii_lowercase()) else {
        return Ok(None);
    };
    if value.is_empty() {
        return Ok(None);
    }
    match value.as_str() {
        "low" | "medium" | "high" => Ok(Some(value)),
        other => Err(AgentRuntimeError::Core(format!(
            "unsupported OpenAI Responses verbosity `{other}`; expected low, medium, or high"
        ))),
    }
}

fn responses_input_from_provider_messages(messages: &[Value]) -> (Option<String>, Vec<Value>) {
    let mut instructions = Vec::new();
    let mut input = Vec::new();
    for message in messages {
        if message
            .get("openaiResponsesShadow")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            continue;
        }
        if is_native_responses_item(message) {
            input.push(message.clone());
            continue;
        }
        let Some(role) = message.get("role").and_then(Value::as_str) else {
            continue;
        };
        let content = message.get("content").cloned().unwrap_or(Value::Null);
        if role == "system" {
            if let Some(text) = content_to_instruction_text(&content) {
                instructions.push(text);
            }
            continue;
        }
        if role == "tool" {
            let tool_call_id = message
                .get("tool_call_id")
                .or_else(|| message.get("toolCallId"))
                .and_then(Value::as_str)
                .unwrap_or("tool-result");
            input.push(function_call_output_item(
                tool_call_id,
                content_to_plain_text(&content),
            ));
            continue;
        }
        input.push(json!({
            "role": responses_role(role),
            "content": responses_message_content(&content, role),
        }));
    }
    (Some(instructions.join("\n\n")), input)
}

fn is_native_responses_item(value: &Value) -> bool {
    value
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| {
            matches!(
                kind,
                "message" | "reasoning" | "function_call" | "function_call_output"
            )
        })
}

fn responses_role(role: &str) -> &str {
    match role {
        "assistant" => "assistant",
        "developer" => "developer",
        _ => "user",
    }
}

fn responses_message_content(content: &Value, role: &str) -> Value {
    match content {
        Value::Array(parts) if role != "assistant" => {
            let converted = parts
                .iter()
                .filter_map(responses_input_content_part)
                .collect::<Vec<_>>();
            if converted.is_empty() {
                Value::String(String::new())
            } else {
                Value::Array(converted)
            }
        }
        Value::Array(_) => Value::String(content_to_plain_text(content)),
        Value::String(text) => Value::String(text.clone()),
        Value::Null => Value::String(String::new()),
        other => Value::String(other.to_string()),
    }
}

fn responses_input_content_part(part: &Value) -> Option<Value> {
    match part.get("type").and_then(Value::as_str) {
        Some("text") => Some(json!({
            "type": "input_text",
            "text": part.get("text").and_then(Value::as_str).unwrap_or_default(),
        })),
        Some("image_url") => {
            let image_url = part
                .pointer("/image_url/url")
                .and_then(Value::as_str)
                .unwrap_or_default();
            (!image_url.trim().is_empty()).then(|| {
                json!({
                    "type": "input_image",
                    "image_url": image_url,
                })
            })
        }
        Some("input_text") | Some("input_image") => Some(part.clone()),
        _ => None,
    }
}

fn content_to_instruction_text(content: &Value) -> Option<String> {
    let text = content_to_plain_text(content);
    (!text.trim().is_empty()).then_some(text)
}

fn responses_tools_from_chat_tools(tools: &[Value]) -> AgentRuntimeResult<Vec<Value>> {
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
                        "OpenAI Responses function tool is missing a name".to_string(),
                    )
                })?;
            let mut output = json!({
                "type": "function",
                "name": name,
                "description": function
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                "parameters": strict_tool_schema(
                    function
                        .get("parameters")
                        .cloned()
                        .unwrap_or_else(|| json!({ "type": "object", "properties": {} }))
                ),
                "strict": true,
            });
            if !output["parameters"].is_object() {
                output["parameters"] = strict_tool_schema(json!({
                    "type": "object",
                    "properties": {},
                }));
            }
            Ok(output)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_uses_local_replay_and_responses_tool_shape() {
        let body = build_request_body(
            "gpt-5-mini",
            &[
                json!({ "role": "system", "content": "Be helpful." }),
                json!({ "role": "user", "content": "Hi" }),
            ],
            &[json!({
                "type": "function",
                "function": {
                    "name": "tool_fs_run",
                    "description": "Run tool",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string" },
                            "args": { "type": "object", "properties": {} }
                        },
                        "required": ["path"]
                    }
                }
            })],
            true,
            RequestOptions {
                reasoning_effort: Some("medium".to_string()),
                verbosity: Some("low".to_string()),
                service_tier: Some("flex".to_string()),
                stateful_prompt_contract: false,
                previous_response_id: None,
            },
        )
        .expect("request body");

        assert_eq!(body["store"], false);
        assert_eq!(body["include"][0], "reasoning.encrypted_content");
        assert_eq!(body["instructions"], "Be helpful.");
        assert_eq!(body["input"][0]["role"], "user");
        assert_eq!(body["tools"][0]["type"], "function");
        assert_eq!(body["tools"][0]["name"], "tool_fs_run");
        assert_eq!(body["tools"][0]["strict"], true);
        assert_eq!(
            body["tools"][0]["parameters"]["additionalProperties"],
            false
        );
        let required = body["tools"][0]["parameters"]["required"]
            .as_array()
            .expect("required properties");
        assert!(required.iter().any(|value| value == "path"));
        assert!(required.iter().any(|value| value == "args"));
        assert_eq!(
            body["tools"][0]["parameters"]["properties"]["args"]["type"][1],
            "null"
        );
        assert_eq!(body["reasoning"]["effort"], "medium");
        assert_eq!(body["text"]["verbosity"], "low");
        assert_eq!(body["service_tier"], "flex");
    }

    #[test]
    fn native_responses_items_are_replayed_without_conversion() {
        let item = json!({
            "type": "function_call_output",
            "call_id": "call-1",
            "output": "ok"
        });
        let body = build_request_body(
            "gpt-5-mini",
            &[item.clone()],
            &[],
            false,
            RequestOptions::default(),
        )
        .expect("request body");
        assert_eq!(body["input"][0], item);
    }

    #[test]
    fn stateful_prompt_contract_is_explicit_and_disabled_by_default() {
        let default_body = build_request_body(
            "gpt-5-mini",
            &[json!({ "role": "user", "content": "Hi" })],
            &[],
            false,
            RequestOptions::default(),
        )
        .expect("default body");
        assert_eq!(default_body["store"], false);
        assert!(default_body.get("previous_response_id").is_none());

        let stateful_body = build_request_body(
            "gpt-5-mini",
            &[json!({ "role": "user", "content": "Hi" })],
            &[],
            false,
            RequestOptions {
                stateful_prompt_contract: true,
                previous_response_id: Some("resp_previous".to_string()),
                ..RequestOptions::default()
            },
        )
        .expect("stateful body");
        assert_eq!(stateful_body["store"], true);
        assert_eq!(stateful_body["previous_response_id"], "resp_previous");
    }
}
