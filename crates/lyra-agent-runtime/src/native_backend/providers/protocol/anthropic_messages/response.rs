use serde_json::{Value, json};

use crate::{
    AgentRuntimeResult,
    native_backend::provider::{
        ModelReply, ModelToolCall, ProviderResponseMeta, ProviderTokenUsage,
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
    let content = body
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| {
            crate::native_backend::providers::errors::protocol_error(
                crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
                "provider returned a malformed Anthropic message envelope",
            )
        })?;
    let text = text_from_content_blocks(&content);
    let reasoning_content = thinking_from_content_blocks(&content);
    let tool_calls = tool_calls_from_content_blocks(&content, tools)?;
    let provider_replay_items = provider_replay_items_from_content_blocks(&content);
    let raw_stop_reason = body
        .get("stop_reason")
        .and_then(Value::as_str)
        .map(str::to_string);
    let stop_signal =
        crate::native_backend::provider::TurnStopSignal::from_raw(raw_stop_reason.as_deref());
    Ok(ModelReply {
        content: text,
        reasoning_content,
        tool_calls,
        ui_message_id: None,
        raw_stop_reason,
        provider_replay_protocol: Some("anthropic_messages".to_string()),
        provider_replay_items,
        response_meta: response_meta(body),
        stop_signal,
    })
}

pub(super) fn response_meta(body: &Value) -> ProviderResponseMeta {
    let usage = body.get("usage").unwrap_or(&Value::Null);
    let input_uncached_tokens = usage.get("input_tokens").and_then(Value::as_u64);
    let cache_read_input_tokens = usage.get("cache_read_input_tokens").and_then(Value::as_u64);
    let cache_write_input_tokens = usage
        .get("cache_creation_input_tokens")
        .or_else(|| usage.get("cache_write_input_tokens"))
        .and_then(Value::as_u64);
    let has_input_usage = input_uncached_tokens.is_some()
        || cache_read_input_tokens.is_some()
        || cache_write_input_tokens.is_some();
    ProviderResponseMeta {
        response_id: body
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        usage: ProviderTokenUsage {
            input_total_tokens: has_input_usage.then(|| {
                input_uncached_tokens
                    .unwrap_or(0)
                    .saturating_add(cache_read_input_tokens.unwrap_or(0))
                    .saturating_add(cache_write_input_tokens.unwrap_or(0))
            }),
            input_uncached_tokens,
            cache_read_input_tokens,
            cache_write_input_tokens,
            output_tokens: usage.get("output_tokens").and_then(Value::as_u64),
            reasoning_tokens: usage.get("reasoning_tokens").and_then(Value::as_u64),
        },
    }
}

pub(crate) fn thinking_from_content_blocks(blocks: &[Value]) -> Option<String> {
    let thinking = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("thinking"))
        .filter_map(|block| block.get("thinking").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    (!thinking.trim().is_empty()).then_some(thinking)
}

pub(super) fn provider_replay_items_from_content_blocks(blocks: &[Value]) -> Vec<Value> {
    blocks
        .iter()
        .filter(|block| {
            matches!(
                block.get("type").and_then(Value::as_str),
                Some("text" | "tool_use" | "thinking" | "redacted_thinking")
            )
        })
        .cloned()
        .collect()
}

pub(crate) fn text_from_content_blocks(blocks: &[Value]) -> Option<String> {
    let text = blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    (!text.trim().is_empty()).then_some(text)
}

pub(crate) fn tool_calls_from_content_blocks(
    blocks: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<Vec<ModelToolCall>> {
    let allowed_tool_names = tool_name_set(tools);
    blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
        .map(|block| {
            let name = block
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| repair_tool_name(name, &allowed_tool_names))
                .ok_or_else(|| incomplete_tool_call("missing or invalid tool name"))?;
            let id = block
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| incomplete_tool_call("missing tool use id"))?
                .to_string();
            let arguments = match block.get("input") {
                Some(Value::String(text)) => {
                    let arguments = parse_tool_arguments(text);
                    if arguments.get("parseError").is_some() {
                        return Err(incomplete_tool_call("truncated tool input"));
                    }
                    arguments
                }
                Some(value) => value.clone(),
                None => json!({}),
            };
            if !arguments.is_object() {
                return Err(incomplete_tool_call("tool input is not an object"));
            }
            Ok(ModelToolCall {
                id,
                name,
                arguments,
            })
        })
        .collect()
}

fn incomplete_tool_call(detail: &str) -> crate::AgentRuntimeError {
    crate::native_backend::providers::errors::protocol_error(
        crate::ProviderProtocolFailureKind::IncompleteToolCall,
        format!("provider returned an incomplete Anthropic tool call: {detail}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_text_and_tool_use_blocks() {
        let reply = parse_response_body(
            &json!({
                "id": "msg-1",
                "type": "message",
                "role": "assistant",
                "content": [
                    { "type": "text", "text": "I will inspect." },
                    {
                        "type": "tool_use",
                        "id": "call-tabs",
                        "name": "TOOL_FS_RUN",
                        "input": { "path": "/tools/workbench/list_tabs", "args": {} }
                    }
                ],
                "stop_reason": "tool_use",
                "usage": {
                    "input_tokens": 20,
                    "cache_creation_input_tokens": 30,
                    "cache_read_input_tokens": 50,
                    "output_tokens": 12
                }
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect("reply");

        assert_eq!(reply.content.as_deref(), Some("I will inspect."));
        assert_eq!(reply.tool_calls[0].id, "call-tabs");
        assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
        assert_eq!(
            reply.tool_calls[0].arguments["path"],
            "/tools/workbench/list_tabs"
        );
        assert_eq!(reply.response_meta.response_id.as_deref(), Some("msg-1"));
        assert_eq!(reply.response_meta.usage.input_total_tokens, Some(100));
        assert_eq!(reply.response_meta.usage.input_uncached_tokens, Some(20));
        assert_eq!(reply.response_meta.usage.cache_write_input_tokens, Some(30));
        assert_eq!(reply.response_meta.usage.cache_read_input_tokens, Some(50));
        assert_eq!(reply.response_meta.usage.output_tokens, Some(12));
        assert_eq!(
            reply.provider_replay_protocol.as_deref(),
            Some("anthropic_messages")
        );
        assert_eq!(reply.raw_stop_reason.as_deref(), Some("tool_use"));
    }

    #[test]
    fn parses_thinking_tool_use_and_text_blocks() {
        let content = json!([
            {
                "type": "thinking",
                "thinking": "I should inspect tabs first.",
                "signature": "sig-thinking"
            },
            {
                "type": "redacted_thinking",
                "data": "opaque-redacted-data"
            },
            { "type": "text", "text": "" },
            {
                "type": "tool_use",
                "id": "call-tabs",
                "name": "tool_fs_run",
                "input": { "path": "/tools/workbench/list_tabs", "args": {} }
            }
        ]);
        let reply = parse_response_body(
            &json!({
                "content": content,
                "stop_reason": "tool_use"
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect("reply");

        assert_eq!(
            reply.reasoning_content.as_deref(),
            Some("I should inspect tabs first.")
        );
        assert_eq!(reply.tool_calls[0].id, "call-tabs");
        assert_eq!(
            reply.provider_replay_items,
            content.as_array().expect("content array").clone()
        );
        assert_eq!(reply.provider_replay_items[0]["signature"], "sig-thinking");
        assert_eq!(
            reply.provider_replay_items[1]["data"],
            "opaque-redacted-data"
        );
        assert_eq!(reply.provider_replay_items[2]["text"], "");
    }

    #[test]
    fn preserves_reasoning_only_and_terminal_empty_replies() {
        let reasoning = parse_response_body(
            &json!({
                "id": "msg-reasoning",
                "content": [{
                    "type": "thinking",
                    "thinking": "Still working.",
                    "signature": "signed"
                }],
                "stop_reason": "max_tokens",
                "usage": { "input_tokens": 4, "output_tokens": 7 }
            }),
            &[],
        )
        .expect("reasoning-only reply");
        assert!(reasoning.content.is_none());
        assert_eq!(
            reasoning.reasoning_content.as_deref(),
            Some("Still working.")
        );
        assert_eq!(reasoning.raw_stop_reason.as_deref(), Some("max_tokens"));
        assert_eq!(reasoning.response_meta.usage.output_tokens, Some(7));
        assert_eq!(reasoning.provider_replay_items.len(), 1);

        let empty = parse_response_body(
            &json!({
                "content": [],
                "stop_reason": "end_turn",
                "usage": { "output_tokens": 0 }
            }),
            &[],
        )
        .expect("terminal-empty reply");
        assert!(empty.content.is_none());
        assert!(empty.reasoning_content.is_none());
        assert!(empty.tool_calls.is_empty());
        assert_eq!(empty.raw_stop_reason.as_deref(), Some("end_turn"));
    }

    #[test]
    fn rejects_truncated_tool_input() {
        let error = parse_response_body(
            &json!({
                "content": [{
                    "type": "tool_use",
                    "id": "call-1",
                    "name": "tool_fs_run",
                    "input": "{\"path\":"
                }],
                "stop_reason": "tool_use"
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect_err("truncated input");

        assert!(matches!(
            error,
            crate::AgentRuntimeError::ProviderProtocol {
                kind: crate::ProviderProtocolFailureKind::IncompleteToolCall,
                ..
            }
        ));
    }
}
