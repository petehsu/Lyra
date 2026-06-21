use serde_json::{Value, json};
use uuid::Uuid;

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
    let message = body.get("message").ok_or_else(|| {
        AgentRuntimeError::Core("provider returned no Ollama message".to_string())
    })?;
    let content = message
        .get("content")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let tool_calls = tool_calls_from_message(message, tools);
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
        provider_replay_items: Vec::new(),
        stop_signal: Default::default(),
    })
}

pub(crate) fn tool_calls_from_message(message: &Value, tools: &[Value]) -> Vec<ModelToolCall> {
    let allowed_tool_names = tool_name_set(tools);
    message
        .get("tool_calls")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let function = item.get("function").unwrap_or(item);
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .and_then(|name| repair_tool_name(name, &allowed_tool_names))?;
            let arguments = match function
                .get("arguments")
                .or_else(|| function.get("args"))
                .cloned()
            {
                Some(Value::String(text)) => parse_tool_arguments(&text),
                Some(value) => value,
                None => json!({}),
            };
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("ollama-call-{}", Uuid::new_v4()));
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
                "done": true
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
    }
}
