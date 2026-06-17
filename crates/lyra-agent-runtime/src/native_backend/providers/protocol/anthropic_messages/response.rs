use serde_json::{Value, json};

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
    let content = body
        .get("content")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let text = text_from_content_blocks(&content);
    let reasoning_content = thinking_from_content_blocks(&content);
    let tool_calls = tool_calls_from_content_blocks(&content, tools);
    if text.as_ref().is_none_or(|value| value.trim().is_empty()) && tool_calls.is_empty() {
        if body.get("stop_reason").and_then(Value::as_str) == Some("max_tokens") {
            return Err(AgentRuntimeError::Core(
                "provider response reached max_tokens without assistant text or tool call"
                    .to_string(),
            ));
        }
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    Ok(ModelReply {
        content: text,
        reasoning_content: reasoning_content,
        tool_calls,
        ui_message_id: None,
        provider_replay_items: Vec::new(),
    })
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
) -> Vec<ModelToolCall> {
    let allowed_tool_names = tool_name_set(tools);
    blocks
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_use"))
        .filter_map(|block| {
            let name = block
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| repair_tool_name(name, &allowed_tool_names))?;
            let id = block
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("tool-use")
                .to_string();
            let arguments = match block.get("input") {
                Some(Value::String(text)) => parse_tool_arguments(text),
                Some(value) => value.clone(),
                None => json!({}),
            };
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
                "stop_reason": "tool_use"
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
    }

    #[test]
    fn parses_thinking_tool_use_and_text_blocks() {
        let reply = parse_response_body(
            &json!({
                "content": [
                    { "type": "thinking", "thinking": "I should inspect tabs first." },
                    { "type": "text", "text": "" },
                    {
                        "type": "tool_use",
                        "id": "call-tabs",
                        "name": "tool_fs_run",
                        "input": { "path": "/tools/workbench/list_tabs", "args": {} }
                    }
                ],
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
    }
}
