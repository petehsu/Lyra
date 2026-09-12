use super::*;

pub(crate) fn validate_final_response_for_session(
    session_id: &str,
    turn_id: &str,
) -> Result<(), NativeToolFailure> {
    let (root, scope, plan_before, plan_after, expected_state) = {
        let state = state().lock().map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the response after runtime state is available.",
            )
        })?;
        let root = state.root.clone();
        let session = state.sessions.get(session_id).ok_or_else(|| {
            NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {session_id}"),
                "Retry in an active session.",
            )
        })?;
        let Some(_) = completion_gate_for_final_response(session, turn_id)? else {
            return Ok(());
        };
        let plan_before = session
            .snapshot
            .get("plan")
            .filter(|plan| plan.is_object())
            .cloned();
        let plan_after = if session
            .snapshot
            .pointer("/projectTodo/status")
            .and_then(Value::as_str)
            == Some("completed")
        {
            let mut plan = plan_before.clone().unwrap_or(Value::Null);
            plan["phase"] = Value::String(PLAN_PHASE_COMPLETED.to_string());
            Some(plan)
        } else {
            None
        };
        (
            root,
            plan_scope_from_session(session),
            plan_before,
            plan_after,
            completion_state_token(session),
        )
    };
    if let Some(plan) = plan_after.as_ref() {
        persist_plan_snapshot(&root, session_id, &scope, plan).map_err(|error| {
            NativeToolFailure::new(
                "completion_audit_store_failed",
                error.to_string(),
                "Retry after checking Lyra local storage.",
            )
        })?;
    }

    let mut state = state().lock().map_err(|_| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            "agent runtime state lock failed",
            "Retry the response after runtime state is available.",
        )
    })?;
    let previous_session = state.sessions.get(session_id).cloned().ok_or_else(|| {
        NativeToolFailure::new(
            "session_not_found",
            format!("session not found: {session_id}"),
            "Retry in an active session.",
        )
    })?;
    if completion_state_token(&previous_session) != expected_state {
        drop(state);
        if let Some(plan) = plan_before.as_ref() {
            let _ = persist_plan_snapshot(&root, session_id, &scope, plan);
        }
        return Err(NativeToolFailure::new(
            "completion_state_changed",
            "Session state changed while Completion Gate was committing its audit.",
            "Retry completion from the current active turn.",
        ));
    }
    {
        let session = state.sessions.get_mut(session_id).expect("session checked");
        let Some(mut audit) = completion_gate_for_final_response(session, turn_id)? else {
            return Ok(());
        };
        let audit_id = format!("completion-audit-{}", Uuid::new_v4());
        audit["id"] = Value::String(audit_id.clone());
        audit["status"] = Value::String("passed".to_string());
        audit["turnId"] = Value::String(turn_id.to_string());
        audit["auditedAt"] = Value::String(now());
        session.snapshot["completionAudit"] = audit.clone();
        if !session
            .snapshot
            .get("completionAudits")
            .is_some_and(Value::is_array)
        {
            session.snapshot["completionAudits"] = json!([]);
        }
        if let Some(audits) = session
            .snapshot
            .get_mut("completionAudits")
            .and_then(Value::as_array_mut)
        {
            audits.push(audit);
            if audits.len() > 12 {
                audits.drain(..audits.len() - 12);
            }
        }
        if let Some(runtime_turn) = session.runtime_turns.iter_mut().find(|runtime_turn| {
            runtime_turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id)
        }) {
            runtime_turn["completionAuditRef"] = Value::String(audit_id);
        }
        session.snapshot["completionBlocked"] = Value::Null;
        session.snapshot["goalContinuation"] = Value::Null;
        if session
            .snapshot
            .pointer("/projectTodo/status")
            .and_then(Value::as_str)
            == Some("completed")
            && session.snapshot.get("plan").is_some_and(Value::is_object)
        {
            session.snapshot["plan"]["phase"] = Value::String(PLAN_PHASE_COMPLETED.to_string());
        }
        touch_session(session);
    }
    if let Err(error) = state.save_state() {
        let mut previous_session = previous_session;
        previous_session.dirty = true;
        state
            .sessions
            .insert(session_id.to_string(), previous_session);
        let rollback_state_error = state.save_state().err().map(|error| error.to_string());
        drop(state);
        let rollback_plan_error = plan_before.as_ref().and_then(|plan| {
            persist_plan_snapshot(&root, session_id, &scope, plan)
                .err()
                .map(|error| error.to_string())
        });
        let rollback_detail = match (rollback_state_error, rollback_plan_error) {
            (None, None) => String::new(),
            (state_error, plan_error) => format!(
                " Rollback errors: state={}, plan={}.",
                state_error.as_deref().unwrap_or("none"),
                plan_error.as_deref().unwrap_or("none"),
            ),
        };
        return Err(NativeToolFailure::new(
            "completion_audit_store_failed",
            format!("{error}{rollback_detail}"),
            "Retry after checking Lyra local storage.",
        ));
    }
    Ok(())
}

fn completion_state_token(session: &NativeSession) -> Value {
    json!({
        "updatedAt": session.snapshot.get("updatedAt").cloned().unwrap_or(Value::Null),
        "activeTurnId": session.snapshot.get("activeTurnId").cloned().unwrap_or(Value::Null),
        "turnStatus": session.snapshot.get("turnStatus").cloned().unwrap_or(Value::Null),
        "planId": session.snapshot.pointer("/plan/activePlanId").cloned().unwrap_or(Value::Null),
        "planVersionId": session.snapshot.pointer("/plan/activeVersionId").cloned().unwrap_or(Value::Null),
        "planPhase": session.snapshot.pointer("/plan/phase").cloned().unwrap_or(Value::Null),
        "projectTodoStatus": session.snapshot.pointer("/projectTodo/status").cloned().unwrap_or(Value::Null),
        "toolCount": session_tools(session).len(),
        "messageCount": session.snapshot.get("messages").and_then(Value::as_array).map(Vec::len).unwrap_or_default(),
        "runtimeTurnCount": session.runtime_turns.len(),
    })
}

pub(crate) fn validate_todo_completion_contract(
    session: &NativeSession,
    turn_id: &str,
) -> Result<Value, NativeToolFailure> {
    let todos = session
        .snapshot
        .pointer("/projectTodo/todos")
        .or_else(|| session.snapshot.get("todos"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let unfinished = todos
        .iter()
        .filter(|todo| {
            !matches!(
                todo.get("status").and_then(Value::as_str),
                Some("completed" | "failed" | "skipped" | "cancelled")
            )
        })
        .filter_map(|todo| todo.get("id").and_then(Value::as_str))
        .collect::<Vec<_>>();
    if !unfinished.is_empty() {
        return Err(NativeToolFailure::new(
            "todo_items_incomplete",
            format!(
                "Cannot finish the plan while todo items remain incomplete: {}.",
                unfinished.join(", ")
            ),
            "Update each todo with its real terminal status before declaring the Goal complete.",
        ));
    }
    Ok(completion_audit(session, turn_id, &todos))
}

fn completion_gate_for_final_response(
    session: &NativeSession,
    turn_id: &str,
) -> Result<Option<Value>, NativeToolFailure> {
    let project_status = session
        .snapshot
        .pointer("/projectTodo/status")
        .and_then(Value::as_str);
    match project_status {
        Some("completed") => {
            if session
                .snapshot
                .pointer("/plan/phase")
                .and_then(Value::as_str)
                == Some(PLAN_PHASE_COMPLETED)
            {
                return Ok(None);
            }
            validate_todo_completion_contract(session, turn_id).map(Some)
        }
        Some("failed" | "cancelled" | "running") => Ok(None),
        Some(_) => Ok(None),
        // Ordinary chat turns are not Goal completion. Do not force a
        // test/typecheck/lint/build before the model can finish speaking.
        None => Ok(None),
    }
}

fn completion_audit(session: &NativeSession, turn_id: &str, todos: &[Value]) -> Value {
    json!({
        "kind": "completion_audit",
        "mode": "general",
        "changedPaths": current_task_changed_paths(session, turn_id),
        "mutationToolId": latest_completed_mutation_id_for_current_task(session, turn_id),
        "todoCount": todos.len(),
    })
}

pub(crate) fn record_completion_blocked_for_session(
    session_id: &str,
    turn_id: &str,
    failure: &NativeToolFailure,
) -> Value {
    let blocked = json!({
        "status": "blocked",
        "code": failure.code,
        "message": failure.message,
        "recommendedNextAction": failure.recommended_next_action,
        "turnId": turn_id,
        "blockedAt": now(),
    });
    let Ok(mut state) = state().lock() else {
        return blocked;
    };
    let Some(session) = state.sessions.get_mut(session_id) else {
        return blocked;
    };
    session.snapshot["completionBlocked"] = blocked.clone();
    session.snapshot["goalContinuation"] = json!({
        "paused": true,
        "reason": "completion_blocked",
    });
    touch_session(session);
    let _ = state.save_state();
    blocked
}

pub(crate) fn is_completion_gate_failure(code: &str) -> bool {
    code.starts_with("completion_") || code == "todo_items_incomplete"
}

pub(crate) fn annotate_mutation_verification_requirement(raw: &mut Value) {
    let ui = raw
        .get("changedFiles")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|change| change.get("path").and_then(Value::as_str))
        .any(is_ui_path);
    if ui {
        raw["verificationRequired"] = Value::String("ui".to_string());
    }
}

pub(crate) fn record_design_quality_audit(
    session_id: &str,
    turn_id: &str,
    mode: &str,
    report: &Value,
) {
    let Ok(mut state) = state().lock() else {
        return;
    };
    let Some(session) = state.sessions.get_mut(session_id) else {
        return;
    };
    let blockers = report
        .get("findings")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|finding| {
            finding.get("severity").and_then(Value::as_str) == Some("high")
                && finding.get("confidence").and_then(Value::as_str) == Some("high")
        })
        .map(|finding| {
            json!({
                "id": finding.get("id").cloned().unwrap_or(Value::Null),
                "ruleId": finding.get("ruleId").cloned().unwrap_or(Value::Null),
            })
        })
        .collect::<Vec<_>>();
    let mutation_tool_id = latest_completed_mutation_id(session);
    let entry = json!({
        "id": format!("design-audit-{}", Uuid::new_v4()),
        "mode": mode,
        "status": report.get("status").cloned().unwrap_or(Value::String("degraded".to_string())),
        "summary": report.get("summary").cloned().unwrap_or(Value::Null),
        "scope": report.get("scope").cloned().unwrap_or(Value::Null),
        "blockingFindings": blockers,
        "mutationToolId": mutation_tool_id,
        "screenshotArtifactRef": report.pointer("/details/screenshotArtifactRef").cloned().unwrap_or(Value::Null),
        "turnId": turn_id,
        "auditedAt": now(),
    });
    if !session
        .snapshot
        .pointer("/designQualityGate/audits")
        .is_some_and(Value::is_array)
    {
        session.snapshot["designQualityGate"] = json!({ "audits": [] });
    }
    if let Some(audits) = session
        .snapshot
        .pointer_mut("/designQualityGate/audits")
        .and_then(Value::as_array_mut)
    {
        audits.push(entry);
        if audits.len() > 12 {
            audits.drain(..audits.len() - 12);
        }
    }
    touch_session(session);
}

fn session_tools(session: &NativeSession) -> &[Value] {
    session
        .snapshot
        .get("tools")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn successful_tool(tool: &Value) -> bool {
    let output = tool.get("output").unwrap_or(&Value::Null);
    matches!(
        tool.get("status").and_then(Value::as_str),
        Some("completed" | "success")
    ) && output.get("error").is_none_or(Value::is_null)
        && output.get("ok").and_then(Value::as_bool) != Some(false)
        && output.pointer("/raw/ok").and_then(Value::as_bool) != Some(false)
        && output.pointer("/raw/success").and_then(Value::as_bool) != Some(false)
        && output.get("cancelled").and_then(Value::as_bool) != Some(true)
        && output.pointer("/raw/cancelled").and_then(Value::as_bool) != Some(true)
        && output.get("degraded").and_then(Value::as_bool) != Some(true)
        && output.pointer("/raw/degraded").and_then(Value::as_bool) != Some(true)
        && output.get("notApplicable").and_then(Value::as_bool) != Some(true)
        && output
            .pointer("/raw/notApplicable")
            .and_then(Value::as_bool)
            != Some(true)
        && !matches!(
            output
                .get("status")
                .or_else(|| output.pointer("/raw/status"))
                .and_then(Value::as_str),
            Some("partial" | "degraded" | "failed" | "cancelled")
        )
}

fn tool_matches_turn(tool: &Value, turn_id: Option<&str>) -> bool {
    turn_id.is_none() || crate::native_backend::activity::tool_runtime_turn_id(tool) == turn_id
}

fn latest_completed_mutation_id(session: &NativeSession) -> Option<String> {
    session_tools(session).iter().rev().find_map(|tool| {
        let changed = tool.get("activityKind").and_then(Value::as_str) == Some("edit")
            || tool
                .pointer("/output/raw/commandKind")
                .and_then(Value::as_str)
                == Some("mutation")
            || tool
                .get("changes")
                .and_then(Value::as_array)
                .is_some_and(|changes| !changes.is_empty())
            || tool
                .pointer("/output/raw/changedFiles")
                .and_then(Value::as_array)
                .is_some_and(|changes| !changes.is_empty());
        (successful_tool(tool) && changed)
            .then(|| tool.get("id").and_then(Value::as_str).map(str::to_string))
            .flatten()
    })
}

fn latest_completed_mutation_id_for_current_task(
    session: &NativeSession,
    turn_id: &str,
) -> Option<String> {
    let start = current_task_start_index(session, turn_id);
    session_tools(session)
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, tool)| {
            (index >= start && successful_tool(tool) && tool_changed_paths(tool).next().is_some())
                .then(|| tool.get("id").and_then(Value::as_str).map(str::to_string))
                .flatten()
        })
}

fn current_task_changed_paths(session: &NativeSession, turn_id: &str) -> Vec<String> {
    let start = current_task_start_index(session, turn_id);
    let mut paths = session_tools(session)
        .iter()
        .enumerate()
        .filter(|(index, tool)| *index >= start && successful_tool(tool))
        .flat_map(|(_, tool)| tool_changed_paths(tool))
        .map(str::to_string)
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    paths
}

fn tool_changed_paths(tool: &Value) -> impl Iterator<Item = &str> {
    ["/changes", "/output/changes", "/output/raw/changedFiles"]
        .into_iter()
        .flat_map(|pointer| {
            tool.pointer(pointer)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|change| {
            change
                .get("path")
                .or_else(|| change.get("target"))
                .and_then(Value::as_str)
        })
}

fn is_ui_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/").to_ascii_lowercase();
    let extension = Path::new(&normalized)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if matches!(
        extension,
        "html"
            | "css"
            | "scss"
            | "sass"
            | "less"
            | "tsx"
            | "jsx"
            | "vue"
            | "svelte"
            | "astro"
            | "mdx"
    ) {
        return true;
    }
    matches!(extension, "ts" | "js")
        && [
            "/frontend/",
            "/renderer/",
            "/components/",
            "/views/",
            "/pages/",
            "apps/desktop/src/modules/workbench/",
        ]
        .iter()
        .any(|segment| normalized.contains(segment))
}

fn current_task_start_index(session: &NativeSession, turn_id: &str) -> usize {
    if session.snapshot.get("plan").is_none() && session.snapshot.get("projectTodo").is_none() {
        return session_tools(session)
            .iter()
            .position(|tool| tool_matches_turn(tool, Some(turn_id)))
            .unwrap_or(session_tools(session).len());
    }
    let active_plan_id = session
        .snapshot
        .pointer("/plan/activePlanId")
        .and_then(Value::as_str);
    let begin_index = active_plan_id
        .and_then(|active_plan_id| {
            session_tools(session).iter().position(|tool| {
                let name = tool.get("name").and_then(Value::as_str).unwrap_or_default();
                let action = tool.pointer("/input/action").and_then(Value::as_str);
                let starts_plan = matches!(name, PLAN_BEGIN_MODEL_TOOL | PLAN_WRITE_MODEL_TOOL)
                    || (name == UPDATE_PLAN_MODEL_TOOL
                        && matches!(action, Some("begin" | "write")));
                starts_plan
                    && tool.pointer("/output/raw/planId").and_then(Value::as_str)
                        == Some(active_plan_id)
            })
        })
        .or_else(|| {
            session_tools(session).iter().rposition(|tool| {
                let name = tool.get("name").and_then(Value::as_str).unwrap_or_default();
                name == PLAN_BEGIN_MODEL_TOOL
                    || (name == UPDATE_PLAN_MODEL_TOOL
                        && tool.pointer("/input/action").and_then(Value::as_str) == Some("begin"))
            })
        })
        .or_else(|| {
            session_tools(session)
                .iter()
                .position(|tool| tool_matches_turn(tool, Some(turn_id)))
        })
        .unwrap_or(session_tools(session).len());
    let begin_turn_id = session_tools(session)
        .get(begin_index)
        .and_then(crate::native_backend::activity::tool_runtime_turn_id);
    begin_turn_id
        .and_then(|begin_turn_id| {
            session_tools(session)
                .iter()
                .position(|tool| tool_matches_turn(tool, Some(begin_turn_id)))
        })
        .unwrap_or(begin_index)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn completed_tool(
        id: &str,
        name: &str,
        turn_id: &str,
        tool_path: Option<&str>,
        content: &str,
        raw: Value,
    ) -> Value {
        let mut input = json!({ "turnId": turn_id });
        if let Some(path) = tool_path {
            input["toolPath"] = Value::String(path.to_string());
        }
        json!({
            "id": id,
            "name": name,
            "status": "completed",
            "input": input,
            "output": {
                "content": content,
                "raw": raw,
            }
        })
    }

    #[test]
    fn ordinary_turn_skips_completion_gate_after_source_mutation() {
        let turn_id = "turn-ordinary-mutation";
        let mut session = new_session(None, None, "normal");
        session.snapshot["tools"] = json!([completed_tool(
            "source-edit",
            EDIT_FILE_MODEL_TOOL,
            turn_id,
            None,
            "source changed",
            json!({
                "changedFiles": [{ "path": "src/lib.rs" }],
            }),
        )]);
        assert!(
            completion_gate_for_final_response(&session, turn_id)
                .expect("ordinary turn")
                .is_none()
        );
    }

    #[test]
    fn goal_completion_allows_source_and_ui_changes_without_verification_audits() {
        let turn_id = "turn-goal-complete";
        let mut session = new_session(None, None, "normal");
        session.snapshot["projectTodo"] = json!({
            "status": "completed",
            "todos": [{
                "id": "ui",
                "content": "Update UI",
                "status": "completed",
            }]
        });
        session.snapshot["tools"] = json!([
            completed_tool(
                "source-edit",
                EDIT_FILE_MODEL_TOOL,
                turn_id,
                None,
                "source changed",
                json!({
                    "changedFiles": [{ "path": "src/lib.rs" }],
                }),
            ),
            completed_tool(
                "ui-edit",
                EDIT_FILE_MODEL_TOOL,
                turn_id,
                None,
                "ui changed",
                json!({
                    "changedFiles": [{
                        "path": "apps/desktop/src/renderer/styles/app.css",
                    }],
                }),
            ),
        ]);
        let audit = validate_todo_completion_contract(&session, turn_id)
            .expect("goal completion should not require tests or design audits");
        assert_eq!(audit["kind"], "completion_audit");
        assert_eq!(audit["todoCount"], 1);
    }

    #[test]
    fn goal_completion_still_requires_todo_items_to_finish() {
        let turn_id = "turn-goal-open-todo";
        let mut session = new_session(None, None, "normal");
        session.snapshot["projectTodo"] = json!({
            "status": "completed",
            "todos": [{
                "id": "open",
                "content": "Still working",
                "status": "in_progress",
            }]
        });
        assert_eq!(
            validate_todo_completion_contract(&session, turn_id)
                .unwrap_err()
                .code,
            "todo_items_incomplete"
        );
    }
}
