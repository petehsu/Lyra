use serde_json::{Value, json};

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
/// `keep_reasoning_replay` keeps `reasoning_content` on assistant messages for
/// routes that require thinking replay (MiMo); everyone else never sees it.
pub(crate) fn wire_messages(messages: &[Value], keep_reasoning_replay: bool) -> Vec<Value> {
    messages
        .iter()
        .filter_map(|message| wire_message(message, keep_reasoning_replay))
        .collect()
}

fn wire_message(message: &Value, keep_reasoning_replay: bool) -> Option<Value> {
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
            if keep_reasoning_replay
                && let Some(reasoning) = message
                    .get("reasoning_content")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())
            {
                wire["reasoning_content"] = Value::String(reasoning.to_string());
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
        let wire = wire_messages(&messages, false);
        assert_eq!(wire.len(), 3);
        assert!(wire[1].get("reasoning_content").is_none());
        assert!(wire[1].get("openaiResponsesShadow").is_none());
        assert_eq!(wire[1]["tool_calls"][0]["id"], "call-1");
        assert!(wire[2].get("lyraToolStatus").is_none());
        assert!(wire[2].get("lyraToolFailure").is_none());
        assert_eq!(wire[2]["tool_call_id"], "call-1");
    }

    #[test]
    fn wire_messages_keep_reasoning_replay_for_thinking_routes() {
        let messages = vec![json!({
            "role": "assistant",
            "content": "answer",
            "reasoning_content": "thought process",
        })];
        let with_replay = wire_messages(&messages, true);
        assert_eq!(with_replay[0]["reasoning_content"], "thought process");
        let without_replay = wire_messages(&messages, false);
        assert!(without_replay[0].get("reasoning_content").is_none());
    }

    #[test]
    fn wire_messages_drop_empty_assistant_and_roleless_items() {
        let messages = vec![
            json!({ "role": "assistant", "content": "" }),
            json!({ "type": "function_call", "call_id": "call-native", "name": "read" }),
            json!({ "role": "user", "content": "hi" }),
            json!({ "role": "assistant", "content": null, "tool_calls": [] }),
        ];
        let wire = wire_messages(&messages, false);
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
        let wire = wire_messages(&messages, false);
        assert!(wire[0]["content"].is_array());
        assert_eq!(wire[1]["content"], "");
    }
}
