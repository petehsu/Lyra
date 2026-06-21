use serde_json::Value;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::provider::{ModelReply, ModelToolCall},
};

use super::super::openai_common::{parse_tool_arguments, repair_tool_name, tool_name_set};

pub(crate) fn parse_response_body(body: &Value, tools: &[Value]) -> AgentRuntimeResult<ModelReply> {
    if let Some(error) = body.get("error") {
        return Err(AgentRuntimeError::Core(format!(
            "provider returned error: {error}"
        )));
    }
    if body.get("status").and_then(Value::as_str) == Some("incomplete") {
        return Err(AgentRuntimeError::Core(format!(
            "provider response is incomplete: {}",
            body.get("incomplete_details")
                .cloned()
                .unwrap_or(Value::Null)
        )));
    }
    if body.get("status").and_then(Value::as_str) == Some("failed") {
        return Err(AgentRuntimeError::Core(format!(
            "provider response failed: {}",
            body.get("error").cloned().unwrap_or(Value::Null)
        )));
    }

    let output = body
        .get("output")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let content = body
        .get("output_text")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .or_else(|| output_text_from_items(&output));
    if let Some(refusal) = refusal_from_items(&output) {
        return Err(AgentRuntimeError::Core(format!(
            "provider refused the request: {refusal}"
        )));
    }
    let tool_calls = tool_calls_from_items(&output, tools);
    if content.as_ref().is_none_or(|value| value.trim().is_empty()) && tool_calls.is_empty() {
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    Ok(ModelReply {
        content,
        reasoning_content: None,
        tool_calls,
        ui_message_id: None,
        provider_replay_items: output,
        stop_signal: Default::default(),
    })
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
                    "arguments": "{\"path\":\"/tools/filesystem/list_files\",\"args\":{}}"
                }
            ]
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
        assert_eq!(reply.provider_replay_items.len(), 3);
    }

    #[test]
    fn incomplete_response_is_an_error() {
        let error = parse_response_body(
            &json!({
                "status": "incomplete",
                "incomplete_details": { "reason": "max_output_tokens" }
            }),
            &[],
        )
        .expect_err("incomplete response");

        assert!(error.to_string().contains("max_output_tokens"));
    }
}
