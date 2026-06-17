use std::{
    collections::HashMap,
    io::BufRead,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use serde_json::{Value, json};

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        provider::{ModelReply, ModelToolCall},
        turns::{append_assistant_delta, emit_assistant_message_placeholder, turn_was_cancelled},
    },
};

use super::super::openai_common::{SseEvent, parse_sse_line};
use super::response::{output_text_from_items, parse_arguments, tool_calls_from_items};

#[derive(Clone, Debug, Default)]
struct FunctionCallDraft {
    id: Option<String>,
    call_id: Option<String>,
    name: Option<String>,
    arguments: String,
}

#[derive(Default)]
struct ResponsesStreamState {
    text: String,
    output_items: Vec<Value>,
    function_calls: HashMap<usize, FunctionCallDraft>,
}

pub(crate) fn parse_streaming_response<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tools: &[Value],
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = ResponsesStreamState::default();
    let mut ui_message_id: Option<String> = None;
    let buffer_assistant_text = !tools.is_empty();

    for line in reader.lines() {
        if cancellation.load(Ordering::SeqCst)
            || (!session_id.is_empty()
                && !turn_id.is_empty()
                && turn_was_cancelled(session_id, turn_id))
        {
            return Err(AgentRuntimeError::Core("turn cancelled".to_string()));
        }
        let line = line.map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let Some(event) = parse_sse_line(&line)? else {
            continue;
        };
        let SseEvent::Data(event) = event else {
            break;
        };
        map_stream_event(
            &event,
            &mut state,
            &mut ui_message_id,
            buffer_assistant_text,
            session_id,
            turn_id,
        )?;
    }

    let replay_items = if state.output_items.is_empty() && !state.text.trim().is_empty() {
        vec![json!({
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": state.text }],
        })]
    } else {
        state.output_items
    };
    let mut tool_calls = tool_calls_from_items(&replay_items, tools);
    if tool_calls.is_empty() {
        tool_calls = state
            .function_calls
            .into_values()
            .filter_map(|draft| {
                let name = draft.name?;
                Some(ModelToolCall {
                    id: draft
                        .call_id
                        .or(draft.id)
                        .unwrap_or_else(|| "call".to_string()),
                    name,
                    arguments: parse_arguments(&draft.arguments),
                })
            })
            .collect();
    }
    let content = output_text_from_items(&replay_items)
        .or_else(|| (!state.text.trim().is_empty()).then_some(state.text));
    if content.as_ref().is_none_or(|value| value.trim().is_empty()) && tool_calls.is_empty() {
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }
    let streamed_message_id = ui_message_id.filter(|id| !id.is_empty());
    let mut reply = ModelReply {
        content,
        reasoning_content: None,
        tool_calls,
        ui_message_id: streamed_message_id.clone(),
        provider_replay_items: replay_items,
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

fn map_stream_event(
    event: &Value,
    state: &mut ResponsesStreamState,
    ui_message_id: &mut Option<String>,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
) -> AgentRuntimeResult<()> {
    match event.get("type").and_then(Value::as_str) {
        Some("response.output_text.delta") => {
            let delta = event
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if delta.is_empty() {
                return Ok(());
            }
            if !buffer_assistant_text {
                let message_id = ui_message_id
                    .get_or_insert_with(|| {
                        emit_assistant_message_placeholder(session_id, turn_id).unwrap_or_default()
                    })
                    .clone();
                if !message_id.is_empty() {
                    append_assistant_delta(session_id, turn_id, &message_id, delta)?;
                }
            }
            state.text.push_str(delta);
        }
        Some("response.output_item.added") => {
            if let Some(item) = event.get("item") {
                capture_function_call_draft(event, item, state);
            }
        }
        Some("response.function_call_arguments.delta") => {
            let index = event
                .get("output_index")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            let draft = state.function_calls.entry(index).or_default();
            if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                draft.arguments.push_str(delta);
            }
        }
        Some("response.output_item.done") => {
            if let Some(item) = event.get("item").cloned() {
                state.output_items.push(item);
            }
        }
        Some("response.completed") => {
            if let Some(output) = event.pointer("/response/output").and_then(Value::as_array) {
                state.output_items = output.clone();
            }
        }
        Some("response.failed") => {
            return Err(AgentRuntimeError::Core(format!(
                "provider response failed: {}",
                event
                    .pointer("/response/error")
                    .cloned()
                    .unwrap_or(Value::Null)
            )));
        }
        Some("error") => {
            return Err(AgentRuntimeError::Core(format!(
                "provider streaming error: {}",
                event.get("error").cloned().unwrap_or_else(|| event.clone())
            )));
        }
        _ => {}
    }
    Ok(())
}

fn capture_function_call_draft(event: &Value, item: &Value, state: &mut ResponsesStreamState) {
    if item.get("type").and_then(Value::as_str) != Some("function_call") {
        return;
    }
    let index = event
        .get("output_index")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let draft = state.function_calls.entry(index).or_default();
    draft.id = item.get("id").and_then(Value::as_str).map(str::to_string);
    draft.call_id = item
        .get("call_id")
        .and_then(Value::as_str)
        .map(str::to_string);
    draft.name = item.get("name").and_then(Value::as_str).map(str::to_string);
    if let Some(arguments) = item.get("arguments").and_then(Value::as_str)
        && !arguments.is_empty()
    {
        draft.arguments.push_str(arguments);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use serde_json::json;

    use super::*;

    #[test]
    fn parses_streaming_text_and_function_call_events() {
        let stream = [
            r#"data: {"type":"response.output_text.delta","delta":"Plan."}"#,
            r#"data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc-1","call_id":"call-1","name":"tool_fs_run","arguments":""}}"#,
            r#"data: {"type":"response.function_call_arguments.delta","output_index":1,"delta":"{\"path\":\"/tools/filesystem/list_files\",\"args\":{}}" }"#,
            r#"data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","id":"fc-1","call_id":"call-1","name":"tool_fs_run","arguments":"{\"path\":\"/tools/filesystem/list_files\",\"args\":{}}"}}"#,
            "data: [DONE]",
        ]
        .join("\n\n");

        let reply = parse_streaming_response(
            std::io::Cursor::new(stream),
            "",
            "",
            &Arc::new(AtomicBool::new(false)),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
            false,
        )
        .expect("streaming reply");

        assert_eq!(reply.content.as_deref(), Some("Plan."));
        assert_eq!(reply.tool_calls[0].id, "call-1");
        assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
        assert_eq!(reply.provider_replay_items[0]["type"], "function_call");
    }
}
