use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    AgentRuntimeResult,
    native_backend::provider::{
        ModelReply, ModelToolCall, ProviderResponseMeta, ProviderTokenUsage, TurnStopSignal,
    },
};

use super::super::openai_common::{parse_tool_arguments, repair_tool_name, tool_name_set};

pub(crate) fn parse_response_body(body: &Value, tools: &[Value]) -> AgentRuntimeResult<ModelReply> {
    if let Some(error) = body.get("error") {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
            format!("provider returned error envelope: {error}"),
        ));
    }
    if body.get("done").and_then(Value::as_bool) != Some(true) {
        return Err(malformed_envelope("response is missing done=true"));
    }
    let message = body
        .get("message")
        .filter(|message| message.is_object())
        .ok_or_else(|| malformed_envelope("response is missing an assistant message"))?;
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let reasoning_content = message
        .get("thinking")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let tool_calls = tool_calls_from_message(message, tools)?;
    Ok(ModelReply {
        content,
        reasoning_content,
        tool_calls,
        ui_message_id: None,
        raw_stop_reason: body
            .get("done_reason")
            .and_then(Value::as_str)
            .map(str::to_string),
        provider_replay_protocol: Some(super::PROTOCOL_ID.to_string()),
        provider_replay_items: Vec::new(),
        response_meta: response_meta(body),
        stop_signal: TurnStopSignal::from_raw(body.get("done_reason").and_then(Value::as_str)),
    })
}

pub(super) fn response_meta(body: &Value) -> ProviderResponseMeta {
    let input_total_tokens = body.get("prompt_eval_count").and_then(Value::as_u64);
    ProviderResponseMeta {
        response_id: body
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        usage: ProviderTokenUsage {
            input_total_tokens,
            input_uncached_tokens: input_total_tokens,
            cache_read_input_tokens: None,
            cache_write_input_tokens: None,
            output_tokens: body.get("eval_count").and_then(Value::as_u64),
            reasoning_tokens: None,
        },
    }
}

pub(crate) fn tool_calls_from_message(
    message: &Value,
    tools: &[Value],
) -> AgentRuntimeResult<Vec<ModelToolCall>> {
    if message
        .get("tool_calls")
        .is_some_and(|tool_calls| !tool_calls.is_array())
    {
        return Err(incomplete_tool_call("tool_calls is not an array"));
    }
    let allowed_tool_names = tool_name_set(tools);
    message
        .get("tool_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|item| {
            let function = item.get("function").unwrap_or(item);
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| repair_tool_name(name, &allowed_tool_names))
                .ok_or_else(|| incomplete_tool_call("missing or invalid function name"))?;
            let arguments = match function.get("arguments").cloned() {
                // Native Ollama protocol: `arguments` is a JSON object, used as-is.
                Some(value @ Value::Object(_)) => value,
                // Defensive: some models violate the protocol and send a JSON
                // string. Parse it (with repair fallback) so the call still works.
                Some(Value::String(text)) => {
                    let arguments = parse_tool_arguments(&text);
                    if arguments.get("parseError").is_some() {
                        return Err(incomplete_tool_call("truncated function arguments"));
                    }
                    arguments
                }
                Some(value) => value,
                None => json!({}),
            };
            if !arguments.is_object() {
                return Err(incomplete_tool_call("function arguments are not an object"));
            }
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("ollama-call-{}", Uuid::new_v4()));
            Ok(ModelToolCall {
                id,
                name,
                arguments,
            })
        })
        .collect()
}

fn malformed_envelope(detail: &str) -> crate::AgentRuntimeError {
    crate::native_backend::providers::errors::protocol_error(
        crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
        format!("provider returned a malformed Ollama response envelope: {detail}"),
    )
}

fn incomplete_tool_call(detail: &str) -> crate::AgentRuntimeError {
    crate::native_backend::providers::errors::protocol_error(
        crate::ProviderProtocolFailureKind::IncompleteToolCall,
        format!("provider returned an incomplete Ollama tool call: {detail}"),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_text_and_tool_calls() {
        let reply = parse_response_body(
            &json!({
                "message": {
                    "role": "assistant",
                    "content": "I will inspect.",
                    "tool_calls": [{
                        "function": {
                            "name": "TOOL_FS_RUN",
                            "arguments": { "path": "/tools/workbench/list_tabs", "args": {} }
                        }
                    }]
                },
                "done": true,
                "prompt_eval_count": 42,
                "eval_count": 9
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect("reply");

        assert_eq!(reply.content.as_deref(), Some("I will inspect."));
        assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
        assert_eq!(
            reply.tool_calls[0].arguments["path"],
            "/tools/workbench/list_tabs"
        );
        assert_eq!(reply.response_meta.usage.input_total_tokens, Some(42));
        assert_eq!(reply.response_meta.usage.input_uncached_tokens, Some(42));
        assert_eq!(reply.response_meta.usage.output_tokens, Some(9));
    }

    #[test]
    fn maps_done_reason_length_to_max_tokens() {
        let reply = parse_response_body(
            &json!({
                "message": {
                    "role": "assistant",
                    "content": "partial"
                },
                "done": true,
                "done_reason": "length"
            }),
            &[],
        )
        .expect("reply");

        assert_eq!(reply.stop_signal, TurnStopSignal::MaxTokens);
    }

    #[test]
    fn preserves_reasoning_only_and_terminal_empty_replies() {
        let reasoning = parse_response_body(
            &json!({
                "message": {
                    "role": "assistant",
                    "content": "",
                    "thinking": "Still working."
                },
                "done": true,
                "done_reason": "length",
                "prompt_eval_count": 4,
                "eval_count": 7
            }),
            &[],
        )
        .expect("reasoning-only reply");
        assert!(reasoning.content.is_none());
        assert_eq!(
            reasoning.reasoning_content.as_deref(),
            Some("Still working.")
        );
        assert_eq!(reasoning.raw_stop_reason.as_deref(), Some("length"));
        assert_eq!(reasoning.response_meta.usage.output_tokens, Some(7));

        let empty = parse_response_body(
            &json!({
                "message": { "role": "assistant", "content": "" },
                "done": true,
                "done_reason": "stop",
                "eval_count": 0
            }),
            &[],
        )
        .expect("terminal-empty reply");
        assert!(empty.content.is_none());
        assert!(empty.reasoning_content.is_none());
        assert!(empty.tool_calls.is_empty());
    }

    #[test]
    fn rejects_truncated_tool_arguments() {
        let error = parse_response_body(
            &json!({
                "message": {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "function": {
                            "name": "tool_fs_run",
                            "arguments": "{\"path\":"
                        }
                    }]
                },
                "done": true,
                "done_reason": "stop"
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect_err("truncated tool arguments");

        assert!(matches!(
            error,
            crate::AgentRuntimeError::ProviderProtocol {
                kind: crate::ProviderProtocolFailureKind::IncompleteToolCall,
                ..
            }
        ));
    }
}
