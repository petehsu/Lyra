use super::*;

pub(crate) fn emit_assistant_text(session_id: &str, turn_id: &str, text: &str) -> Option<String> {
    let message_id = emit_assistant_message_placeholder(session_id, turn_id)?;
    append_assistant_delta(session_id, turn_id, &message_id, text).ok()?;
    commit_assistant_message(session_id, turn_id, &message_id);
    Some(message_id)
}

pub(crate) fn emit_assistant_error_message(
    session_id: &str,
    turn_id: &str,
    failure_message: &str,
) -> Option<String> {
    let text = if failure_message.trim().is_empty() {
        "Agent turn failed without an error message.".to_string()
    } else {
        failure_message.trim().to_string()
    };
    let message_id = emit_assistant_message_placeholder(session_id, turn_id)?;
    append_assistant_delta(session_id, turn_id, &message_id, &text).ok()?;
    commit_assistant_message(session_id, turn_id, &message_id);
    attach_metadata_to_active_assistant_message(
        session_id,
        turn_id,
        &message_id,
        json!({ "isApiError": true }),
    );
    Some(message_id)
}

pub(crate) fn set_active_ui_message_id(session_id: &str, turn_id: &str, message_id: &str) {
    super::session_runtime::set_active_ui_message_id(session_id, turn_id, message_id);
}

pub(crate) fn active_ui_message_id(session_id: &str, turn_id: &str) -> Option<String> {
    super::session_runtime::active_ui_message_id(session_id, turn_id)
}

pub(crate) fn clear_active_ui_message_id(session_id: &str, turn_id: &str) {
    super::session_runtime::clear_active_ui_message_id(session_id, turn_id);
}

pub(crate) fn append_tool_block_to_ui_message(session_id: &str, message_id: &str, tool_id: &str) {
    let (callback, committed_message) = match state().lock() {
        Ok(mut state) => {
            let callback = event_callback();
            let committed_message = {
                let Some(session) = state.sessions.get_mut(session_id) else {
                    return;
                };
                let Some(messages) = session
                    .snapshot
                    .get_mut("messages")
                    .and_then(Value::as_array_mut)
                else {
                    return;
                };
                let Some(index) = messages.iter().position(|message| {
                    message.get("id").and_then(Value::as_str) == Some(message_id)
                }) else {
                    return;
                };
                let message = &mut messages[index];
                if !message.get("blocks").is_some_and(Value::is_array) {
                    message["blocks"] = json!([]);
                }
                let existing_text = message
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                ensure_existing_text_block(message, &existing_text);
                let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) else {
                    return;
                };
                let already_present = blocks.iter().any(|block| {
                    block.get("type").and_then(Value::as_str) == Some("tool")
                        && block.get("toolId").and_then(Value::as_str) == Some(tool_id)
                });
                if already_present {
                    return;
                }
                blocks.push(json!({
                    "type": "tool",
                    "id": format!("tool-{tool_id}"),
                    "toolId": tool_id,
                }));
                let committed_message = message.clone();
                mark_dialog_dirty_from(session, index);
                committed_message
            };
            let _ = state.save_state();
            (callback, committed_message)
        }
        Err(_) => return,
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": committed_message,
        }),
    );
}

pub(crate) fn assistant_reply_visible_text(
    reply: &crate::native_backend::provider::ModelReply,
) -> Option<String> {
    reply
        .content
        .as_ref()
        .filter(|content| !content.trim().is_empty())
        .cloned()
}

/// Commit assistant text to the factual UI timeline.
/// Tool-round preambles are anchored in the chat transcript and receive tool blocks.
pub(crate) fn commit_visible_assistant_reply(
    session_id: &str,
    turn_id: &str,
    reply: &mut crate::native_backend::provider::ModelReply,
    streamed_message_id: &Option<String>,
) -> bool {
    if reply.tool_calls.is_empty() {
        if let Some(message_id) = streamed_message_id
            .as_ref()
            .filter(|message_id| !message_id.is_empty())
        {
            set_active_ui_message_id(session_id, turn_id, message_id);
            reply.ui_message_id = Some(message_id.clone());
            stamp_reasoning_content(session_id, message_id, reply.reasoning_content.as_deref());
            commit_assistant_message(session_id, turn_id, message_id);
            return true;
        }
        if let Some(content) = reply
            .content
            .as_ref()
            .filter(|content| !content.trim().is_empty())
        {
            clear_active_ui_message_id(session_id, turn_id);
            reply.ui_message_id = emit_assistant_text(session_id, turn_id, content);
            if let Some(ref id) = reply.ui_message_id {
                stamp_reasoning_content(session_id, id, reply.reasoning_content.as_deref());
            }
            return reply.ui_message_id.is_some();
        }
        clear_active_ui_message_id(session_id, turn_id);
        return false;
    }

    let message_id = streamed_message_id
        .as_ref()
        .filter(|message_id| !message_id.is_empty())
        .cloned()
        .or_else(|| active_ui_message_id(session_id, turn_id))
        .or_else(|| emit_assistant_message_placeholder(session_id, turn_id));
    let Some(message_id) = message_id else {
        return false;
    };
    let streamed_live = streamed_message_id
        .as_ref()
        .is_some_and(|message_id| !message_id.is_empty());
    let has_streamed_text = reply
        .content
        .as_ref()
        .is_some_and(|content| !content.trim().is_empty());
    if !(streamed_live && has_streamed_text) {
        if let Some(visible_text) = assistant_reply_visible_text(reply)
            && append_assistant_delta(session_id, turn_id, &message_id, &visible_text).is_err()
        {
            return false;
        }
    }
    if has_streamed_text || assistant_reply_visible_text(reply).is_some() {
        commit_assistant_message(session_id, turn_id, &message_id);
    }
    set_active_ui_message_id(session_id, turn_id, &message_id);
    stamp_reasoning_content(session_id, &message_id, reply.reasoning_content.as_deref());
    reply.ui_message_id = Some(message_id);
    true
}

pub(crate) fn ensure_existing_text_block(message: &mut Value, text: &str) {
    if text.is_empty() {
        return;
    }
    if !message.get("blocks").is_some_and(Value::is_array) {
        message["blocks"] = json!([]);
    }
    let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) else {
        return;
    };
    if blocks.iter().any(|block| {
        block.get("type").and_then(Value::as_str) == Some("text")
            && block
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|value| !value.is_empty())
    }) {
        return;
    }
    if let Some(block) = blocks
        .first_mut()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
    {
        block["text"] = Value::String(text.to_string());
        return;
    }
    blocks.insert(0, json!({ "type": "text", "id": "text-0", "text": text }));
}

pub(crate) fn append_reasoning_to_message(
    message: &mut Value,
    delta: &str,
    status: &str,
) -> String {
    append_string_field(message, "reasoningContent", delta);
    let existing_text = missing_text_block(message).then(|| {
        message
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    });
    if !message.get("blocks").is_some_and(Value::is_array) {
        message["blocks"] = json!([]);
    }
    if let Some(existing_text) = existing_text {
        ensure_existing_text_block(message, &existing_text);
    }
    if let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) {
        if let Some(block) = blocks
            .last_mut()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("thinking"))
        {
            let block_id = block
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("thinking-0")
                .to_string();
            append_string_field(block, "text", delta);
            block["status"] = Value::String(status.to_string());
            return block_id;
        }
        let block_id = format!("thinking-{}", blocks.len());
        blocks.push(json!({ "type": "thinking", "id": block_id, "text": delta, "status": status }));
        return block_id;
    }
    "thinking-0".to_string()
}

pub(crate) fn finish_reasoning_blocks(message: &mut Value, reasoning: &str) {
    let existing_text = message
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    ensure_existing_text_block(message, &existing_text);
    let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) else {
        message["blocks"] = json!([
            { "type": "thinking", "id": "thinking-0", "text": reasoning, "status": "done" }
        ]);
        return;
    };
    let has_thinking = blocks
        .iter()
        .any(|block| block.get("type").and_then(Value::as_str) == Some("thinking"));
    if has_thinking {
        for block in blocks {
            if block.get("type").and_then(Value::as_str) == Some("thinking") {
                block["status"] = Value::String("done".to_string());
            }
        }
        return;
    }
    blocks.insert(
        0,
        json!({ "type": "thinking", "id": "thinking-0", "text": reasoning, "status": "done" }),
    );
}

/// Stamp `reasoningContent` onto a UI assistant message and mark status as done.
pub(crate) fn stamp_reasoning_content(session_id: &str, message_id: &str, reasoning: Option<&str>) {
    let (callback, committed_message) = {
        let Ok(mut state) = state().lock() else {
            return;
        };
        let callback = event_callback();
        let Some(session) = state.sessions.get_mut(session_id) else {
            return;
        };
        let Some(messages) = session
            .snapshot
            .get_mut("messages")
            .and_then(Value::as_array_mut)
        else {
            return;
        };
        let Some(index) = messages
            .iter()
            .rposition(|m| m.get("id").and_then(Value::as_str) == Some(message_id))
        else {
            return;
        };
        let message = &mut messages[index];
        // Providers that stream thinking deltas hand back reasoning_content: None
        // at commit time — the reasoning already lives on the message from the
        // delta path. Fall back to it so the status still flips to "done" instead
        // of sticking on "thinking" forever.
        let reasoning = reasoning
            .filter(|r| !r.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                message
                    .get("reasoningContent")
                    .and_then(Value::as_str)
                    .filter(|r| !r.trim().is_empty())
                    .map(str::to_string)
            });
        let Some(reasoning) = reasoning else {
            return;
        };
        message["reasoningContent"] = json!(reasoning);
        message["reasoningStatus"] = json!("done");
        finish_reasoning_blocks(message, &reasoning);
        let committed_message = message.clone();
        mark_dialog_dirty_from(session, index);
        let _ = state.save_state();
        (callback, committed_message)
    };
    // Tool-call-only replies never reach commit_assistant_message, so without
    // this event the renderer keeps showing the thinking spinner even though
    // the snapshot already says "done".
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": committed_message,
        }),
    );
}

pub(crate) fn emit_assistant_message_placeholder(
    session_id: &str,
    turn_id: &str,
) -> Option<String> {
    let message_id = format!("message-{}", Uuid::new_v4());
    let (callback, message) = match state().lock() {
        Ok(mut state) => {
            let callback = event_callback();
            let session = state.sessions.get_mut(session_id)?;
            if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                return None;
            }
            let mut message = assistant_message_with_id(message_id.clone(), String::new());
            if let Some(metadata) = oma_finish_metadata(&session.snapshot, None) {
                message["metadata"] = metadata;
            }
            push_session_message(session, message.clone());
            let _ = state.save_state();
            (callback, message)
        }
        Err(_) => return None,
    };
    set_active_ui_message_id(session_id, turn_id, &message_id);
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": message,
        }),
    );
    Some(message_id)
}

pub(crate) fn append_assistant_delta(
    session_id: &str,
    turn_id: &str,
    message_id: &str,
    delta: &str,
) -> AgentRuntimeResult<()> {
    let callback = match state().lock() {
        Ok(mut state) => {
            let callback = event_callback();
            let session = state.sessions.get_mut(session_id).ok_or_else(|| {
                AgentRuntimeError::Core(format!("session not found: {session_id}"))
            })?;
            if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                return Err(AgentRuntimeError::Core("turn no longer active".to_string()));
            }
            let messages = session
                .snapshot
                .get_mut("messages")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| {
                    AgentRuntimeError::Core("session messages are invalid".to_string())
                })?;
            // Streaming deltas target the most recently appended assistant message,
            // which lives at the tail of the array. Searching from the back finds it
            // in O(1) for the common case instead of scanning the whole conversation
            // on every token. The message id is unique, so the match is identical to a
            // forward scan.
            let index = messages
                .iter()
                .rposition(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
                .ok_or_else(|| {
                    AgentRuntimeError::Core(format!("message not found: {message_id}"))
                })?;
            let message = &mut messages[index];
            let block_id = append_text_to_message(message, delta);
            mark_dialog_dirty_from(session, index);
            (callback, block_id)
        }
        Err(_) => {
            return Err(AgentRuntimeError::Core(
                "agent runtime state lock failed".to_string(),
            ));
        }
    };
    // Streaming must stay lightweight: ship only raw text deltas. The frontend
    // renders an immediate plain/code view while the model is still writing,
    // and the finalized assistant message is enriched once at commit time.
    let event = json!({
        "kind": "messageDelta",
        "sessionId": session_id,
        "messageId": message_id,
        "blockId": callback.1,
        "delta": delta,
    });
    emit_with_callback(&callback.0, event);
    Ok(())
}

pub(crate) fn append_assistant_reasoning_delta(
    session_id: &str,
    turn_id: &str,
    message_id: &str,
    delta: &str,
) -> AgentRuntimeResult<()> {
    let callback = match state().lock() {
        Ok(mut state) => {
            let callback = event_callback();
            let session = state.sessions.get_mut(session_id).ok_or_else(|| {
                AgentRuntimeError::Core(format!("session not found: {session_id}"))
            })?;
            if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                return Err(AgentRuntimeError::Core("turn no longer active".to_string()));
            }
            let messages = session
                .snapshot
                .get_mut("messages")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| {
                    AgentRuntimeError::Core("session messages are invalid".to_string())
                })?;
            let index = messages
                .iter()
                .rposition(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
                .ok_or_else(|| {
                    AgentRuntimeError::Core(format!("message not found: {message_id}"))
                })?;
            let message = &mut messages[index];
            let block_id = append_reasoning_to_message(message, delta, "thinking");
            message["reasoningStatus"] = json!("thinking");
            mark_dialog_dirty_from(session, index);
            (callback, block_id)
        }
        Err(_) => {
            return Err(AgentRuntimeError::Core(
                "agent runtime state lock failed".to_string(),
            ));
        }
    };
    let event = json!({
        "kind": "messageReasoningDelta",
        "sessionId": session_id,
        "messageId": message_id,
        "blockId": callback.1,
        "delta": delta,
    });
    emit_with_callback(&callback.0, event);
    Ok(())
}

pub(crate) struct StreamDeltaBatcher {
    visible: String,
    reasoning: String,
    last_flush: Instant,
}

impl Default for StreamDeltaBatcher {
    fn default() -> Self {
        Self {
            visible: String::new(),
            reasoning: String::new(),
            last_flush: Instant::now(),
        }
    }
}

impl StreamDeltaBatcher {
    const MAX_BYTES: usize = 160;
    const MAX_WAIT: Duration = Duration::from_millis(32);

    pub(crate) fn push_visible(
        &mut self,
        delta: &str,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        let mut flushed = self.flush_reasoning(ui_message_id, session_id, turn_id)?;
        self.visible.push_str(delta);
        flushed |= self.flush_if_ready(ui_message_id, session_id, turn_id)?;
        Ok(flushed)
    }

    pub(crate) fn push_reasoning(
        &mut self,
        delta: &str,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        let mut flushed = self.flush_visible(ui_message_id, session_id, turn_id)?;
        self.reasoning.push_str(delta);
        flushed |= self.flush_if_ready(ui_message_id, session_id, turn_id)?;
        Ok(flushed)
    }

    pub(crate) fn flush(
        &mut self,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        let visible_flushed = self.flush_visible(ui_message_id, session_id, turn_id)?;
        let reasoning_flushed = self.flush_reasoning(ui_message_id, session_id, turn_id)?;
        if visible_flushed || reasoning_flushed {
            self.last_flush = Instant::now();
        }
        Ok(visible_flushed || reasoning_flushed)
    }

    fn flush_if_ready(
        &mut self,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        if self.visible.len() + self.reasoning.len() < Self::MAX_BYTES
            && self.last_flush.elapsed() < Self::MAX_WAIT
        {
            return Ok(false);
        }
        self.flush(ui_message_id, session_id, turn_id)
    }

    fn flush_visible(
        &mut self,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        if self.visible.is_empty() {
            return Ok(false);
        }
        let delta = std::mem::take(&mut self.visible);
        let message_id = ui_message_id
            .get_or_insert_with(|| {
                emit_assistant_message_placeholder(session_id, turn_id).unwrap_or_default()
            })
            .clone();
        if !message_id.is_empty() {
            append_assistant_delta(session_id, turn_id, &message_id, &delta)?;
        }
        Ok(true)
    }

    fn flush_reasoning(
        &mut self,
        ui_message_id: &mut Option<String>,
        session_id: &str,
        turn_id: &str,
    ) -> AgentRuntimeResult<bool> {
        if self.reasoning.is_empty() {
            return Ok(false);
        }
        let delta = std::mem::take(&mut self.reasoning);
        append_reasoning_delta(&delta, ui_message_id, session_id, turn_id)?;
        Ok(true)
    }
}

/// Stream a reasoning delta to the UI, creating a placeholder message if needed.
pub(crate) fn append_reasoning_delta(
    delta: &str,
    ui_message_id: &mut Option<String>,
    session_id: &str,
    turn_id: &str,
) -> AgentRuntimeResult<()> {
    if delta.is_empty() {
        return Ok(());
    }
    let message_id = ui_message_id
        .get_or_insert_with(|| {
            emit_assistant_message_placeholder(session_id, turn_id).unwrap_or_default()
        })
        .clone();
    if !message_id.is_empty() {
        append_assistant_reasoning_delta(session_id, turn_id, &message_id, delta)?;
    }
    Ok(())
}

pub(crate) fn commit_assistant_message(
    session_id: &str,
    turn_id: &str,
    message_id: &str,
) -> Option<Value> {
    let (callback, committed_message) = match state().lock() {
        Ok(mut state) => {
            let callback = event_callback();
            let session = state.sessions.get_mut(session_id)?;
            if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                return None;
            }
            let messages = session
                .snapshot
                .get_mut("messages")
                .and_then(Value::as_array_mut)?;
            let message = messages
                .iter_mut()
                .rev()
                .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))?;
            if message.get("role").and_then(Value::as_str) != Some("assistant") {
                return None;
            }
            let committed_message = message.clone();
            mark_dialog_message_dirty(session, message_id);
            let _ = state.save_state();
            (callback, committed_message)
        }
        Err(_) => return None,
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": committed_message,
        }),
    );
    Some(committed_message)
}

pub(crate) fn attach_metadata_to_assistant_message(
    snapshot: &mut Value,
    message_id: &str,
    metadata: Value,
) -> Option<Value> {
    if metadata.is_null() || metadata.as_object().is_some_and(Map::is_empty) {
        return None;
    }
    let messages = snapshot.get_mut("messages").and_then(Value::as_array_mut)?;
    let message = messages
        .iter_mut()
        .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))?;
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let existing = message
        .get("metadata")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut merged = existing;
    if let Some(incoming) = metadata.as_object() {
        for (key, value) in incoming {
            merged.insert(key.clone(), value.clone());
        }
    }
    message["metadata"] = Value::Object(merged);
    Some(message.clone())
}

pub(crate) fn attach_metadata_to_active_assistant_message(
    session_id: &str,
    turn_id: &str,
    message_id: &str,
    metadata: Value,
) -> Option<Value> {
    let (callback, committed_message) = match state().lock() {
        Ok(mut state) => {
            let callback = event_callback();
            let session = state.sessions.get_mut(session_id)?;
            if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
                return None;
            }
            let committed_message =
                attach_metadata_to_assistant_message(&mut session.snapshot, message_id, metadata)?;
            mark_dialog_message_dirty(session, message_id);
            let _ = state.save_state();
            (callback, committed_message)
        }
        Err(_) => return None,
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": committed_message,
        }),
    );
    Some(committed_message)
}

pub(crate) fn persist_provider_protocol_step(
    session_id: &str,
    turn_id: &str,
    message_id: &str,
    provider_protocol: Value,
) -> AgentRuntimeResult<()> {
    let (callback, committed_message) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let callback = event_callback();
        let session = state.sessions.get_mut(session_id).ok_or_else(|| {
            AgentRuntimeError::Core(format!(
                "session not found while persisting tool step: {session_id}"
            ))
        })?;
        if session.snapshot.get("activeTurnId").and_then(Value::as_str) != Some(turn_id) {
            return Err(AgentRuntimeError::Core(format!(
                "turn is no longer active while persisting tool step: {turn_id}"
            )));
        }
        let committed_message = attach_metadata_to_assistant_message(
            &mut session.snapshot,
            message_id,
            json!({ "providerProtocol": provider_protocol }),
        )
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!(
                "assistant message not found while persisting tool step: {message_id}"
            ))
        })?;
        mark_dialog_message_dirty(session, message_id);
        state.save_state()?;
        (callback, committed_message)
    };

    // Tool calls may have irreversible side effects. Do not dispatch one until
    // the matching assistant/tool-call step is durably recoverable.
    flush_state()?;
    emit_with_callback(
        &callback,
        json!({
            "kind": "messageCommitted",
            "sessionId": session_id,
            "message": committed_message,
        }),
    );
    Ok(())
}

pub(crate) fn persist_oma_provider_protocol_checkpoint(
    execution_session_id: &str,
    turn_id: &str,
    provider_protocol: Value,
) -> AgentRuntimeResult<()> {
    {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let execution = state.sessions.get(execution_session_id).ok_or_else(|| {
            AgentRuntimeError::Core(format!(
                "execution session not found while persisting provider step: {execution_session_id}"
            ))
        })?;
        if execution
            .snapshot
            .get("activeTurnId")
            .and_then(Value::as_str)
            != Some(turn_id)
        {
            return Err(AgentRuntimeError::Core(format!(
                "turn is no longer active while persisting provider step: {turn_id}"
            )));
        }
        let parent_session_id = execution
            .snapshot
            .pointer("/oma/parentSessionId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                AgentRuntimeError::Core(
                    "non-UI provider step has no durable parent session".to_string(),
                )
            })?;
        let session_agent_id = execution
            .snapshot
            .pointer("/oma/executingSessionAgentId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                AgentRuntimeError::Core(
                    "non-UI provider step has no executing Oma agent".to_string(),
                )
            })?;
        let parent = state.sessions.get_mut(&parent_session_id).ok_or_else(|| {
            AgentRuntimeError::Core(format!(
                "Oma parent session not found while persisting provider step: {parent_session_id}"
            ))
        })?;
        let private_metadata = &mut parent.snapshot["oma"]["privateProviderMetadataByAgent"];
        if !private_metadata.is_object() {
            *private_metadata = json!({});
        }
        if !private_metadata[&session_agent_id].is_object() {
            private_metadata[&session_agent_id] = json!({});
        }
        private_metadata[&session_agent_id]["__activeTurn"] = json!({
            "turnId": turn_id,
            "providerProtocol": provider_protocol,
        });
        touch_session(parent);
        state.save_state()?;
    }
    flush_state()
}

pub(crate) fn remove_assistant_message(session_id: &str, message_id: &str) -> bool {
    let (callback, removed) = match state().lock() {
        Ok(mut state) => {
            let callback = event_callback();
            let Some(session) = state.sessions.get_mut(session_id) else {
                return false;
            };
            let Some(messages) = session
                .snapshot
                .get_mut("messages")
                .and_then(Value::as_array_mut)
            else {
                return false;
            };
            let removed_index = messages
                .iter()
                .position(|message| message.get("id").and_then(Value::as_str) == Some(message_id));
            let original_len = messages.len();
            messages
                .retain(|message| message.get("id").and_then(Value::as_str) != Some(message_id));
            let removed = messages.len() < original_len;
            if removed {
                mark_dialog_dirty_from(session, removed_index.unwrap_or(0));
                let _ = state.save_state();
            }
            (callback, removed)
        }
        Err(_) => return false,
    };
    if removed {
        super::session_runtime::clear_active_ui_message_if_matches(session_id, message_id);
        emit_with_callback(
            &callback,
            json!({
                "kind": "sessionSnapshot",
                "snapshot": state()
                    .lock()
                    .ok()
                    .and_then(|state| {
                        state
                            .sessions
                            .get(session_id)
                            .map(|session| session.snapshot.clone())
                    })
                    .unwrap_or(Value::Null),
            }),
        );
    }
    removed
}

pub(crate) fn assistant_message_has_visible_timeline_content(message: &Value) -> bool {
    if message
        .get("text")
        .and_then(Value::as_str)
        .is_some_and(|text| {
            crate::native_backend::tool_protocol::sanitize_visible_assistant_text(text).is_some()
        })
    {
        return true;
    }
    let Some(blocks) = message.get("blocks").and_then(Value::as_array) else {
        return false;
    };
    for block in blocks {
        match block.get("type").and_then(Value::as_str) {
            Some("tool") | Some("image") => return true,
            Some("thinking") => {
                if block
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| !text.trim().is_empty())
                {
                    return true;
                }
            }
            Some("text") => {
                if block
                    .get("text")
                    .and_then(Value::as_str)
                    .is_some_and(|text| {
                        crate::native_backend::tool_protocol::sanitize_visible_assistant_text(text)
                            .is_some()
                    })
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

pub(crate) fn assistant_message_has_provider_protocol_checkpoint(message: &Value) -> bool {
    message
        .pointer("/metadata/providerProtocol/version")
        .and_then(Value::as_u64)
        == Some(2)
}

pub(crate) fn prune_empty_assistant_messages(session: &mut NativeSession) -> usize {
    let Some(messages) = session
        .snapshot
        .get_mut("messages")
        .and_then(Value::as_array_mut)
    else {
        return 0;
    };
    let first_removed = messages.iter().position(|message| {
        message.get("role").and_then(Value::as_str) == Some("assistant")
            && !assistant_message_has_visible_timeline_content(message)
            && !assistant_message_has_provider_protocol_checkpoint(message)
    });
    let original_len = messages.len();
    messages.retain(|message| {
        message.get("role").and_then(Value::as_str) != Some("assistant")
            || assistant_message_has_visible_timeline_content(message)
            || assistant_message_has_provider_protocol_checkpoint(message)
    });
    let removed = original_len.saturating_sub(messages.len());
    if let Some(index) = first_removed {
        mark_dialog_dirty_from(session, index);
    }
    removed
}

pub(crate) fn append_text_to_message(message: &mut Value, delta: &str) -> String {
    let previous_text = missing_text_block(message).then(|| {
        message
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    });
    append_string_field(message, "text", delta);
    if !message.get("blocks").is_some_and(Value::is_array) {
        message["blocks"] = json!([{ "type": "text", "id": "text-0", "text": "" }]);
    }
    if let Some(previous_text) = previous_text {
        ensure_existing_text_block(message, &previous_text);
    }
    if let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) {
        if let Some(block) = blocks
            .last_mut()
            .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        {
            let block_id = block
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("text-0")
                .to_string();
            append_string_field(block, "text", delta);
            return block_id;
        } else {
            let block_id = format!("text-{}", blocks.len());
            blocks.push(json!({ "type": "text", "id": block_id, "text": delta }));
            return block_id;
        }
    }
    "text-0".to_string()
}

pub(crate) fn append_string_field(value: &mut Value, key: &str, delta: &str) {
    match value.get_mut(key) {
        Some(Value::String(text)) => text.push_str(delta),
        _ => value[key] = Value::String(delta.to_string()),
    }
}

pub(crate) fn missing_text_block(message: &Value) -> bool {
    let Some(text) = message.get("text").and_then(Value::as_str) else {
        return false;
    };
    if text.is_empty() {
        return false;
    }
    !message
        .get("blocks")
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks.iter().any(|block| {
                block.get("type").and_then(Value::as_str) == Some("text")
                    && block
                        .get("text")
                        .and_then(Value::as_str)
                        .is_some_and(|value| !value.is_empty())
            })
        })
}
