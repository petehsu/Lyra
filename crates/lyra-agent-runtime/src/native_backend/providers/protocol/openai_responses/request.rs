use serde_json::{Value, json};

use crate::{AgentRuntimeError, AgentRuntimeResult};

use super::super::openai_common::{content_to_plain_text, strict_tool_schema};

#[derive(Clone, Debug, Default)]
pub(crate) struct RequestOptions {
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) verbosity: Option<String>,
    pub(crate) service_tier: Option<String>,
    pub(crate) prompt_cache_key: Option<String>,
    pub(crate) explicit_prompt_cache: bool,
    pub(crate) store: bool,
    pub(crate) previous_response_id: Option<String>,
    pub(crate) input_start: usize,
}

pub(crate) fn build_request_body(
    model: &str,
    messages: &[Value],
    tools: &[Value],
    stream: bool,
    options: RequestOptions,
) -> AgentRuntimeResult<Value> {
    let (instructions, mut input, stable_cache_boundary, cache_boundaries) =
        responses_input_from_provider_messages(
            messages,
            options.input_start,
            options.explicit_prompt_cache,
        );
    if options.explicit_prompt_cache {
        if let Some(index) = stable_cache_boundary {
            add_prompt_cache_breakpoint(&mut input[index]);
        }
        let remaining_breakpoints = if stable_cache_boundary.is_some() {
            3
        } else {
            4
        };
        for index in cache_boundaries
            .into_iter()
            .rev()
            .take(remaining_breakpoints)
        {
            add_prompt_cache_breakpoint(&mut input[index]);
        }
    }
    let mut body = json!({
        "model": model,
        "input": input,
        "stream": stream,
        "store": options.store,
        "include": ["reasoning.encrypted_content"],
    });
    if let Some(prompt_cache_key) = options
        .prompt_cache_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["prompt_cache_key"] = Value::String(prompt_cache_key.to_string());
    }
    if options.explicit_prompt_cache {
        body["prompt_cache_options"] = json!({ "mode": "explicit" });
    }
    if let Some(previous_response_id) = options
        .previous_response_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        body["previous_response_id"] = Value::String(previous_response_id.to_string());
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
        "none" | "low" | "medium" | "high" | "xhigh" | "max" => Ok(Some(value)),
        other => Err(AgentRuntimeError::Core(format!(
            "unsupported OpenAI Responses reasoning effort `{other}`; expected none, low, medium, high, xhigh, or max"
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

fn responses_input_from_provider_messages(
    messages: &[Value],
    input_start: usize,
    explicit_prompt_cache: bool,
) -> (Option<String>, Vec<Value>, Option<usize>, Vec<usize>) {
    let mut instructions = Vec::new();
    let mut input = Vec::new();
    let mut cache_boundaries = Vec::new();
    let mut stable_cache_boundary = None;
    let mut saw_stable_instructions = false;
    for (message_index, message) in messages.iter().enumerate() {
        if message
            .get("openaiResponsesShadow")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            continue;
        }
        let role = message.get("role").and_then(Value::as_str);
        if matches!(role, Some("system" | "developer")) && !saw_stable_instructions {
            saw_stable_instructions = true;
            let content = message.get("content").cloned().unwrap_or(Value::Null);
            if let Some(text) = content_to_instruction_text(&content) {
                if explicit_prompt_cache {
                    if input_start == 0 {
                        stable_cache_boundary = Some(input.len());
                        input.push(json!({
                            "role": "developer",
                            "content": text,
                        }));
                    }
                } else {
                    instructions.push(text);
                }
            }
            continue;
        }
        if message_index < input_start {
            continue;
        }
        if is_native_responses_item(message) {
            if message.get("type").and_then(Value::as_str) == Some("function_call_output") {
                cache_boundaries.push(input.len());
            }
            input.push(message.clone());
            continue;
        }
        let Some(role) = role else {
            continue;
        };
        let content = message.get("content").cloned().unwrap_or(Value::Null);
        if matches!(role, "system" | "developer") {
            if let Some(text) = content_to_instruction_text(&content) {
                input.push(json!({
                    "role": "developer",
                    "content": text,
                }));
            }
            continue;
        }
        if role == "tool" {
            let tool_call_id = message
                .get("tool_call_id")
                .or_else(|| message.get("toolCallId"))
                .and_then(Value::as_str)
                .unwrap_or("tool-result");
            cache_boundaries.push(input.len());
            input.push(function_call_output_item(
                tool_call_id,
                content_to_plain_text(&content),
            ));
            continue;
        }
        if role == "user"
            && message
                .get("lyraCacheBoundary")
                .and_then(Value::as_str)
                .is_some_and(|value| value == "turnTail")
        {
            cache_boundaries.push(input.len());
        }
        input.push(json!({
            "role": responses_role(role),
            "content": responses_message_content(&content, role),
        }));
    }
    (
        Some(instructions.join("\n\n")),
        input,
        stable_cache_boundary,
        cache_boundaries,
    )
}

fn add_prompt_cache_breakpoint(message: &mut Value) {
    let field = if message.get("type").and_then(Value::as_str) == Some("function_call_output") {
        "output"
    } else {
        "content"
    };
    let Some(content) = message.get_mut(field) else {
        return;
    };
    if let Value::String(text) = content {
        if text.trim().is_empty() {
            return;
        }
        *content = json!([{
            "type": "input_text",
            "text": text,
            "prompt_cache_breakpoint": { "mode": "explicit" },
        }]);
        return;
    }
    let Some(parts) = content.as_array_mut() else {
        return;
    };
    if let Some(part) = parts.iter_mut().rev().find(|part| {
        matches!(
            part.get("type").and_then(Value::as_str),
            Some("input_text" | "input_image" | "input_file")
        )
    }) {
        part["prompt_cache_breakpoint"] = json!({ "mode": "explicit" });
    }
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
                ..RequestOptions::default()
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
    fn prompt_cache_store_and_response_state_are_independent() {
        let default_body = build_request_body(
            "gpt-5-mini",
            &[json!({ "role": "user", "content": "Hi" })],
            &[],
            false,
            RequestOptions::default(),
        )
        .expect("default body");
        assert_eq!(default_body["store"], false);
        assert!(default_body.get("prompt_cache_key").is_none());
        assert!(default_body.get("prompt_cache_options").is_none());
        assert!(default_body.get("previous_response_id").is_none());

        let configured_body = build_request_body(
            "gpt-5-mini",
            &[json!({ "role": "user", "content": "Hi" })],
            &[],
            false,
            RequestOptions {
                prompt_cache_key: Some(" session-1 ".to_string()),
                store: false,
                previous_response_id: Some("resp_previous".to_string()),
                ..RequestOptions::default()
            },
        )
        .expect("configured body");
        assert_eq!(configured_body["store"], false);
        assert_eq!(configured_body["prompt_cache_key"], "session-1");
        assert_eq!(configured_body["previous_response_id"], "resp_previous");
    }

    #[test]
    fn accepts_gpt_5_6_max_reasoning_effort() {
        assert_eq!(
            validated_reasoning_effort(Some("MAX".to_string())).expect("max effort"),
            Some("max".to_string())
        );
    }

    #[test]
    fn explicit_prompt_cache_marks_stable_prefix_and_three_latest_growth_points() {
        let body = build_request_body(
            "gpt-5.6",
            &[
                json!({ "role": "system", "content": "Be helpful." }),
                json!({
                    "role": "user",
                    "content": "first",
                    "lyraCacheBoundary": "turnTail"
                }),
                json!({ "role": "assistant", "content": "first answer" }),
                json!({
                    "role": "user",
                    "content": "second",
                    "lyraCacheBoundary": "turnTail"
                }),
                json!({ "role": "assistant", "content": "second answer" }),
                json!({
                    "role": "user",
                    "content": "third",
                    "lyraCacheBoundary": "turnTail"
                }),
            ],
            &[],
            false,
            RequestOptions {
                prompt_cache_key: Some("session-1".to_string()),
                explicit_prompt_cache: true,
                ..RequestOptions::default()
            },
        )
        .expect("explicit cache body");

        assert_eq!(
            body,
            json!({
                "model": "gpt-5.6",
                "input": [
                    {
                        "role": "developer",
                        "content": [{
                            "type": "input_text",
                            "text": "Be helpful.",
                            "prompt_cache_breakpoint": { "mode": "explicit" }
                        }]
                    },
                    {
                        "role": "user",
                        "content": [{
                            "type": "input_text",
                            "text": "first",
                            "prompt_cache_breakpoint": { "mode": "explicit" }
                        }]
                    },
                    { "role": "assistant", "content": "first answer" },
                    {
                        "role": "user",
                        "content": [{
                            "type": "input_text",
                            "text": "second",
                            "prompt_cache_breakpoint": { "mode": "explicit" }
                        }]
                    },
                    { "role": "assistant", "content": "second answer" },
                    {
                        "role": "user",
                        "content": [{
                            "type": "input_text",
                            "text": "third",
                            "prompt_cache_breakpoint": { "mode": "explicit" }
                        }]
                    }
                ],
                "stream": false,
                "store": false,
                "include": ["reasoning.encrypted_content"],
                "prompt_cache_key": "session-1",
                "prompt_cache_options": { "mode": "explicit" }
            })
        );
    }

    #[test]
    fn explicit_prompt_cache_advances_to_native_tool_output() {
        let body = build_request_body(
            "gpt-5.6",
            &[
                json!({ "role": "system", "content": "Stable instructions." }),
                json!({
                    "role": "user",
                    "content": "question",
                    "lyraCacheBoundary": "turnTail"
                }),
                json!({
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "lookup",
                    "arguments": "{}"
                }),
                function_call_output_item("call-1", "tool result".to_string()),
            ],
            &[],
            false,
            RequestOptions {
                prompt_cache_key: Some("shared-prefix".to_string()),
                explicit_prompt_cache: true,
                ..RequestOptions::default()
            },
        )
        .expect("explicit cache body");

        assert_eq!(
            body["input"][3]["output"],
            json!([{
                "type": "input_text",
                "text": "tool result",
                "prompt_cache_breakpoint": { "mode": "explicit" }
            }])
        );
    }

    #[test]
    fn stateful_delta_keeps_stable_instructions_and_sends_only_new_input() {
        let body = build_request_body(
            "gpt-5.6",
            &[
                json!({ "role": "system", "content": "stable" }),
                json!({ "role": "user", "content": "old question" }),
                json!({ "role": "assistant", "content": "old answer" }),
                json!({ "role": "system", "content": "new correction" }),
                json!({ "role": "user", "content": "new question" }),
            ],
            &[],
            false,
            RequestOptions {
                store: true,
                previous_response_id: Some("resp_previous".to_string()),
                input_start: 3,
                ..RequestOptions::default()
            },
        )
        .expect("delta body");

        assert_eq!(body["instructions"], "stable");
        assert_eq!(body["previous_response_id"], "resp_previous");
        assert_eq!(body["input"].as_array().expect("input").len(), 2);
        assert_eq!(body["input"][0]["role"], "developer");
        assert_eq!(body["input"][1]["content"], "new question");
    }

    #[test]
    fn explicit_stateful_delta_reuses_prior_stable_prefix_and_marks_new_input() {
        let body = build_request_body(
            "gpt-5.6",
            &[
                json!({ "role": "system", "content": "stable" }),
                json!({ "role": "user", "content": "old question" }),
                json!({ "role": "assistant", "content": "old answer" }),
                function_call_output_item("call-1", "new tool result".to_string()),
            ],
            &[],
            false,
            RequestOptions {
                prompt_cache_key: Some("shared-prefix".to_string()),
                explicit_prompt_cache: true,
                store: true,
                previous_response_id: Some("resp_previous".to_string()),
                input_start: 3,
                ..RequestOptions::default()
            },
        )
        .expect("stateful explicit cache body");

        assert!(body.get("instructions").is_none());
        assert_eq!(body["previous_response_id"], "resp_previous");
        assert_eq!(body["input"].as_array().expect("input").len(), 1);
        assert_eq!(
            body["input"][0]["output"],
            json!([{
                "type": "input_text",
                "text": "new tool result",
                "prompt_cache_breakpoint": { "mode": "explicit" }
            }])
        );
    }
}
