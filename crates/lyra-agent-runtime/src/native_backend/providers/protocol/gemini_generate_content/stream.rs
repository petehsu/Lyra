use std::{
    collections::HashSet,
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
        turns::{StreamDeltaBatcher, turn_was_cancelled},
    },
};

use super::{
    super::openai_common::{SseEvent, parse_sse_line},
    response::{text_from_parts, tool_calls_from_parts},
};

#[derive(Default)]
struct GeminiStreamState {
    text: String,
    tool_calls: Vec<ModelToolCall>,
    seen_tool_calls: HashSet<String>,
    finish_reason: Option<String>,
}

pub(crate) fn parse_streaming_response<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tools: &[Value],
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = GeminiStreamState::default();
    let mut ui_message_id: Option<String> = None;
    let mut delta_batcher = StreamDeltaBatcher::default();
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
        let SseEvent::Data(chunk) = event else {
            break;
        };
        map_stream_chunk(
            &chunk,
            &mut state,
            &mut ui_message_id,
            &mut delta_batcher,
            buffer_assistant_text,
            session_id,
            turn_id,
            tools,
        )?;
    }
    delta_batcher.flush(&mut ui_message_id, session_id, turn_id)?;

    if state.text.trim().is_empty() && state.tool_calls.is_empty() {
        if state.finish_reason.as_deref() == Some("MAX_TOKENS") {
            return Err(AgentRuntimeError::Core(
                "provider response reached max tokens without assistant text or tool call"
                    .to_string(),
            ));
        }
        return Err(AgentRuntimeError::Core(
            "provider returned no assistant text or tool call".to_string(),
        ));
    }

    let streamed_message_id = ui_message_id.filter(|id| !id.is_empty());
    let stop_signal =
        crate::native_backend::provider::TurnStopSignal::from_raw(state.finish_reason.as_deref());
    let mut reply = ModelReply {
        content: (!state.text.trim().is_empty()).then_some(state.text),
        reasoning_content: None,
        tool_calls: state.tool_calls,
        ui_message_id: streamed_message_id.clone(),
        provider_replay_items: Vec::new(),
        stop_signal,
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

fn map_stream_chunk(
    chunk: &Value,
    state: &mut GeminiStreamState,
    ui_message_id: &mut Option<String>,
    delta_batcher: &mut StreamDeltaBatcher,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
    tools: &[Value],
) -> AgentRuntimeResult<()> {
    if let Some(error) = chunk.get("error") {
        return Err(AgentRuntimeError::Core(format!(
            "provider streaming error: {error}"
        )));
    }
    for candidate in chunk
        .get("candidates")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(finish_reason) = candidate.get("finishReason").and_then(Value::as_str)
            && !finish_reason.trim().is_empty()
        {
            state.finish_reason = Some(finish_reason.to_string());
        }
        let parts = candidate
            .pointer("/content/parts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if let Some(text) = text_from_parts(&parts) {
            append_text_delta(
                &text,
                state,
                ui_message_id,
                delta_batcher,
                buffer_assistant_text,
                session_id,
                turn_id,
            )?;
        }
        for call in tool_calls_from_parts(&parts, tools) {
            let fingerprint = format!(
                "{}:{}",
                call.name,
                serde_json::to_string(&call.arguments).unwrap_or_default()
            );
            if state.seen_tool_calls.insert(fingerprint) {
                state.tool_calls.push(call);
            }
        }
    }
    Ok(())
}

fn append_text_delta(
    text: &str,
    state: &mut GeminiStreamState,
    ui_message_id: &mut Option<String>,
    delta_batcher: &mut StreamDeltaBatcher,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
) -> AgentRuntimeResult<()> {
    if text.is_empty() {
        return Ok(());
    }
    if !buffer_assistant_text {
        delta_batcher.push_visible(text, ui_message_id, session_id, turn_id)?;
    }
    state.text.push_str(text);
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use serde_json::json;

    use super::*;

    #[test]
    fn parses_streaming_text_and_function_call_chunks() {
        let stream = [
            r#"data: {"candidates":[{"content":{"parts":[{"text":"Plan."}]}}]}"#,
            r#"data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"tool_fs_run","args":{"path":"/tools/workbench/list_tabs","args":{}}}}]},"finishReason":"STOP"}]}"#,
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
        .expect("reply");

        assert_eq!(reply.content.as_deref(), Some("Plan."));
        assert_eq!(reply.tool_calls[0].name, "tool_fs_run");
        assert_eq!(
            reply.tool_calls[0].arguments["path"],
            "/tools/workbench/list_tabs"
        );
    }
}
