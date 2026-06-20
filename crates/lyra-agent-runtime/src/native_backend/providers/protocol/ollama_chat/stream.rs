use std::{
    collections::HashMap,
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
        provider::ModelReply,
        turns::{append_assistant_delta, emit_assistant_message_placeholder, turn_was_cancelled},
    },
};

use super::super::openai_common::{
    StreamingToolCallAccumulator, finalize_streaming_tool_calls, is_valid_tool_call_id,
    tool_name_set,
};

#[derive(Default)]
struct OllamaStreamState {
    content: String,
    tool_calls: HashMap<usize, StreamingToolCallAccumulator>,
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
    let buffer_assistant_text = false;

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

    let allowed_tool_names = tool_name_set(tools);
    let tool_calls = finalize_streaming_tool_calls(state.tool_calls, &allowed_tool_names)?
        .into_iter()
        .map(|(_, tool_call)| tool_call)
        .collect::<Vec<_>>();
    if state.content.trim().is_empty() && tool_calls.is_empty() {
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    let streamed_message_id = ui_message_id.filter(|id| !id.is_empty());
    let mut reply = ModelReply {
        content: (!state.content.trim().is_empty()).then_some(state.content),
        reasoning_content: None,
        tool_calls,
        ui_message_id: streamed_message_id.clone(),
        provider_replay_items: Vec::new(),
    };
    if commit_assistant_text {
        crate::native_backend::turns::commit_visible_assistant_reply(
            session_id,
            turn_id,
            &mut reply,
            &streamed_message_id,
        );
    } else {
        reply.ui_message_id = streamed_message_id;
    }
    Ok(reply)
}

fn merge_tool_call_chunk(
    accumulator: &mut StreamingToolCallAccumulator,
    chunk: &Value,
) {
    if let Some(id) = chunk.get("id").and_then(Value::as_str)
        && is_valid_tool_call_id(id)
    {
        accumulator.id = Some(id.trim().to_string());
    }
    let Some(function) = chunk.get("function") else {
        return;
    };
    if let Some(name) = function.get("name").and_then(Value::as_str)
        && !name.trim().is_empty()
    {
        accumulator.name = Some(name.trim().to_string());
    }
    let args_text = match function.get("arguments") {
        Some(Value::String(text)) => text.clone(),
        Some(value) => serde_json::to_string(value).unwrap_or_default(),
        None => String::new(),
    };
    if args_text.is_empty() {
        return;
    }
    if accumulator.arguments.is_empty() || args_text.starts_with(&accumulator.arguments) {
        accumulator.arguments = args_text;
    } else {
        accumulator.arguments.push_str(&args_text);
    }
}

fn map_stream_chunk(
    value: &Value,
    state: &mut OllamaStreamState,
    ui_message_id: &mut Option<String>,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
    _tools: &[Value],
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
    if let Some(chunks) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, chunk) in chunks.iter().enumerate() {
            let accumulator = state.tool_calls.entry(index).or_default();
            merge_tool_call_chunk(accumulator, chunk);
        }
        crate::native_backend::tools::maybe_emit_streaming_diff_previews_from_accumulators(
            session_id,
            turn_id,
            &state.tool_calls,
        );
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