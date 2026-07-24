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
        .unwrap_or_default();
    let text = text_from_content_blocks(&content);
    let tool_calls = tool_calls_from_content_blocks(&content, tools);
    if text.as_ref().is_none_or(|value| value.trim().is_empty()) && tool_calls.is_empty() {
        if body.get("stopReason").and_then(Value::as_str) == Some("max_tokens") {
            return Err(crate::native_backend::providers::errors::empty_response(
                "provider response reached max_tokens without assistant text or tool call"
                    .to_string(),
            ));
        }
        return Err(crate::native_backend::providers::errors::empty_response(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    let stop_signal = crate::native_backend::provider::TurnStopSignal::from_raw(
        body.get("stopReason").and_then(Value::as_str),
    );
    Ok(ModelReply {
        content: text,
        reasoning_content: None,
        tool_calls,
        ui_message_id: None,
        provider_replay_items: Vec::new(),
        response_meta: response_meta(body),
        stop_signal,
    })
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

pub(crate) fn tool_calls_from_content_blocks(
    blocks: &[Value],
    tools: &[Value],
) -> Vec<ModelToolCall> {
    let allowed_tool_names = tool_name_set(tools);
    blocks
        .iter()
        .filter_map(|block| block.get("toolUse"))
        .filter_map(|tool_use| {
            let name = tool_use
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| repair_tool_name(name, &allowed_tool_names))?;
            let id = tool_use
                .get("toolUseId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("tool-use")
                .to_string();
            let arguments = tool_use
                .get("input")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            Some(ModelToolCall {
                id,
                name,
                arguments,
            })
        })
        .collect()
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
    }
}
