use serde_json::Value;

use crate::{
    AgentRuntimeResult,
    native_backend::provider::{
        ModelReply, ModelToolCall, ProviderResponseMeta, ProviderTokenUsage,
    },
};

use super::super::openai_common::{repair_tool_name, tool_name_set};

pub(crate) fn parse_response_body(body: &Value, tools: &[Value]) -> AgentRuntimeResult<ModelReply> {
    if let Some(error) = body.get("message").or_else(|| body.get("error")) {
        if body.get("output").is_none() {
            return Err(crate::native_backend::providers::errors::protocol_error(
                crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
                format!("provider returned error envelope: {error}"),
            ));
        }
    }
    let content = body
        .pointer("/output/message/content")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| {
            crate::native_backend::providers::errors::protocol_error(
                crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
                "provider returned a malformed Bedrock Converse response envelope",
            )
        })?;
    let text = text_from_content_blocks(&content);
    let reasoning_content = reasoning_from_content_blocks(&content);
    let tool_calls = tool_calls_from_content_blocks(&content, tools)?;
    let raw_stop_reason = body
        .get("stopReason")
        .and_then(Value::as_str)
        .map(str::to_string);
    let stop_signal = stop_signal_from_reason(raw_stop_reason.as_deref())?;
    Ok(ModelReply {
        content: text,
        reasoning_content,
        tool_calls,
        ui_message_id: None,
        raw_stop_reason,
        provider_replay_protocol: Some("aws_bedrock_converse".to_string()),
        provider_replay_items: content,
        response_meta: response_meta(body),
        stop_signal,
    })
}

fn stop_signal_from_reason(
    raw: Option<&str>,
) -> AgentRuntimeResult<crate::native_backend::provider::TurnStopSignal> {
    match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("stop_sequence") => Ok(crate::native_backend::provider::TurnStopSignal::EndTurn),
        Some("guardrail_intervened" | "content_filtered") => {
            Ok(crate::native_backend::provider::TurnStopSignal::ContentFilter)
        }
        Some("malformed_tool_use") => Err(incomplete_tool_call("malformed_tool_use stop reason")),
        Some("malformed_model_output") => {
            Err(crate::native_backend::providers::errors::protocol_error(
                crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
                "provider reported malformed Bedrock model output",
            ))
        }
        _ => Ok(crate::native_backend::provider::TurnStopSignal::from_raw(
            raw,
        )),
    }
}

fn response_meta(body: &Value) -> ProviderResponseMeta {
    let usage = body.get("usage").unwrap_or(&Value::Null);
    let input_uncached_tokens = usage.get("inputTokens").and_then(Value::as_u64);
    let cache_read_input_tokens = usage.get("cacheReadInputTokens").and_then(Value::as_u64);
    let cache_write_input_tokens = usage.get("cacheWriteInputTokens").and_then(Value::as_u64);
    let has_input_usage = input_uncached_tokens.is_some()
        || cache_read_input_tokens.is_some()
        || cache_write_input_tokens.is_some();
    ProviderResponseMeta {
        response_id: body
            .pointer("/ResponseMetadata/RequestId")
            .or_else(|| body.pointer("/responseMetadata/requestId"))
            .or_else(|| body.pointer("/$metadata/requestId"))
            .or_else(|| body.get("requestId"))
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
            output_tokens: usage.get("outputTokens").and_then(Value::as_u64),
            reasoning_tokens: usage.get("reasoningTokens").and_then(Value::as_u64),
        },
    }
}

pub(crate) fn text_from_content_blocks(blocks: &[Value]) -> Option<String> {
    let text = blocks
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    (!text.trim().is_empty()).then_some(text)
}

pub(crate) fn reasoning_from_content_blocks(blocks: &[Value]) -> Option<String> {
    let reasoning = blocks
        .iter()
        .filter_map(|block| {
            block
                .pointer("/reasoningContent/reasoningText/text")
                .and_then(Value::as_str)
        })
        .collect::<Vec<_>>()
        .join("");
    (!reasoning.trim().is_empty()).then_some(reasoning)
}

pub(crate) fn tool_calls_from_content_blocks(
    blocks: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<Vec<ModelToolCall>> {
    let allowed_tool_names = tool_name_set(tools);
    blocks
        .iter()
        .filter_map(|block| block.get("toolUse"))
        .map(|tool_use| {
            let tool_use = tool_use
                .as_object()
                .ok_or_else(|| incomplete_tool_call("toolUse is not an object"))?;
            let name = tool_use
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| repair_tool_name(name, &allowed_tool_names))
                .ok_or_else(|| incomplete_tool_call("missing or invalid tool name"))?;
            let id = tool_use
                .get("toolUseId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| incomplete_tool_call("missing tool use id"))?
                .to_string();
            let arguments = match tool_use.get("input") {
                Some(Value::Object(input)) => Value::Object(input.clone()),
                None => serde_json::json!({}),
                Some(_) => return Err(incomplete_tool_call("tool input is not an object")),
            };
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
        format!("provider returned an incomplete Bedrock tool call: {detail}"),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_text_and_tool_use_blocks() {
        let reply = parse_response_body(
            &json!({
                "output": {
                    "message": {
                        "role": "assistant",
                        "content": [
                            { "text": "I will inspect." },
                            {
                                "toolUse": {
                                    "toolUseId": "call-tabs",
                                    "name": "TOOL_FS_RUN",
                                    "input": {
                                        "path": "/tools/workbench/list_tabs",
                                        "args": {}
                                    }
                                }
                            }
                        ]
                    }
                },
                "stopReason": "tool_use",
                "responseMetadata": { "requestId": "bedrock-request-1" },
                "usage": {
                    "inputTokens": 20,
                    "cacheReadInputTokens": 50,
                    "cacheWriteInputTokens": 30,
                    "outputTokens": 12
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
        assert_eq!(
            reply.response_meta.response_id.as_deref(),
            Some("bedrock-request-1")
        );
        assert_eq!(reply.response_meta.usage.input_total_tokens, Some(100));
        assert_eq!(reply.response_meta.usage.input_uncached_tokens, Some(20));
        assert_eq!(reply.response_meta.usage.cache_read_input_tokens, Some(50));
        assert_eq!(reply.response_meta.usage.cache_write_input_tokens, Some(30));
        assert_eq!(reply.response_meta.usage.output_tokens, Some(12));
        assert_eq!(reply.raw_stop_reason.as_deref(), Some("tool_use"));
        assert_eq!(
            reply.provider_replay_protocol.as_deref(),
            Some("aws_bedrock_converse")
        );
    }

    #[test]
    fn preserves_exact_ordered_content_blocks_for_replay() {
        let content = json!([
            {
                "reasoningContent": {
                    "reasoningText": {
                        "text": "private reasoning",
                        "signature": "signed-reasoning"
                    }
                }
            },
            {
                "reasoningContent": {
                    "redactedContent": "redacted-bytes"
                }
            },
            {
                "toolUse": {
                    "toolUseId": "call-tabs",
                    "name": "tool_fs_run",
                    "input": {}
                }
            },
            {
                "text": ""
            }
        ]);
        let reply = parse_response_body(
            &json!({
                "output": {
                    "message": {
                        "role": "assistant",
                        "content": content
                    }
                },
                "stopReason": "tool_use"
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect("reply");

        assert_eq!(
            reply.provider_replay_items,
            content.as_array().expect("content blocks").clone()
        );
        assert_eq!(
            reply.reasoning_content.as_deref(),
            Some("private reasoning")
        );
    }

    #[test]
    fn preserves_reasoning_only_and_terminal_empty_replies() {
        let reasoning = parse_response_body(
            &json!({
                "output": {
                    "message": {
                        "role": "assistant",
                        "content": [{
                            "reasoningContent": {
                                "reasoningText": {
                                    "text": "Still working.",
                                    "signature": "signed"
                                }
                            }
                        }]
                    }
                },
                "stopReason": "max_tokens",
                "usage": { "inputTokens": 4, "outputTokens": 7 }
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

        let empty = parse_response_body(
            &json!({
                "output": {
                    "message": { "role": "assistant", "content": [] }
                },
                "stopReason": "end_turn",
                "usage": { "outputTokens": 0 }
            }),
            &[],
        )
        .expect("terminal-empty reply");
        assert!(empty.content.is_none());
        assert!(empty.reasoning_content.is_none());
        assert!(empty.tool_calls.is_empty());
    }

    #[test]
    fn rejects_invalid_tool_use_block() {
        let error = parse_response_body(
            &json!({
                "output": {
                    "message": {
                        "role": "assistant",
                        "content": [{ "toolUse": { "toolUseId": "call-1" } }]
                    }
                },
                "stopReason": "tool_use"
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect_err("invalid tool use");

        assert!(matches!(
            error,
            crate::AgentRuntimeError::ProviderProtocol {
                kind: crate::ProviderProtocolFailureKind::IncompleteToolCall,
                ..
            }
        ));
    }

    #[test]
    fn classifies_bedrock_policy_and_malformed_tool_stop_reasons() {
        let blocked = parse_response_body(
            &json!({
                "output": {
                    "message": { "role": "assistant", "content": [] }
                },
                "stopReason": "guardrail_intervened",
                "usage": { "outputTokens": 0 }
            }),
            &[],
        )
        .expect("guardrail reply");
        assert_eq!(
            blocked.stop_signal,
            crate::native_backend::provider::TurnStopSignal::ContentFilter
        );

        let error = parse_response_body(
            &json!({
                "output": {
                    "message": { "role": "assistant", "content": [] }
                },
                "stopReason": "malformed_tool_use"
            }),
            &[],
        )
        .expect_err("malformed tool stop reason");
        assert!(matches!(
            error,
            crate::AgentRuntimeError::ProviderProtocol {
                kind: crate::ProviderProtocolFailureKind::IncompleteToolCall,
                ..
            }
        ));
    }
}
