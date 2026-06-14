use std::{
    collections::BTreeMap,
    io::BufRead,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use serde_json::Value;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        provider::{ModelReply, ModelToolCall},
        turns::{append_assistant_delta, emit_assistant_message_placeholder, turn_was_cancelled},
    },
};

use super::response::tool_calls_from_message;

#[derive(Default)]
struct OllamaStreamState {
    content: String,
    tool_calls: BTreeMap<usize, ModelToolCall>,
}

pub(crate) fn parse_streaming_response<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tools: &[Value],
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = OllamaStreamState::default();
    let mut ui_message_id: Option<String> = None;
    let buffer_assistant_text = !commit_assistant_text || !tools.is_empty();

    for line in reader.lines() {
        if cancellation.load(Ordering::SeqCst)
            || (!session_id.is_empty()
                && !turn_id.is_empty()
                && turn_was_cancelled(session_id, turn_id))
        {
            return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
        }
        let line = line.map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value = serde_json::from_str::<Value>(trimmed)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if let Some(error) = value.get("error") {
            return Err(AgentRuntimeError::Core(format!(
                "provider streaming error: {error}"
            )));
        }
        map_stream_chunk(
            &value,
            &mut state,
            &mut ui_message_id,
            buffer_assistant_text,
            session_id,
            turn_id,
            tools,
        )?;
        if value.get("done").and_then(Value::as_bool).unwrap_or(false) {
            break;
        }
    }

    let tool_calls = state.tool_calls.into_values().collect::<Vec<_>>();
    if state.content.trim().is_empty() && tool_calls.is_empty() {
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    let mut reply = ModelReply {
        content: (!state.content.trim().is_empty()).then_some(state.content),
        reasoning_content: None,
        tool_calls,
        ui_message_id: ui_message_id.filter(|id| !id.is_empty()),
        provider_replay_items: Vec::new(),
    };
    if commit_assistant_text
        && buffer_assistant_text
        && let Some(content) = reply
            .content
            .as_ref()
            .filter(|content| !content.trim().is_empty())
    {
        reply.ui_message_id =
            crate::native_backend::turns::emit_assistant_text(session_id, turn_id, content);
    }
    Ok(reply)
}

fn map_stream_chunk(
    value: &Value,
    state: &mut OllamaStreamState,
    ui_message_id: &mut Option<String>,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
    tools: &[Value],
) -> AgentRuntimeResult<()> {
    let message = value.get("message").unwrap_or(&Value::Null);
    if let Some(text) = message.get("content").and_then(Value::as_str)
        && !text.is_empty()
    {
        if !buffer_assistant_text {
            let message_id = ui_message_id
                .get_or_insert_with(|| {
                    emit_assistant_message_placeholder(session_id, turn_id).unwrap_or_default()
                })
                .clone();
            if !message_id.is_empty() {
                append_assistant_delta(session_id, turn_id, &message_id, text)?;
            }
        }
        state.content.push_str(text);
    }
    for (index, tool_call) in tool_calls_from_message(message, tools)
        .into_iter()
        .enumerate()
    {
        state.tool_calls.insert(index, tool_call);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use serde_json::json;

    use super::*;

    #[test]
    fn parses_jsonl_text_and_tool_calls() {
        let stream = [
            r#"{"message":{"role":"assistant","content":"Plan."},"done":false}"#,
            r#"{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"tool_fs_run","arguments":{"path":"/tools/workbench/list_tabs","args":{}}}}]},"done":true}"#,
        ]
        .join("\n");

        let reply = parse_streaming_response(
            std::io::Cursor::new(stream),
            "",
            "",
            &Arc::new(AtomicBool::new(false)),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
            false,
        )
        .expect("reply");

        assert_eq!(reply.content.as_deref(), Some("Plan."));
        assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
        assert_eq!(
            reply.tool_calls[0].arguments["path"],
            "/tools/workbench/list_tabs"
        );
    }
}
