use serde_json::Value;
use uuid::Uuid;

use crate::{
    AgentRuntimeResult,
    native_backend::provider::{ModelReply, ModelToolCall},
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
    let candidate = body
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|candidates| candidates.first())
        .ok_or_else(|| {
            crate::native_backend::providers::errors::empty_response(
                "provider returned no Gemini candidate",
            )
        })?;
    let parts = candidate
        .pointer("/content/parts")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let text = text_from_parts(&parts);
    let tool_calls = tool_calls_from_parts(&parts, tools);
    if text.as_ref().is_none_or(|value| value.trim().is_empty()) && tool_calls.is_empty() {
        if candidate.get("finishReason").and_then(Value::as_str) == Some("MAX_TOKENS") {
            return Err(crate::native_backend::providers::errors::empty_response(
                "provider response reached max tokens without assistant text or tool call"
                    .to_string(),
            ));
        }
        return Err(crate::native_backend::providers::errors::empty_response(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    let stop_signal = crate::native_backend::provider::TurnStopSignal::from_raw(
        candidate.get("finishReason").and_then(Value::as_str),
    );
    Ok(ModelReply {
        content: text,
        reasoning_content: None,
        tool_calls,
        ui_message_id: None,
        provider_replay_items: Vec::new(),
        stop_signal,
    })
}

pub(crate) fn text_from_parts(parts: &[Value]) -> Option<String> {
    let text = parts
        .iter()
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("");
    (!text.trim().is_empty()).then_some(text)
}

pub(crate) fn tool_calls_from_parts(parts: &[Value], tools: &[Value]) -> Vec<ModelToolCall> {
    let allowed_tool_names = tool_name_set(tools);
    parts
        .iter()
        .enumerate()
        .filter_map(|(index, part)| {
            let function_call = part
                .get("functionCall")
                .or_else(|| part.get("function_call"))?;
            let name = function_call
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| repair_tool_name(name, &allowed_tool_names))?;
            let arguments = function_call
                .get("args")
                .or_else(|| function_call.get("arguments"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            Some(ModelToolCall {
                id: format!("gemini-call-{index}-{}", Uuid::new_v4()),
                name,
                arguments,
            })
        })
        .collect()
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
                }]
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
