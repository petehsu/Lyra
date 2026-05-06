use super::*;

pub fn apply_agent_patch(request: AgentApplyPatchRequest) -> Result<AgentApplyPatchResult> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let session_id = request.session_id.as_str().trim().to_string();
    if session_id.is_empty() {
        return Err(anyhow!("sessionId is required"));
    }
    let _permission_mode = normalize_permission_mode(request.permission_mode.as_deref(), None);
    let session = store
        .read_session_index(&session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    let workspace_root = session
        .project_root
        .as_deref()
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("session has no bound workspace root"))?;
    let args = normalize_apply_args(request.artifact_id.as_deref(), request.patch_ref.as_deref())?;
    let operation = apply_operation(new_id("op").as_str(), &args);
    ensure_apply_args_not_denied(&store, &session_id, &args)?;
    let prepared = prepare_patch_apply(
        &store,
        &session_id,
        &ToolExecutionContext {
            workspace_root: Some(workspace_root),
        },
        &args,
    )?;
    ensure_patch_source_not_denied(&store, &session_id, &prepared)?;
    let turn_id = prepared.record.runtime_turn_id.clone();
    emit_apply_event(
        &store,
        &session_id,
        turn_id.as_deref(),
        "tool_operation_started",
        json!({ "operation": operation_payload(&operation) }),
    )?;
    crate::agent_runtime::project_follow_operation_started(
        &store,
        &session_id,
        turn_id.as_deref().unwrap_or_default(),
        &operation,
    )?;
    match execute_prepared_apply(
        &store,
        &session_id,
        turn_id.as_deref().unwrap_or_default(),
        &operation.op_id,
        prepared,
        ApprovalSource::UserApproved,
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
            let blob = store.append_tool_result_blob(
                &session_id,
                turn_id.as_deref().unwrap_or_default(),
                &operation.op_id,
                TOOL_FS_APPLY_PATCH,
                "completed",
                &result.content,
            )?;
            result.result_ref = Some(blob.result_ref.clone());
            crate::agent_runtime::project_follow_operation_finished(
                &store,
                &session_id,
                turn_id.as_deref().unwrap_or_default(),
                &operation,
                &result,
                &blob,
            )?;
            crate::agent_runtime::project_recovery_side_effect(
                &store,
                &session_id,
                turn_id.as_deref().unwrap_or_default(),
                &operation,
                &result,
            )?;
            emit_apply_event(
                &store,
                &session_id,
                turn_id.as_deref(),
                "tool_operation_completed",
                json!({
                    "operation": operation_payload(&operation),
                    "result": result_payload(&result, &blob.result_ref, blob.content_bytes, &blob.content_preview),
                }),
            )?;
            emit_verification_projection_events(&store, &session_id, turn_id.as_deref(), &result)?;
            record_todo_from_patch_result(
                &store,
                &session_id,
                turn_id.as_deref(),
                &operation,
                &result,
            )?;
            store.evaluate_completion_audit_and_delivery_proof(&session_id, turn_id.as_deref())?;
            let detail = store.read_session_detail(&session_id)?;
            emit_completion_projection_events(
                &store,
                &session_id,
                turn_id.as_deref(),
                detail.as_ref(),
            )?;
            Ok(AgentApplyPatchResult {
                session_id,
                turn_id,
                status: "applied".to_string(),
                detail: "Patch applied".to_string(),
                approval_ticket_id: applied.approval_ticket_id,
                artifact_id: applied.artifact_id,
                evidence_id: applied.evidence_id,
                patch_ref: applied.patch_ref,
                changed_files: applied.changed_files,
            })
        }
        Err(error) => {
            let error_code = tool_error_code(&error, TOOL_PATCH_INVALID);
            let result = ToolResultEnvelope::failed(&operation, error_code, error.to_string());
            let blob = store.append_tool_result_blob(
                &session_id,
                turn_id.as_deref().unwrap_or_default(),
                &operation.op_id,
                TOOL_FS_APPLY_PATCH,
                "failed",
                "",
            )?;
            crate::agent_runtime::project_follow_operation_finished(
                &store,
                &session_id,
                turn_id.as_deref().unwrap_or_default(),
                &operation,
                &result,
                &blob,
            )?;
            emit_apply_event(
                &store,
                &session_id,
                turn_id.as_deref(),
                "tool_operation_failed",
                json!({
                    "operation": operation_payload(&operation),
                    "result": result_payload(&result, &blob.result_ref, blob.content_bytes, &blob.content_preview),
                }),
            )?;
            record_todo_from_patch_result(
                &store,
                &session_id,
                turn_id.as_deref(),
                &operation,
                &result,
            )?;
            store.evaluate_completion_audit_and_delivery_proof(&session_id, turn_id.as_deref())?;
            let detail = store.read_session_detail(&session_id)?;
            emit_completion_projection_events(
                &store,
                &session_id,
                turn_id.as_deref(),
                detail.as_ref(),
            )?;
            Err(error)
        }
    }
}

pub fn apply_patch_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> ToolResultEnvelope {
    match apply_patch_tool_result_inner(
        store,
        session_id,
        turn_id,
        context,
        operation,
        permission_mode,
    ) {
        Ok(result) => result,
        Err(error) => ToolResultEnvelope::failed(
            operation,
            tool_error_code(&error, TOOL_PATCH_INVALID),
            error.to_string(),
        ),
    }
}

pub(super) fn apply_patch_tool_result_inner(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> Result<ToolResultEnvelope> {
    let args = parse_args::<ApplyPatchArgs>(&operation.args)?;
    let args = normalize_apply_args(args.artifact_id.as_deref(), args.patch_ref.as_deref())?;
    ensure_apply_args_not_denied(store, session_id, &args)?;
    let prepared = prepare_patch_apply(store, session_id, context, &args)?;
    ensure_patch_source_not_applied(store, session_id, &prepared)?;
    ensure_patch_source_not_denied(store, session_id, &prepared)?;
    if permission_mode == PermissionMode::Sandbox {
        let ticket = match pending_apply_ticket(store, session_id, &prepared)? {
            Some(ticket) => ticket,
            None => create_approval_ticket(
                store,
                session_id,
                turn_id,
                &operation.op_id,
                &prepared,
                "pending_user",
                "user",
            )?,
        };
        let mut result = ToolResultEnvelope::failed(
            operation,
            TOOL_APPROVAL_REQUIRED,
            "User approval is required before applying this patch",
        );
        result.metadata = Some(json!({
            "kind": "patch_apply_approval_required",
            "approvalTicketId": ticket.approval_ticket_id,
            "artifactId": prepared.record.artifact_id,
            "patchRef": prepared.record.content_ref,
            "changedFiles": prepared.plan.changed_files,
        }));
        return Ok(result);
    }
    let applied = execute_prepared_apply(
        store,
        session_id,
        turn_id,
        &operation.op_id,
        prepared,
        ApprovalSource::Model(permission_mode),
    )?;
    let mut result = ToolResultEnvelope::completed(
        operation,
        "Applied patch to workspace",
        applied_content("applied", "Patch applied", &applied)?,
        false,
    );
    result.metadata = Some(applied_metadata(&applied));
    Ok(result)
}

pub(super) fn normalize_apply_args(
    artifact_id: Option<&str>,
    patch_ref: Option<&str>,
) -> Result<ApplyPatchArgs> {
    let artifact_id = artifact_id.and_then(trim_to_string);
    let patch_ref = patch_ref.and_then(trim_to_string);
    if artifact_id.is_some() == patch_ref.is_some() {
        return Err(anyhow!("Provide exactly one of artifactId or patchRef"));
    }
    Ok(ApplyPatchArgs {
        artifact_id,
        patch_ref,
    })
}

pub(super) fn ensure_apply_args_not_denied(
    store: &AiStore,
    session_id: &str,
    args: &ApplyPatchArgs,
) -> Result<()> {
    if store
        .find_denied_approval_for_tool_source(
            session_id,
            TOOL_FS_APPLY_PATCH,
            args.artifact_id.as_deref(),
            args.patch_ref.as_deref(),
        )?
        .is_some()
    {
        return Err(tool_error(
            TOOL_APPROVAL_DENIED,
            "user denied this patch application",
        ));
    }
    Ok(())
}

pub(super) fn prepare_patch_apply(
    store: &AiStore,
    session_id: &str,
    context: &ToolExecutionContext,
    args: &ApplyPatchArgs,
) -> Result<PreparedPatchApply> {
    let record = store
        .read_diff_artifact_blob(
            session_id,
            args.artifact_id.as_deref(),
            args.patch_ref.as_deref(),
        )?
        .ok_or_else(|| anyhow!("AI diff artifact not found"))?;
    if record.status != "created" {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "apply_patch requires a patch proposal artifact",
        ));
    }
    ensure_patch_record_not_applied(store, session_id, &record)?;
    let expected_changed_files: Vec<PatchChangedFile> = record
        .metadata
        .get("changedFiles")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    let plan = plan_patch_apply(context, &record.content, &expected_changed_files)?;
    Ok(PreparedPatchApply { record, plan })
}

pub(super) fn ensure_patch_source_not_applied(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchApply,
) -> Result<()> {
    ensure_patch_record_not_applied(store, session_id, &prepared.record)
}

pub(super) fn ensure_patch_source_not_denied(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchApply,
) -> Result<()> {
    if store
        .find_denied_approval_for_tool_source(
            session_id,
            TOOL_FS_APPLY_PATCH,
            Some(&prepared.record.artifact_id),
            Some(&prepared.record.content_ref),
        )?
        .is_some()
    {
        return Err(tool_error(
            TOOL_APPROVAL_DENIED,
            "user denied this patch application",
        ));
    }
    Ok(())
}

pub(super) fn ensure_patch_record_not_applied(
    store: &AiStore,
    session_id: &str,
    record: &DiffArtifactBlobRecord,
) -> Result<()> {
    if store
        .find_applied_patch_artifact(session_id, &record.artifact_id, &record.content_ref)?
        .is_some()
    {
        return Err(tool_error(
            TOOL_PATCH_ALREADY_APPLIED,
            "patch proposal has already been applied",
        ));
    }
    Ok(())
}

pub(super) fn pending_apply_ticket(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchApply,
) -> Result<Option<crate::storage::ApprovalTicketRecord>> {
    store.find_pending_approval_for_tool_source(
        session_id,
        TOOL_FS_APPLY_PATCH,
        Some(&prepared.record.artifact_id),
        Some(&prepared.record.content_ref),
    )
}

pub(super) fn execute_prepared_apply(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    prepared: PreparedPatchApply,
    source: ApprovalSource,
) -> Result<AppliedPatch> {
    let (ticket_status, approval_mode, preferred_ticket_id) = match source {
        ApprovalSource::UserApproved => ("approved", "user_approved", None),
        ApprovalSource::UserApprovedTicket(ticket_id) => {
            ("approved", "user_approved", Some(ticket_id))
        }
        ApprovalSource::Model(PermissionMode::FullAccess) => {
            ("auto_approved_by_full_access", "full_access", None)
        }
        ApprovalSource::Model(PermissionMode::Sandbox) => ("pending_user", "user", None),
    };
    if ticket_status == "pending_user" {
        return Err(anyhow!("pending approvals cannot execute apply_patch"));
    }
    let touched_paths = prepared
        .plan
        .changed_files
        .iter()
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    crate::agent_runtime::ensure_recovery_anchor_for_write(store, session_id, turn_id)?;
    store.capture_workspace_snapshot_files_for_turn(
        session_id,
        turn_id,
        &touched_paths,
        "write_preflight",
    )?;
    ensure_patch_source_not_applied(store, session_id, &prepared)?;
    let ticket = if let Some(ticket_id) = preferred_ticket_id {
        store.update_approval_ticket_status(session_id, &ticket_id, ticket_status, approval_mode)?
    } else {
        match pending_apply_ticket(store, session_id, &prepared)? {
            Some(ticket) => store.update_approval_ticket_status(
                session_id,
                &ticket.approval_ticket_id,
                ticket_status,
                approval_mode,
            )?,
            None => create_approval_ticket(
                store,
                session_id,
                turn_id,
                op_id,
                &prepared,
                ticket_status,
                approval_mode,
            )?,
        }
    };
    let backup_refs = prepared
        .plan
        .files
        .iter()
        .map(|file| {
            store.append_patch_file_backup(
                session_id,
                turn_id,
                &ticket.approval_ticket_id,
                &prepared.record.artifact_id,
                &prepared.record.content_ref,
                &file.path,
                file.original_content.as_deref(),
                &file.new_content,
            )
        })
        .collect::<Result<Vec<_>>>()?;
    let write_records = write_patch_apply_plan(&prepared.plan)?;
    let changed_files_json = serde_json::to_value(&prepared.plan.changed_files)?;
    let metadata = json!({
        "mimeType": "text/x-diff",
        "sizeBytes": prepared.record.content_bytes,
        "contentHash": prepared.record.content_sha256,
        "createdByTool": TOOL_FS_APPLY_PATCH,
        "appliedFromArtifactId": prepared.record.artifact_id,
        "patchRef": prepared.record.content_ref,
        "approvalTicketId": ticket.approval_ticket_id,
        "changedFiles": prepared.plan.changed_files,
        "backupRefs": backup_refs,
        "writeRecords": write_records,
    });
    let refs = store.append_applied_patch_artifact_and_evidence(
        session_id,
        turn_id,
        op_id,
        &format!("Applied {}", prepared.record.title),
        &prepared.record.content_ref,
        metadata,
        changed_files_json.clone(),
    )?;
    let verification_plan_id = store
        .create_verification_plan_for_changed_files(
            session_id,
            turn_id,
            &refs.artifact_id,
            changed_files_json,
        )?
        .verification_plan_id;
    Ok(AppliedPatch {
        approval_ticket_id: ticket.approval_ticket_id,
        artifact_id: refs.artifact_id,
        evidence_id: refs.evidence_id,
        verification_plan_id: Some(verification_plan_id),
        patch_ref: prepared.record.content_ref,
        source_artifact_id: prepared.record.artifact_id,
        changed_files: prepared.plan.changed_files,
        backup_refs,
    })
}

pub(super) fn create_approval_ticket(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    prepared: &PreparedPatchApply,
    status: &str,
    approval_mode: &str,
) -> Result<crate::storage::ApprovalTicketRecord> {
    store.append_approval_ticket(
        session_id,
        turn_id,
        status,
        approval_mode,
        "Apply workspace patch",
        json!({
            "level": "medium",
            "kinds": ["workspace_write"],
            "reversible": "backup_ref",
            "summary": format!(
                "Apply patch to {} workspace file{}.",
                prepared.plan.changed_files.len(),
                if prepared.plan.changed_files.len() == 1 { "" } else { "s" }
            )
        }),
        json!({
            "workspace": "bound",
            "files": prepared.plan.changed_files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
        }),
        json!({
            "toolPath": TOOL_FS_APPLY_PATCH,
            "toolOperationId": op_id,
            "artifactId": prepared.record.artifact_id,
            "patchRef": prepared.record.content_ref,
        }),
    )
}

pub(super) fn applied_content(
    status: &str,
    detail: &str,
    applied: &AppliedPatch,
) -> Result<String> {
    json_string(&json!({
        "status": status,
        "detail": detail,
        "approvalTicketId": applied.approval_ticket_id,
        "artifactId": applied.artifact_id,
        "evidenceId": applied.evidence_id,
        "verificationPlanId": applied.verification_plan_id,
        "patchRef": applied.patch_ref,
        "appliedFromArtifactId": applied.source_artifact_id,
        "changedFiles": applied.changed_files,
        "backupRefs": applied.backup_refs,
    }))
}

pub(super) fn applied_metadata(applied: &AppliedPatch) -> Value {
    json!({
        "kind": "patch_apply",
        "status": "applied",
        "approvalTicketId": applied.approval_ticket_id,
        "artifactId": applied.artifact_id,
        "evidenceId": applied.evidence_id,
        "verificationPlanId": applied.verification_plan_id,
        "patchRef": applied.patch_ref,
        "appliedFromArtifactId": applied.source_artifact_id,
        "changedFiles": applied.changed_files,
        "backupRefs": applied.backup_refs,
    })
}

pub(super) fn apply_operation(op_id: &str, args: &ApplyPatchArgs) -> ToolOperationEnvelope {
    ToolOperationEnvelope {
        schema_version: TOOL_SCHEMA_VERSION.to_string(),
        kind: "tool_operation".to_string(),
        op_id: op_id.to_string(),
        op: ToolFsOp::Run,
        path: TOOL_FS_APPLY_PATCH.to_string(),
        args: json!({
            "artifactId": args.artifact_id,
            "patchRef": args.patch_ref,
        }),
    }
}
