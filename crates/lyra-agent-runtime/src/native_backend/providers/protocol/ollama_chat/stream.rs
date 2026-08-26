use std::{collections::HashMap, io::BufRead, time::Instant};

use serde_json::Value;

use tokio_util::sync::CancellationToken;

use crate::{
    AgentRuntimeError, AgentRuntimeResult, ProviderTransportKind,
    native_backend::{
        provider::{ModelReply, ProviderResponseMeta, TurnStopSignal},
        turns::{StreamDeltaBatcher, turn_was_cancelled},
    },
};

use super::super::openai_common::{
    StreamingToolCallAccumulator, finalize_streaming_tool_calls, is_valid_tool_call_id,
    tool_name_set,
};
use super::response::response_meta;

#[derive(Default)]
struct OllamaStreamState {
    content: String,
    reasoning: String,
    tool_calls: HashMap<usize, StreamingToolCallAccumulator>,
    raw_stop_reason: Option<String>,
    stop_signal: TurnStopSignal,
    saw_done: bool,
    saw_message: bool,
    response_meta: ProviderResponseMeta,
}

pub(crate) fn parse_streaming_response<R: BufRead>(
    reader: R,
    session_id: &str,
    turn_id: &str,
    cancellation: &CancellationToken,
    tools: &[Value],
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = OllamaStreamState::default();
    let mut ui_message_id: Option<String> = None;
    let mut delta_batcher = StreamDeltaBatcher::default();
    let buffer_assistant_text = false;
    let started_at = Instant::now();

    for line in reader.lines() {
        if cancellation.is_cancelled()
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
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value = serde_json::from_str::<Value>(trimmed).map_err(|error| {
            crate::native_backend::providers::errors::protocol_error(
                crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
                format!("provider returned malformed Ollama stream JSON: {error}"),
            )
        })?;
        if let Some(error) = value.get("error") {
            return Err(crate::native_backend::providers::errors::protocol_error(
                crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
                format!("provider streaming error envelope: {error}"),
            ));
        }
        map_stream_chunk(
            &value,
            &mut state,
            &mut ui_message_id,
            &mut delta_batcher,
            buffer_assistant_text,
            session_id,
            turn_id,
            tools,
        )?;
        if value.get("done").and_then(Value::as_bool).unwrap_or(false) {
            break;
        }
    }
    delta_batcher.flush(&mut ui_message_id, session_id, turn_id)?;
    finish_streaming_reply(
        state,
        ui_message_id,
        session_id,
        turn_id,
        tools,
        commit_assistant_text,
    )
}

pub(crate) async fn parse_streaming_response_async(
    response: reqwest::Response,
    session_id: &str,
    turn_id: &str,
    cancellation: &CancellationToken,
    tools: &[Value],
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    let mut state = OllamaStreamState::default();
    let mut ui_message_id: Option<String> = None;
    let mut delta_batcher = StreamDeltaBatcher::default();
    let buffer_assistant_text = false;
    let started_at = Instant::now();

    let mut reader = super::super::async_line_reader::AsyncLineReader::new(response.bytes_stream());
    while let Some(line_result) = reader.next_line().await {
        if cancellation.is_cancelled()
            || (!session_id.is_empty()
                && !turn_id.is_empty()
                && turn_was_cancelled(session_id, turn_id))
        {
            return Err(AgentRuntimeError::Cancelled);
        }
        if crate::native_backend::provider::provider_streaming_total_deadline_exceeded(started_at) {
            return Err(crate::native_backend::provider::provider_streaming_total_timeout_error());
        }
        let line = line_result?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let value = serde_json::from_str::<Value>(trimmed).map_err(|error| {
            crate::native_backend::providers::errors::protocol_error(
                crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
                format!("provider returned malformed Ollama stream JSON: {error}"),
            )
        })?;
        if let Some(error) = value.get("error") {
            return Err(crate::native_backend::providers::errors::protocol_error(
                crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
                format!("provider streaming error envelope: {error}"),
            ));
        }
        map_stream_chunk(
            &value,
            &mut state,
            &mut ui_message_id,
            &mut delta_batcher,
            buffer_assistant_text,
            session_id,
            turn_id,
            tools,
        )?;
        if value.get("done").and_then(Value::as_bool).unwrap_or(false) {
            break;
        }
    }
    delta_batcher.flush(&mut ui_message_id, session_id, turn_id)?;
    finish_streaming_reply(
        state,
        ui_message_id,
        session_id,
        turn_id,
        tools,
        commit_assistant_text,
    )
}

fn finish_streaming_reply(
    state: OllamaStreamState,
    ui_message_id: Option<String>,
    session_id: &str,
    turn_id: &str,
    tools: &[Value],
    commit_assistant_text: bool,
) -> AgentRuntimeResult<ModelReply> {
    if !state.saw_done {
        return Err(AgentRuntimeError::ProviderTransport {
            kind: ProviderTransportKind::StreamInterrupted,
            detail: "Ollama stream ended before done=true".to_string(),
        });
    }
    if !state.saw_message {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
            "provider returned an Ollama stream without an assistant message",
        ));
    }
    let allowed_tool_names = tool_name_set(tools);
    let tool_calls = finalize_streaming_tool_calls(state.tool_calls, &allowed_tool_names)?
        .into_iter()
        .map(|(_, tool_call)| tool_call)
        .collect::<Vec<_>>();
    if tool_calls
        .iter()
        .any(|call| call.arguments.get("parseError").is_some())
    {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::IncompleteToolCall,
            "provider returned truncated Ollama function arguments",
        ));
    }
    let streamed_message_id = ui_message_id.filter(|id| !id.is_empty());
    let mut reply = ModelReply {
        content: (!state.content.trim().is_empty()).then_some(state.content),
        reasoning_content: (!state.reasoning.trim().is_empty()).then_some(state.reasoning),
        tool_calls,
        ui_message_id: streamed_message_id.clone(),
        raw_stop_reason: state.raw_stop_reason,
        provider_replay_protocol: Some(super::PROTOCOL_ID.to_string()),
        provider_replay_items: Vec::new(),
        response_meta: state.response_meta,
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

fn merge_tool_call_chunk(accumulator: &mut StreamingToolCallAccumulator, chunk: &Value) {
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
    // Ollama's native /api/chat protocol emits `function.arguments` as a JSON
    // object (not a streamed string of fragments like OpenAI's delta format).
    // Each frame carries the complete arguments for a tool call, so the
    // accumulator stores the latest serialized form and overwrites on a
    // subsequent frame — there is no string concatenation across frames.
    let args_text = match function.get("arguments") {
        Some(Value::String(text)) => {
            // Defensive: some models violate the protocol and send a JSON
            // string. Keep it as-is and let parse_tool_arguments + repair
            // handle it downstream.
            text.clone()
        }
        Some(value) => serde_json::to_string(value).unwrap_or_default(),
        None => String::new(),
    };
    if !args_text.is_empty() {
        accumulator.arguments = args_text;
    }
}

fn map_stream_chunk(
    value: &Value,
    state: &mut OllamaStreamState,
    ui_message_id: &mut Option<String>,
    delta_batcher: &mut StreamDeltaBatcher,
    buffer_assistant_text: bool,
    session_id: &str,
    turn_id: &str,
    _tools: &[Value],
) -> AgentRuntimeResult<()> {
    state.response_meta.merge(response_meta(value));
    if value
        .get("message")
        .is_some_and(|message| !message.is_object())
    {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::ProviderErrorEnvelope,
            "provider returned a malformed Ollama stream message",
        ));
    }
    let message = value.get("message").unwrap_or(&Value::Null);
    state.saw_message |= message.is_object();
    if let Some(text) = message.get("content").and_then(Value::as_str)
        && !text.is_empty()
    {
        if !buffer_assistant_text {
            delta_batcher.push_visible(text, ui_message_id, session_id, turn_id)?;
        }
        state.content.push_str(text);
    }
    if let Some(reasoning) = message.get("thinking").and_then(Value::as_str)
        && !reasoning.is_empty()
    {
        delta_batcher.push_reasoning(reasoning, ui_message_id, session_id, turn_id)?;
        state.reasoning.push_str(reasoning);
    }
    if message
        .get("tool_calls")
        .is_some_and(|tool_calls| !tool_calls.is_array())
    {
        return Err(crate::native_backend::providers::errors::protocol_error(
            crate::ProviderProtocolFailureKind::IncompleteToolCall,
            "provider returned malformed Ollama tool_calls",
        ));
    }
    if let Some(chunks) = message.get("tool_calls").and_then(Value::as_array) {
        for (fallback_index, chunk) in chunks.iter().enumerate() {
            // Ollama native tool_calls carry a `function.index` identifying the
            // call slot (sequential 0..N-1 per assistant message). Prefer it
            // over the array position so parallel calls in the same frame — or
            // the same index reused across frames for different calls — are
            // routed to distinct accumulators. Fall back to array position
            // when the field is absent.
            let index = chunk
                .pointer("/function/index")
                .or_else(|| chunk.get("index"))
                .and_then(Value::as_u64)
                .map(|value| value as usize)
                .unwrap_or(fallback_index);
            let accumulator = state.tool_calls.entry(index).or_default();
            merge_tool_call_chunk(accumulator, chunk);
        }
        delta_batcher.flush(ui_message_id, session_id, turn_id)?;
        crate::native_backend::tools::maybe_emit_streaming_diff_previews_from_accumulators(
            session_id,
            turn_id,
            &state.tool_calls,
        );
    }
    let raw_stop_reason = value.get("done_reason").and_then(Value::as_str);
    if let Some(raw_stop_reason) = raw_stop_reason {
        state.raw_stop_reason = Some(raw_stop_reason.to_string());
    }
    let signal = TurnStopSignal::from_raw(raw_stop_reason);
    if signal != TurnStopSignal::Unknown {
        state.stop_signal = signal;
    }
    state.saw_done |= value.get("done").and_then(Value::as_bool) == Some(true);
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn parses_jsonl_text_and_tool_calls() {
        let stream = [
            r#"{"message":{"role":"assistant","content":"Plan."},"done":false}"#,
            r#"{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"tool_fs_run","arguments":{"path":"/tools/workbench/list_tabs","args":{}}}}]},"done":true,"prompt_eval_count":42,"eval_count":9}"#,
        ]
        .join("\n");

        let reply = parse_streaming_response(
            std::io::Cursor::new(stream),
            "",
            "",
            &CancellationToken::new(),
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
        assert_eq!(reply.response_meta.usage.input_total_tokens, Some(42));
        assert_eq!(reply.response_meta.usage.output_tokens, Some(9));
    }

    #[test]
    fn maps_streaming_done_reason_length_to_max_tokens() {
        let stream = [
            r#"{"message":{"role":"assistant","content":"partial"},"done":false}"#,
            r#"{"message":{"role":"assistant","content":""},"done":true,"done_reason":"length"}"#,
        ]
        .join("\n");

        let reply = parse_streaming_response(
            std::io::Cursor::new(stream),
            "",
            "",
            &CancellationToken::new(),
            &[],
            false,
        )
        .expect("reply");

        assert_eq!(reply.content.as_deref(), Some("partial"));
        assert_eq!(reply.stop_signal, TurnStopSignal::MaxTokens);
    }

    #[test]
    fn reasoning_only_stream_is_returned_with_usage() {
        let stream = [
            r#"{"message":{"role":"assistant","content":"","thinking":"Still "},"done":false}"#,
            r#"{"message":{"role":"assistant","content":"","thinking":"working."},"done":true,"done_reason":"length","prompt_eval_count":4,"eval_count":7}"#,
        ]
        .join("\n");

        let reply = parse_streaming_response(
            std::io::Cursor::new(stream),
            "",
            "",
            &CancellationToken::new(),
            &[],
            false,
        )
        .expect("reasoning-only reply");

        assert!(reply.content.is_none());
        assert_eq!(reply.reasoning_content.as_deref(), Some("Still working."));
        assert_eq!(reply.raw_stop_reason.as_deref(), Some("length"));
        assert_eq!(reply.response_meta.usage.output_tokens, Some(7));
    }

    #[test]
    fn terminal_empty_stream_is_returned_to_the_loop() {
        let reply = parse_streaming_response(
            std::io::Cursor::new(
                r#"{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","eval_count":0}"#,
            ),
            "",
            "",
            &CancellationToken::new(),
            &[],
            false,
        )
        .expect("terminal-empty reply");

        assert!(reply.content.is_none());
        assert!(reply.reasoning_content.is_none());
        assert!(reply.tool_calls.is_empty());
        assert_eq!(reply.raw_stop_reason.as_deref(), Some("stop"));
        assert_eq!(reply.response_meta.usage.output_tokens, Some(0));
    }

    #[test]
    fn stream_without_done_is_interrupted() {
        let error = parse_streaming_response(
            std::io::Cursor::new(
                r#"{"message":{"role":"assistant","content":"partial"},"done":false}"#,
            ),
            "",
            "",
            &CancellationToken::new(),
            &[],
            false,
        )
        .expect_err("missing done=true");

        assert!(matches!(
            error,
            AgentRuntimeError::ProviderTransport {
                kind: ProviderTransportKind::StreamInterrupted,
                ..
            }
        ));
    }

    #[test]
    fn object_arguments_overwrite_per_frame_not_concatenate() {
        // Ollama native protocol sends `arguments` as a JSON object, and each
        // frame carries the complete arguments for that tool call. A later
        // frame with the same index must overwrite — not string-concatenate —
        // so the final arguments are the last frame's complete object.
        let stream = [
            r#"{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"index":0,"name":"tool_fs_run","arguments":{"path":"/first"}}}]},"done":false}"#,
            r#"{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"index":0,"name":"tool_fs_run","arguments":{"path":"/second","args":{}}}}]},"done":true,"done_reason":"stop"}"#,
        ]
        .join("\n");

        let reply = parse_streaming_response(
            std::io::Cursor::new(stream),
            "",
            "",
            &CancellationToken::new(),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
            false,
        )
        .expect("reply");

        assert_eq!(reply.tool_calls.len(), 1);
        assert_eq!(reply.tool_calls[0].arguments["path"], "/second");
        assert!(reply.tool_calls[0].arguments.get("args").is_some());
    }

    #[test]
    fn parallel_tool_calls_are_routed_by_function_index() {
        // Parallel tool calls in one frame are distinguished by
        // `function.index`; each must land in its own accumulator slot.
        let stream = [
            r#"{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"index":0,"name":"tool_fs_run","arguments":{"path":"/a"}}},{"function":{"index":1,"name":"tool_fs_run","arguments":{"path":"/b"}}}]},"done":true,"done_reason":"stop"}"#,
        ]
        .join("\n");

        let reply = parse_streaming_response(
            std::io::Cursor::new(stream),
            "",
            "",
            &CancellationToken::new(),
            &[json!({ "type": "function", "function": { "name": "tool_fs_run" } })],
            false,
        )
        .expect("reply");

        assert_eq!(reply.tool_calls.len(), 2);
        let paths: Vec<&str> = reply
            .tool_calls
            .iter()
            .map(|call| call.arguments["path"].as_str().unwrap())
            .collect();
        assert!(paths.contains(&"/a"));
        assert!(paths.contains(&"/b"));
    }
}
