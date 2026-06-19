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

use super::super::openai_common::{
    SseEvent, parse_sse_line, parse_tool_arguments, repair_tool_name, tool_name_set,
};

#[derive(Clone, Debug, Default)]
struct ToolUseDraft {
    id: Option<String>,
    name: Option<String>,
    input_json: String,
    input: Option<Value>,
}

#[derive(Default)]
struct AnthropicStreamState {
    text: String,
    thinking: String,
    tool_uses: HashMap<usize, ToolUseDraft>,
    stop_reason: Option<String>,
}

pub(crate) fn parse_streaming_response<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tools: &[Value],
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = AnthropicStreamState::default();
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

    let mut tool_calls = tool_calls_from_drafts(state.tool_uses, tools)?;
    tool_calls.sort_by(|left, right| left.id.cmp(&right.id));
    if state.text.trim().is_empty() && tool_calls.is_empty() {
        if state.stop_reason.as_deref() == Some("max_tokens") {
            return Err(AgentRuntimeError::Core(
                "provider response reached max_tokens without assistant text or tool call"
                    .to_string(),
            ));
        }
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }

    let streamed_message_id = ui_message_id.filter(|id| !id.is_empty());
    let mut reply = ModelReply {
        content: (!state.text.trim().is_empty()).then_some(state.text),
        reasoning_content: (!state.thinking.trim().is_empty()).then_some(state.thinking),
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

fn map_stream_event(
    event: &Value,
    state: &mut AnthropicStreamState,
    ui_message_id: &mut Option<String>,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
) -> AgentRuntimeResult<()> {
    match event.get("type").and_then(Value::as_str) {
        Some("content_block_start") => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let block = event.get("content_block").unwrap_or(&Value::Null);
            if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                let draft = state.tool_uses.entry(index).or_default();
                draft.id = block.get("id").and_then(Value::as_str).map(str::to_string);
                draft.name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                if let Some(input) = block.get("input").filter(|value| !value.is_null()) {
                    draft.input = Some(input.clone());
                }
            }
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(text) = block.get("text").and_then(Value::as_str) {
                        append_text_delta(
                            text,
                            state,
                            ui_message_id,
                            buffer_assistant_text,
                            session_id,
                            turn_id,
                        )?;
                    }
                }
                Some("thinking") => {
                    if let Some(thinking) = block.get("thinking").and_then(Value::as_str) {
                        state.thinking.push_str(thinking);
                    }
                }
                _ => {}
            }
        }
        Some("content_block_delta") => {
            let delta = event.get("delta").unwrap_or(&Value::Null);
            match delta.get("type").and_then(Value::as_str) {
                Some("thinking_delta") => {
                    if let Some(thinking) = delta.get("thinking").and_then(Value::as_str) {
                        state.thinking.push_str(thinking);
                    }
                }
                Some("text_delta") => {
                    let text = delta
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    append_text_delta(
                        text,
                        state,
                        ui_message_id,
                        buffer_assistant_text,
                        session_id,
                        turn_id,
                    )?;
                }
                Some("input_json_delta") => {
                    let index = event.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                    let draft = state.tool_uses.entry(index).or_default();
                    if let Some(partial) = delta.get("partial_json").and_then(Value::as_str) {
                        draft.input_json.push_str(partial);
                    }
                    if let (Some(tool_call_id), Some(tool_name)) =
                        (draft.id.as_deref(), draft.name.as_deref())
                    {
                        crate::native_backend::tools::maybe_emit_streaming_diff_preview(
                            session_id,
                            turn_id,
                            tool_call_id,
                            tool_name,
                            &draft.input_json,
                        );
                    }
                }
                _ => {}
            }
        }
        Some("message_delta") => {
            if let Some(stop_reason) = event.pointer("/delta/stop_reason").and_then(Value::as_str)
                && !stop_reason.trim().is_empty()
            {
                state.stop_reason = Some(stop_reason.to_string());
            }
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

fn append_text_delta(
    text: &str,
    state: &mut AnthropicStreamState,
    ui_message_id: &mut Option<String>,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
) -> AgentRuntimeResult<()> {
    if text.is_empty() {
        return Ok(());
    }
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
    state.text.push_str(text);
    Ok(())
}

fn tool_calls_from_drafts(
    drafts: HashMap<usize, ToolUseDraft>,
    tools: &[Value],
) -> AgentRuntimeResult<Vec<ModelToolCall>> {
    let allowed_tool_names = tool_name_set(tools);
    drafts
        .into_values()
        .filter_map(|draft| {
            let name = draft.name?;
            let name = repair_tool_name(&name, &allowed_tool_names)?;
            let id = draft.id.unwrap_or_else(|| "tool-use".to_string());
            let arguments = if !draft.input_json.trim().is_empty() {
                parse_tool_arguments(&draft.input_json)
            } else {
                draft.input.unwrap_or_else(|| json!({}))
            };
            Some(Ok(ModelToolCall {
                id,
                name,
                arguments,
            }))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::*;

    #[test]
    fn parses_streaming_text_and_tool_use_events() {
        let stream = [
            r#"data: {"type":"message_start","message":{"id":"msg-1","type":"message"}}"#,
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Plan."}}"#,
            r#"data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-tabs","name":"tool_fs_run","input":{}}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/tools/workbench/list_tabs\",\"args\":{}}"}}"#,
            r#"data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}"#,
            r#"data: {"type":"message_stop"}"#,
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
        .expect("reply");

        assert_eq!(reply.content.as_deref(), Some("Plan."));
        assert_eq!(reply.tool_calls[0].id, "call-tabs");
        assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
        assert_eq!(
            reply.tool_calls[0].arguments["path"],
            "/tools/workbench/list_tabs"
        );
    }

    #[test]
    fn parses_streaming_thinking_text_and_tool_use_events() {
        let stream = [
            r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Inspect tabs."}}"#,
            r#"data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Plan."}}"#,
            r#"data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"call-tabs","name":"tool_fs_run","input":{}}}"#,
            r#"data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"/tools/workbench/list_tabs\",\"args\":{}}"}}"#,
            r#"data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}"#,
            r#"data: {"type":"message_stop"}"#,
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
        .expect("reply");

        assert_eq!(reply.reasoning_content.as_deref(), Some("Inspect tabs."));
        assert_eq!(reply.content.as_deref(), Some("Plan."));
        assert_eq!(reply.tool_calls[0].id, "call-tabs");
    }
}
