use std::{
    collections::HashMap,
    io::BufRead,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

use serde_json::{Value, json};

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{
        provider::{ModelReply, ModelToolCall, TurnStopSignal},
        turns::{StreamDeltaBatcher, turn_was_cancelled},
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
    function_call_indices: HashMap<String, usize>,
    stop_signal: TurnStopSignal,
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
    let mut delta_batcher = StreamDeltaBatcher::default();
    let buffer_assistant_text = false;
    let started_at = Instant::now();

    for line in reader.lines() {
        if cancellation.load(Ordering::SeqCst)
            || (!session_id.is_empty()
                && !turn_id.is_empty()
                && turn_was_cancelled(session_id, turn_id))
        {
            return Err(AgentRuntimeError::Cancelled);
        }
        if crate::native_backend::provider::provider_streaming_total_deadline_exceeded(started_at) {
            return Err(crate::native_backend::provider::provider_streaming_total_timeout_error());
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
            &mut delta_batcher,
            buffer_assistant_text,
            session_id,
            turn_id,
        )?;
    }
    delta_batcher.flush(&mut ui_message_id, session_id, turn_id)?;

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
        return Err(crate::native_backend::providers::errors::empty_response(
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
        stop_signal: state.stop_signal,
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
    delta_batcher: &mut StreamDeltaBatcher,
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
                delta_batcher.push_visible(delta, ui_message_id, session_id, turn_id)?;
            }
            state.text.push_str(delta);
        }
        Some("response.output_item.added") => {
            if let Some(item) = event.get("item") {
                capture_function_call_draft(event, item, state);
            }
        }
        Some("response.function_call_arguments.delta") => {
            let index = function_call_index_for_event(event, state);
            let draft = state.function_calls.entry(index).or_default();
            if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                draft.arguments.push_str(delta);
            }
            delta_batcher.flush(ui_message_id, session_id, turn_id)?;
            let tool_call_id = draft
                .call_id
                .as_deref()
                .or(draft.id.as_deref())
                .unwrap_or_default();
            if let Some(tool_name) = draft.name.as_deref() {
                crate::native_backend::tools::maybe_emit_streaming_diff_preview(
                    session_id,
                    turn_id,
                    tool_call_id,
                    tool_name,
                    &draft.arguments,
                );
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
            if state.stop_signal == TurnStopSignal::Unknown {
                state.stop_signal = TurnStopSignal::EndTurn;
            }
        }
        Some("response.incomplete") => {
            if let Some(output) = event.pointer("/response/output").and_then(Value::as_array) {
                state.output_items = output.clone();
            }
            let signal = TurnStopSignal::from_raw(
                event
                    .pointer("/response/incomplete_details/reason")
                    .and_then(Value::as_str),
            );
            if signal != TurnStopSignal::MaxTokens {
                return Err(AgentRuntimeError::Core(format!(
                    "provider response is incomplete: {}",
                    event
                        .pointer("/response/incomplete_details")
                        .cloned()
                        .unwrap_or(Value::Null)
                )));
            }
            state.stop_signal = signal;
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
    for key in [draft.id.as_deref(), draft.call_id.as_deref()]
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
    {
        state.function_call_indices.insert(key.to_string(), index);
    }
    if let Some(arguments) = item.get("arguments").and_then(Value::as_str)
        && !arguments.is_empty()
    {
        draft.arguments.push_str(arguments);
    }
}

fn function_call_index_for_event(event: &Value, state: &ResponsesStreamState) -> usize {
    if let Some(index) = event.get("output_index").and_then(Value::as_u64) {
        return index as usize;
    }
    for key in ["item_id", "call_id"] {
        let Some(value) = event.get(key).and_then(Value::as_str) else {
            continue;
        };
        if let Some(index) = state.function_call_indices.get(value) {
            return *index;
        }
    }
    0
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
            r#"data: {"type":"response.function_call_arguments.delta","output_index":1,"delta":"{\"path\":\"/tools/web/search\",\"args\":{\"query\":\"Lyra\"}}" }"#,
            r#"data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","id":"fc-1","call_id":"call-1","name":"tool_fs_run","arguments":"{\"path\":\"/tools/web/search\",\"args\":{\"query\":\"Lyra\"}}"}}"#,
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

    #[test]
    fn streams_write_file_arguments_into_running_edit_activity() {
        let workspace = tempfile::tempdir().expect("workspace");
        let mut session = crate::native_backend::sessions::new_session(
            Some(format!("Streaming preview {}", uuid::Uuid::new_v4())),
            Some(workspace.path().display().to_string()),
            "normal",
        );
        let session_id = session.id.clone();
        let turn_id = format!("turn-streaming-preview-{}", uuid::Uuid::new_v4());
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.snapshot["follow"] = json!({ "running": true, "activity": "calling_model" });
        session
            .runtime_turns
            .push(crate::native_backend::projections::runtime_turn(
                &turn_id,
                &session_id,
                "calling_model",
                None,
                None,
            ));
        {
            let mut state = crate::native_backend::state::state()
                .lock()
                .expect("state lock");
            session.dirty = true;
            state.sessions.insert(session_id.clone(), session);
            state.save_state().expect("save state");
        }

        let arguments = r#"{"path":"index.html","content":"<!DOCTYPE html>\n<html>"}"#;
        let stream = [
            format!(
                "data: {}",
                json!({
                    "type": "response.output_item.added",
                    "output_index": 0,
                    "item": {
                        "type": "function_call",
                        "id": "fc-1",
                        "call_id": "call-write",
                        "name": "write_file",
                        "arguments": ""
                    }
                })
            ),
            format!(
                "data: {}",
                json!({
                    "type": "response.function_call_arguments.delta",
                    "item_id": "fc-1",
                    "delta": arguments
                })
            ),
            format!(
                "data: {}",
                json!({
                    "type": "response.output_item.done",
                    "output_index": 0,
                    "item": {
                        "type": "function_call",
                        "id": "fc-1",
                        "call_id": "call-write",
                        "name": "write_file",
                        "arguments": arguments
                    }
                })
            ),
            "data: [DONE]".to_string(),
        ]
        .join("\n\n");

        let reply = parse_streaming_response(
            std::io::Cursor::new(stream),
            &session_id,
            &turn_id,
            &Arc::new(AtomicBool::new(false)),
            &[json!({ "type": "function", "function": { "name": "write_file" } })],
            false,
        )
        .expect("streaming write_file reply");

        assert_eq!(reply.tool_calls[0].id, "call-write");
        let state = crate::native_backend::state::state()
            .lock()
            .expect("state lock");
        let session = state.sessions.get(&session_id).expect("session");
        let tool = session
            .snapshot
            .get("tools")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|tool| tool.get("id").and_then(Value::as_str) == Some("call-write"))
            .expect("streaming preview tool");
        assert_eq!(tool["status"].as_str(), Some("running"));
        assert_eq!(tool["activityKind"].as_str(), Some("edit"));
        assert_eq!(
            tool.pointer("/output/raw/changedFiles/0/path")
                .and_then(Value::as_str),
            Some("index.html")
        );
        assert!(
            tool.pointer("/output/raw/diff")
                .and_then(Value::as_str)
                .is_some_and(|diff| diff.contains("<!DOCTYPE html>"))
        );
    }

    #[test]
    fn maps_streaming_incomplete_max_output_tokens() {
        let stream = [
            r#"data: {"type":"response.output_text.delta","delta":"partial"}"#,
            r#"data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"partial"}]}]}}"#,
            "data: [DONE]",
        ]
        .join("\n\n");

        let reply = parse_streaming_response(
            std::io::Cursor::new(stream),
            "",
            "",
            &Arc::new(AtomicBool::new(false)),
            &[],
            false,
        )
        .expect("streaming incomplete reply");

        assert_eq!(reply.content.as_deref(), Some("partial"));
        assert_eq!(reply.stop_signal, TurnStopSignal::MaxTokens);
    }

    #[test]
    fn rejects_streaming_incomplete_non_max_output_tokens_reason() {
        let stream = [
            r#"data: {"type":"response.output_text.delta","delta":"partial"}"#,
            r#"data: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"content_filter"},"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"partial"}]}]}}"#,
            "data: [DONE]",
        ]
        .join("\n\n");

        let error = parse_streaming_response(
            std::io::Cursor::new(stream),
            "",
            "",
            &Arc::new(AtomicBool::new(false)),
            &[],
            false,
        )
        .expect_err("non-token-limit incomplete response");

        assert!(error.to_string().contains("content_filter"));
    }
}
