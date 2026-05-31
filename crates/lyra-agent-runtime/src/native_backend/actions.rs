use super::*;

pub(crate) fn action_turn(payload: Value, instruction: &str) -> AgentRuntimeResult<Value> {
    let focus = string_opt(&payload, "focus").unwrap_or_default();
    send_turn(json!({
        "sessionId": payload.get("sessionId").cloned().unwrap_or(Value::Null),
        "text": if focus.is_empty() { instruction.to_string() } else { format!("{instruction}\n\nFocus: {focus}") }
    }))
}

pub(crate) fn poke_session(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let session_id = state.resolve_session_id(session_id)?;
    let incomplete = state
        .sessions
        .get(&session_id)
        .and_then(|session| session.snapshot.get("todos"))
        .and_then(Value::as_array)
        .map(|todos| todos.len())
        .unwrap_or(0);
    Ok(json!({
        "sessionId": session_id,
        "turnId": Value::Null,
        "status": "idle",
        "sent": false,
        "incompleteTodoCount": incomplete
    }))
}

pub(crate) fn run_subagent(payload: Value) -> AgentRuntimeResult<Value> {
    let parent_id = string_opt(&payload, "sessionId");
    let mut response = fork_session(json!({ "sessionId": parent_id }), "Subagent")?;
    let session_id = response
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let tool_id = format!("tool-{}", Uuid::new_v4());
    let _ = send_turn(json!({
        "sessionId": session_id,
        "text": string_opt(&payload, "prompt").unwrap_or_else(|| "Run subagent task.".to_string())
    }));
    response["toolId"] = Value::String(tool_id);
    Ok(response)
}

pub(crate) fn run_btw(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = string_opt(&payload, "sessionId");
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let session_id = state.resolve_session_id(session_id)?;
    let question = string_opt(&payload, "question").unwrap_or_default();
    let turn_id = format!("btw-{}", Uuid::new_v4());
    let page = json!({
        "id": format!("side-panel-{}", Uuid::new_v4()),
        "title": "Side Question",
        "filePath": "",
        "format": "markdown",
        "source": "lyra-native",
        "content": build_btw_answer(
            state
                .sessions
                .get(&session_id)
                .map(|session| &session.snapshot),
            &question
        ),
        "updatedAtMs": Utc::now().timestamp_millis()
    });
    let session = state
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
    session
        .runtime_turns
        .push(runtime_turn(&turn_id, &session_id, "completed", None, None));
    session.snapshot["sidePanel"] = json!({
        "focusedPageId": page["id"],
        "pages": [page]
    });
    touch_session(session);
    let snapshot = session.snapshot.clone();
    let side_panel = session.snapshot["sidePanel"].clone();
    let callback = state.event_callback.clone();
    state.save_state()?;
    emit_with_callback(
        &callback,
        json!({
            "kind": "sessionSnapshot",
            "snapshot": snapshot
        }),
    );
    emit_with_callback(
        &callback,
        json!({
            "kind": "btwAnswered",
            "sessionId": session_id,
            "turnId": turn_id,
            "question": question
        }),
    );
    Ok(json!({
        "sessionId": session_id,
        "turnId": turn_id,
        "status": "idle",
        "sidePanel": side_panel
    }))
}

pub(crate) fn build_btw_answer(snapshot: Option<&Value>, question: &str) -> String {
    let messages = snapshot
        .and_then(|snapshot| snapshot.get("messages"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let recent = messages
        .iter()
        .rev()
        .take(6)
        .rev()
        .filter_map(|message| {
            let role = message.get("role").and_then(Value::as_str)?;
            let text = message.get("text").and_then(Value::as_str)?.trim();
            if text.is_empty() {
                return None;
            }
            Some(format!("- {role}: {text}"))
        })
        .collect::<Vec<_>>()
        .join("\n");
    if recent.is_empty() {
        format!(
            "## Side Question\n\n**Question:** {question}\n\n**Answer:** 当前会话还没有足够上下文。就这个侧问本身看，建议先补充目标、约束和期望输出，然后再让 Lyra Agent 继续主线。"
        )
    } else {
        format!(
            "## Side Question\n\n**Question:** {question}\n\n**Answer:** 基于当前会话上下文，这个侧问可以先按只读分析处理，不影响主 turn。相关上下文如下：\n\n{recent}"
        )
    }
}
