use super::*;

pub(crate) fn tool_todo_read(session_id: &str) -> NativeToolResult {
    let todos = state()
        .lock()
        .map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the tool call.",
            )
        })?
        .sessions
        .get(session_id)
        .and_then(|session| session.snapshot.get("todos"))
        .cloned()
        .unwrap_or_else(|| json!([]));
    Ok(NativeToolSuccess {
        content: format!(
            "Current todos:\n{}",
            serde_json::to_string_pretty(&todos).unwrap_or_default()
        ),
        raw: json!({ "todos": todos }),
        recommended_next_action: None,
    })
}

pub(crate) fn tool_todo_write(session_id: &str, turn_id: &str, input: &Value) -> NativeToolResult {
    let todos = input
        .get("todos")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "todos array is required",
                "Retry with a typed todos array.",
            )
        })?
        .iter()
        .enumerate()
        .map(|(index, todo)| normalize_todo_item(index, todo))
        .collect::<Result<Vec<_>, _>>()?;
    let (callback, snapshot) = {
        let mut state = state().lock().map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the tool call.",
            )
        })?;
        let session = state.sessions.get_mut(session_id).ok_or_else(|| {
            NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {session_id}"),
                "Retry in an active session.",
            )
        })?;
        session.snapshot["todos"] = Value::Array(todos.clone());
        touch_snapshot(&mut session.snapshot);
        let snapshot = session.snapshot.clone();
        let callback = state.event_callback.clone();
        state.save_state().map_err(|error| {
            NativeToolFailure::new(
                "write_failed",
                format!("failed to persist todos: {error}"),
                "Retry after checking runtime storage.",
            )
        })?;
        (callback, snapshot)
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "todoUpdated",
            "sessionId": session_id,
            "turnId": turn_id,
            "todos": todos,
        }),
    );
    emit_with_callback(
        &callback,
        json!({
            "kind": "sessionSnapshot",
            "snapshot": snapshot,
        }),
    );
    Ok(NativeToolSuccess {
        content: format!("Updated {} todos.", todos.len()),
        raw: json!({ "todos": todos }),
        recommended_next_action: Some(
            "Continue executing the next pending todo or mark completed items when done."
                .to_string(),
        ),
    })
}

pub(crate) fn normalize_todo_item(index: usize, value: &Value) -> Result<Value, NativeToolFailure> {
    let content = value
        .get("content")
        .or_else(|| value.get("title"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|content| !content.is_empty())
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "todo content is required",
                "Retry with non-empty content for every todo.",
            )
        })?;
    let status = value
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("pending")
        .trim();
    let status = match status {
        "pending" | "in_progress" | "completed" | "cancelled" => status,
        "running" | "active" => "in_progress",
        "done" | "complete" => "completed",
        _ => "pending",
    };
    let blocked_by = value
        .get("blockedBy")
        .or_else(|| value.get("blocked_by"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(|value| Value::String(value.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(json!({
        "id": value
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("todo-{}", index + 1)),
        "content": content,
        "status": status,
        "priority": value
            .get("priority")
            .and_then(Value::as_str)
            .unwrap_or("normal"),
        "blockedBy": blocked_by,
        "assignedTo": value.get("assignedTo").or_else(|| value.get("assigned_to")).cloned().unwrap_or(Value::Null),
    }))
}
