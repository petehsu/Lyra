use super::*;
use lyra_tool_fs_core::{TOOL_FS_INSPECT, TOOL_FS_LIST, TOOL_FS_READ_DOC, TOOL_FS_SEARCH};

pub(crate) fn mutation_quality_gate_model_tool(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    arguments: Value,
    started_at: &str,
) -> Option<Value> {
    if !matches!(
        tool_name,
        APPLY_PATCH_MODEL_TOOL | WRITE_FILE_MODEL_TOOL | EDIT_FILE_MODEL_TOOL
    ) {
        return None;
    }
    let result = {
        let state = state().lock().ok()?;
        let session = state.sessions.get(session_id)?;
        validate_artifact_mutation_contract(session, turn_id)
    };
    let failure = result.err()?;
    Some(record_gate_failure(
        session_id,
        turn_id,
        tool_call_id,
        tool_name,
        arguments,
        started_at,
        failure,
    ))
}

pub(crate) fn validate_artifact_mutation_for_session(
    session_id: &str,
    turn_id: &str,
) -> Result<(), NativeToolFailure> {
    {
        let state = state().lock().map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the tool call.",
            )
        })?;
        let session = state.sessions.get(session_id).ok_or_else(|| {
            NativeToolFailure::new(
                "session_not_found",
                format!("session not found: {session_id}"),
                "Retry in an active session.",
            )
        })?;
        validate_artifact_mutation_contract(session, turn_id)?;
    }
    Ok(())
}

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
        validate_final_response_contract(session, turn_id)?;
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
        validate_final_response_contract(session, turn_id)?;
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
    design_finding_dispositions: &[Value],
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
    validate_completion_evidence(session, turn_id, &todos, design_finding_dispositions)
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
            let dispositions = session
                .snapshot
                .pointer("/projectTodo/designFindingDispositions")
                .and_then(Value::as_array)
                .map(Vec::as_slice)
                .unwrap_or_default();
            validate_todo_completion_contract(session, turn_id, dispositions).map(Some)
        }
        Some("failed" | "cancelled" | "running") => Ok(None),
        Some(_) => Ok(None),
        None if latest_completed_mutation_id_for_current_task(session, turn_id).is_some() => {
            validate_completion_evidence(session, turn_id, &[], &[]).map(Some)
        }
        None => Ok(None),
    }
}

fn validate_completion_evidence(
    session: &NativeSession,
    turn_id: &str,
    todos: &[Value],
    design_finding_dispositions: &[Value],
) -> Result<Value, NativeToolFailure> {
    let changed_paths = current_task_changed_paths(session, turn_id);
    let mutation_tool_id = latest_completed_mutation_id_for_current_task(session, turn_id);
    let verification_tool_id =
        validate_post_mutation_verification(session, turn_id, &changed_paths)?;
    let ui_paths = current_task_ui_changed_paths(session, turn_id);
    if ui_paths.is_empty() {
        return Ok(json!({
            "kind": "completion_audit",
            "mode": "general",
            "changedPaths": changed_paths,
            "mutationToolId": mutation_tool_id,
            "verificationToolId": verification_tool_id,
            "todoCount": todos.len(),
        }));
    }
    let mut audit = validate_ui_completion(
        session,
        turn_id,
        &todos,
        design_finding_dispositions,
        ui_paths,
    )?;
    audit["changedPaths"] = Value::Array(changed_paths.into_iter().map(Value::String).collect());
    audit["verificationToolId"] = verification_tool_id
        .map(Value::String)
        .unwrap_or(Value::Null);
    Ok(audit)
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
    code.starts_with("completion_") || code.starts_with("design_")
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

fn validate_artifact_mutation_contract(
    session: &NativeSession,
    turn_id: &str,
) -> Result<(), NativeToolFailure> {
    let approved_execution = has_approved_execution_scope(session);
    if !approved_execution && !has_investigation_evidence(session, Some(turn_id)) {
        return Err(NativeToolFailure::new(
            "investigation_required_before_mutation",
            "Production artifacts cannot be changed before inspecting substantive real evidence for the current task.",
            "Read or search the real workspace, product, documentation, or reference implementation first; a directory listing is not enough.",
        ));
    }
    Ok(())
}

fn validate_final_response_contract(
    session: &NativeSession,
    turn_id: &str,
) -> Result<(), NativeToolFailure> {
    let phase = session
        .snapshot
        .pointer("/plan/phase")
        .and_then(Value::as_str);
    // Without a structured plan/action contract, do not guess task intent
    // from natural-language keywords. Mutation remains independently gated
    // by validate_artifact_mutation_contract.
    if phase.is_none() && !has_investigation_evidence(session, Some(turn_id)) {
        return Ok(());
    }

    // If a plan was started in this turn but never finalized, block.
    if phase.is_some()
        && !completed_plan_in_turn(session, turn_id)
        && !has_approved_execution_scope(session)
    {
        return Err(NativeToolFailure::new(
            "plan_finalize_required_before_final",
            "A planning task cannot finish before the current turn finalizes a structured plan for review.",
            "Continue with investigation or reference tools as needed, then call plan_begin, plan_write, and plan_finalize.",
        ));
    }

    let inherited_evidence =
        has_approved_execution_scope(session) || completed_plan_in_turn(session, turn_id);
    if !inherited_evidence && !has_investigation_evidence(session, Some(turn_id)) {
        return Err(NativeToolFailure::new(
            "investigation_required_before_final",
            "This task cannot be concluded without inspecting substantive real evidence.",
            "Read or search the real product, workspace, documentation, or reference implementation, then answer from that evidence.",
        ));
    }
    Ok(())
}

fn completed_plan_in_turn(session: &NativeSession, turn_id: &str) -> bool {
    session_tools(session).iter().rev().any(|tool| {
        tool_matches_turn(tool, Some(turn_id))
            && successful_tool(tool)
            && is_plan_finalize_tool(tool)
    })
}

fn is_plan_finalize_tool(tool: &Value) -> bool {
    let name = tool.get("name").and_then(Value::as_str).unwrap_or_default();
    name == PLAN_FINALIZE_MODEL_TOOL
        || (name == UPDATE_PLAN_MODEL_TOOL
            && tool
                .get("input")
                .and_then(|i| i.get("action"))
                .and_then(Value::as_str)
                == Some("finalize"))
}

fn has_approved_execution_scope(session: &NativeSession) -> bool {
    if session
        .snapshot
        .pointer("/oma/executingWorkPackageId")
        .and_then(Value::as_str)
        .is_some()
    {
        return true;
    }
    matches!(
        session
            .snapshot
            .pointer("/plan/phase")
            .and_then(Value::as_str),
        Some(PLAN_PHASE_TODO_REQUIRED | PLAN_PHASE_EXECUTING_TODO | PLAN_PHASE_COMPLETED)
    )
}

pub(crate) fn has_investigation_evidence(session: &NativeSession, turn_id: Option<&str>) -> bool {
    session_tools(session).iter().any(|tool| {
        tool_matches_turn(tool, turn_id)
            && successful_tool(tool)
            && investigation_tool(tool)
            && tool_has_substantive_evidence(tool)
    })
}

pub(crate) fn current_plan_investigation_evidence_ids(
    session: &NativeSession,
    turn_id: &str,
) -> Vec<String> {
    let start = current_task_start_index(session, turn_id);
    session_tools(session)
        .iter()
        .enumerate()
        .filter(|(index, tool)| {
            *index >= start
                && successful_tool(tool)
                && investigation_tool(tool)
                && tool_has_substantive_evidence(tool)
        })
        .filter_map(|(_, tool)| tool.get("id").and_then(Value::as_str).map(str::to_string))
        .collect()
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

fn tool_has_substantive_evidence(tool: &Value) -> bool {
    let name = tool.get("name").and_then(Value::as_str).unwrap_or_default();
    let path = tool_path(tool);
    let output = tool.get("output").unwrap_or(&Value::Null);
    if matches!(
        name,
        TOOL_FS_SEARCH | TOOL_FS_LIST | TOOL_FS_READ_DOC | TOOL_FS_INSPECT | GLOB_MODEL_TOOL
    ) || path.starts_with("/tools/runtime/tool_fs_")
        || path.ends_with("/list")
        || path.ends_with("/glob")
    {
        return false;
    }
    if matches!(
        output
            .pointer("/raw/pageKind")
            .or_else(|| output.pointer("/raw/observationKind"))
            .and_then(Value::as_str),
        Some("search" | "results" | "search-home" | "search-results")
    ) {
        return false;
    }
    if name == READ_FILE_MODEL_TOOL || path.contains("/filesystem/read") {
        return output
            .pointer("/raw/bytes")
            .and_then(Value::as_u64)
            .is_some_and(|bytes| bytes > 0);
    }
    if name == GREP_MODEL_TOOL || path.ends_with("/grep") || path.ends_with("/search") {
        return output
            .pointer("/raw/matches")
            .or_else(|| output.pointer("/raw/total"))
            .and_then(Value::as_u64)
            .is_some_and(|matches| matches > 0);
    }
    if name == EXEC_COMMAND_MODEL_TOOL || path == "/tools/shell/run" {
        return output.pointer("/raw/success").and_then(Value::as_bool) == Some(true)
            && ["/raw/stdout", "/raw/stderr"].iter().any(|pointer| {
                output
                    .pointer(pointer)
                    .and_then(Value::as_str)
                    .is_some_and(|text| !text.trim().is_empty())
            });
    }
    if path.starts_with("/tools/code/") || path.starts_with("/tools/codegraph/") {
        return codegraph_has_substantive_evidence(output);
    }
    if path.starts_with("/tools/browser/") {
        if path.ends_with("/navigate") || path.ends_with("/reload") {
            return false;
        }
        let has_capture = output
            .pointer("/raw/screenshotArtifactRef")
            .is_some_and(non_empty_json);
        let has_observation = ["/raw/content", "/raw/bodyText", "/raw/markdown", "/content"]
            .iter()
            .any(|pointer| {
                output
                    .pointer(pointer)
                    .and_then(Value::as_str)
                    .is_some_and(substantive_text)
            });
        return has_capture || has_observation;
    }
    if path.starts_with("/tools/web/") {
        let has_page = [
            "/raw/url",
            "/raw/finalUrl",
            "/raw/address",
            "/raw/page/url",
            "/raw/page/address",
        ]
        .iter()
        .any(|pointer| {
            output
                .pointer(pointer)
                .and_then(Value::as_str)
                .is_some_and(|value| value.starts_with("http://") || value.starts_with("https://"))
        });
        let has_capture = output
            .pointer("/raw/screenshotArtifactRef")
            .is_some_and(non_empty_json);
        return has_page
            && (has_capture
                || output
                    .get("content")
                    .and_then(Value::as_str)
                    .is_some_and(substantive_text));
    }
    if path.starts_with("/tools/design/") {
        return output
            .get("content")
            .and_then(Value::as_str)
            .is_some_and(substantive_text);
    }
    for pointer in [
        "/raw/content",
        "/raw/stdout",
        "/raw/results",
        "/raw/items",
        "/raw/data",
        "/content",
    ] {
        let Some(value) = output.pointer(pointer) else {
            continue;
        };
        match value {
            Value::String(text) if substantive_text(text) => return true,
            Value::Array(items) if !items.is_empty() => return true,
            Value::Object(object) if !object.is_empty() => return true,
            Value::Number(_) | Value::Bool(_) => return true,
            _ => {}
        }
    }
    false
}

fn substantive_text(text: &str) -> bool {
    let text = text.trim();
    !text.is_empty()
        && !matches!(
            text,
            "No matches found." | "Directory is empty." | "No results." | "null" | "{}" | "[]"
        )
}

fn codegraph_has_substantive_evidence(output: &Value) -> bool {
    for pointer in [
        "/raw/results",
        "/raw/symbols",
        "/raw/functions",
        "/raw/callers",
        "/raw/callees",
        "/raw/dependencies",
        "/raw/nodes",
        "/raw/edges",
        "/raw/matches",
        "/raw/files",
    ] {
        if output
            .pointer(pointer)
            .and_then(Value::as_array)
            .is_some_and(|items| !items.is_empty())
        {
            return true;
        }
    }
    [
        "/raw/total",
        "/raw/total_matches",
        "/raw/fileCount",
        "/raw/file_count",
        "/raw/symbolCount",
        "/raw/symbol_count",
        "/raw/files_indexed",
    ]
    .iter()
    .any(|pointer| {
        output
            .pointer(pointer)
            .and_then(Value::as_u64)
            .is_some_and(|count| count > 0)
    })
}

fn tool_matches_turn(tool: &Value, turn_id: Option<&str>) -> bool {
    turn_id.is_none() || crate::native_backend::activity::tool_runtime_turn_id(tool) == turn_id
}

fn investigation_tool(tool: &Value) -> bool {
    let name = tool.get("name").and_then(Value::as_str).unwrap_or_default();
    if matches!(name, READ_FILE_MODEL_TOOL | GREP_MODEL_TOOL) {
        return true;
    }
    let path = tool_path(tool);
    if [
        "/tools/web/",
        "/tools/browser/",
        "/tools/design/reference",
        "/tools/design/extract_reference",
        "/tools/code/",
        "/tools/codegraph/",
        "/tools/filesystem/read",
        "/tools/filesystem/search",
    ]
    .iter()
    .any(|prefix| path.starts_with(prefix))
    {
        return true;
    }
    (path == "/tools/shell/run" || name == EXEC_COMMAND_MODEL_TOOL)
        && tool
            .pointer("/output/raw/commandKind")
            .and_then(Value::as_str)
            == Some("read")
}

fn tool_path(tool: &Value) -> &str {
    [
        "/toolPath",
        "/input/toolPath",
        "/input/toolOperation/path",
        "/output/toolPath",
        "/output/raw/toolPath",
    ]
    .iter()
    .find_map(|pointer| tool.pointer(pointer).and_then(Value::as_str))
    .unwrap_or_default()
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

fn current_task_ui_changed_paths(session: &NativeSession, turn_id: &str) -> Vec<String> {
    let start = current_task_start_index(session, turn_id);
    let mut paths = session_tools(session)
        .iter()
        .enumerate()
        .filter(|(index, tool)| *index >= start && successful_tool(tool))
        .flat_map(|(_, tool)| tool_changed_paths(tool))
        .filter(|path| is_ui_path(path))
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

fn is_code_path(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "rs" | "c"
            | "cc"
            | "cpp"
            | "h"
            | "hpp"
            | "go"
            | "py"
            | "rb"
            | "php"
            | "java"
            | "kt"
            | "kts"
            | "swift"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "vue"
            | "svelte"
            | "astro"
            | "html"
            | "css"
            | "scss"
            | "sass"
            | "less"
            | "sql"
            | "sh"
            | "bash"
            | "zsh"
            | "fish"
    )
}

fn validate_post_mutation_verification(
    session: &NativeSession,
    turn_id: &str,
    changed_paths: &[String],
) -> Result<Option<String>, NativeToolFailure> {
    if !changed_paths.iter().any(|path| is_code_path(path)) {
        return Ok(None);
    }
    let start = current_task_start_index(session, turn_id);
    let Some((mutation_index, mutation_id)) = session_tools(session)
        .iter()
        .enumerate()
        .rev()
        .find_map(|(index, tool)| {
            (index >= start && successful_tool(tool) && tool_changed_paths(tool).next().is_some())
                .then(|| {
                    tool.get("id")
                        .and_then(Value::as_str)
                        .map(|id| (index, id.to_string()))
                })
                .flatten()
        })
    else {
        return Ok(None);
    };
    let verification = session_tools(session)
        .iter()
        .enumerate()
        .skip(mutation_index + 1)
        .filter(|(_, tool)| {
            matches!(
                tool.pointer("/output/raw/commandKind")
                    .and_then(Value::as_str),
                Some("test" | "typecheck" | "lint" | "build")
            )
        })
        .last();
    match verification {
        Some((_, tool)) if successful_tool(tool) => Ok(tool
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)),
        Some((_, tool)) => Err(NativeToolFailure::new(
            "completion_verification_failed",
            "The latest test, typecheck, lint, or build after the final source mutation failed.",
            "Fix the failure and run a newer successful verification before declaring completion.",
        )
        .with_detail(json!({
            "mutationToolId": mutation_id,
            "failedVerificationToolId": tool.get("id").cloned().unwrap_or(Value::Null),
        }))),
        None => Err(NativeToolFailure::new(
            "completion_verification_required",
            "Source changes require a successful test, typecheck, lint, or build after the final mutation.",
            "Run the smallest meaningful verification command, then declare completion again.",
        )
        .with_detail(json!({ "mutationToolId": mutation_id }))),
    }
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

fn evidence_id_valid_for_current_task(session: &NativeSession, turn_id: &str, id: &str) -> bool {
    let start = current_task_start_index(session, turn_id);
    if session_tools(session)
        .iter()
        .enumerate()
        .any(|(index, tool)| {
            index >= start
                && tool.get("id").and_then(Value::as_str) == Some(id)
                && successful_tool(tool)
                && tool_has_substantive_evidence(tool)
        })
    {
        return true;
    }
    session
        .snapshot
        .pointer("/designQualityGate/audits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|audit| valid_design_audit_evidence(session, turn_id, start, audit, id))
}

fn valid_design_audit_evidence(
    session: &NativeSession,
    turn_id: &str,
    task_start: usize,
    audit: &Value,
    id: &str,
) -> bool {
    if audit.get("id").and_then(Value::as_str) != Some(id)
        || !matches!(
            audit.get("status").and_then(Value::as_str),
            Some("clean" | "findings")
        )
        || audit.get("notApplicable").and_then(Value::as_bool) == Some(true)
        || !design_audit_has_real_evidence(audit)
    {
        return false;
    }
    if let Some(mutation_id) = audit.get("mutationToolId").and_then(Value::as_str) {
        return session_tools(session)
            .iter()
            .enumerate()
            .any(|(index, tool)| {
                index >= task_start
                    && tool.get("id").and_then(Value::as_str) == Some(mutation_id)
                    && successful_tool(tool)
            });
    }
    audit.get("turnId").and_then(Value::as_str) == Some(turn_id)
}

fn validate_ui_completion(
    session: &NativeSession,
    turn_id: &str,
    todos: &[Value],
    dispositions: &[Value],
    ui_paths: Vec<String>,
) -> Result<Value, NativeToolFailure> {
    let latest_mutation = latest_completed_mutation_id_for_current_task(session, turn_id);
    let audits = session
        .snapshot
        .pointer("/designQualityGate/audits")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let current = audits
        .iter()
        .filter(|audit| {
            audit.get("mutationToolId").and_then(Value::as_str) == latest_mutation.as_deref()
        })
        .collect::<Vec<_>>();
    let source = current
        .iter()
        .rev()
        .copied()
        .find(|audit| audit.get("mode").and_then(Value::as_str) == Some("source"));
    let desktop = current.iter().rev().copied().find(|audit| {
        audit.get("mode").and_then(Value::as_str) == Some("rendered")
            && viewport_width(audit) >= 1_000
    });
    let narrow = current.iter().rev().copied().find(|audit| {
        audit.get("mode").and_then(Value::as_str) == Some("rendered")
            && (1..=768).contains(&viewport_width(audit))
    });
    if source.is_none() {
        return Err(NativeToolFailure::new(
            "design_source_audit_required",
            "UI changes require a source audit after the latest mutation.",
            "Run /tools/design/quality with action=audit_source after the final edit.",
        ));
    }
    if desktop.is_none() || narrow.is_none() {
        return Err(NativeToolFailure::new(
            "design_rendered_audits_required",
            "UI changes require desktop and narrow rendered audits after the latest mutation.",
            "Run audit_rendered at desktop and narrow viewport widths with screenshots enabled.",
        ));
    }
    let required = [source, desktop, narrow]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    if required.iter().any(|audit| {
        !matches!(
            audit.get("status").and_then(Value::as_str),
            Some("clean" | "findings")
        ) || audit.get("notApplicable").and_then(Value::as_bool) == Some(true)
    }) {
        return Err(NativeToolFailure::new(
            "design_audit_degraded",
            "A required UI audit is degraded, partial, or not applicable.",
            "Restore real source/browser verification and rerun the required audit.",
        ));
    }
    let source = source.expect("checked above");
    if audit_scanned_count(source) == 0 || !source_audit_covers_paths(source, &ui_paths) {
        return Err(NativeToolFailure::new(
            "design_source_audit_invalid",
            "The required source audit did not scan the changed UI source paths.",
            "Rerun audit_source after the final edit with a path that covers every changed UI file.",
        ));
    }
    for (label, audit) in [("desktop", desktop), ("narrow", narrow)] {
        let audit = audit.expect("checked above");
        if audit_scanned_count(audit) == 0
            || !audit_has_real_page_url(audit)
            || audit
                .get("screenshotArtifactRef")
                .is_none_or(|value| !non_empty_json(value))
        {
            return Err(NativeToolFailure::new(
                "design_visual_inspection_required",
                format!(
                    "The {label} rendered audit lacks a real page, scanned content, or screenshot."
                ),
                "Open the real page and rerun audit_rendered with includeScreenshot=true.",
            ));
        }
    }
    let mut blockers = required
        .iter()
        .flat_map(|audit| {
            audit
                .get("blockingFindings")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut seen = HashSet::new();
    blockers.retain(|finding| {
        finding
            .get("ruleId")
            .and_then(Value::as_str)
            .is_none_or(|rule| seen.insert(rule.to_string()))
    });
    let unresolved = blockers
        .iter()
        .filter(|finding| {
            let rule = finding
                .get("ruleId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            !dispositions
                .iter()
                .any(|value| valid_design_disposition(session, turn_id, value, rule))
        })
        .collect::<Vec<_>>();
    if !unresolved.is_empty() {
        return Err(NativeToolFailure::new(
            "design_findings_need_review",
            format!(
                "High-severity, high-confidence UI findings remain without valid evidence dispositions: {}.",
                unresolved
                    .iter()
                    .filter_map(|finding| finding.get("ruleId").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            "Fix and rerun the audit, or provide retained/ignored dispositions with valid evidenceIds.",
        ));
    }
    Ok(json!({
        "kind": "completion_audit",
        "mode": "ui",
        "verificationRequired": "ui",
        "changedPaths": ui_paths,
        "mutationToolId": latest_mutation,
        "sourceAudit": source,
        "desktopAudit": desktop,
        "narrowAudit": narrow,
        "reviewedHighConfidenceFindings": blockers,
        "designFindingDispositions": dispositions,
        "todoEvidenceCount": todos.len(),
    }))
}

fn viewport_width(audit: &Value) -> u64 {
    audit
        .pointer("/scope/viewport/width")
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

fn design_audit_has_real_evidence(audit: &Value) -> bool {
    if audit_scanned_count(audit) == 0 {
        return false;
    }
    match audit.get("mode").and_then(Value::as_str) {
        Some("source") => true,
        Some("rendered") => {
            audit_has_real_page_url(audit)
                && audit
                    .get("screenshotArtifactRef")
                    .is_some_and(non_empty_json)
        }
        _ => false,
    }
}

fn audit_scanned_count(audit: &Value) -> u64 {
    audit
        .pointer("/summary/scanned")
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

fn audit_has_real_page_url(audit: &Value) -> bool {
    audit
        .pointer("/scope/url")
        .and_then(Value::as_str)
        .is_some_and(|url| {
            url.starts_with("http://") || url.starts_with("https://") || url.starts_with("file://")
        })
}

fn source_audit_covers_paths(audit: &Value, paths: &[String]) -> bool {
    let Some(scope) = audit.pointer("/scope/path").and_then(Value::as_str) else {
        return false;
    };
    let scope = scope
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string();
    if scope.is_empty() || scope == "." {
        return true;
    }
    let scope = scope.trim_end_matches('/');
    paths.iter().all(|path| {
        let path = path.replace('\\', "/");
        path == scope || path.starts_with(&format!("{scope}/"))
    })
}

fn valid_design_disposition(
    session: &NativeSession,
    turn_id: &str,
    value: &Value,
    rule_id: &str,
) -> bool {
    value.get("ruleId").and_then(Value::as_str) == Some(rule_id)
        && matches!(
            value.get("disposition").and_then(Value::as_str),
            Some("retained" | "ignored")
        )
        && value
            .get("evidenceIds")
            .and_then(Value::as_array)
            .is_some_and(|ids| {
                !ids.is_empty()
                    && ids.iter().all(|id| {
                        id.as_str().is_some_and(|id| {
                            evidence_id_valid_for_current_task(session, turn_id, id)
                        })
                    })
            })
}

fn non_empty_json(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(value) => !value.trim().is_empty(),
        Value::Array(values) => !values.is_empty(),
        Value::Object(values) => !values.is_empty(),
        _ => true,
    }
}

fn record_gate_failure(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    arguments: Value,
    started_at: &str,
    failure: NativeToolFailure,
) -> Value {
    let output = tool_failure_output(
        &failure.code,
        &failure.message,
        &failure.recommended_next_action,
        failure.detail,
    );
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            tool_name,
            tool_name,
            "failed",
            arguments,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
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
    fn investigated_final_response_passes_without_contract() {
        // Simple conversational message (no task keywords) → allowed without investigation.
        let mut session = new_session(None, None, "normal");
        let turn_id = "turn-final-contract";
        let message = user_message("Hello there".to_string(), Vec::new(), now());
        let message_id = message["id"].as_str().unwrap().to_string();
        session.snapshot["messages"] = json!([message]);
        session.runtime_turns.push(runtime_turn(
            turn_id,
            &session.id,
            "calling_model",
            Some(message_id),
            None,
        ));
        assert!(validate_final_response_contract(&session, turn_id).is_ok());

        let mut session = new_session(None, None, "normal");
        let turn_id = "turn-explanation";
        let message = user_message("How does git status work?".to_string(), Vec::new(), now());
        let message_id = message["id"].as_str().unwrap().to_string();
        session.snapshot["messages"] = json!([message]);
        session.runtime_turns.push(runtime_turn(
            turn_id,
            &session.id,
            "calling_model",
            Some(message_id),
            None,
        ));
        assert!(
            validate_final_response_contract(&session, turn_id).is_ok(),
            "an explanation should not be forced into Plan or investigation"
        );

        // Natural-language text is not treated as a task classifier when no
        // structured plan/action contract exists.
        let mut session = new_session(None, None, "normal");
        let turn_id = "turn-task-blocked";
        let message = user_message("Inspect the workspace".to_string(), Vec::new(), now());
        let message_id = message["id"].as_str().unwrap().to_string();
        session.snapshot["messages"] = json!([message]);
        session.runtime_turns.push(runtime_turn(
            turn_id,
            &session.id,
            "calling_model",
            Some(message_id),
            None,
        ));
        assert!(validate_final_response_contract(&session, turn_id).is_ok());

        // Task-like message with investigation evidence → allowed.
        session.snapshot["tools"] = json!([{
            "id": "tool-read",
            "name": "read_file",
            "status": "completed",
            "input": {
                "path": "Cargo.toml",
                "turnId": turn_id
            },
            "output": {
                "content": "workspace manifest inspected",
                "raw": { "bytes": 128 }
            }
        }]);
        assert!(validate_final_response_contract(&session, turn_id).is_ok());
    }

    #[test]
    fn mutation_requires_investigation_unless_execution_is_approved() {
        let turn_id = "turn-mutation-discipline";
        let mut session = new_session(None, None, "normal");
        assert_eq!(
            validate_artifact_mutation_contract(&session, turn_id)
                .unwrap_err()
                .code,
            "investigation_required_before_mutation"
        );

        session.snapshot["tools"] = json!([completed_tool(
            "source-read",
            READ_FILE_MODEL_TOOL,
            turn_id,
            None,
            "shared implementation",
            json!({ "bytes": 128 }),
        )]);
        assert!(
            validate_artifact_mutation_contract(&session, turn_id).is_ok(),
            "a small direct edit may proceed after substantive inspection without Plan or Todo"
        );

        session.snapshot["tools"] = json!([]);
        session.snapshot["plan"] = json!({ "phase": PLAN_PHASE_EXECUTING_TODO });
        assert!(
            validate_artifact_mutation_contract(&session, turn_id).is_ok(),
            "approved Plan execution inherits its investigation evidence"
        );

        session.snapshot["plan"] = Value::Null;
        session.snapshot["oma"] = json!({ "executingWorkPackageId": "package-1" });
        assert!(
            validate_artifact_mutation_contract(&session, turn_id).is_ok(),
            "an approved Oma work package inherits its investigation evidence"
        );
    }

    #[test]
    fn plan_phase_requires_successful_finalize_in_current_turn() {
        let mut session = new_session(None, None, "normal");
        let turn_id = "turn-plan-contract";
        let message = user_message("Plan the change".to_string(), Vec::new(), now());
        let message_id = message["id"].as_str().unwrap().to_string();
        session.snapshot["messages"] = json!([message]);
        session.runtime_turns.push(runtime_turn(
            turn_id,
            &session.id,
            "calling_model",
            Some(message_id),
            None,
        ));
        session.snapshot["tools"] = json!([{
            "id": "tool-read",
            "name": "read_file",
            "status": "completed",
            "input": {
                "path": "Cargo.toml",
                "turnId": turn_id
            },
            "output": {
                "content": "workspace manifest inspected",
                "raw": { "bytes": 128 }
            }
        }]);

        // Set plan phase to a non-completed state → should require finalize.
        session.snapshot["plan"] = json!({ "phase": "drafting" });

        assert_eq!(
            validate_final_response_contract(&session, turn_id)
                .unwrap_err()
                .code,
            "plan_finalize_required_before_final"
        );

        // Add a successful plan_finalize → should pass.
        session.snapshot["tools"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "id": "tool-plan-finalize",
                "name": PLAN_FINALIZE_MODEL_TOOL,
                "status": "completed",
                "input": { "turnId": turn_id },
                "output": {
                    "raw": { "phase": PLAN_PHASE_REVIEWING }
                }
            }));
        assert!(validate_final_response_contract(&session, turn_id).is_ok());
    }

    #[test]
    fn investigation_evidence_rejects_catalog_empty_partial_and_search_home_results() {
        let turn_id = "turn-investigation-evidence";
        let mut session = new_session(None, None, "normal");
        session.snapshot["tools"] = json!([
            completed_tool(
                "catalog",
                "tool_fs",
                turn_id,
                Some("/tools/runtime/tool_fs_search"),
                "Found 5 tools.",
                json!({ "total": 5, "results": [{ "path": "/tools/filesystem/read_file" }] }),
            ),
            completed_tool(
                "empty-read",
                READ_FILE_MODEL_TOOL,
                turn_id,
                None,
                "Cargo.toml",
                json!({ "bytes": 0 }),
            ),
            completed_tool(
                "partial-codegraph",
                "code",
                turn_id,
                Some("/tools/codegraph/server"),
                "0 files indexed.",
                json!({ "ok": false, "status": "partial", "files_indexed": 0 }),
            ),
            completed_tool(
                "search-home",
                "lyra_lumen",
                turn_id,
                Some("/tools/browser/read"),
                "Search home",
                json!({
                    "pageKind": "search-home",
                    "url": "https://example.com",
                }),
            ),
            completed_tool(
                "browser-navigate",
                "lyra_lumen",
                turn_id,
                Some("/tools/browser/navigate"),
                "Navigated to https://example.com/product.",
                json!({
                    "url": "https://example.com/product",
                }),
            ),
            completed_tool(
                "degraded-browser-read",
                "lyra_lumen",
                turn_id,
                Some("/tools/browser/read"),
                "Fallback browser read.",
                json!({
                    "degraded": true,
                    "url": "https://example.com/product",
                    "content": "Fallback browser read.",
                }),
            ),
            completed_tool(
                "source-read",
                READ_FILE_MODEL_TOOL,
                turn_id,
                None,
                "real source",
                json!({ "bytes": 128 }),
            ),
            completed_tool(
                "browser-page",
                "lyra_lumen",
                turn_id,
                Some("/tools/browser/read"),
                "Rendered product page with account controls.",
                json!({
                    "pageKind": "page",
                    "url": "https://example.com/product",
                }),
            ),
        ]);

        assert_eq!(
            current_plan_investigation_evidence_ids(&session, turn_id),
            vec!["source-read".to_string(), "browser-page".to_string()]
        );
    }

    #[test]
    fn completion_gate_requires_a_latest_successful_verification() {
        let turn_id = "turn-completion-verification";
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
        assert_eq!(
            validate_completion_evidence(&session, turn_id, &[], &[])
                .unwrap_err()
                .code,
            "completion_verification_required"
        );

        session.snapshot["tools"]
            .as_array_mut()
            .expect("tools")
            .push(completed_tool(
                "failed-test",
                EXEC_COMMAND_MODEL_TOOL,
                turn_id,
                None,
                "test failed",
                json!({
                    "success": false,
                    "commandKind": "test",
                    "stdout": "1 failed",
                }),
            ));
        assert_eq!(
            validate_completion_evidence(&session, turn_id, &[], &[])
                .unwrap_err()
                .code,
            "completion_verification_failed"
        );

        session.snapshot["tools"]
            .as_array_mut()
            .expect("tools")
            .push(completed_tool(
                "passed-test",
                EXEC_COMMAND_MODEL_TOOL,
                turn_id,
                None,
                "test passed",
                json!({
                    "success": true,
                    "commandKind": "test",
                    "stdout": "1 passed",
                }),
            ));
        let audit =
            validate_completion_evidence(&session, turn_id, &[], &[]).expect("verification pass");
        assert_eq!(audit["verificationToolId"], "passed-test");
    }

    #[test]
    fn ui_completion_requires_current_source_desktop_narrow_and_screenshots() {
        let turn_id = "turn-ui-audit";
        let mut session = new_session(None, None, "normal");
        session.snapshot["projectTodo"] = json!({
            "status": "running",
            "todos": [{
                "id": "ui",
                "content": "Update UI",
                "status": "completed",
                "evidenceIds": ["passed-test"],
            }]
        });
        session.snapshot["tools"] = json!([
            completed_tool(
                "ui-edit",
                "file",
                turn_id,
                None,
                "Edited UI",
                json!({
                    "changedFiles": [{
                        "path": "apps/desktop/src/renderer/styles/app.css",
                    }],
                }),
            ),
            completed_tool(
                "passed-test",
                EXEC_COMMAND_MODEL_TOOL,
                turn_id,
                None,
                "test passed",
                json!({
                    "success": true,
                    "commandKind": "test",
                    "stdout": "1 passed",
                }),
            ),
        ]);
        let source = json!({
            "id": "audit-source",
            "mode": "source",
            "status": "clean",
            "summary": { "scanned": 1 },
            "scope": { "path": "." },
            "mutationToolId": "ui-edit",
            "turnId": turn_id,
        });
        let desktop = json!({
            "id": "audit-desktop",
            "mode": "rendered",
            "status": "clean",
            "summary": { "scanned": 20 },
            "scope": {
                "url": "https://example.com/app",
                "viewport": { "width": 1440, "height": 900 },
            },
            "screenshotArtifactRef": { "id": "desktop-shot" },
            "mutationToolId": "ui-edit",
            "turnId": turn_id,
        });
        let narrow = json!({
            "id": "audit-narrow",
            "mode": "rendered",
            "status": "clean",
            "summary": { "scanned": 12 },
            "scope": {
                "url": "https://example.com/app",
                "viewport": { "width": 390, "height": 844 },
            },
            "screenshotArtifactRef": { "id": "narrow-shot" },
            "mutationToolId": "ui-edit",
            "turnId": turn_id,
        });

        session.snapshot["designQualityGate"] = json!({
            "audits": [source.clone(), desktop.clone()]
        });
        assert_eq!(
            validate_todo_completion_contract(&session, turn_id, &[])
                .unwrap_err()
                .code,
            "design_rendered_audits_required"
        );

        let mut missing_screenshot = narrow.clone();
        missing_screenshot["screenshotArtifactRef"] = Value::Null;
        session.snapshot["designQualityGate"] = json!({
            "audits": [source.clone(), desktop.clone(), missing_screenshot]
        });
        assert_eq!(
            validate_todo_completion_contract(&session, turn_id, &[])
                .unwrap_err()
                .code,
            "design_visual_inspection_required"
        );

        session.snapshot["designQualityGate"] = json!({
            "audits": [source.clone(), desktop.clone(), narrow.clone()]
        });
        let audit =
            validate_todo_completion_contract(&session, turn_id, &[]).expect("complete UI audit");
        assert_eq!(audit["verificationRequired"], "ui");

        let mut file_desktop = desktop.clone();
        file_desktop["scope"]["url"] = Value::String("file:///tmp/index.html".to_string());
        let mut file_narrow = narrow.clone();
        file_narrow["scope"]["url"] = Value::String("file:///tmp/index.html".to_string());
        session.snapshot["designQualityGate"] = json!({
            "audits": [source.clone(), file_desktop, file_narrow]
        });
        assert!(
            validate_todo_completion_contract(&session, turn_id, &[]).is_ok(),
            "trusted local rendered audits are real screenshot evidence"
        );

        let mut blocked_narrow = narrow;
        blocked_narrow["blockingFindings"] = json!([{ "ruleId": "layout.overlap" }]);
        session.snapshot["designQualityGate"] = json!({
            "audits": [source, desktop, blocked_narrow]
        });
        assert_eq!(
            validate_todo_completion_contract(&session, turn_id, &[])
                .unwrap_err()
                .code,
            "design_findings_need_review"
        );
        assert!(
            validate_todo_completion_contract(
                &session,
                turn_id,
                &[json!({
                    "ruleId": "layout.overlap",
                    "disposition": "retained",
                    "evidenceIds": ["passed-test"],
                })],
            )
            .is_ok()
        );
    }
}
