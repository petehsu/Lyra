use super::*;

pub(crate) fn execute_todo_tool_adapter(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    execute_native_tool_adapter(
        session_id,
        turn_id,
        cancellation,
        tool_call_id,
        tool_name,
        display_name,
        action,
        arguments,
        started_at,
    )
}

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
    if todos.is_empty() {
        return Err(NativeToolFailure::new(
            "empty_todo_list",
            "todo_write requires a complete non-empty todo list.",
            "Retry with every ordered step needed to complete the approved plan.",
        ));
    }
    let (callback, snapshot, project_todo) = {
        let mut state = state().lock().map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the tool call.",
            )
        })?;
        let root = state.root.clone();
        let session = state.sessions.get_mut(session_id).ok_or_else(|| {
            NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {session_id}"),
                "Retry in an active session.",
            )
        })?;
        let plan_phase = session
            .snapshot
            .pointer("/plan/phase")
            .and_then(Value::as_str)
            .map(str::to_string);
        let has_project_todo = session
            .snapshot
            .get("projectTodo")
            .is_some_and(Value::is_object);
        if session.snapshot.get("plan").is_some_and(Value::is_object)
            && !has_project_todo
            && plan_phase.as_deref() != Some(PLAN_PHASE_TODO_REQUIRED)
        {
            return Err(NativeToolFailure::new(
                "todo_write_not_ready",
                "The active plan is not approved and ready for project todos.",
                "Finalize the plan and wait for approval before calling todo_write.",
            )
            .with_detail(json!({ "phase": plan_phase })));
        }
        session.snapshot["todos"] = Value::Array(todos.clone());
        let project_todo =
            if plan_phase.as_deref() == Some(PLAN_PHASE_TODO_REQUIRED) || has_project_todo {
                let plan_id = session
                    .snapshot
                    .pointer("/plan/activePlanId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| {
                        NativeToolFailure::new(
                            "plan_required",
                            "todo_write requires an approved plan in Plan Mode.",
                            "Approve a plan before writing project todos.",
                        )
                    })?;
                let version_id = session
                    .snapshot
                    .pointer("/plan/activeVersionId")
                    .and_then(Value::as_str)
                    .unwrap_or(&plan_id)
                    .to_string();
                let project_todo = project_todo_snapshot(
                    session
                        .snapshot
                        .pointer("/projectTodo/todoListId")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("todo-list-{}", Uuid::new_v4())),
                    plan_id,
                    version_id,
                    "running",
                    todos.clone(),
                    None,
                );
                session.snapshot["projectTodo"] = project_todo.clone();
                session.snapshot["plan"]["phase"] =
                    Value::String(PLAN_PHASE_EXECUTING_TODO.to_string());
                let scope = plan_scope_from_session(session);
                if let Some(plan) = session.snapshot.get("plan") {
                    persist_plan_snapshot(&root, session_id, &scope, plan)
                        .map_err(native_failure_from_runtime)?;
                }
                persist_project_todo_snapshot(&root, &scope, &project_todo)
                    .map_err(native_failure_from_runtime)?;
                Some(project_todo)
            } else {
                None
            };
        touch_session(session);
        let snapshot = session.snapshot.clone();
        let callback = event_callback();
        state.save_state().map_err(|error| {
            NativeToolFailure::new(
                "write_failed",
                format!("failed to persist todos: {error}"),
                "Retry after checking runtime storage.",
            )
        })?;
        (callback, snapshot, project_todo)
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
    if let Some(project_todo) = project_todo.clone() {
        emit_with_callback(
            &callback,
            json!({
                "kind": "projectTodoUpdated",
                "sessionId": session_id,
                "turnId": turn_id,
                "todo": project_todo,
            }),
        );
    }
    emit_with_callback(
        &callback,
        json!({
            "kind": "sessionSnapshot",
            "snapshot": snapshot,
        }),
    );
    Ok(NativeToolSuccess {
        content: format!("Updated {} todos.", todos.len()),
        raw: json!({ "todos": todos, "projectTodo": project_todo }),
        recommended_next_action: Some(
            "Continue executing the next pending todo or mark completed items when done."
                .to_string(),
        ),
    })
}

pub(crate) fn tool_todo_update(session_id: &str, turn_id: &str, input: &Value) -> NativeToolResult {
    let todo_id = input
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "todo id is required",
                "Retry with the id of the todo to update.",
            )
        })?
        .to_string();
    let raw_status = input
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "todo status is required",
                "Retry with a supported todo status.",
            )
        })?;
    if !matches!(
        raw_status,
        "pending"
            | "in_progress"
            | "completed"
            | "cancelled"
            | "failed"
            | "skipped"
            | "running"
            | "active"
            | "done"
            | "complete"
            | "skip"
    ) {
        return Err(NativeToolFailure::new(
            "bad_request",
            format!("unsupported todo status: {raw_status}"),
            "Use pending, in_progress, completed, failed, skipped, or cancelled.",
        ));
    }
    let status = normalize_todo_status(raw_status);
    let note = input
        .get("note")
        .or_else(|| input.get("summary"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let evidence = input
        .get("evidence")
        .and_then(Value::as_str)
        .map(str::to_string);
    let evidence_ids = evidence_ids(input, "evidenceIds");
    let failure_reason = input
        .get("failureReason")
        .or_else(|| input.get("failure_reason"))
        .and_then(Value::as_str)
        .map(str::to_string);
    if matches!(status.as_str(), "failed" | "skipped")
        && failure_reason
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
    {
        return Err(NativeToolFailure::new(
            "todo_failure_reason_required",
            "A failed or skipped todo requires a concrete failure reason.",
            "Retry with failureReason describing the blocker or failed verification.",
        ));
    }
    update_project_todo(session_id, turn_id, |todos, _project_todo| {
        let mut found = false;
        for todo in todos.iter_mut() {
            if todo.get("id").and_then(Value::as_str) != Some(todo_id.as_str()) {
                if status == "in_progress"
                    && todo.get("status").and_then(Value::as_str) == Some("in_progress")
                    && let Some(object) = todo.as_object_mut()
                {
                    object.insert("status".to_string(), Value::String("pending".to_string()));
                }
                continue;
            }
            found = true;
            if let Some(object) = todo.as_object_mut() {
                object.insert("status".to_string(), Value::String(status.clone()));
                if let Some(note) = note.clone() {
                    object.insert("note".to_string(), Value::String(note));
                }
                if let Some(evidence) = evidence.clone() {
                    object.insert("evidence".to_string(), Value::String(evidence));
                }
                if !evidence_ids.is_empty() {
                    object.insert(
                        "evidenceIds".to_string(),
                        Value::Array(evidence_ids.iter().cloned().map(Value::String).collect()),
                    );
                }
                if let Some(failure_reason) = failure_reason.clone() {
                    object.insert("failureReason".to_string(), Value::String(failure_reason));
                }
            }
        }
        if !found {
            return Err(NativeToolFailure::new(
                "todo_not_found",
                format!("todo not found: {todo_id}"),
                "Retry with an id from the current todo list.",
            ));
        }
        Ok((todo_list_status(todos), note))
    })
}

pub(crate) fn tool_todo_finish(session_id: &str, turn_id: &str, input: &Value) -> NativeToolResult {
    let status = input
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|status| matches!(*status, "completed" | "failed" | "cancelled"))
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "todo_finish requires status completed, failed, or cancelled",
                "Retry with the Goal's real terminal status.",
            )
        })?
        .to_string();
    let summary = input
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|summary| !summary.is_empty())
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "todo_finish requires a non-empty summary",
                "Retry with a concise summary of the Goal's real outcome.",
            )
        })?
        .to_string();
    let design_finding_dispositions = input
        .get("designFindingDispositions")
        .or_else(|| input.get("design_finding_dispositions"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    update_project_todo(session_id, turn_id, |todos, project_todo| {
        // codex's update_goal(Complete) does NOT hard-require all sub-items
        // terminal. Auto-skip leftover non-terminal todos instead of blocking,
        // so the model can close a goal when remaining items are no longer
        // relevant or were handled implicitly.
        if status == "completed" {
            for todo in todos.iter_mut() {
                let is_terminal = matches!(
                    todo.get("status").and_then(Value::as_str),
                    Some("completed" | "failed" | "skipped" | "cancelled")
                );
                if !is_terminal {
                    if let Some(object) = todo.as_object_mut() {
                        object.insert("status".to_string(), Value::String("skipped".to_string()));
                        object.insert(
                            "failureReason".to_string(),
                            Value::String(
                                "Auto-skipped when the Goal was marked completed via todo_finish."
                                    .to_string(),
                            ),
                        );
                    }
                }
            }
        }
        project_todo["designFindingDispositions"] =
            Value::Array(design_finding_dispositions.clone());
        Ok((status.clone(), Some(summary.clone())))
    })
}

fn update_project_todo(
    session_id: &str,
    turn_id: &str,
    update: impl FnOnce(
        &mut Vec<Value>,
        &mut Value,
    ) -> Result<(String, Option<String>), NativeToolFailure>,
) -> NativeToolResult {
    let (callback, snapshot, project_todo, todos) = {
        let mut state = state().lock().map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the todo tool call.",
            )
        })?;
        let root = state.root.clone();
        let session = state.sessions.get_mut(session_id).ok_or_else(|| {
            NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {session_id}"),
                "Retry in an active session.",
            )
        })?;
        let mut project_todo = session
            .snapshot
            .get("projectTodo")
            .filter(|value| value.is_object())
            .cloned()
            .ok_or_else(|| {
                NativeToolFailure::new(
                    "todo_list_not_started",
                    "No project todo list exists.",
                    "Call todo_write after plan approval before updating todos.",
                )
            })?;
        let mut todos = project_todo
            .get("todos")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let (status, summary) = update(&mut todos, &mut project_todo)?;
        project_todo["todos"] = Value::Array(todos.clone());
        project_todo["status"] = Value::String(status.clone());
        project_todo["currentIndex"] = json!(current_todo_index(&todos));
        if let Some(summary) = summary.clone() {
            project_todo["summary"] = Value::String(summary);
        }
        session.snapshot["todos"] = Value::Array(todos.clone());
        session.snapshot["projectTodo"] = project_todo.clone();
        let scope = plan_scope_from_session(session);
        if let Some(plan) = session.snapshot.get("plan") {
            persist_plan_snapshot(&root, session_id, &scope, plan)
                .map_err(native_failure_from_runtime)?;
        }
        persist_project_todo_snapshot(&root, &scope, &project_todo)
            .map_err(native_failure_from_runtime)?;
        touch_session(session);
        let snapshot = session.snapshot.clone();
        let callback = event_callback();
        state.save_state().map_err(|error| {
            NativeToolFailure::new(
                "write_failed",
                format!("failed to persist todos: {error}"),
                "Retry after checking runtime storage.",
            )
        })?;
        (callback, snapshot, project_todo, todos)
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
            "kind": "projectTodoUpdated",
            "sessionId": session_id,
            "turnId": turn_id,
            "todo": project_todo,
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
        content: "Updated project todo state.".to_string(),
        raw: json!({ "todos": todos, "projectTodo": project_todo }),
        recommended_next_action: Some("Continue executing the approved todo list.".to_string()),
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
    let status = normalize_todo_status(status);
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
        "note": value.get("note").or_else(|| value.get("summary")).cloned().unwrap_or(Value::Null),
        "evidence": value.get("evidence").cloned().unwrap_or(Value::Null),
        "evidenceIds": value.get("evidenceIds").or_else(|| value.get("evidence_ids")).cloned().unwrap_or_else(|| json!([])),
        "failureReason": value.get("failureReason").or_else(|| value.get("failure_reason")).cloned().unwrap_or(Value::Null),
    }))
}

fn evidence_ids(input: &Value, key: &str) -> Vec<String> {
    let mut ids = input
        .get(key)
        .or_else(|| input.get("evidence_ids"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

fn normalize_todo_status(status: &str) -> String {
    match status {
        "pending" | "in_progress" | "completed" | "cancelled" | "failed" | "skipped" => {
            status.to_string()
        }
        "running" | "active" => "in_progress".to_string(),
        "done" | "complete" => "completed".to_string(),
        "skip" => "skipped".to_string(),
        _ => "pending".to_string(),
    }
}

fn project_todo_snapshot(
    todo_list_id: String,
    plan_id: String,
    version_id: String,
    status: &str,
    todos: Vec<Value>,
    summary: Option<String>,
) -> Value {
    json!({
        "todoListId": todo_list_id,
        "planId": plan_id,
        "versionId": version_id,
        "status": status,
        "currentIndex": current_todo_index(&todos),
        "todos": todos,
        "summary": summary,
    })
}

fn current_todo_index(todos: &[Value]) -> usize {
    todos
        .iter()
        .position(|todo| todo.get("status").and_then(Value::as_str) == Some("in_progress"))
        .or_else(|| {
            todos.iter().position(|todo| {
                !matches!(
                    todo.get("status").and_then(Value::as_str),
                    Some("completed" | "skipped" | "cancelled")
                )
            })
        })
        .unwrap_or_default()
}

fn todo_list_status(todos: &[Value]) -> String {
    let _ = todos;
    "running".to_string()
}

fn native_failure_from_runtime(error: AgentRuntimeError) -> NativeToolFailure {
    NativeToolFailure::new(
        "project_todo_store_failed",
        error.to_string(),
        "Retry after checking Lyra local storage.",
    )
}
