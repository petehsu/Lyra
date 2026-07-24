use sha2::{Digest, Sha256};

use super::*;

mod oma_provider;
mod provider_metadata;
mod provider_request;

#[cfg(test)]
#[path = "turns/goal_continuation_tests.test.rs"]
mod goal_continuation_tests;
#[cfg(test)]
#[path = "turns/narration_tests.test.rs"]
mod narration_tests;

pub(crate) use oma_provider::run_oma_direct_ask;
use oma_provider::run_oma_turn_if_needed_async;
use provider_metadata::{
    finalize_openai_response_state_fingerprint, set_runtime_turn_provider_metadata,
};
#[cfg(test)]
pub(crate) use provider_request::build_model_request;
use provider_request::build_model_request_async;

pub(crate) fn send_turn(payload: Value) -> AgentRuntimeResult<Value> {
    let requested_session = string_opt(&payload, "sessionId");
    if let Ok(mut state) = state().lock() {
        if let Ok(session_id) = state.resolve_session_id(requested_session.clone()) {
            if let Some(session) = state.sessions.get(&session_id) {
                if let Some(failure) = gate_turn_on_blocked_browser(session) {
                    return Err(AgentRuntimeError::Core(failure));
                }
            }
        }
    }
    let text = string_opt(&payload, "text")
        .or_else(|| string_opt(&payload, "prompt"))
        .unwrap_or_default();
    let inline_images = parse_inline_images(&payload);
    let uses_inline_image_markers = text_has_inline_image_markers(&text);
    if uses_inline_image_markers {
        validate_inline_image_turn_commit(&text, &inline_images)
            .map_err(AgentRuntimeError::Core)?;
    }
    let legacy_images = if uses_inline_image_markers {
        Vec::new()
    } else {
        payload
            .get("images")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let citations = parse_transcript_citations(&payload);
    let page_citations = parse_page_citations(&payload);
    let file_citations = parse_file_citations(&payload);
    let ui_hidden = payload
        .get("uiHidden")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let only_if_idle = payload
        .get("onlyIfIdle")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let goal_continuation = payload
        .get("goalContinuation")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let requested_session = string_opt(&payload, "sessionId");
    let now = now();
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let mut user_message = user_message(text.clone(), legacy_images.clone(), now.clone());
    let user_message_id = user_message
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("message-{}", Uuid::new_v4()));

    let (session_id, callback, snapshot, soft_interrupt_events, cancellation) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let session_id = state.resolve_session_id(requested_session)?;
        if only_if_idle {
            let turn_status = state
                .sessions
                .get(&session_id)
                .and_then(|s| s.snapshot.get("turnStatus").and_then(Value::as_str))
                .unwrap_or("idle");
            if turn_status != "idle" {
                return Ok(json!({
                    "sessionId": session_id,
                    "turnId": Value::Null,
                    "status": "idle",
                    "sent": false,
                    "reason": "session_not_idle"
                }));
            }
        }
        let interrupted_turn_id = state
            .sessions
            .get(&session_id)
            .filter(|session| session.snapshot["turnStatus"] == "running")
            .and_then(|session| {
                session
                    .snapshot
                    .get("activeTurnId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        if let Some(previous_turn_id) = interrupted_turn_id.as_ref() {
            super::session_runtime::request_turn_cancellation(previous_turn_id);
            clear_pending_interactions_for_turn(&mut state, previous_turn_id);
        }
        let session = state
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let mut soft_interrupt_events = Vec::new();
        if let Some(previous_turn_id) = interrupted_turn_id.as_ref() {
            session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
            session.snapshot["activeTurnId"] = Value::Null;
            finalize_interrupt_state(session, "soft_interrupt_new_user_message");
            finish_running_tools_for_turn(
                session,
                previous_turn_id,
                "cancelled",
                json!({ "content": "Lyra tool call was cancelled by a newer user message." }),
            );
            update_runtime_turn_state(
                session,
                previous_turn_id,
                "interrupted",
                Some("soft_interrupt"),
            );
            soft_interrupt_events.push(json!({
                "kind": "turnStateChanged",
                "sessionId": session_id,
                "turnId": previous_turn_id,
                "state": "interrupted",
                "reason": "soft_interrupt_new_user_message"
            }));
            soft_interrupt_events.push(json!({
                "kind": "turnInterrupted",
                "sessionId": session_id,
                "turnId": previous_turn_id,
                "reason": "soft_interrupt_new_user_message"
            }));
        }
        if !citations.is_empty() {
            let existing_messages = session
                .snapshot
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let (accepted, rejected) =
                validate_transcript_citations(&existing_messages, &citations);
            apply_transcript_citations_to_user_message(&mut user_message, &accepted, &rejected);
        }
        if !page_citations.is_empty() {
            apply_page_citations_to_user_message(&mut user_message, &page_citations);
        }
        if !file_citations.is_empty() {
            apply_file_citations_to_user_message(&mut user_message, &file_citations);
        }
        if uses_inline_image_markers {
            apply_inline_images_to_user_message(&mut user_message, &inline_images);
        }
        if ui_hidden {
            if !user_message.get("metadata").is_some_and(Value::is_object) {
                user_message["metadata"] = json!({});
            }
            user_message["metadata"]["uiHidden"] = json!(true);
            if goal_continuation {
                user_message["metadata"]["goalContinuation"] = json!(true);
            }
            user_message["rollback"] = json!({
                "available": false,
                "unavailableReason": "Rollback is unavailable for menu action turns."
            });
        } else {
            session.snapshot["goalContinuation"] = Value::Null;
            session.snapshot["completionBlocked"] = Value::Null;
            let checkpoint = rollback_checkpoint(&session_id, &turn_id, &user_message_id, session);
            user_message["rollback"] = json!({
                "available": true,
                "anchorId": checkpoint.id,
                "checkpointAt": checkpoint.created_at,
                "unavailableReason": Value::Null
            });
            session.rollback_checkpoints.push(checkpoint);
            maybe_title_session_from_first_user_message(session, &text);
        }
        apply_oma_user_turn(session, &payload, &text, &mut user_message)?;
        push_session_message(session, user_message.clone());
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.snapshot["follow"] = json!({ "running": true, "activity": "calling_model" });
        touch_session(session);
        session.runtime_turns.push(runtime_turn(
            &turn_id,
            &session_id,
            "calling_model",
            Some(user_message_id.clone()),
            None,
        ));
        let snapshot = session.snapshot.clone();
        let cancellation = CancellationToken::new();
        super::session_runtime::register_active_turn(&session_id, &turn_id, cancellation.clone());
        let callback = event_callback();
        state.save_state()?;
        (
            session_id,
            callback,
            snapshot,
            soft_interrupt_events,
            cancellation,
        )
    };

    for event in soft_interrupt_events {
        emit_with_callback(&callback, event);
    }
    emit_with_callback(
        &callback,
        json!({ "kind": "messageCommitted", "sessionId": session_id, "message": user_message }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "turnStarted", "sessionId": session_id, "turnId": turn_id, "state": "calling_model" }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "turnStateChanged", "sessionId": session_id, "turnId": turn_id, "state": "calling_model", "reason": "native_turn_started" }),
    );
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );

    let thread_session_id = session_id.clone();
    let thread_turn_id = turn_id.clone();
    super::turn_engine::spawn_turn(thread_session_id, thread_turn_id, cancellation);

    Ok(json!({ "sessionId": session_id, "turnId": turn_id, "status": "running" }))
}

pub(crate) async fn run_native_turn_async(
    session_id: String,
    turn_id: String,
    cancellation: CancellationToken,
) {
    let model_result =
        match run_oma_turn_if_needed_async(&session_id, &turn_id, &cancellation).await {
            Some(result) => result,
            None => match build_model_request_async(session_id.clone()).await {
                Ok(request) => {
                    run_model_loop_async(&session_id, &turn_id, request, &cancellation).await
                }
                Err(error) => Err(error),
            },
        };
    tokio::time::sleep(Duration::from_millis(25)).await;

    if cancellation.is_cancelled() || turn_was_cancelled(&session_id, &turn_id) {
        let metadata = super::session_runtime::take_turn_provider_metadata(&session_id, &turn_id);
        finish_turn_with_metadata(
            &session_id,
            &turn_id,
            "cancelled",
            None,
            Some("turn cancelled".to_string()),
            metadata,
            None,
        );
        return;
    }

    match model_result {
        Ok(result) => {
            let _ = super::session_runtime::take_turn_provider_metadata(&session_id, &turn_id);
            let metadata = result.session_metadata();
            let assistant_text = if result.ui_text_committed {
                None
            } else {
                result.final_text
            };
            finish_turn_with_metadata(
                &session_id,
                &turn_id,
                "finished",
                assistant_text,
                None,
                metadata,
                None,
            );
            // goal continuation: 只在成功 turn 后触发，错误/取消 turn 不继续
            evaluate_goal_continuation(&session_id, &turn_id);
        }
        Err(error) => {
            let metadata =
                super::session_runtime::take_turn_provider_metadata(&session_id, &turn_id);
            let failure_message = error.to_string();
            let failure_kind = match error {
                AgentRuntimeError::ProviderFailure { .. }
                | AgentRuntimeError::ProviderProtocol { .. }
                | AgentRuntimeError::ProviderTransport { .. } => "provider_error",
                _ => "runtime_error",
            };
            emit_assistant_error_message(&session_id, &turn_id, &failure_message);
            finish_turn_with_metadata(
                &session_id,
                &turn_id,
                "finished",
                None,
                Some(failure_message),
                metadata,
                Some(failure_kind.to_string()),
            )
        }
    }
}

pub(crate) fn latest_user_text(messages: &[Value]) -> String {
    messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        .and_then(|message| message.get("text").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn maybe_title_session_from_first_user_message(session: &mut NativeSession, text: &str) {
    if session.custom_title.is_some() {
        return;
    }
    if first_user_message_exists(session) {
        return;
    }
    let title = text.trim();
    if title.is_empty() {
        return;
    }
    // A create-time title is only a placeholder unless the user explicitly
    // renamed the session (custom_title). The frontend sends its localized
    // placeholder at create time, so recognize every locale's variant.
    let current_title = session.snapshot.get("title").and_then(Value::as_str);
    let placeholder = match current_title {
        None => true,
        Some(value) => {
            let value = value.trim();
            value.is_empty()
                || value == DEFAULT_SESSION_TITLE
                || value == LEGACY_DEFAULT_SESSION_TITLE
                || value == LEGACY_DEFAULT_SESSION_TITLE_ZH
                || value == "New session"
        }
    };
    if placeholder {
        session.snapshot["title"] = Value::String(title.to_string());
    }
}

fn first_user_message_exists(session: &NativeSession) -> bool {
    session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .is_some_and(|messages| {
            messages
                .iter()
                .any(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        })
}

pub(crate) fn active_skill_prompt(active_skills: &HashSet<String>) -> String {
    active_skill_prompt_for(active_skills)
}

fn openai_responses_stateful_prompt_contract_enabled(configured: bool) -> bool {
    env_bool_override("LYRA_OPENAI_RESPONSES_STATEFUL_PROMPT_CONTRACT").unwrap_or(configured)
}

pub(crate) fn env_bool_override(name: &str) -> Option<bool> {
    std::env::var(name)
        .map(|value| matches!(value.trim(), "1" | "true" | "yes" | "on"))
        .ok()
}

pub(crate) fn combined_memory_prompt(
    memory_records: &[RankedMemoryRecord],
    system_recall_records: &[RankedSystemRecallItem],
    pinned_context_prompt: &str,
) -> String {
    [
        pinned_context_prompt.to_string(),
        shared_memory_prompt(memory_records),
        system_recall_prompt(system_recall_records),
    ]
    .into_iter()
    .filter(|section| !section.trim().is_empty())
    .collect::<Vec<_>>()
    .join("\n\n")
}

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

fn assistant_reply_visible_text(
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
        clear_active_ui_message_id(session_id, turn_id);
        if let Some(message_id) = streamed_message_id
            .as_ref()
            .filter(|message_id| !message_id.is_empty())
        {
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
            reply.ui_message_id = emit_assistant_text(session_id, turn_id, content);
            if let Some(ref id) = reply.ui_message_id {
                stamp_reasoning_content(session_id, id, reply.reasoning_content.as_deref());
            }
            return reply.ui_message_id.is_some();
        }
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

fn ensure_existing_text_block(message: &mut Value, text: &str) {
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

fn append_reasoning_to_message(message: &mut Value, delta: &str, status: &str) -> String {
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

fn finish_reasoning_blocks(message: &mut Value, reasoning: &str) {
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
fn stamp_reasoning_content(session_id: &str, message_id: &str, reasoning: Option<&str>) {
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

fn commit_assistant_message(session_id: &str, turn_id: &str, message_id: &str) -> Option<Value> {
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

fn attach_metadata_to_assistant_message(
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

fn attach_metadata_to_active_assistant_message(
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

fn assistant_message_has_visible_timeline_content(message: &Value) -> bool {
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

fn prune_empty_assistant_messages(session: &mut NativeSession) -> usize {
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
    });
    let original_len = messages.len();
    messages.retain(|message| {
        message.get("role").and_then(Value::as_str) != Some("assistant")
            || assistant_message_has_visible_timeline_content(message)
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

fn append_string_field(value: &mut Value, key: &str, delta: &str) {
    match value.get_mut(key) {
        Some(Value::String(text)) => text.push_str(delta),
        _ => value[key] = Value::String(delta.to_string()),
    }
}

fn missing_text_block(message: &Value) -> bool {
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

pub(crate) fn finish_turn(
    session_id: &str,
    turn_id: &str,
    status: &str,
    assistant_text: Option<String>,
    failure: Option<String>,
) {
    finish_turn_with_metadata(
        session_id,
        turn_id,
        status,
        assistant_text,
        failure,
        None,
        None,
    );
}

pub(crate) fn finish_turn_with_metadata(
    session_id: &str,
    turn_id: &str,
    status: &str,
    assistant_text: Option<String>,
    failure: Option<String>,
    metadata: Option<Value>,
    failure_kind: Option<String>,
) {
    let failure_kind = failure_kind.or_else(|| {
        (status != "cancelled" && failure.is_some()).then(|| "runtime_error".to_string())
    });
    let failure_for_ledger = failure.clone();
    let (unfinished_tool_status, unfinished_tool_output) = if status == "cancelled" {
        (
            "cancelled",
            json!({ "content": failure.as_deref().unwrap_or("Lyra tool call was cancelled.") }),
        )
    } else if let Some(failure) = failure.as_deref() {
        ("failed", json!({ "content": failure }))
    } else {
        (
            "failed",
            json!({ "content": "Lyra ended the turn before this tool call produced a result." }),
        )
    };
    let mut metadata = metadata;
    let mut compress_check_job: Option<(PathBuf, String, String)> = None;
    let mut recall_index_job: Option<(PathBuf, NativeSession)> = None;
    let mut trim_job: Option<(PathBuf, String)> = None;
    let mut ledger_turn: Option<(PathBuf, NativeSession, String, String, Option<String>)> = None;
    let (callback, events) = match state().lock() {
        Ok(mut state) => {
            let callback = event_callback();
            let mut events = Vec::new();
            let root = state.root.clone();
            let streamed_message_id =
                super::session_runtime::active_ui_message_id(session_id, turn_id);
            super::session_runtime::clear_active_turn(session_id, turn_id);
            clear_pending_interactions_for_turn(&mut state, turn_id);
            let in_flight = state.active_compressions.contains(session_id);
            if let Some(session) = state.sessions.get_mut(session_id) {
                if session.snapshot.get("activeTurnId").and_then(Value::as_str) == Some(turn_id) {
                    metadata = oma_finish_metadata(&session.snapshot, metadata);
                    finalize_openai_response_state_fingerprint(
                        session,
                        assistant_text.as_deref(),
                        streamed_message_id.as_deref(),
                        &mut metadata,
                    );
                    if let Some(text) = assistant_text.filter(|text| !text.trim().is_empty()) {
                        let message = assistant_message_with_metadata(text, metadata.clone());
                        push_session_message(session, message.clone());
                        events.push(json!({
                            "kind": "messageCommitted",
                            "sessionId": session_id,
                            "message": message
                        }));
                    } else if let (Some(metadata), Some(message_id)) =
                        (metadata.clone(), streamed_message_id)
                    {
                        if let Some(message) = attach_metadata_to_assistant_message(
                            &mut session.snapshot,
                            &message_id,
                            metadata,
                        ) {
                            mark_dialog_message_dirty(session, &message_id);
                            events.push(json!({
                                "kind": "messageCommitted",
                                "sessionId": session_id,
                                "message": message
                            }));
                        }
                    }
                    session.snapshot["turnStatus"] =
                        Value::String(session_turn_status_for_finish_status(status).to_string());
                    session.snapshot["activeTurnId"] = Value::Null;
                    session.snapshot["follow"] =
                        json!({ "running": false, "activity": Value::Null });
                    oma_provider::clear_oma_nested_provider_metadata(
                        &mut session.snapshot,
                        turn_id,
                    );
                    oma_mark_turn_finished(session);
                    finish_running_tools_for_turn(
                        session,
                        turn_id,
                        unfinished_tool_status,
                        unfinished_tool_output.clone(),
                    );
                    set_runtime_turn_provider_metadata(session, turn_id, metadata.as_ref());
                    if let Some(failure_kind) = failure_kind.as_deref() {
                        update_runtime_turn_state(
                            session,
                            turn_id,
                            "interrupted",
                            Some(failure_kind),
                        );
                    } else {
                        update_runtime_turn(session, turn_id, status);
                    }
                    let _ = prune_empty_assistant_messages(session);
                    let retention_metrics = prune_transient_tool_outputs(session);
                    prune_goal_continuation_session_messages(session);
                    touch_session(session);
                    recall_index_job = Some((root.clone(), session.clone()));
                    events.push(json!({
                        "kind": "sessionSnapshot",
                        "snapshot": session.snapshot
                    }));
                    if retention_metrics
                        .get("pruned")
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
                        > 0
                    {
                        events.push(json!({
                            "kind": "contextTrimmed",
                            "sessionId": session_id,
                            "detail": {
                                "reason": "tool_retention",
                                "metrics": retention_metrics,
                            }
                        }));
                    }
                    if status == "finished" {
                        let session_messages = session
                            .snapshot
                            .get("messages")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default();
                        let total_tokens =
                            crate::native_backend::token_estimate::estimate_messages_tokens(
                                &session_messages,
                            );
                        let baseline = session
                            .snapshot
                            .pointer("/memoryCompression/compressedTokenBaseline")
                            .and_then(Value::as_u64)
                            .map(|v| v as usize)
                            .unwrap_or(0);
                        let compressed_up_to = super::memory_compress::effective_compressed_up_to(
                            &session.snapshot,
                            &session_messages,
                        );
                        let has_uncompressed =
                            session_messages.iter().skip(compressed_up_to).any(|msg| {
                                matches!(
                                    msg.get("role").and_then(Value::as_str),
                                    Some("user") | Some("assistant")
                                )
                            });
                        if total_tokens.saturating_sub(baseline)
                            >= super::memory_compress::EXTRACT_COMPRESS_THRESHOLD
                            && has_uncompressed
                            && !in_flight
                        {
                            compress_check_job =
                                Some((root.clone(), session_id.to_string(), turn_id.to_string()));
                        }
                        trim_job = Some((root.clone(), session_id.to_string()));
                    }
                    ledger_turn = Some((
                        root.clone(),
                        session.clone(),
                        turn_id.to_string(),
                        status.to_string(),
                        failure_for_ledger.clone(),
                    ));
                    events.push(json!({
                        "kind": "turnFinished",
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "status": status
                    }));
                    if let Some(failure_kind) = failure_kind.as_deref() {
                        events.push(json!({
                            "kind": "turnInterrupted",
                            "sessionId": session_id,
                            "turnId": turn_id,
                            "reason": failure_kind
                        }));
                    } else {
                        match status {
                            "finished" => events.push(json!({
                            "kind": "turnCompleted",
                            "sessionId": session_id,
                            "turnId": turn_id
                            })),
                            "cancelled" => events.push(json!({
                            "kind": "turnInterrupted",
                            "sessionId": session_id,
                            "turnId": turn_id,
                            "reason": failure
                                .clone()
                                .unwrap_or_else(|| "turn cancelled".to_string())
                            })),
                            _ => {}
                        }
                    }
                    events.push(json!({
                        "kind": "followStateChanged",
                        "sessionId": session_id,
                        "follow": { "running": false, "activity": Value::Null }
                    }));
                }
            }
            let _ = state.save_state();
            (callback, events)
        }
        Err(_) => return,
    };
    let _ = flush_state();
    for event in events {
        emit_with_callback(&callback, event);
    }
    if let Some((root, session)) = recall_index_job {
        let _ = index_session_messages_for_recall(&root, &session);
    }
    if let Some((root, session, turn_id, status, failure)) = ledger_turn {
        let _ = record_turn_finished(&root, &session, &turn_id, &status, failure.as_deref());
    }
    if let Some((root, session_id, turn_id)) = compress_check_job {
        super::memory_compress::spawn_extract_and_compress(root, session_id, turn_id);
    }
    if let Some((root, session_id)) = trim_job {
        spawn_post_turn_session_trim(root, session_id);
    }
}

fn clear_pending_interactions_for_turn(state: &mut NativeRuntimeState, turn_id: &str) {
    state
        .pending_permissions
        .retain(|_, request| request.turn_id != turn_id);
    state
        .pending_clarifications
        .retain(|_, request| request.turn_id != turn_id);
}

fn session_turn_status_for_finish_status(status: &str) -> &'static str {
    match status {
        "cancelled" => "cancelled",
        _ => "idle",
    }
}

pub(crate) fn update_runtime_turn(session: &mut NativeSession, turn_id: &str, status: &str) {
    let state_name = match status {
        "finished" => "completed",
        "cancelled" => "cancelled_by_user",
        _ => "completed",
    };
    update_runtime_turn_state(session, turn_id, state_name, None);
}

pub(crate) const STALE_WAITING_FOR_TOOL_WITHOUT_RUNNING_TOOL_MS: i64 = 60_000;

pub(crate) fn reconcile_orphan_running_turn(
    session: &mut NativeSession,
    has_live_cancellation_token: bool,
    reason: &str,
) -> bool {
    let turn_status = session
        .snapshot
        .get("turnStatus")
        .and_then(Value::as_str)
        .unwrap_or("idle");
    let active_turn_id = session
        .snapshot
        .get("activeTurnId")
        .and_then(Value::as_str)
        .map(str::to_string);
    if turn_status != "running" {
        return false;
    }
    let stale_waiting_for_tool = active_turn_id
        .as_deref()
        .is_some_and(|turn_id| stale_waiting_for_tool_without_running_tool(session, turn_id));
    if has_live_cancellation_token && active_turn_id.is_some() && !stale_waiting_for_tool {
        return false;
    }
    // DIAGNOSTIC: log when reconcile decides to cancel a running turn
    eprintln!(
        "[DIAG] reconcile_orphan_running_turn CANCELLING turn: reason={reason} \
         has_live_token={has_live_cancellation_token} \
         active_turn_id={:?} stale_waiting_for_tool={stale_waiting_for_tool}",
        active_turn_id
    );
    let turn_id = active_turn_id.unwrap_or_else(|| format!("orphan-turn-{}", Uuid::new_v4()));
    session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
    session.snapshot["activeTurnId"] = Value::Null;
    finalize_interrupt_state(session, reason);
    let recovery_message = if stale_waiting_for_tool {
        "Lyra marked this turn as interrupted because it was still waiting for a tool even though no tool was running."
    } else {
        "Lyra marked this turn as cancelled because no live runtime worker was attached to it."
    };
    finish_running_tools_for_turn(
        session,
        &turn_id,
        "cancelled",
        json!({ "content": recovery_message }),
    );
    let failure_kind = if stale_waiting_for_tool {
        "stale_waiting_for_tool_without_running_tools"
    } else {
        reason
    };
    update_runtime_turn_state(session, &turn_id, "interrupted", Some(failure_kind));
    touch_session(session);
    true
}

fn stale_waiting_for_tool_without_running_tool(session: &NativeSession, turn_id: &str) -> bool {
    let Some(turn) = session
        .runtime_turns
        .iter()
        .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id))
    else {
        return false;
    };
    if turn.get("state").and_then(Value::as_str) != Some("waiting_for_tool") {
        return false;
    }
    if running_tool_for_turn(session, turn_id) {
        return false;
    }
    let updated_at_ms = turn
        .get("updatedAtMs")
        .and_then(Value::as_i64)
        .unwrap_or_else(|| Utc::now().timestamp_millis());
    Utc::now().timestamp_millis().saturating_sub(updated_at_ms)
        >= STALE_WAITING_FOR_TOOL_WITHOUT_RUNNING_TOOL_MS
}

fn running_tool_for_turn(session: &NativeSession, turn_id: &str) -> bool {
    session
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|tool| {
            if tool.get("status").and_then(Value::as_str) != Some("running") {
                return false;
            }
            let tool_turn_id = super::activity::tool_runtime_turn_id(tool);
            tool_turn_id.is_none_or(|value| value == turn_id)
        })
}

pub(crate) fn update_runtime_turn_state(
    session: &mut NativeSession,
    turn_id: &str,
    state_name: &str,
    failure_kind: Option<&str>,
) {
    let timestamp = now();
    for turn in &mut session.runtime_turns {
        if turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id) {
            turn["state"] = Value::String(state_name.to_string());
            turn["updatedAtIso"] = Value::String(timestamp.clone());
            turn["updatedAtMs"] = Value::Number(Utc::now().timestamp_millis().into());
            if matches!(
                state_name,
                "completed" | "cancelled_by_user" | "interrupted"
            ) {
                turn["completedAtIso"] = Value::String(timestamp.clone());
                turn["completedAtMs"] = Value::Number(Utc::now().timestamp_millis().into());
            }
            if matches!(state_name, "completed" | "cancelled_by_user") {
                turn["failureKind"] = Value::Null;
            } else if state_name == "interrupted" {
                turn["failureKind"] = failure_kind
                    .map(|value| Value::String(value.to_string()))
                    .unwrap_or(Value::Null);
            } else if let Some(failure_kind) = failure_kind {
                turn["failureKind"] = Value::String(failure_kind.to_string());
            }
        }
    }
}

pub(crate) fn set_runtime_turn_state(
    session: &mut NativeSession,
    turn_id: &str,
    state_name: &str,
    failure_kind: Option<&str>,
) {
    update_runtime_turn_state(session, turn_id, state_name, failure_kind);
}

pub(crate) fn turn_was_cancelled(session_id: &str, turn_id: &str) -> bool {
    if super::session_runtime::turn_cancellation_requested(turn_id) {
        eprintln!(
            "[DIAG] turn_was_cancelled TRUE(cancellation_requested): session={session_id} turn={turn_id}"
        );
        return true;
    }
    state()
        .lock()
        .map(|state| {
            let snapshot_turn_id = state
                .sessions
                .get(session_id)
                .and_then(|session| session.snapshot.get("activeTurnId"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let active_turn_mismatch = snapshot_turn_id.as_deref() != Some(turn_id);
            let cancelled = active_turn_mismatch;
            if cancelled {
                eprintln!(
                    "[DIAG] turn_was_cancelled TRUE: session={session_id} turn={turn_id} \
                     snapshot_turn_id={snapshot_turn_id:?} active_turn_mismatch={active_turn_mismatch}"
                );
            }
            cancelled
        })
        .unwrap_or(true)
}

pub(crate) fn cancel_turn(payload: Value) -> AgentRuntimeResult<Value> {
    let id = required_session_id(&payload)?;
    if let Some(turn_id) = super::session_runtime::active_turn_id(&id) {
        super::session_runtime::request_turn_cancellation(&turn_id);
    }
    let (turn_id, callback, events, ledger_turn) = {
        let mut state = match state().try_lock() {
            Ok(state) => state,
            Err(std::sync::TryLockError::WouldBlock) => {
                return Ok(json!({
                    "sessionId": id,
                    "status": "cancelling",
                    "deferred": true,
                }));
            }
            Err(std::sync::TryLockError::Poisoned(_)) => {
                return Err(AgentRuntimeError::Core(
                    "agent runtime state lock failed".to_string(),
                ));
            }
        };
        let root = state.root.clone();
        let turn_id = state
            .sessions
            .get(&id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?
            .snapshot
            .get("activeTurnId")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| {
                AgentRuntimeError::Core(format!("turn not running for session: {id}"))
            })?;
        super::session_runtime::request_turn_cancellation(&turn_id);
        clear_pending_interactions_for_turn(&mut state, &turn_id);
        let session = state
            .sessions
            .get_mut(&id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {id}")))?;
        session.snapshot["turnStatus"] = Value::String("cancelled".to_string());
        session.snapshot["activeTurnId"] = Value::Null;
        finalize_interrupt_state(session, "cancelled_by_user");
        finish_running_tools_for_turn(
            session,
            &turn_id,
            "cancelled",
            json!({ "content": "Lyra tool call was cancelled by the user." }),
        );
        update_runtime_turn(session, &turn_id, "cancelled");
        touch_session(session);
        let snapshot = session.snapshot.clone();
        let ledger_session = session.clone();
        let callback = event_callback();
        state.save_state()?;
        let events = vec![
            json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
            json!({
                "kind": "turnStateChanged",
                "sessionId": id,
                "turnId": turn_id,
                "state": "cancelled",
                "reason": "user_cancelled",
            }),
        ];
        (
            turn_id,
            callback,
            events,
            (root, ledger_session, "cancelled".to_string()),
        )
    };
    for event in events {
        emit_with_callback(&callback, event);
    }
    let (root, session, status) = ledger_turn;
    let _ = record_turn_finished(
        &root,
        &session,
        &turn_id,
        &status,
        Some("turn cancelled by user"),
    );
    Ok(json!({
        "sessionId": id,
        "turnId": turn_id,
        "status": "cancelling"
    }))
}

// ── Goal continuation ───────────────────────────────────────────────────
// turn 成功结束后，系统评估是否需要自动继续推进 goal。
// 判定信号：plan 处于 executing_todo 阶段 + Todo/Goal 的真实状态。
// 触发方式：send_turn(uiHidden=true, goalContinuation=true, onlyIfIdle=true)。
// continuation prompt 在 turn 结束后被 prune_goal_continuation_messages 剪除，
// 不保留在会话历史，不持续占用 model context。

/// 从 messages 中移除 metadata.goalContinuation == true 的 user 消息。
/// 这些是系统自动发送的 continuation prompt，turn 结束后不保留在会话历史。
fn prune_goal_continuation_messages(snapshot: &mut Value) -> Option<usize> {
    let messages = snapshot.get_mut("messages").and_then(Value::as_array_mut)?;
    let first_removed = messages.iter().position(|msg| {
        msg.get("role").and_then(Value::as_str) == Some("user")
            && msg.pointer("/metadata/goalContinuation") == Some(&Value::Bool(true))
    });
    messages.retain(|msg| {
        !(msg.get("role").and_then(Value::as_str) == Some("user")
            && msg.pointer("/metadata/goalContinuation") == Some(&Value::Bool(true)))
    });
    first_removed
}

fn prune_goal_continuation_session_messages(session: &mut NativeSession) {
    let first_removed = prune_goal_continuation_messages(&mut session.snapshot);
    if let Some(index) = first_removed {
        mark_dialog_dirty_from(session, index);
    }
}

/// 动态拼装 continuation prompt。
fn build_continuation_prompt(incomplete: &[&Value], finish_required: bool) -> String {
    let mut sections = Vec::new();
    sections.push("[Goal Continuation] 当前 plan 仍处于执行阶段，需要继续推进。".to_string());

    if !incomplete.is_empty() {
        sections.push(format!("\n未完成 todo（{} 个）：", incomplete.len()));
        for todo in incomplete {
            let status = todo
                .pointer("/status")
                .and_then(Value::as_str)
                .unwrap_or("pending");
            let content = todo
                .pointer("/content")
                .and_then(Value::as_str)
                .unwrap_or("");
            let id = todo.pointer("/id").and_then(Value::as_str).unwrap_or("");
            sections.push(format!("  - [{}] [{}] {}", id, status, content));
        }
    }

    if !incomplete.is_empty() {
        sections.push("\n请继续推进未完成的工作。".to_string());
    } else if finish_required {
        sections.push(
            "\n所有 Todo 已进入终态，但 Goal 尚未结束。请调用 todo_finish，报告真实的 completed、failed 或 cancelled 结果。"
                .to_string(),
        );
    }
    sections.join("\n")
}

fn goal_progress_fingerprint(session: &NativeSession) -> String {
    let todos = session
        .snapshot
        .pointer("/projectTodo/todos")
        .or_else(|| session.snapshot.get("todos"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|todo| {
            json!({
                "id": todo.get("id").cloned().unwrap_or(Value::Null),
                "status": todo.get("status").cloned().unwrap_or(Value::Null),
            })
        })
        .collect::<Vec<_>>();
    let latest_success = session
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .rev()
        .find(|tool| {
            matches!(
                tool.get("status").and_then(Value::as_str),
                Some("completed" | "success")
            ) && tool.pointer("/output/raw/ok").and_then(Value::as_bool) != Some(false)
                && tool.pointer("/output/raw/success").and_then(Value::as_bool) != Some(false)
        })
        .map(|tool| {
            json!({
                "name": tool.get("name").cloned().unwrap_or(Value::Null),
                "path": tool.get("toolPath")
                    .or_else(|| tool.pointer("/input/toolPath"))
                    .cloned()
                    .unwrap_or(Value::Null),
                "target": tool.pointer("/input/path")
                    .or_else(|| tool.pointer("/input/pattern"))
                    .cloned()
                    .unwrap_or(Value::Null),
                "commandKind": tool.pointer("/output/raw/commandKind")
                    .cloned()
                    .unwrap_or(Value::Null),
                "changes": tool.get("changes")
                    .or_else(|| tool.pointer("/output/raw/changedFiles"))
                    .cloned()
                    .unwrap_or(Value::Null),
            })
        })
        .unwrap_or(Value::Null);
    serde_json::to_string(&json!({
        "todos": todos,
        "projectStatus": session.snapshot.pointer("/projectTodo/status").cloned().unwrap_or(Value::Null),
        "latestSuccessfulTool": latest_success,
        "completionAudit": session.snapshot.get("completionAudit").cloned().unwrap_or(Value::Null),
    }))
    .unwrap_or_default()
}

fn update_goal_progress_state(session: &mut NativeSession, fingerprint: &str) -> bool {
    if session
        .snapshot
        .pointer("/goalContinuation/paused")
        .and_then(Value::as_bool)
        == Some(true)
    {
        return false;
    }
    let previous = session
        .snapshot
        .pointer("/goalContinuation/fingerprint")
        .and_then(Value::as_str);
    let stagnant_turns = if previous == Some(fingerprint) {
        session
            .snapshot
            .pointer("/goalContinuation/stagnantTurns")
            .and_then(Value::as_u64)
            .unwrap_or_default()
            .saturating_add(1)
    } else {
        0
    };
    if stagnant_turns >= 2 {
        session.snapshot["goalContinuation"] = json!({
            "fingerprint": fingerprint,
            "stagnantTurns": stagnant_turns,
            "paused": true,
            "reason": "no_progress",
        });
        return false;
    }
    session.snapshot["goalContinuation"] = json!({
        "fingerprint": fingerprint,
        "stagnantTurns": stagnant_turns,
        "paused": false,
        "reason": Value::Null,
    });
    true
}

/// turn 成功结束后，评估是否需要 goal continuation。
/// 满足条件时通过 send_turn 发送一条 uiHidden + goalContinuation 的隐式 prompt。
fn evaluate_goal_continuation(session_id: &str, _turn_id: &str) {
    let prompt = {
        let Ok(mut state) = state().lock() else {
            return;
        };
        let Some(session) = state.sessions.get_mut(session_id) else {
            return;
        };

        // plan 不在执行阶段 → 无活跃 goal
        let phase = session
            .snapshot
            .pointer("/plan/phase")
            .and_then(Value::as_str);
        if phase != Some(PLAN_PHASE_EXECUTING_TODO) {
            return;
        }

        // turnStatus 非 idle → 用户已发新消息，不抢夺
        let turn_status = session
            .snapshot
            .get("turnStatus")
            .and_then(Value::as_str)
            .unwrap_or("idle");
        if turn_status != "idle" {
            return;
        }
        let project_status = session
            .snapshot
            .pointer("/projectTodo/status")
            .and_then(Value::as_str)
            .unwrap_or("running");
        if matches!(project_status, "completed" | "failed" | "cancelled") {
            return;
        }

        let todos = session
            .snapshot
            .pointer("/projectTodo/todos")
            .or_else(|| session.snapshot.get("todos"))
            .and_then(Value::as_array);
        let incomplete: Vec<Value> = todos
            .map(|arr| {
                arr.iter()
                    .filter(|t| {
                        let s = t.pointer("/status").and_then(Value::as_str).unwrap_or("");
                        s == "pending" || s == "in_progress"
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default();
        let finish_required = incomplete.is_empty()
            && todos.is_some_and(|todos| {
                !todos.is_empty()
                    && todos.iter().all(|todo| {
                        matches!(
                            todo.get("status").and_then(Value::as_str),
                            Some("completed" | "failed" | "skipped" | "cancelled")
                        )
                    })
            });
        if incomplete.is_empty() && !finish_required {
            return;
        }
        let fingerprint = goal_progress_fingerprint(session);
        if !update_goal_progress_state(session, &fingerprint) {
            touch_session(session);
            let _ = state.save_state();
            return;
        }
        let incomplete_refs = incomplete.iter().collect::<Vec<_>>();
        let prompt = build_continuation_prompt(&incomplete_refs, finish_required);
        touch_session(session);
        let _ = state.save_state();
        prompt
    };

    let _ = send_turn(json!({
        "sessionId": session_id,
        "text": prompt,
        "uiHidden": true,
        "goalContinuation": true,
        "onlyIfIdle": true
    }));
}
