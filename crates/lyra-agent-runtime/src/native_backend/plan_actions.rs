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
    let (callback, snapshot, plan, resolution) = {
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
        let resolution = match action.as_str() {
            "approve" | "approved" => {
                plan["phase"] = Value::String(PLAN_PHASE_TODO_REQUIRED.to_string());
                plan["review"] = json!({ "status": "approved", "summary": feedback });
                "approved"
            }
            "reject" | "rejected" => {
                plan["phase"] = Value::String(PLAN_PHASE_REJECTED.to_string());
                plan["review"] = json!({ "status": "rejected", "summary": feedback });
                "rejected"
            }
            "request_revision" | "revise" | "revision" => {
                plan["phase"] = Value::String(PLAN_PHASE_PLANNING.to_string());
                plan["review"] = json!({ "status": "changed", "summary": feedback });
                "revise"
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
        (callback, snapshot, plan, resolution.to_string())
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
    Ok(snapshot)
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
