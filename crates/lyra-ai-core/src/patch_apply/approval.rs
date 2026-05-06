use super::*;

pub fn resolve_agent_approval(
    request: AgentResolveApprovalRequest,
) -> Result<AgentResolveApprovalResult> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let session_id = request.session_id.as_str().trim().to_string();
    if session_id.is_empty() {
        return Err(anyhow!("sessionId is required"));
    }
    let approval_ticket_id = request.approval_ticket_id.as_str().trim().to_string();
    if approval_ticket_id.is_empty() {
        return Err(anyhow!("approvalTicketId is required"));
    }
    let ticket = store
        .read_approval_ticket_detail(&session_id, &approval_ticket_id)?
        .ok_or_else(|| anyhow!("approval ticket not found: {approval_ticket_id}"))?;
    if ticket.status != "pending_user" {
        return Err(tool_error(
            TOOL_APPROVAL_NOT_PENDING,
            format!("approval ticket is not pending: {}", ticket.status),
        ));
    }

    match request.decision {
        ApprovalDecision::Approve => approve_approval(&store, &session_id, ticket),
        ApprovalDecision::Deny => deny_approval(&store, &session_id, ticket),
    }
}

pub(super) fn approve_approval(
    store: &AiStore,
    session_id: &str,
    ticket: crate::storage::ApprovalTicketDetailRecord,
) -> Result<AgentResolveApprovalResult> {
    let tool_path = approval_tool_path(&ticket)?;
    match tool_path.as_str() {
        TOOL_FS_APPLY_PATCH => approve_apply_approval(store, session_id, ticket),
        TOOL_FS_ROLLBACK_PATCH => approve_rollback_approval(store, session_id, ticket),
        TOOL_SHELL_RUN_COMMAND => approve_run_command_approval(store, session_id, ticket),
        _ => Err(tool_error(
            TOOL_APPROVAL_UNSUPPORTED,
            format!("approval is not supported for {tool_path}"),
        )),
    }
}

pub(super) fn approve_run_command_approval(
    store: &AiStore,
    session_id: &str,
    ticket: crate::storage::ApprovalTicketDetailRecord,
) -> Result<AgentResolveApprovalResult> {
    let context = workspace_context_for_session(store, session_id)?;
    let turn_id = ticket.runtime_turn_id.clone();
    let (operation, result) =
        shell::approve_run_command_ticket(store, session_id, &context, &ticket)?;
    let event_type = if result.status == ToolResultStatus::Completed {
        "tool_operation_completed"
    } else {
        "tool_operation_failed"
    };
    let result = append_result_and_emit_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        &operation,
        TOOL_SHELL_RUN_COMMAND,
        result,
        event_type,
    )?;
    emit_approval_resolved_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        "approve",
        "approved",
        &operation.path,
        result
            .metadata
            .as_ref()
            .cloned()
            .unwrap_or_else(|| json!({})),
    )?;
    let metadata = result.metadata.as_ref().unwrap_or(&Value::Null);
    Ok(AgentResolveApprovalResult {
        session_id: session_id.to_string(),
        approval_ticket_id: ticket.approval_ticket_id,
        status: "approved".to_string(),
        detail: "Command executed".to_string(),
        tool_path: TOOL_SHELL_RUN_COMMAND.to_string(),
        artifact_id: metadata
            .get("artifactId")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        evidence_id: metadata
            .get("evidenceId")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        patch_ref: None,
        changed_files: Vec::new(),
    })
}

pub(super) fn approve_apply_approval(
    store: &AiStore,
    session_id: &str,
    ticket: crate::storage::ApprovalTicketDetailRecord,
) -> Result<AgentResolveApprovalResult> {
    let context = workspace_context_for_session(store, session_id)?;
    let args = apply_args_from_requested_action(&ticket.requested_action)?;
    let op_id = approval_operation_id(&ticket);
    let operation = apply_operation(&op_id, &args);
    let prepared = prepare_patch_apply(store, session_id, &context, &args)?;
    let turn_id = ticket.runtime_turn_id.clone();
    emit_apply_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        "tool_operation_started",
        json!({ "operation": operation_payload(&operation) }),
    )?;
    match execute_prepared_apply(
        store,
        session_id,
        &turn_id,
        &operation.op_id,
        prepared,
        ApprovalSource::UserApprovedTicket(ticket.approval_ticket_id.clone()),
    ) {
        Ok(applied) => {
            let content = applied_content("applied", "Patch applied", &applied)?;
            let mut result = ToolResultEnvelope::completed(
                &operation,
                "Applied patch to workspace",
                content,
                false,
            );
            result.metadata = Some(applied_metadata(&applied));
            let result = append_result_and_emit_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                &operation,
                TOOL_FS_APPLY_PATCH,
                result,
                "tool_operation_completed",
            )?;
            emit_approval_resolved_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                "approve",
                "approved",
                &operation.path,
                result
                    .metadata
                    .as_ref()
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )?;
            Ok(AgentResolveApprovalResult {
                session_id: session_id.to_string(),
                approval_ticket_id: applied.approval_ticket_id,
                status: "approved".to_string(),
                detail: "Patch applied".to_string(),
                tool_path: TOOL_FS_APPLY_PATCH.to_string(),
                artifact_id: Some(applied.artifact_id),
                evidence_id: Some(applied.evidence_id),
                patch_ref: Some(applied.patch_ref),
                changed_files: applied.changed_files,
            })
        }
        Err(error) => {
            let error_code = tool_error_code(&error, TOOL_PATCH_INVALID);
            let result = ToolResultEnvelope::failed(&operation, error_code, error.to_string());
            append_result_and_emit_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                &operation,
                TOOL_FS_APPLY_PATCH,
                result,
                "tool_operation_failed",
            )?;
            Err(error)
        }
    }
}

pub(super) fn approve_rollback_approval(
    store: &AiStore,
    session_id: &str,
    ticket: crate::storage::ApprovalTicketDetailRecord,
) -> Result<AgentResolveApprovalResult> {
    let context = workspace_context_for_session(store, session_id)?;
    let args = rollback_args_from_requested_action(&ticket.requested_action)?;
    let op_id = approval_operation_id(&ticket);
    let operation = rollback_operation_for_args(&op_id, &args);
    let prepared = prepare_patch_rollback(store, session_id, &args)?;
    let turn_id = ticket.runtime_turn_id.clone();
    emit_apply_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        "tool_operation_started",
        json!({ "operation": operation_payload(&operation) }),
    )?;
    match execute_prepared_rollback(
        store,
        session_id,
        &turn_id,
        &operation.op_id,
        &context,
        prepared,
        ApprovalSource::UserApprovedTicket(ticket.approval_ticket_id.clone()),
    ) {
        Ok(rolled_back) => {
            let content = rollback_content("rolled_back", "Patch rolled back", &rolled_back)?;
            let mut result = ToolResultEnvelope::completed(
                &operation,
                "Rolled back patch from workspace",
                content,
                false,
            );
            result.metadata = Some(rollback_metadata(&rolled_back));
            let result = append_result_and_emit_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                &operation,
                TOOL_FS_ROLLBACK_PATCH,
                result,
                "tool_operation_completed",
            )?;
            emit_approval_resolved_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                "approve",
                "approved",
                &operation.path,
                result
                    .metadata
                    .as_ref()
                    .cloned()
                    .unwrap_or_else(|| json!({})),
            )?;
            Ok(AgentResolveApprovalResult {
                session_id: session_id.to_string(),
                approval_ticket_id: rolled_back.approval_ticket_id,
                status: "approved".to_string(),
                detail: "Patch rolled back".to_string(),
                tool_path: TOOL_FS_ROLLBACK_PATCH.to_string(),
                artifact_id: Some(rolled_back.artifact_id),
                evidence_id: Some(rolled_back.evidence_id),
                patch_ref: Some(rolled_back.patch_ref),
                changed_files: rolled_back.changed_files,
            })
        }
        Err(error) => {
            let error_code = tool_error_code(&error, TOOL_PATCH_INVALID);
            let result = ToolResultEnvelope::failed(&operation, error_code, error.to_string());
            append_result_and_emit_event(
                store,
                session_id,
                Some(turn_id.as_str()),
                &operation,
                TOOL_FS_ROLLBACK_PATCH,
                result,
                "tool_operation_failed",
            )?;
            Err(error)
        }
    }
}

pub(super) fn deny_approval(
    store: &AiStore,
    session_id: &str,
    ticket: crate::storage::ApprovalTicketDetailRecord,
) -> Result<AgentResolveApprovalResult> {
    let tool_path = approval_tool_path(&ticket)?;
    let operation = approval_operation_from_ticket(&ticket, &tool_path)?;
    let turn_id = ticket.runtime_turn_id.clone();
    store.update_approval_ticket_status(
        session_id,
        &ticket.approval_ticket_id,
        "denied",
        "user_denied",
    )?;
    let content = json_string(&json!({
        "status": "denied",
        "detail": "User denied tool approval",
        "approvalTicketId": ticket.approval_ticket_id.clone(),
        "toolPath": tool_path.clone(),
        "artifactId": approval_artifact_id(&ticket),
        "patchRef": approval_patch_ref(&ticket),
        "commandHash": shell::command_hash_from_ticket(&ticket),
    }))?;
    let mut result = ToolResultEnvelope::failed(
        &operation,
        TOOL_APPROVAL_DENIED,
        "User denied tool approval",
    );
    result.content = content;
    result.metadata = Some(json!({
        "kind": "approval_denied",
        "approvalTicketId": ticket.approval_ticket_id.clone(),
        "toolPath": tool_path.clone(),
        "artifactId": approval_artifact_id(&ticket),
        "patchRef": approval_patch_ref(&ticket),
        "commandHash": shell::command_hash_from_ticket(&ticket),
    }));
    let result = append_result_and_emit_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        &operation,
        &tool_path,
        result,
        "tool_operation_failed",
    )?;
    emit_approval_resolved_event(
        store,
        session_id,
        Some(turn_id.as_str()),
        "deny",
        "denied",
        &tool_path,
        result
            .metadata
            .as_ref()
            .cloned()
            .unwrap_or_else(|| json!({})),
    )?;
    Ok(AgentResolveApprovalResult {
        session_id: session_id.to_string(),
        approval_ticket_id: ticket.approval_ticket_id.clone(),
        status: "denied".to_string(),
        detail: "User denied tool approval".to_string(),
        tool_path,
        artifact_id: approval_artifact_id(&ticket),
        evidence_id: None,
        patch_ref: approval_patch_ref(&ticket),
        changed_files: Vec::new(),
    })
}

pub(super) fn workspace_context_for_session(
    store: &AiStore,
    session_id: &str,
) -> Result<ToolExecutionContext> {
    let session = store
        .read_session_index(session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    let workspace_root = session
        .project_root
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("session has no bound workspace root"))?;
    Ok(ToolExecutionContext {
        workspace_root: Some(workspace_root),
    })
}

pub(super) fn approval_tool_path(
    ticket: &crate::storage::ApprovalTicketDetailRecord,
) -> Result<String> {
    ticket
        .requested_action
        .get("toolPath")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("approval ticket requestedAction is missing toolPath"))
}

pub(super) fn approval_operation_id(ticket: &crate::storage::ApprovalTicketDetailRecord) -> String {
    ticket
        .requested_action
        .get("toolOperationId")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .unwrap_or_else(|| new_id("op"))
}

pub(super) fn approval_artifact_id(
    ticket: &crate::storage::ApprovalTicketDetailRecord,
) -> Option<String> {
    ticket
        .requested_action
        .get("artifactId")
        .or_else(|| ticket.requested_action.get("appliedArtifactId"))
        .and_then(Value::as_str)
        .and_then(trim_to_string)
}

pub(super) fn approval_patch_ref(
    ticket: &crate::storage::ApprovalTicketDetailRecord,
) -> Option<String> {
    ticket
        .requested_action
        .get("patchRef")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
}

pub(super) fn apply_args_from_requested_action(requested_action: &Value) -> Result<ApplyPatchArgs> {
    let artifact_id = requested_action
        .get("artifactId")
        .and_then(Value::as_str)
        .and_then(trim_to_string);
    if artifact_id.is_some() {
        return Ok(ApplyPatchArgs {
            artifact_id,
            patch_ref: None,
        });
    }
    let patch_ref = requested_action
        .get("patchRef")
        .and_then(Value::as_str)
        .and_then(trim_to_string);
    if patch_ref.is_some() {
        return Ok(ApplyPatchArgs {
            artifact_id: None,
            patch_ref,
        });
    }
    Err(anyhow!(
        "apply_patch approval is missing artifactId or patchRef"
    ))
}

pub(super) fn rollback_args_from_requested_action(
    requested_action: &Value,
) -> Result<RollbackPatchArgs> {
    let applied_artifact_id = requested_action
        .get("appliedArtifactId")
        .or_else(|| requested_action.get("artifactId"))
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("rollback_patch approval is missing appliedArtifactId"))?;
    Ok(RollbackPatchArgs {
        applied_artifact_id,
    })
}

pub(super) fn approval_operation_from_ticket(
    ticket: &crate::storage::ApprovalTicketDetailRecord,
    tool_path: &str,
) -> Result<ToolOperationEnvelope> {
    let op_id = approval_operation_id(ticket);
    let args = if tool_path == TOOL_FS_APPLY_PATCH {
        let args = apply_args_from_requested_action(&ticket.requested_action)?;
        json!({
            "artifactId": args.artifact_id,
            "patchRef": args.patch_ref,
        })
    } else if tool_path == TOOL_FS_ROLLBACK_PATCH {
        let args = rollback_args_from_requested_action(&ticket.requested_action)?;
        json!({
            "appliedArtifactId": args.applied_artifact_id,
        })
    } else if tool_path == TOOL_SHELL_RUN_COMMAND {
        ticket
            .requested_action
            .get("args")
            .cloned()
            .ok_or_else(|| anyhow!("run_command approval is missing args"))?
    } else {
        ticket.requested_action.clone()
    };
    Ok(ToolOperationEnvelope {
        schema_version: TOOL_SCHEMA_VERSION.to_string(),
        kind: "tool_operation".to_string(),
        op_id,
        op: ToolFsOp::Run,
        path: tool_path.to_string(),
        args,
    })
}
