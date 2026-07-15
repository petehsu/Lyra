use super::*;

pub(crate) fn delivery_intent_for_turn(
    session: &NativeSession,
    turn_id: &str,
) -> Result<&'static str, NativeToolFailure> {
    let contract = require_task_contract(session, turn_id)?.contract;
    Ok(match contract.constraints.maturity.value {
        Maturity::Demo => "demo",
        Maturity::Prototype => "prototype",
        Maturity::Production | Maturity::Unspecified => "production",
    })
}

pub(crate) fn single_file_explicit_for_turn(
    session: &NativeSession,
    turn_id: &str,
) -> Result<bool, NativeToolFailure> {
    Ok(require_task_contract(session, turn_id)?
        .contract
        .constraints
        .architecture
        .value
        == Architecture::SingleFile)
}

pub(crate) fn is_major_ui_contract(contract: &TaskContract) -> bool {
    contract.scope == TaskScope::Major
        && contract.surfaces.iter().any(|surface| {
            matches!(
                surface,
                TaskSurface::Ui | TaskSurface::Ux | TaskSurface::Web
            )
        })
}

fn is_ui_contract(contract: &TaskContract) -> bool {
    contract.surfaces.iter().any(|surface| {
        matches!(
            surface,
            TaskSurface::Ui | TaskSurface::Ux | TaskSurface::Web
        )
    })
}

pub(crate) fn validate_plan_execution_contract(
    session: &NativeSession,
    turn_id: &str,
    execution_contract: &Value,
) -> Result<(), NativeToolFailure> {
    let task_contract = require_task_contract(session, turn_id)?.contract;
    if !has_investigation_evidence(session, Some(turn_id)) {
        return Err(NativeToolFailure::new(
            "plan_missing_reference_evidence",
            "A plan cannot be finalized before substantive investigation or reference review.",
            "Inspect the real workspace, product, documentation, or external references, then retry with their evidence ids.",
        ));
    }
    let reference_ids = required_string_array(
        execution_contract,
        "referenceEvidenceIds",
        "plan_reference_evidence_required",
    )?;
    validate_evidence_ids(session, &reference_ids)?;
    required_non_empty_array(
        execution_contract,
        "architectureResponsibilities",
        "plan_architecture_responsibilities_required",
    )?;
    required_non_empty_array(
        execution_contract,
        "acceptanceCriteria",
        "plan_acceptance_criteria_required",
    )?;
    required_non_empty_array(
        execution_contract,
        "verificationSteps",
        "plan_verification_steps_required",
    )?;
    if !execution_contract
        .get("unknowns")
        .is_some_and(Value::is_array)
    {
        return Err(NativeToolFailure::new(
            "plan_unknowns_required",
            "The structured plan contract must include an unknowns array, even when it is empty.",
            "Retry plan_finalize with executionContract.unknowns.",
        ));
    }
    if is_ui_contract(&task_contract) && !has_design_reference_evidence(session, Some(turn_id)) {
        return Err(NativeToolFailure::new(
            "design_reference_required",
            "UI plans require a successful real or curated design reference before review.",
            "Inspect the existing interface/source or use a browser/design reference tool, then include that evidence id.",
        ));
    }
    Ok(())
}

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
    }
    .and_then(|_| lock_task_contract_for_side_effect(session_id, turn_id, "artifact_mutation"));
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
    lock_task_contract_for_side_effect(session_id, turn_id, "artifact_mutation")?;
    Ok(())
}

pub(crate) fn validate_final_response_for_session(
    session_id: &str,
    turn_id: &str,
) -> Result<(), NativeToolFailure> {
    let state = state().lock().map_err(|_| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            "agent runtime state lock failed",
            "Retry the response after runtime state is available.",
        )
    })?;
    let session = state.sessions.get(session_id).ok_or_else(|| {
        NativeToolFailure::new(
            "session_not_found",
            format!("session not found: {session_id}"),
            "Retry in an active session.",
        )
    })?;
    validate_final_response_contract(session, turn_id)
}

pub(crate) fn validate_todo_completion_contract(
    session: &NativeSession,
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
                Some("completed" | "skipped" | "cancelled")
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
            "Update each todo with its real terminal status and evidence before calling todo_finish.",
        ));
    }
    let missing_evidence = todos
        .iter()
        .filter(|todo| todo.get("status").and_then(Value::as_str) == Some("completed"))
        .filter(|todo| {
            todo.get("evidence")
                .and_then(Value::as_str)
                .is_none_or(|value| value.trim().is_empty())
        })
        .filter_map(|todo| todo.get("id").and_then(Value::as_str))
        .collect::<Vec<_>>();
    if !missing_evidence.is_empty() {
        return Err(NativeToolFailure::new(
            "todo_evidence_required",
            format!(
                "Completed todo items are missing verification evidence: {}.",
                missing_evidence.join(", ")
            ),
            "Attach concise evidence from files, tools, tests, or rendered inspection to each completed todo.",
        ));
    }

    let contract = session
        .snapshot
        .pointer("/plan/taskContract")
        .cloned()
        .and_then(|value| serde_json::from_value::<TaskContract>(value).ok());
    if !contract.as_ref().is_some_and(is_major_ui_contract) {
        return Ok(json!({
            "kind": "completion_audit",
            "mode": "general",
            "todoEvidenceCount": todos.len(),
        }));
    }
    validate_design_completion(
        session,
        &todos,
        design_finding_dispositions,
        contract.as_ref().expect("checked"),
    )
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

fn validate_design_completion(
    session: &NativeSession,
    todos: &[Value],
    design_finding_dispositions: &[Value],
    contract: &TaskContract,
) -> Result<Value, NativeToolFailure> {
    let latest_mutation = latest_completed_mutation_id(session);
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
                || (latest_mutation.is_none()
                    && audit.get("mutationToolId").is_none_or(Value::is_null))
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
            "Major UI work requires a source audit after the latest file mutation.",
            "Run /tools/design/quality with action=audit_source after the final edit.",
        ));
    }
    if desktop.is_none() || narrow.is_none() {
        return Err(NativeToolFailure::new(
            "design_rendered_audits_required",
            "Major UI work requires rendered audits at desktop and narrow/mobile viewports after the latest mutation.",
            "Run audit_rendered with explicit desktop and narrow viewport widths; include a screenshot for actual visual inspection.",
        ));
    }
    let required_audits = [source, desktop, narrow]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    if required_audits.iter().any(|audit| {
        audit.get("status").and_then(Value::as_str) == Some("degraded")
            || audit.get("status").is_none()
    }) {
        return Err(NativeToolFailure::new(
            "design_audit_degraded",
            "A required design audit is degraded and cannot support a completion claim.",
            "Restore the browser/render capability and rerun the required audit.",
        ));
    }
    if ![desktop, narrow].into_iter().flatten().any(|audit| {
        audit
            .get("screenshotArtifactRef")
            .is_some_and(|value| !value.is_null())
    }) {
        return Err(NativeToolFailure::new(
            "design_visual_inspection_required",
            "Rendered DOM checks do not prove visual completion without an actual rendered image.",
            "Rerun at least one audit_rendered call with includeScreenshot=true and inspect the result.",
        ));
    }

    let demo = matches!(
        contract.constraints.maturity.value,
        Maturity::Demo | Maturity::Prototype
    );
    let single_file = contract.constraints.architecture.value == Architecture::SingleFile;
    let mut blockers = required_audits
        .iter()
        .flat_map(|audit| {
            audit
                .get("blockingFindings")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter(|finding| {
            let rule = finding
                .get("ruleId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            !((demo && rule == "intent.placeholder_or_dead_action")
                || ((demo || single_file) && rule == "components.monolithic_page"))
        })
        .cloned()
        .collect::<Vec<_>>();
    let mut seen_rules = HashSet::new();
    blockers.retain(|finding| {
        finding
            .get("ruleId")
            .and_then(Value::as_str)
            .is_none_or(|rule_id| seen_rules.insert(rule_id.to_string()))
    });
    let unresolved = blockers
        .iter()
        .filter(|finding| {
            let rule_id = finding
                .get("ruleId")
                .and_then(Value::as_str)
                .unwrap_or_default();
            !design_finding_dispositions
                .iter()
                .any(|disposition| valid_design_disposition(session, disposition, rule_id))
        })
        .cloned()
        .collect::<Vec<_>>();
    if !unresolved.is_empty() {
        return Err(NativeToolFailure::new(
            "design_findings_need_review",
            format!(
                "High-severity, high-confidence design findings remain without a structured evidence disposition: {}.",
                unresolved
                    .iter()
                    .filter_map(|finding| finding.get("ruleId").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            "Fix and rerun the audit, or provide retained/ignored dispositions with an enum basis and valid evidence ids.",
        ));
    }

    Ok(json!({
        "kind": "completion_audit",
        "mode": "major_ui",
        "maturity": contract.constraints.maturity.value,
        "architecture": contract.constraints.architecture.value,
        "mutationToolId": latest_mutation,
        "sourceAudit": source,
        "desktopAudit": desktop,
        "narrowAudit": narrow,
        "reviewedHighConfidenceFindings": blockers,
        "designFindingDispositions": design_finding_dispositions,
        "todoEvidenceCount": todos.len(),
    }))
}

fn validate_artifact_mutation_contract(
    session: &NativeSession,
    turn_id: &str,
) -> Result<(), NativeToolFailure> {
    let contract = require_task_contract(session, turn_id)?.contract;
    if !contract.action.permits_artifact_mutation() {
        return Err(NativeToolFailure::new(
            "task_contract_action_disallows_mutation",
            format!(
                "Task Contract action `{:?}` does not authorize artifact mutation.",
                contract.action
            ),
            "Report a corrected contract on a new user turn or use read-only inspection tools.",
        ));
    }
    if contract.ambiguity.level == AmbiguityLevel::Blocking {
        return Err(NativeToolFailure::new(
            "task_contract_blocking_ambiguity",
            "Artifact mutation is blocked because the Task Contract records unresolved blocking ambiguity.",
            "Ask for structured clarification or inspect first when canInspectBeforeClarifying is true.",
        ));
    }
    let approved_execution = has_approved_execution_scope(session);
    if !approved_execution && !has_investigation_evidence(session, Some(turn_id)) {
        return Err(NativeToolFailure::new(
            "investigation_required_before_mutation",
            "Production artifacts cannot be changed before inspecting substantive real evidence for the current task.",
            "Read or search the real workspace, product, documentation, or reference implementation first; a directory listing is not enough.",
        ));
    }
    if is_ui_contract(&contract)
        && !approved_execution
        && !has_design_reference_evidence(session, Some(turn_id))
    {
        return Err(NativeToolFailure::new(
            "design_reference_required_before_mutation",
            "UI artifacts cannot be changed before inspecting the real product or a successful real/curated design reference.",
            "Inspect the existing UI/source or use browser/design reference tools, then implement from that evidence.",
        ));
    }
    if is_major_ui_contract(&contract) && !approved_execution {
        return Err(NativeToolFailure::new(
            "major_ui_plan_required",
            "Major UI work cannot mutate production artifacts before an approved implementation plan or authorized Oma work package.",
            "Create and approve a structured plan grounded in inspected product/reference evidence before implementation.",
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
    let bound = task_contract_for_turn(session, turn_id);
    if phase == Some(PLAN_PHASE_EXECUTING_TODO)
        && session
            .snapshot
            .pointer("/projectTodo/status")
            .and_then(Value::as_str)
            != Some("completed")
        && session
            .snapshot
            .pointer("/oma/executingWorkPackageId")
            .is_none()
        && !bound
            .as_ref()
            .is_ok_and(|bound| bound.contract.action == TaskAction::Control)
    {
        return Err(NativeToolFailure::new(
            "todo_finish_required_before_final",
            "The assistant cannot declare completion while the approved todo list is still executing.",
            "Continue the real work, update every todo with evidence, and call todo_finish before the final response.",
        ));
    }

    let bound = match bound {
        Ok(bound) => bound,
        Err(_) if phase.is_none() && !has_investigation_evidence(session, Some(turn_id)) => {
            return Ok(());
        }
        Err(error) => return Err(error),
    };
    let contract = bound.contract;
    if contract.ambiguity.level == AmbiguityLevel::Blocking
        && !has_completed_clarification(session, turn_id)
    {
        return Err(NativeToolFailure::new(
            "clarification_required_before_final",
            "The Task Contract records blocking ambiguity that has not been resolved.",
            "Call lyra_clarification_ask with one concise structured question.",
        ));
    }
    if contract.action == TaskAction::Plan && !completed_plan_in_turn(session, turn_id) {
        return Err(NativeToolFailure::new(
            "plan_finalize_required_before_final",
            "A planning task cannot finish before the current turn finalizes a structured plan for review.",
            "Continue with investigation or reference tools as needed, then call plan_begin, plan_write, and plan_finalize.",
        ));
    }
    if !contract.action.requires_workspace_evidence() {
        return Ok(());
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
    if is_ui_contract(&contract)
        && !inherited_evidence
        && !has_design_reference_evidence(session, Some(turn_id))
    {
        return Err(NativeToolFailure::new(
            "design_reference_required_before_final",
            "A UI/UX conclusion cannot be finalized without inspecting the real interface/source or a successful real/curated design reference.",
            "Inspect the actual UI or frontend source, or use browser/design reference tools.",
        ));
    }
    if is_major_ui_contract(&contract)
        && contract.action.permits_artifact_mutation()
        && !inherited_evidence
    {
        return Err(NativeToolFailure::new(
            "major_ui_plan_required_before_final",
            "Major UI implementation requires an approved Solo Plan or authorized Oma work package.",
            "Create a production plan grounded in real product facts and references, request approval, then implement and verify it.",
        ));
    }
    if is_ui_contract(&contract)
        && contract.scope == TaskScope::Local
        && contract.action.permits_artifact_mutation()
    {
        validate_local_ui_completion(session)?;
    }
    Ok(())
}

fn validate_local_ui_completion(session: &NativeSession) -> Result<(), NativeToolFailure> {
    let Some(latest_mutation) = latest_completed_mutation_id(session) else {
        return Ok(());
    };
    let rendered = session
        .snapshot
        .pointer("/designQualityGate/audits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .rev()
        .find(|audit| {
            audit.get("mode").and_then(Value::as_str) == Some("rendered")
                && audit.get("mutationToolId").and_then(Value::as_str)
                    == Some(latest_mutation.as_str())
        });
    let Some(rendered) = rendered else {
        return Err(NativeToolFailure::new(
            "local_ui_rendered_audit_required",
            "A local UI change cannot be finalized without a targeted rendered audit after the latest mutation.",
            "Run /tools/design/quality with action=audit_rendered against the affected route and state.",
        ));
    };
    if rendered.get("status").and_then(Value::as_str) == Some("degraded")
        || rendered.get("status").is_none()
    {
        return Err(NativeToolFailure::new(
            "local_ui_rendered_audit_degraded",
            "The targeted rendered audit is degraded and cannot support a UI completion claim.",
            "Restore the render/browser capability and rerun the audit.",
        ));
    }
    if rendered
        .get("screenshotArtifactRef")
        .is_none_or(Value::is_null)
    {
        return Err(NativeToolFailure::new(
            "local_ui_visual_inspection_required",
            "A rendered DOM report without an actual image does not prove the local UI fix.",
            "Rerun audit_rendered with includeScreenshot=true and inspect the resulting image.",
        ));
    }
    if rendered
        .get("blockingFindings")
        .and_then(Value::as_array)
        .is_some_and(|findings| !findings.is_empty())
    {
        return Err(NativeToolFailure::new(
            "local_ui_findings_unresolved",
            "The latest rendered audit still contains high-confidence blocking findings.",
            "Fix the findings and rerun the rendered audit.",
        ));
    }
    Ok(())
}

fn has_completed_clarification(session: &NativeSession, turn_id: &str) -> bool {
    session_tools(session).iter().rev().any(|tool| {
        tool_matches_turn(tool, Some(turn_id))
            && successful_tool(tool)
            && tool.get("name").and_then(Value::as_str) == Some(LYRA_CLARIFICATION_ASK_TOOL)
    })
}

fn completed_plan_in_turn(session: &NativeSession, turn_id: &str) -> bool {
    session_tools(session).iter().rev().any(|tool| {
        tool_matches_turn(tool, Some(turn_id))
            && successful_tool(tool)
            && tool.get("name").and_then(Value::as_str) == Some(PLAN_FINALIZE_MODEL_TOOL)
    })
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

fn has_investigation_evidence(session: &NativeSession, turn_id: Option<&str>) -> bool {
    session_tools(session).iter().any(|tool| {
        tool_matches_turn(tool, turn_id)
            && successful_tool(tool)
            && investigation_tool(tool)
            && tool_has_substantive_evidence(tool)
    })
}

fn has_design_reference_evidence(session: &NativeSession, turn_id: Option<&str>) -> bool {
    session_tools(session).iter().any(|tool| {
        tool_matches_turn(tool, turn_id)
            && successful_tool(tool)
            && tool_has_substantive_evidence(tool)
            && (design_reference_tool(tool) || source_reference_tool(tool))
    })
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
    matches!(
        tool.get("status").and_then(Value::as_str),
        Some("completed" | "success")
    ) && tool.pointer("/output/error").is_none_or(Value::is_null)
        && tool.pointer("/output/raw/ok").and_then(Value::as_bool) != Some(false)
}

fn tool_has_substantive_evidence(tool: &Value) -> bool {
    let output = tool.get("output").unwrap_or(&Value::Null);
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
            Value::String(text) if !text.trim().is_empty() => return true,
            Value::Array(items) if !items.is_empty() => return true,
            Value::Object(object) if !object.is_empty() => return true,
            Value::Number(_) | Value::Bool(_) => return true,
            _ => {}
        }
    }
    false
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

fn source_reference_tool(tool: &Value) -> bool {
    let name = tool.get("name").and_then(Value::as_str).unwrap_or_default();
    (matches!(name, READ_FILE_MODEL_TOOL | GREP_MODEL_TOOL)
        || matches!(
            tool_path(tool),
            "/tools/filesystem/read_file"
                | "/tools/filesystem/grep"
                | "/tools/code/search_text"
                | "/tools/code/grep_text"
                | "/tools/code/search_symbol"
        ))
        && tool_has_frontend_path_evidence(tool)
}

fn tool_has_frontend_path_evidence(tool: &Value) -> bool {
    [
        "/input/path",
        "/input/glob",
        "/output/raw/path",
        "/output/raw/file",
    ]
    .iter()
    .filter_map(|pointer| tool.pointer(pointer).and_then(Value::as_str))
    .any(|path| {
        Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
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
                )
            })
    })
}

fn design_reference_tool(tool: &Value) -> bool {
    let path = tool_path(tool);
    path == "/tools/design/reference"
        || path == "/tools/design/extract_reference"
        || path.starts_with("/tools/browser/")
        || path.starts_with("/tools/web/")
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

fn viewport_width(audit: &Value) -> u64 {
    audit
        .pointer("/scope/viewport/width")
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

fn required_string_array(
    value: &Value,
    key: &str,
    code: &str,
) -> Result<Vec<String>, NativeToolFailure> {
    let values = value
        .get(key)
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if values.is_empty() {
        return Err(NativeToolFailure::new(
            code,
            format!("executionContract.{key} must be a non-empty string array."),
            "Retry plan_finalize with structured evidence ids.",
        ));
    }
    Ok(values)
}

fn required_non_empty_array(value: &Value, key: &str, code: &str) -> Result<(), NativeToolFailure> {
    if value
        .get(key)
        .and_then(Value::as_array)
        .is_some_and(|values| !values.is_empty())
    {
        return Ok(());
    }
    Err(NativeToolFailure::new(
        code,
        format!("executionContract.{key} must be a non-empty array."),
        "Retry plan_finalize with the missing structured plan metadata.",
    ))
}

fn validate_evidence_ids(session: &NativeSession, ids: &[String]) -> Result<(), NativeToolFailure> {
    let missing = ids
        .iter()
        .filter(|id| !evidence_id_exists(session, id))
        .cloned()
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(NativeToolFailure::new(
            "plan_evidence_id_not_found",
            format!(
                "Structured plan evidence ids were not found in the session: {}.",
                missing.join(", ")
            ),
            "Use ids from successful tool activities, citations, attachments, or design audits.",
        ))
    }
}

fn valid_design_disposition(session: &NativeSession, value: &Value, rule_id: &str) -> bool {
    value.get("ruleId").and_then(Value::as_str) == Some(rule_id)
        && matches!(
            value.get("disposition").and_then(Value::as_str),
            Some("retained" | "ignored")
        )
        && matches!(
            value.get("basis").and_then(Value::as_str),
            Some("user_requirement" | "existing_system" | "reference" | "verified_exception")
        )
        && value
            .get("evidenceIds")
            .and_then(Value::as_array)
            .is_some_and(|ids| {
                !ids.is_empty()
                    && ids.iter().all(|id| {
                        id.as_str()
                            .is_some_and(|id| evidence_id_exists(session, id))
                    })
            })
}

fn evidence_id_exists(session: &NativeSession, id: &str) -> bool {
    session_tools(session)
        .iter()
        .filter(|tool| successful_tool(tool))
        .any(|tool| tool.get("id").and_then(Value::as_str) == Some(id))
        || session
            .snapshot
            .pointer("/designQualityGate/audits")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|audit| {
                audit.get("id").and_then(Value::as_str) == Some(id)
                    || audit.get("screenshotArtifactRef").and_then(Value::as_str) == Some(id)
            })
        || session
            .snapshot
            .get("messages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|message| json_contains_reference(message, id))
}

fn json_contains_reference(value: &Value, id: &str) -> bool {
    match value {
        Value::Array(values) => values
            .iter()
            .any(|value| json_contains_reference(value, id)),
        Value::Object(object) => object.iter().any(|(key, value)| {
            ((key == "id" || key.ends_with("Id") || key.ends_with("Ref") || key.ends_with("RefId"))
                && value.as_str() == Some(id))
                || json_contains_reference(value, id)
        }),
        _ => false,
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

    fn task_contract(action: &str, surfaces: &[&str], scope: &str) -> Value {
        json!({
            "action": action,
            "surfaces": surfaces,
            "scope": scope,
            "targets": [],
            "constraints": {
                "maturity": { "value": "production", "authority": "unspecified", "evidence": [] },
                "architecture": { "value": "standard", "authority": "unspecified", "evidence": [] },
                "visualChoices": [],
                "delegatedDecisions": false
            },
            "ambiguity": { "level": "none", "missing": [], "canInspectBeforeClarifying": true },
            "relation": { "kind": "new" },
            "confidence": "high"
        })
    }

    #[test]
    fn major_ui_depends_only_on_structured_contract() {
        for text in [
            "重做官网",
            "Redesign the website",
            "ウェブサイトを再設計",
            "웹사이트를 다시 디자인",
            "أعد تصميم الموقع",
            "Rediseña el sitio",
        ] {
            let _ = text;
            let contract: TaskContract =
                serde_json::from_value(task_contract("implement", &["ui"], "major")).unwrap();
            assert!(is_major_ui_contract(&contract));
        }
    }

    #[test]
    fn source_reference_uses_file_syntax_not_natural_language() {
        let tool = json!({
            "name": "read_file",
            "status": "completed",
            "input": { "path": "src/view.tsx" },
            "output": { "content": "export function View() {}" }
        });
        assert!(source_reference_tool(&tool));
    }

    #[test]
    fn investigated_final_response_requires_current_message_contract() {
        let mut session = new_session(None, None, "normal");
        let turn_id = "turn-final-contract";
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

        session.snapshot["tools"] = json!([{
            "id": "tool-read",
            "name": "read_file",
            "status": "completed",
            "input": {
                "path": "Cargo.toml",
                "turnId": turn_id
            },
            "output": { "content": "workspace manifest inspected" }
        }]);
        assert_eq!(
            validate_final_response_contract(&session, turn_id)
                .unwrap_err()
                .code,
            "task_contract_missing"
        );
    }

    #[test]
    fn plan_action_requires_successful_finalize_in_current_turn() {
        let mut session = new_session(None, None, "normal");
        let turn_id = "turn-plan-contract";
        let mut message = user_message("Plan the change".to_string(), Vec::new(), now());
        let message_id = message["id"].as_str().unwrap().to_string();
        message["metadata"] = json!({
            "taskContract": {
                "contract": task_contract("plan", &["code"], "major"),
                "locked": true
            }
        });
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
            "output": { "content": "workspace manifest inspected" }
        }]);

        assert_eq!(
            validate_final_response_contract(&session, turn_id)
                .unwrap_err()
                .code,
            "plan_finalize_required_before_final"
        );

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
}
