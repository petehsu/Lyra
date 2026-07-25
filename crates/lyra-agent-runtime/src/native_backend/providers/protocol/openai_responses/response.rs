use serde_json::Value;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::provider::{
        ModelReply, ModelToolCall, ProviderResponseMeta, ProviderTokenUsage, TurnStopSignal,
    },
};

use super::super::openai_common::{parse_tool_arguments, repair_tool_name, tool_name_set};

pub(crate) fn parse_response_body(body: &Value, tools: &[Value]) -> AgentRuntimeResult<ModelReply> {
    if let Some(error) = body.get("error").filter(|error| !error.is_null()) {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
            format!("provider returned error envelope: {error}"),
        ));
    }
    let status = body.get("status").and_then(Value::as_str).ok_or_else(|| {
        AgentRuntimeError::Core("provider response is missing status".to_string())
    })?;
    if status == "failed" {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
            format!(
                "provider response failed: {}",
                body.get("error").cloned().unwrap_or(Value::Null)
            ),
        ));
    }
    if !matches!(status, "completed" | "incomplete") {
        return Err(AgentRuntimeError::Core(format!(
            "provider response ended with non-terminal status `{status}`"
        )));
    }

    let output = body
        .get("output")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| {
            AgentRuntimeError::Core("provider response is missing output".to_string())
        })?;
    let content = body
        .get("output_text")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| output_text_from_items(&output));
    if let Some(refusal) = refusal_from_items(&output) {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::ContentBlocked,
            format!("provider refused the request: {refusal}"),
        ));
    }
    let stop_signal = stop_signal_from_response(body);
    let tool_calls = tool_calls_from_items(&output, tools);
    validate_tool_call_items(&output, &tool_calls, stop_signal)?;
    if status == "incomplete" && stop_signal != TurnStopSignal::MaxTokens {
        return Err(incomplete_response_error(body));
    }
    Ok(ModelReply {
        content,
        reasoning_content: reasoning_text_from_items(&output),
        tool_calls,
        ui_message_id: None,
        raw_stop_reason: Some(
            body.pointer("/incomplete_details/reason")
                .and_then(Value::as_str)
                .unwrap_or(status)
                .to_string(),
        ),
        provider_replay_protocol: Some(super::PROTOCOL_ID.to_string()),
        provider_replay_items: output,
        response_meta: response_meta(body),
        stop_signal,
    })
}

pub(super) fn response_meta(body: &Value) -> ProviderResponseMeta {
    let usage = body.get("usage").unwrap_or(&Value::Null);
    let input_total_tokens = usage.get("input_tokens").and_then(Value::as_u64);
    let cache_read_input_tokens = usage
        .pointer("/input_tokens_details/cached_tokens")
        .or_else(|| usage.get("cache_read_input_tokens"))
        .and_then(Value::as_u64);
    let cache_write_input_tokens = usage
        .pointer("/input_tokens_details/cache_write_tokens")
        .or_else(|| usage.get("cache_write_input_tokens"))
        .or_else(|| usage.get("cache_creation_input_tokens"))
        .and_then(Value::as_u64);
    ProviderResponseMeta {
        response_id: body
            .get("id")
            .or_else(|| body.get("response_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        usage: ProviderTokenUsage {
            input_total_tokens,
            input_uncached_tokens: input_total_tokens.map(|total| {
                total
                    .saturating_sub(cache_read_input_tokens.unwrap_or(0))
                    .saturating_sub(cache_write_input_tokens.unwrap_or(0))
            }),
            cache_read_input_tokens,
            cache_write_input_tokens,
            output_tokens: usage.get("output_tokens").and_then(Value::as_u64),
            reasoning_tokens: usage
                .pointer("/output_tokens_details/reasoning_tokens")
                .or_else(|| usage.get("reasoning_tokens"))
                .and_then(Value::as_u64),
        },
    }
}

fn incomplete_response_error(body: &Value) -> AgentRuntimeError {
    AgentRuntimeError::Core(format!(
        "provider response is incomplete: {}",
        body.get("incomplete_details")
            .cloned()
            .unwrap_or(Value::Null)
    ))
}

fn stop_signal_from_response(body: &Value) -> TurnStopSignal {
    let incomplete_reason = body
        .pointer("/incomplete_details/reason")
        .and_then(Value::as_str);
    let signal = TurnStopSignal::from_raw(incomplete_reason);
    if signal != TurnStopSignal::Unknown {
        return signal;
    }
    match body.get("status").and_then(Value::as_str) {
        Some("completed") => TurnStopSignal::EndTurn,
        Some("incomplete") => TurnStopSignal::Unknown,
        _ => TurnStopSignal::Unknown,
    }
}

pub(crate) fn output_text_from_items(items: &[Value]) -> Option<String> {
    let text = items
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|part| {
            part.get("text")
                .and_then(Value::as_str)
                .or_else(|| part.get("content").and_then(Value::as_str))
        })
        .collect::<Vec<_>>()
        .join("");
    (!text.trim().is_empty()).then_some(text)
}

pub(crate) fn reasoning_text_from_items(items: &[Value]) -> Option<String> {
    let text = items
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("reasoning"))
        .filter_map(|item| {
            ["summary", "content"].into_iter().find_map(|field| {
                let text = item
                    .get(field)?
                    .as_array()?
                    .iter()
                    .filter_map(|part| part.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("\n\n");
                (!text.trim().is_empty()).then_some(text)
            })
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    (!text.trim().is_empty()).then_some(text)
}

pub(crate) fn refusal_from_items(items: &[Value]) -> Option<String> {
    items
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .find_map(|part| {
            (part.get("type").and_then(Value::as_str) == Some("refusal")).then(|| {
                part.get("refusal")
                    .and_then(Value::as_str)
                    .or_else(|| part.get("text").and_then(Value::as_str))
                    .unwrap_or("refusal")
                    .to_string()
            })
        })
}

pub(crate) fn tool_calls_from_items(items: &[Value], tools: &[Value]) -> Vec<ModelToolCall> {
    let allowed_tool_names = tool_name_set(tools);
    items
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
        .filter_map(|item| {
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| repair_tool_name(name, &allowed_tool_names))?;
            let id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("call")
                .to_string();
            let arguments = match item.get("arguments") {
                Some(Value::String(text)) => parse_arguments(text),
                Some(value) => value.clone(),
                None => serde_json::json!({}),
            };
            Some(ModelToolCall {
                id,
                name,
                arguments,
            })
        })
        .collect()
}

pub(super) fn validate_tool_call_items(
    items: &[Value],
    tool_calls: &[ModelToolCall],
    stop_signal: TurnStopSignal,
) -> AgentRuntimeResult<()> {
    let item_count = items
        .iter()
        .filter(|item| item.get("type").and_then(Value::as_str) == Some("function_call"))
        .count();
    if item_count != tool_calls.len() {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::IncompleteToolCall,
            "provider returned an incomplete or unknown function call",
        ));
    }
    if stop_signal == TurnStopSignal::MaxTokens {
        Ok(())
    } else {
        super::super::openai_common::validate_tool_call_arguments(tool_calls)
    }
}

pub(crate) fn parse_arguments(text: &str) -> Value {
    parse_tool_arguments(text)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_text_function_call_and_replay_items() {
        let body = json!({
            "id": "resp-1",
            "status": "completed",
            "output": [
                { "type": "reasoning", "id": "rs-1", "encrypted_content": "secret" },
                {
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "I'll inspect." }]
                },
                {
                    "type": "function_call",
                    "call_id": "call-1",
                    "name": "tool_fs_run",
                    "arguments": "{\"path\":\"/tools/web/search\",\"args\":{\"query\":\"Lyra\"}}"
                }
            ],
            "usage": {
                "input_tokens": 120,
                "input_tokens_details": {
                    "cached_tokens": 80,
                    "cache_write_tokens": 10
                },
                "output_tokens": 20,
                "output_tokens_details": { "reasoning_tokens": 5 }
            }
        });
        let reply = parse_response_body(
            &body,
            &[json!({
                "type": "function",
                "function": { "name": "tool_fs_run" }
            })],
        )
        .expect("reply");

        assert_eq!(reply.content.as_deref(), Some("I'll inspect."));
        assert_eq!(reply.tool_calls[0].id, "call-1");
        assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
        assert_eq!(
            reply.provider_replay_items,
            body["output"].as_array().expect("output").clone()
        );
        assert_eq!(
            reply.provider_replay_protocol.as_deref(),
            Some("openai_responses")
        );
        assert_eq!(reply.raw_stop_reason.as_deref(), Some("completed"));
        assert_eq!(reply.response_meta.response_id.as_deref(), Some("resp-1"));
        assert_eq!(reply.response_meta.usage.input_total_tokens, Some(120));
        assert_eq!(reply.response_meta.usage.input_uncached_tokens, Some(30));
        assert_eq!(reply.response_meta.usage.cache_read_input_tokens, Some(80));
        assert_eq!(reply.response_meta.usage.cache_write_input_tokens, Some(10));
        assert_eq!(reply.response_meta.usage.output_tokens, Some(20));
        assert_eq!(reply.response_meta.usage.reasoning_tokens, Some(5));
    }

    #[test]
    fn incomplete_response_with_text_maps_max_output_tokens() {
        let reply = parse_response_body(
            &json!({
                "status": "incomplete",
                "incomplete_details": { "reason": "max_output_tokens" },
                "output": [{
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "partial" }]
                }]
            }),
            &[],
        )
        .expect("incomplete text response");

        assert_eq!(reply.content.as_deref(), Some("partial"));
        assert_eq!(reply.stop_signal, TurnStopSignal::MaxTokens);
    }

    #[test]
    fn incomplete_response_without_text_reaches_the_loop() {
        let reply = parse_response_body(
            &json!({
                "status": "incomplete",
                "incomplete_details": { "reason": "max_output_tokens" },
                "output": []
            }),
            &[],
        )
        .expect("empty incomplete response");

        assert!(reply.content.is_none());
        assert!(reply.tool_calls.is_empty());
        assert_eq!(reply.stop_signal, TurnStopSignal::MaxTokens);
        assert_eq!(reply.raw_stop_reason.as_deref(), Some("max_output_tokens"));
    }

    #[test]
    fn incomplete_response_with_non_max_output_tokens_reason_is_an_error() {
        let error = parse_response_body(
            &json!({
                "status": "incomplete",
                "incomplete_details": { "reason": "content_filter" },
                "output": [{
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": "partial" }]
                }]
            }),
            &[],
        )
        .expect_err("non-token-limit incomplete response");

        assert!(error.to_string().contains("content_filter"));
    }

    #[test]
    fn completed_reasoning_only_and_empty_responses_reach_the_loop() {
        let reasoning = json!({
            "type": "reasoning",
            "id": "rs-1",
            "encrypted_content": "opaque",
            "summary": [{ "type": "summary_text", "text": "Still reasoning." }]
        });
        let reasoning_reply = parse_response_body(
            &json!({
                "status": "completed",
                "output": [reasoning.clone()],
                "usage": {
                    "output_tokens": 12,
                    "output_tokens_details": { "reasoning_tokens": 12 }
                }
            }),
            &[],
        )
        .expect("reasoning-only response");

        assert!(reasoning_reply.content.is_none());
        assert_eq!(
            reasoning_reply.reasoning_content.as_deref(),
            Some("Still reasoning.")
        );
        assert_eq!(reasoning_reply.provider_replay_items, vec![reasoning]);
        assert_eq!(
            reasoning_reply.response_meta.usage.reasoning_tokens,
            Some(12)
        );

        let empty_reply = parse_response_body(&json!({ "status": "completed", "output": [] }), &[])
            .expect("terminal empty response");
        assert!(empty_reply.content.is_none());
        assert!(empty_reply.reasoning_content.is_none());
        assert!(empty_reply.tool_calls.is_empty());
    }

    #[test]
    fn malformed_envelopes_and_invalid_function_calls_stay_errors() {
        assert!(parse_response_body(&json!({ "output": [] }), &[]).is_err());
        assert!(
            parse_response_body(
                &json!({
                    "status": "completed",
                    "output": [{
                        "type": "function_call",
                        "call_id": "call-1",
                        "arguments": "{}"
                    }]
                }),
                &[],
            )
            .is_err()
        );
    }
}
