use super::*;

pub(crate) fn project_plan_list(payload: Value) -> AgentRuntimeResult<Value> {
    let (root, working_dir) = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let working_dir = resolve_working_dir(&state, &payload)?;
        (state.root.clone(), working_dir)
    };
    list_project_plans(&root, &working_dir)
}

pub(crate) fn project_plan_read(payload: Value) -> AgentRuntimeResult<Value> {
    let plan_id = string_opt(&payload, "planId")
        .ok_or_else(|| AgentRuntimeError::Core("planId is required".to_string()))?;
    let (root, working_dir) = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let working_dir = resolve_working_dir(&state, &payload)?;
        (state.root.clone(), working_dir)
    };
    read_project_plan(&root, &working_dir, &plan_id)
}

pub(crate) fn project_plan_delete(payload: Value) -> AgentRuntimeResult<Value> {
    let plan_id = string_opt(&payload, "planId")
        .ok_or_else(|| AgentRuntimeError::Core("planId is required".to_string()))?;
    let (root, working_dir) = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let working_dir = resolve_working_dir(&state, &payload)?;
        (state.root.clone(), working_dir)
    };
    delete_project_plan(&root, &working_dir, &plan_id)
}

pub(crate) fn project_todo_read_for_project(payload: Value) -> AgentRuntimeResult<Value> {
    let plan_id = string_opt(&payload, "planId")
        .ok_or_else(|| AgentRuntimeError::Core("planId is required".to_string()))?;
    let (root, working_dir) = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let working_dir = resolve_working_dir(&state, &payload)?;
        (state.root.clone(), working_dir)
    };
    read_project_todo(&root, &working_dir, &plan_id)
}

pub(crate) fn project_plan_revise(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = string_opt(&payload, "sessionId")
        .ok_or_else(|| AgentRuntimeError::Core("sessionId is required".to_string()))?;
    let markdown = payload
        .get("markdown")
        .and_then(Value::as_str)
        .ok_or_else(|| AgentRuntimeError::Core("markdown is required".to_string()))?
        .to_string();
    let plan_id = string_opt(&payload, "planId");
    let base_version_id = string_opt(&payload, "baseVersionId");
    let source = string_opt(&payload, "source").unwrap_or_else(|| "user_edit".to_string());
    let annotations = payload
        .get("annotations")
        .filter(|value| value.is_array())
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let summary = string_opt(&payload, "summary");

    let (callback, snapshot, plan) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let root = state.root.clone();
        let session = state
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let mut plan = session
            .snapshot
            .get("plan")
            .filter(|value| value.is_object())
            .cloned()
            .ok_or_else(|| AgentRuntimeError::Core("no active plan to revise".to_string()))?;
        if let Some(expected_plan_id) = plan_id.as_deref() {
            let current_plan_id = plan.get("activePlanId").and_then(Value::as_str);
            if current_plan_id != Some(expected_plan_id) {
                return Err(AgentRuntimeError::Core(format!(
                    "active plan mismatch: expected {expected_plan_id}"
                )));
            }
        }
        if let Some(expected_version_id) = base_version_id.as_deref() {
            let current_version_id = plan.get("activeVersionId").and_then(Value::as_str);
            if current_version_id != Some(expected_version_id) {
                return Err(AgentRuntimeError::Core(format!(
                    "active plan version mismatch: expected {expected_version_id}"
                )));
            }
        }
        let parent_version_id = plan
            .get("activeVersionId")
            .and_then(Value::as_str)
            .map(str::to_string);
        plan["activeVersionId"] = Value::String(format!("plan-version-{}", Uuid::new_v4()));
        plan["markdown"] = Value::String(markdown);
        plan["annotations"] = annotations;
        plan["phase"] = Value::String(PLAN_PHASE_REVIEWING.to_string());
        plan["review"] = json!({ "status": "changed", "summary": summary });
        let scope = plan_scope_from_session(session);
        session.snapshot["plan"] = plan.clone();
        touch_session(session);
        persist_plan_snapshot_with_source(
            &root,
            &session_id,
            &scope,
            &plan,
            &source,
            parent_version_id.as_deref(),
        )?;
        let snapshot = session.snapshot.clone();
        let callback = state.event_callback.clone();
        state.save_state()?;
        (callback, snapshot, plan)
    };

    emit_with_callback(
        &callback,
        json!({
            "kind": "planUpdated",
            "sessionId": session_id,
            "plan": plan,
        }),
    );
    emit_with_callback(
        &callback,
        json!({
            "kind": "sessionSnapshot",
            "snapshot": snapshot,
        }),
    );
    Ok(snapshot)
}

pub(crate) fn plan_review_respond(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = string_opt(&payload, "sessionId")
        .ok_or_else(|| AgentRuntimeError::Core("sessionId is required".to_string()))?;
    let action = string_opt(&payload, "action")
        .or_else(|| string_opt(&payload, "resolution"))
        .ok_or_else(|| AgentRuntimeError::Core("action is required".to_string()))?;
    let feedback = string_opt(&payload, "feedback");
    let should_continue = payload
        .get("continue")
        .or_else(|| payload.get("resume"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let (callback, snapshot, plan, resolution, continuation) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let root = state.root.clone();
        let session = state
            .sessions
            .get_mut(&session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let mut plan = session
            .snapshot
            .get("plan")
            .filter(|value| value.is_object())
            .cloned()
            .ok_or_else(|| AgentRuntimeError::Core("no active plan to review".to_string()))?;
        let (resolution, continuation) = match action.as_str() {
            "approve" | "approved" => {
                plan["phase"] = Value::String(PLAN_PHASE_TODO_REQUIRED.to_string());
                plan["review"] = json!({ "status": "approved", "summary": feedback });
                (
                    "approved",
                    Some(PlanReviewContinuation::Approved {
                        feedback: feedback.clone(),
                    }),
                )
            }
            "reject" | "rejected" | "set_aside" | "set-aside" | "defer" => {
                // Non-destructive: set the plan aside (deferred) instead of
                // killing it. The plan stays in the session snapshot and the
                // persisted project plan store, so the user can resume it later
                // from the plan board. The current turn stops here.
                plan["phase"] = Value::String(PLAN_PHASE_SET_ASIDE.to_string());
                plan["review"] = json!({ "status": "set_aside", "summary": feedback });
                ("set_aside", None)
            }
            "resume" | "reopen" | "reactivate" => {
                // Bring a set-aside plan back into review so the user can
                // approve, revise, or set it aside again.
                plan["phase"] = Value::String(PLAN_PHASE_REVIEWING.to_string());
                plan["review"] = json!({ "status": "pending", "summary": feedback });
                ("resumed", None)
            }
            "request_revision" | "revise" | "revision" => {
                plan["phase"] = Value::String(PLAN_PHASE_PLANNING.to_string());
                plan["review"] = json!({ "status": "changed", "summary": feedback });
                (
                    "revise",
                    Some(PlanReviewContinuation::Revision {
                        feedback: feedback.clone(),
                    }),
                )
            }
            other => {
                return Err(AgentRuntimeError::Core(format!(
                    "unsupported plan review action: {other}"
                )));
            }
        };
        let scope = plan_scope_from_session(session);
        session.snapshot["plan"] = plan.clone();
        touch_session(session);
        persist_plan_snapshot(&root, &session_id, &scope, &plan)?;
        let snapshot = session.snapshot.clone();
        let callback = state.event_callback.clone();
        state.save_state()?;
        (
            callback,
            snapshot,
            plan,
            resolution.to_string(),
            continuation,
        )
    };
    emit_with_callback(
        &callback,
        json!({
            "kind": "planUpdated",
            "sessionId": session_id,
            "plan": plan,
        }),
    );
    emit_with_callback(
        &callback,
        json!({
            "kind": "planReviewResolved",
            "sessionId": session_id,
            "planId": snapshot.pointer("/plan/activePlanId").cloned().unwrap_or(Value::Null),
            "resolution": resolution,
        }),
    );
    emit_with_callback(
        &callback,
        json!({
            "kind": "sessionSnapshot",
            "snapshot": snapshot,
        }),
    );
    let mut response_snapshot = snapshot;
    if should_continue && let Some(continuation) = continuation {
        resume_plan_review_continuation(&session_id, &response_snapshot, continuation)?;
        response_snapshot = current_session_snapshot(&session_id)?;
    }
    Ok(response_snapshot)
}

#[derive(Clone, Debug)]
enum PlanReviewContinuation {
    Approved { feedback: Option<String> },
    Revision { feedback: Option<String> },
}

fn resume_plan_review_continuation(
    session_id: &str,
    snapshot: &Value,
    continuation: PlanReviewContinuation,
) -> AgentRuntimeResult<Value> {
    let plan = snapshot
        .get("plan")
        .filter(|value| value.is_object())
        .ok_or_else(|| AgentRuntimeError::Core("approved plan snapshot is missing".to_string()))?;
    let plan_id = plan
        .get("activePlanId")
        .and_then(Value::as_str)
        .unwrap_or("unknown-plan");
    let version_id = plan
        .get("activeVersionId")
        .and_then(Value::as_str)
        .unwrap_or("unknown-version");
    let title = plan.get("title").and_then(Value::as_str).unwrap_or("Plan");
    let markdown = plan
        .get("markdown")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let annotations = plan
        .get("annotations")
        .filter(|value| value.is_array())
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let instruction = match continuation {
        PlanReviewContinuation::Approved { feedback } => format!(
            "Runtime continuation: the user approved Plan {plan_id}/{version_id} ({title}). Before executing anything, call todo_write with a complete ordered todo list derived from the approved plan. Do not call mutation tools until todo_write succeeds.\n\nApproved plan markdown:\n{markdown}\n\nUser approval note: {}",
            feedback.unwrap_or_else(|| "none".to_string())
        ),
        PlanReviewContinuation::Revision { feedback } => format!(
            "Runtime continuation: the user edited or annotated Plan {plan_id}/{version_id} ({title}). Rewrite or improve the plan using plan_write, then call plan_finalize again. Do not execute the task yet.\n\nCurrent plan markdown:\n{markdown}\n\nCurrent annotations:\n{}\n\nUser feedback: {}",
            serde_json::to_string_pretty(&annotations).unwrap_or_else(|_| "[]".to_string()),
            feedback.unwrap_or_else(|| "none".to_string())
        ),
    };
    send_turn(json!({
        "sessionId": session_id,
        "text": instruction,
        "uiHidden": true
    }))
}

fn current_session_snapshot(session_id: &str) -> AgentRuntimeResult<Value> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    state
        .sessions
        .get(session_id)
        .map(|session| session.snapshot.clone())
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))
}

fn resolve_working_dir(state: &NativeRuntimeState, payload: &Value) -> AgentRuntimeResult<String> {
    if let Some(working_dir) = string_opt(payload, "workingDir") {
        return Ok(working_dir);
    }
    if let Some(session_id) = string_opt(payload, "sessionId") {
        return state
            .sessions
            .get(&session_id)
            .and_then(|session| session.snapshot.get("workingDir"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AgentRuntimeError::Core(format!("workingDir not found for session: {session_id}"))
            });
    }
    Err(AgentRuntimeError::Core(
        "workingDir or sessionId is required".to_string(),
    ))
}
