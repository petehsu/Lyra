use serde_json::Value;
use uuid::Uuid;

use crate::{
    AgentRuntimeResult,
    native_backend::provider::{
        ModelReply, ModelToolCall, ProviderResponseMeta, ProviderTokenUsage,
    },
};

use super::super::openai_common::{repair_tool_name, tool_name_set};

pub(crate) fn parse_response_body(body: &Value, tools: &[Value]) -> AgentRuntimeResult<ModelReply> {
    if let Some(error) = body.get("error") {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
            format!("provider returned error envelope: {error}"),
        ));
    }
    if let Some(block_reason) = body
        .pointer("/promptFeedback/blockReason")
        .and_then(Value::as_str)
    {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::ContentBlocked,
            format!("provider blocked the prompt with reason `{block_reason}`"),
        ));
    }
    let candidates = body
        .get("candidates")
        .and_then(Value::as_array)
        .ok_or_else(|| malformed_envelope("missing candidates array"))?;
    let candidate = candidates
        .first()
        .ok_or_else(|| malformed_envelope("empty candidates array without block reason"))?;
    let raw_stop_reason = candidate
        .get("finishReason")
        .and_then(Value::as_str)
        .map(str::to_string);
    let stop_signal = stop_signal_from_finish_reason(raw_stop_reason.as_deref())?;
    let parts = match candidate.pointer("/content/parts") {
        Some(Value::Array(parts)) => parts.clone(),
        None if matches!(
            stop_signal,
            crate::native_backend::provider::TurnStopSignal::ContentFilter
                | crate::native_backend::provider::TurnStopSignal::Refusal
        ) =>
        {
            Vec::new()
        }
        _ => return Err(malformed_envelope("candidate is missing content parts")),
    };
    let text = text_from_parts(&parts);
    let reasoning_content = reasoning_from_parts(&parts);
    let tool_calls = tool_calls_from_parts(&parts, tools)?;
    Ok(ModelReply {
        content: text,
        reasoning_content,
        tool_calls,
        ui_message_id: None,
        raw_stop_reason,
        provider_replay_protocol: Some("gemini_generate_content".to_string()),
        provider_replay_items: parts,
        response_meta: response_meta(body),
        stop_signal,
    })
}

pub(super) fn stop_signal_from_finish_reason(
    raw: Option<&str>,
) -> AgentRuntimeResult<crate::native_backend::provider::TurnStopSignal> {
    let normalized = raw.map(str::trim).map(str::to_ascii_lowercase);
    match normalized.as_deref() {
        Some(
            "safety"
            | "recitation"
            | "language"
            | "blocklist"
            | "prohibited_content"
            | "spii"
            | "image_safety"
            | "image_prohibited_content"
            | "image_recitation"
            | "escalation",
        ) => Ok(crate::native_backend::provider::TurnStopSignal::ContentFilter),
        Some("malformed_function_call" | "unexpected_tool_call" | "too_many_tool_calls") => Err(
            incomplete_tool_call(raw.unwrap_or("invalid function call finish reason")),
        ),
        Some("missing_thought_signature" | "malformed_response") => Err(malformed_envelope(
            raw.unwrap_or("malformed response finish reason"),
        )),
        _ => Ok(crate::native_backend::provider::TurnStopSignal::from_raw(
            raw,
        )),
    }
}

pub(super) fn response_meta(body: &Value) -> ProviderResponseMeta {
    let usage = body.get("usageMetadata").unwrap_or(&Value::Null);
    let input_total_tokens = usage.get("promptTokenCount").and_then(Value::as_u64);
    let cache_read_input_tokens = usage.get("cachedContentTokenCount").and_then(Value::as_u64);
    ProviderResponseMeta {
        response_id: body
            .get("responseId")
            .or_else(|| body.get("response_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        usage: ProviderTokenUsage {
            input_total_tokens,
            input_uncached_tokens: input_total_tokens
                .map(|total| total.saturating_sub(cache_read_input_tokens.unwrap_or(0))),
            cache_read_input_tokens,
            cache_write_input_tokens: None,
            output_tokens: usage.get("candidatesTokenCount").and_then(Value::as_u64),
            reasoning_tokens: usage.get("thoughtsTokenCount").and_then(Value::as_u64),
        },
    }
}

pub(crate) fn text_from_parts(parts: &[Value]) -> Option<String> {
    let text = parts
        .iter()
        .filter(|part| part.get("thought").and_then(Value::as_bool) != Some(true))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    (!text.trim().is_empty()).then_some(text)
}

pub(crate) fn reasoning_from_parts(parts: &[Value]) -> Option<String> {
    let reasoning = parts
        .iter()
        .filter(|part| part.get("thought").and_then(Value::as_bool) == Some(true))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    (!reasoning.trim().is_empty()).then_some(reasoning)
}

pub(crate) fn tool_calls_from_parts(
    parts: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<Vec<ModelToolCall>> {
    let allowed_tool_names = tool_name_set(tools);
    parts
        .iter()
        .enumerate()
        .filter_map(|(index, part)| {
            part.get("functionCall")
                .or_else(|| part.get("function_call"))
                .map(|function_call| (index, function_call))
        })
        .map(|(index, function_call)| {
            let function_call = function_call
                .as_object()
                .ok_or_else(|| incomplete_tool_call("functionCall is not an object"))?;
            let name = function_call
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| repair_tool_name(name, &allowed_tool_names))
                .ok_or_else(|| incomplete_tool_call("missing or invalid function name"))?;
            let arguments = match function_call
                .get("args")
                .or_else(|| function_call.get("arguments"))
            {
                Some(Value::Object(arguments)) => Value::Object(arguments.clone()),
                Some(Value::String(arguments)) => {
                    let parsed = serde_json::from_str::<Value>(arguments)
                        .map_err(|_| incomplete_tool_call("truncated function arguments"))?;
                    if !parsed.is_object() {
                        return Err(incomplete_tool_call("function arguments are not an object"));
                    }
                    parsed
                }
                Some(_) => {
                    return Err(incomplete_tool_call("function arguments are not an object"));
                }
                None => serde_json::json!({}),
            };
            Ok(ModelToolCall {
                id: format!("gemini-call-{index}-{}", Uuid::new_v4()),
                name,
                arguments,
            })
        })
        .collect()
}

fn malformed_envelope(detail: &str) -> crate::AgentRuntimeError {
    crate::native_backend::providers::errors::protocol_error(
        crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
        format!("provider returned a malformed Gemini response envelope: {detail}"),
    )
}

fn incomplete_tool_call(detail: &str) -> crate::AgentRuntimeError {
    crate::native_backend::providers::errors::protocol_error(
        crate::ProviderProtocolFailureKind::IncompleteToolCall,
        format!("provider returned an incomplete Gemini function call: {detail}"),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::native_backend::provider::TurnStopSignal;

    use super::*;

    #[test]
    fn parses_text_and_function_call_parts() {
        let reply = parse_response_body(
            &json!({
                "candidates": [{
                    "content": {
                        "role": "model",
                        "parts": [
                            { "text": "I will inspect." },
                            {
                                "functionCall": {
                                    "name": "TOOL_FS_RUN",
                                    "args": {
                                        "path": "/tools/workbench/list_tabs",
                                        "args": {}
                                    }
                                }
                            }
                        ]
                    },
                    "finishReason": "STOP"
                }],
                "responseId": "gemini-response-1",
                "usageMetadata": {
                    "promptTokenCount": 100,
                    "cachedContentTokenCount": 60,
                    "candidatesTokenCount": 20,
                    "thoughtsTokenCount": 5
                }
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect("reply");

        assert_eq!(reply.content.as_deref(), Some("I will inspect."));
        assert!(reply.tool_calls[0].id.starts_with("gemini-call-1-"));
        assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
        assert_eq!(
            reply.tool_calls[0].arguments["path"],
            "/tools/workbench/list_tabs"
        );
        assert_eq!(reply.stop_signal, TurnStopSignal::EndTurn);
        assert_eq!(
            reply.response_meta.response_id.as_deref(),
            Some("gemini-response-1")
        );
        assert_eq!(reply.response_meta.usage.input_total_tokens, Some(100));
        assert_eq!(reply.response_meta.usage.input_uncached_tokens, Some(40));
        assert_eq!(reply.response_meta.usage.output_tokens, Some(20));
        assert_eq!(reply.response_meta.usage.reasoning_tokens, Some(5));
        assert_eq!(reply.raw_stop_reason.as_deref(), Some("STOP"));
        assert_eq!(
            reply.provider_replay_protocol.as_deref(),
            Some("gemini_generate_content")
        );
    }

    #[test]
    fn preserves_exact_ordered_candidate_parts_for_replay() {
        let parts = json!([
            {
                "text": "",
                "thoughtSignature": "signed-empty-text"
            },
            {
                "functionCall": {
                    "name": "tool_fs_run",
                    "args": {}
                },
                "thoughtSignature": "signed-function-call"
            },
            {
                "text": "Done."
            }
        ]);
        let reply = parse_response_body(
            &json!({
                "candidates": [{
                    "content": {
                        "role": "model",
                        "parts": parts
                    },
                    "finishReason": "STOP"
                }]
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect("reply");

        assert_eq!(
            reply.provider_replay_items,
            parts.as_array().expect("candidate parts").clone()
        );
    }

    #[test]
    fn thought_text_is_reasoning_not_visible_content() {
        let parts = json!([
            {
                "thought": true,
                "text": "Private thought.",
                "thoughtSignature": "signed-thought"
            },
            { "text": "" }
        ]);
        let reply = parse_response_body(
            &json!({
                "candidates": [{
                    "content": { "role": "model", "parts": parts },
                    "finishReason": "MAX_TOKENS"
                }],
                "responseId": "reasoning-only",
                "usageMetadata": {
                    "promptTokenCount": 5,
                    "candidatesTokenCount": 8,
                    "thoughtsTokenCount": 8
                }
            }),
            &[],
        )
        .expect("reasoning-only reply");

        assert!(reply.content.is_none());
        assert_eq!(reply.reasoning_content.as_deref(), Some("Private thought."));
        assert_eq!(reply.raw_stop_reason.as_deref(), Some("MAX_TOKENS"));
        assert_eq!(reply.response_meta.usage.output_tokens, Some(8));
        assert_eq!(
            reply.provider_replay_items,
            parts.as_array().expect("parts").clone()
        );
    }

    #[test]
    fn terminal_empty_candidate_is_returned_to_the_loop() {
        let reply = parse_response_body(
            &json!({
                "candidates": [{
                    "content": { "role": "model", "parts": [] },
                    "finishReason": "STOP"
                }],
                "usageMetadata": { "candidatesTokenCount": 0 }
            }),
            &[],
        )
        .expect("terminal-empty reply");

        assert!(reply.content.is_none());
        assert!(reply.reasoning_content.is_none());
        assert!(reply.tool_calls.is_empty());
        assert_eq!(reply.raw_stop_reason.as_deref(), Some("STOP"));
    }

    #[test]
    fn rejects_invalid_function_call_part() {
        let error = parse_response_body(
            &json!({
                "candidates": [{
                    "content": {
                        "role": "model",
                        "parts": [{ "functionCall": {} }]
                    },
                    "finishReason": "STOP"
                }]
            }),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
        )
        .expect_err("invalid function call");

        assert!(matches!(
            error,
            crate::AgentRuntimeError::ProviderProtocol {
                kind: crate::ProviderProtocolFailureKind::IncompleteToolCall,
                ..
            }
        ));
    }

    #[test]
    fn classifies_policy_and_malformed_function_finish_reasons() {
        let blocked = parse_response_body(
            &json!({
                "candidates": [{ "finishReason": "RECITATION" }],
                "usageMetadata": { "candidatesTokenCount": 3 }
            }),
            &[],
        )
        .expect("content-filter reply");
        assert_eq!(blocked.stop_signal, TurnStopSignal::ContentFilter);
        assert_eq!(blocked.raw_stop_reason.as_deref(), Some("RECITATION"));
        assert_eq!(blocked.response_meta.usage.output_tokens, Some(3));

        let error = parse_response_body(
            &json!({
                "candidates": [{
                    "content": { "parts": [] },
                    "finishReason": "MALFORMED_FUNCTION_CALL"
                }]
            }),
            &[],
        )
        .expect_err("malformed function finish reason");
        assert!(matches!(
            error,
            crate::AgentRuntimeError::ProviderProtocol {
                kind: crate::ProviderProtocolFailureKind::IncompleteToolCall,
                ..
            }
        ));
    }

    #[test]
    fn maps_finish_reason_to_stop_signal() {
        let reply = parse_response_body(
            &json!({
                "candidates": [{
                    "content": {
                        "role": "model",
                        "parts": [{ "text": "Partial answer." }]
                    },
                    "finishReason": "MAX_TOKENS"
                }]
            }),
            &[],
        )
        .expect("reply");

        assert_eq!(reply.stop_signal, TurnStopSignal::MaxTokens);
    }
}
