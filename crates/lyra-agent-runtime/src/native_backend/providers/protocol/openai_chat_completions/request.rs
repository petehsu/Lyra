use serde_json::{Value, json};

use crate::native_backend::ReasoningReplayField;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ReasoningReplayPolicy {
    pub(crate) field: ReasoningReplayField,
    pub(crate) required_on_assistant_messages: bool,
}

pub(crate) fn build_request_body(
    model: &str,
    messages: &[Value],
    tools: &[Value],
    stream: bool,
) -> Value {
    let mut body = json!({
        "model": model,
        "messages": messages,
        "stream": stream,
    });
    if !tools.is_empty() {
        body["tools"] = Value::Array(tools.to_vec());
        body["tool_choice"] = Value::String("auto".to_string());
    }
    body
}

/// Normalize loop-internal message history into clean Chat Completions wire
/// messages.
///
/// The model loop annotates history with runtime bookkeeping — `lyraToolStatus`,
/// `lyraToolFailure`, `openaiResponsesShadow`, streamed `reasoning_content`,
/// snapshot metadata — and strict OpenAI-compatible gateways reject unknown
/// fields with HTTP 400 `invalid_request_error` (observed with the opencode
/// zen gateway: every replayed turn failed and the session died at the second
/// model call). A whitelist per role is the root cure: only fields the Chat
/// Completions API defines ever reach the wire.
///
/// The replay policy selects the one provider-native reasoning field allowed
/// on assistant messages. Presence is preserved, including an empty value.
pub(crate) fn wire_messages(
    messages: &[Value],
    reasoning_replay: ReasoningReplayPolicy,
) -> Vec<Value> {
    messages
        .iter()
        .filter_map(|message| wire_message(message, reasoning_replay))
        .collect()
}

pub(crate) fn enforce_tool_choice_support(body: &mut Value, supported: bool) {
    if supported {
        return;
    }
    if body
        .get("tools")
        .and_then(Value::as_array)
        .is_some_and(|tools| !tools.is_empty())
    {
        body["tool_choice"] = Value::String("auto".to_string());
    } else {
        body.as_object_mut()
            .map(|object| object.remove("tool_choice"));
    }
}

fn wire_message(message: &Value, reasoning_replay: ReasoningReplayPolicy) -> Option<Value> {
    let role = message.get("role").and_then(Value::as_str)?;
    let content = message.get("content").cloned().unwrap_or(Value::Null);
    match role {
        "system" | "developer" | "user" => Some(json!({
            "role": role,
            "content": normalized_content(content),
        })),
        "assistant" => {
            let tool_calls = message
                .get("tool_calls")
                .and_then(Value::as_array)
                .filter(|calls| !calls.is_empty())
                .cloned();
            let has_text = content_has_text(&content);
            // A fully empty assistant message (no text, no tool calls) is
            // invalid on strict providers and useless everywhere else.
            if !has_text && tool_calls.is_none() {
                return None;
            }
            let mut wire = json!({
                "role": "assistant",
                "content": normalized_content(content),
            });
            if let Some(tool_calls) = tool_calls {
                wire["tool_calls"] = Value::Array(tool_calls);
            }
            if let Some(field) = reasoning_replay.field.wire_name() {
                let value = replay_reasoning_value(message, field).or_else(|| {
                    (field != "reasoning_content")
                        .then(|| message.get("reasoning_content").cloned())
                        .flatten()
                });
                if let Some(value) = value {
                    wire[field] = value;
                } else if reasoning_replay.required_on_assistant_messages {
                    wire[field] = match reasoning_replay.field {
                        ReasoningReplayField::ReasoningDetails => Value::Array(Vec::new()),
                        _ => Value::String(String::new()),
                    };
                }
            }
            Some(wire)
        }
        "tool" => {
            let tool_call_id = message
                .get("tool_call_id")
                .or_else(|| message.get("toolCallId"))
                .and_then(Value::as_str)?;
            let mut wire = json!({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": normalized_content(content),
            });
            if let Some(name) = message.get("name").and_then(Value::as_str) {
                wire["name"] = Value::String(name.to_string());
            }
            Some(wire)
        }
        // Native OpenAI Responses items (no chat role) and anything unknown
        // never belong on the Chat Completions wire.
        _ => None,
    }
}

fn replay_reasoning_value(message: &Value, field: &str) -> Option<Value> {
    message.get(field).cloned().or_else(|| {
        message
            .get("lyraProviderReplay")
            .filter(|replay| {
                replay.get("protocol").and_then(Value::as_str) == Some(super::PROTOCOL_ID)
            })
            .and_then(|replay| replay.get("items"))
            .and_then(Value::as_array)
            .and_then(|items| {
                items.iter().find_map(|item| {
                    (item.get("field").and_then(Value::as_str) == Some(field))
                        .then(|| item.get("value").cloned())
                        .flatten()
                })
            })
    })
}

fn normalized_content(content: Value) -> Value {
    match content {
        // Multimodal content parts pass through untouched.
        Value::Array(parts) => Value::Array(parts),
        Value::String(text) => Value::String(text),
        // Null/missing/other → empty string: strict gateways reject null
        // content on non-assistant roles, and "" is valid everywhere.
        _ => Value::String(String::new()),
    }
}

fn content_has_text(content: &Value) -> bool {
    match content {
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(parts) => !parts.is_empty(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NO_REASONING_REPLAY: ReasoningReplayPolicy = ReasoningReplayPolicy {
        field: ReasoningReplayField::None,
        required_on_assistant_messages: false,
    };

    #[test]
    fn wire_messages_strip_runtime_bookkeeping_fields() {
        let messages = vec![
            json!({ "role": "system", "content": "be helpful" }),
            json!({
                "role": "assistant",
                "content": "checking the file",
                "reasoning_content": "let me think about this",
                "tool_calls": [{ "id": "call-1", "type": "function", "function": { "name": "read", "arguments": "{}" } }],
                "openaiResponsesShadow": true,
            }),
            json!({
                "role": "tool",
                "tool_call_id": "call-1",
                "content": "file contents",
                "lyraToolStatus": "completed",
                "lyraToolFailure": null,
            }),
        ];
        let wire = wire_messages(&messages, NO_REASONING_REPLAY);
        assert_eq!(wire.len(), 3);
        assert!(wire[1].get("reasoning_content").is_none());
        assert!(wire[1].get("openaiResponsesShadow").is_none());
        assert_eq!(wire[1]["tool_calls"][0]["id"], "call-1");
        assert!(wire[2].get("lyraToolStatus").is_none());
        assert!(wire[2].get("lyraToolFailure").is_none());
        assert_eq!(wire[2]["tool_call_id"], "call-1");
    }

    #[test]
    fn wire_messages_replay_selected_reasoning_field_and_present_empty() {
        let messages = vec![
            json!({
                "role": "assistant",
                "content": "answer",
                "reasoning_content": "thought process",
            }),
            json!({
                "role": "assistant",
                "content": "",
                "reasoning_content": "",
                "tool_calls": [{ "id": "call-1", "type": "function", "function": { "name": "read", "arguments": "{}" } }],
            }),
        ];
        let with_replay = wire_messages(
            &messages,
            ReasoningReplayPolicy {
                field: ReasoningReplayField::ReasoningContent,
                required_on_assistant_messages: false,
            },
        );
        assert_eq!(with_replay[0]["reasoning_content"], "thought process");
        assert_eq!(with_replay[1]["reasoning_content"], "");
        let without_replay = wire_messages(&messages, NO_REASONING_REPLAY);
        assert!(without_replay[0].get("reasoning_content").is_none());
    }

    #[test]
    fn wire_messages_map_canonical_reasoning_and_emit_required_empty_field() {
        let messages = vec![
            json!({
                "role": "assistant",
                "content": "answer",
                "reasoning_content": "thought process",
            }),
            json!({ "role": "assistant", "content": "answer without reasoning" }),
        ];
        let wire = wire_messages(
            &messages,
            ReasoningReplayPolicy {
                field: ReasoningReplayField::Reasoning,
                required_on_assistant_messages: true,
            },
        );
        assert_eq!(wire[0]["reasoning"], "thought process");
        assert_eq!(wire[1]["reasoning"], "");
    }

    #[test]
    fn wire_messages_preserve_reasoning_details_shape() {
        let messages = vec![json!({
            "role": "assistant",
            "content": "answer",
            "lyraProviderReplay": {
                "protocol": "openai_chat_completions",
                "items": [{
                    "field": "reasoning_details",
                    "value": [{ "type": "reasoning.text", "text": "thought" }]
                }]
            },
        })];
        let wire = wire_messages(
            &messages,
            ReasoningReplayPolicy {
                field: ReasoningReplayField::ReasoningDetails,
                required_on_assistant_messages: false,
            },
        );
        assert!(wire[0]["reasoning_details"].is_array());
        assert_eq!(wire[0]["reasoning_details"][0]["text"], "thought");
    }

    #[test]
    fn wire_messages_drop_empty_assistant_and_roleless_items() {
        let messages = vec![
            json!({ "role": "assistant", "content": "" }),
            json!({ "type": "function_call", "call_id": "call-native", "name": "read" }),
            json!({ "role": "user", "content": "hi" }),
            json!({ "role": "assistant", "content": null, "tool_calls": [] }),
        ];
        let wire = wire_messages(&messages, NO_REASONING_REPLAY);
        assert_eq!(wire.len(), 1);
        assert_eq!(wire[0]["role"], "user");
    }

    #[test]
    fn wire_messages_preserve_multimodal_content_and_null_to_empty() {
        let messages = vec![
            json!({
                "role": "user",
                "content": [
                    { "type": "text", "text": "look" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,xxxx" } },
                ],
            }),
            json!({ "role": "tool", "tool_call_id": "call-2", "content": null }),
        ];
        let wire = wire_messages(&messages, NO_REASONING_REPLAY);
        assert!(wire[0]["content"].is_array());
        assert_eq!(wire[1]["content"], "");
    }

    #[test]
    fn unsupported_forced_tool_choice_falls_back_to_auto_without_dropping_tools() {
        let mut body = build_request_body(
            "deepseek-v4-flash-free",
            &[json!({ "role": "user", "content": "inspect" })],
            &[json!({ "type": "function", "function": { "name": "read" } })],
            true,
        );
        body["tool_choice"] = json!("required");
        enforce_tool_choice_support(&mut body, false);
        assert_eq!(body["tool_choice"], "auto");
        assert_eq!(body["tools"].as_array().map(Vec::len), Some(1));
    }
}
