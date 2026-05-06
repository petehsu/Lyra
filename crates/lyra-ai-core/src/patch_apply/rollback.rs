use super::*;

pub fn rollback_patch_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> ToolResultEnvelope {
    match rollback_patch_tool_result_inner(
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

pub(super) fn rollback_patch_tool_result_inner(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    permission_mode: PermissionMode,
) -> Result<ToolResultEnvelope> {
    let args = parse_args::<RollbackPatchArgs>(&operation.args)?;
    let applied_artifact_id = normalize_rollback_args(&args)?;
    ensure_rollback_args_not_denied(store, session_id, &applied_artifact_id)?;
    let prepared = prepare_patch_rollback(store, session_id, &args)?;
    ensure_rollback_source_not_denied(store, session_id, &prepared)?;
    if permission_mode == PermissionMode::Sandbox {
        let ticket = match pending_rollback_ticket(store, session_id, &prepared)? {
            Some(ticket) => ticket,
            None => create_rollback_approval_ticket(
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
            "User approval is required before rolling back this patch",
        );
        result.metadata = Some(json!({
            "kind": "patch_rollback_approval_required",
            "approvalTicketId": ticket.approval_ticket_id,
            "appliedArtifactId": prepared.applied_record.artifact_id,
            "artifactId": prepared.applied_record.artifact_id,
            "patchRef": prepared.patch_ref,
            "changedFiles": prepared.changed_files,
        }));
        return Ok(result);
    }

    let rolled_back = execute_prepared_rollback(
        store,
        session_id,
        turn_id,
        &operation.op_id,
        context,
        prepared,
        ApprovalSource::Model(permission_mode),
    )?;
    let mut result = ToolResultEnvelope::completed(
        operation,
        "Rolled back patch from workspace",
        rollback_content("rolled_back", "Patch rolled back", &rolled_back)?,
        false,
    );
    result.metadata = Some(rollback_metadata(&rolled_back));
    Ok(result)
}

pub(super) fn normalize_rollback_args(args: &RollbackPatchArgs) -> Result<String> {
    trim_to_string(&args.applied_artifact_id)
        .ok_or_else(|| anyhow!("appliedArtifactId is required"))
}

pub(super) fn ensure_rollback_args_not_denied(
    store: &AiStore,
    session_id: &str,
    applied_artifact_id: &str,
) -> Result<()> {
    if store
        .find_denied_approval_for_tool_source(
            session_id,
            TOOL_FS_ROLLBACK_PATCH,
            Some(applied_artifact_id),
            None,
        )?
        .is_some()
    {
        return Err(tool_error(
            TOOL_APPROVAL_DENIED,
            "user denied this patch rollback",
        ));
    }
    Ok(())
}

pub(super) fn prepare_patch_rollback(
    store: &AiStore,
    session_id: &str,
    args: &RollbackPatchArgs,
) -> Result<PreparedPatchRollback> {
    let applied_artifact_id = normalize_rollback_args(args)?;
    let applied_record = store
        .read_patch_artifact_record(session_id, &applied_artifact_id)?
        .ok_or_else(|| anyhow!("applied patch artifact not found"))?;
    if applied_record.status == "rolled_back" {
        return Err(tool_error(
            TOOL_PATCH_ALREADY_ROLLED_BACK,
            "patch has already been rolled back",
        ));
    }
    if applied_record.status != "applied" {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "rollback_patch requires an applied patch artifact",
        ));
    }
    let source_artifact_id = applied_record
        .metadata
        .get("appliedFromArtifactId")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .ok_or_else(|| anyhow!("applied patch metadata is missing appliedFromArtifactId"))?;
    let patch_ref = applied_record
        .metadata
        .get("patchRef")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
        .unwrap_or_else(|| applied_record.content_ref.clone());
    let changed_files: Vec<PatchChangedFile> = applied_record
        .metadata
        .get("changedFiles")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    if changed_files.is_empty() {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "applied patch metadata is missing changedFiles",
        ));
    }
    let backup_refs: Vec<PatchFileBackupRef> = applied_record
        .metadata
        .get("backupRefs")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    if backup_refs.is_empty() {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "applied patch metadata is missing backupRefs",
        ));
    }
    let mut backups = Vec::with_capacity(backup_refs.len());
    for backup_ref in &backup_refs {
        let backup = store
            .read_patch_file_backup(session_id, &backup_ref.backup_ref)?
            .ok_or_else(|| anyhow!("patch backup not found: {}", backup_ref.backup_ref))?;
        if backup.source_artifact_id != source_artifact_id
            || backup.patch_ref != patch_ref
            || backup.path != backup_ref.path
        {
            return Err(tool_error(
                TOOL_PATCH_INVALID,
                "patch backup does not match applied artifact metadata",
            ));
        }
        backups.push(backup);
    }
    Ok(PreparedPatchRollback {
        applied_record,
        source_artifact_id,
        patch_ref,
        changed_files,
        backup_refs,
        backups,
    })
}

pub(super) fn pending_rollback_ticket(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchRollback,
) -> Result<Option<crate::storage::ApprovalTicketRecord>> {
    store.find_pending_approval_for_tool_source(
        session_id,
        TOOL_FS_ROLLBACK_PATCH,
        Some(&prepared.applied_record.artifact_id),
        Some(&prepared.patch_ref),
    )
}

pub(super) fn ensure_rollback_source_not_denied(
    store: &AiStore,
    session_id: &str,
    prepared: &PreparedPatchRollback,
) -> Result<()> {
    if store
        .find_denied_approval_for_tool_source(
            session_id,
            TOOL_FS_ROLLBACK_PATCH,
            Some(&prepared.applied_record.artifact_id),
            Some(&prepared.patch_ref),
        )?
        .is_some()
    {
        return Err(tool_error(
            TOOL_APPROVAL_DENIED,
            "user denied this patch rollback",
        ));
    }
    Ok(())
}

#[derive(Clone)]
struct RollbackFileAction {
    path: String,
    target_path: PathBuf,
    existed: bool,
    backup_content: Option<String>,
}

pub(super) fn execute_prepared_rollback(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    context: &ToolExecutionContext,
    prepared: PreparedPatchRollback,
    source: ApprovalSource,
) -> Result<RollbackPatch> {
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
        return Err(anyhow!("rollback_patch execution requires full_access"));
    }
    let actions = preflight_rollback(store, session_id, context, &prepared)?;
    let ticket = if let Some(ticket_id) = preferred_ticket_id {
        store.update_approval_ticket_status(session_id, &ticket_id, ticket_status, approval_mode)?
    } else {
        match pending_rollback_ticket(store, session_id, &prepared)? {
            Some(ticket) => store.update_approval_ticket_status(
                session_id,
                &ticket.approval_ticket_id,
                ticket_status,
                approval_mode,
            )?,
            None => create_rollback_approval_ticket(
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

    let mut write_records = Vec::with_capacity(actions.len());
    for action in &actions {
        if action.existed {
            let content = action
                .backup_content
                .as_deref()
                .ok_or_else(|| anyhow!("rollback backup content missing"))?;
            write_atomic_text(&action.target_path, content)?;
            write_records.push(json!({
                "path": action.path,
                "action": "restored",
                "bytes": content.len(),
            }));
        } else {
            fs::remove_file(&action.target_path)
                .with_context(|| format!("failed to remove {}", action.target_path.display()))?;
            write_records.push(json!({
                "path": action.path,
                "action": "removed_created_file",
                "bytes": 0,
            }));
        }
    }

    let changed_files_json = serde_json::to_value(&prepared.changed_files)?;
    let metadata = json!({
        "mimeType": "application/json",
        "createdByTool": TOOL_FS_ROLLBACK_PATCH,
        "rolledBackArtifactId": prepared.applied_record.artifact_id,
        "appliedFromArtifactId": prepared.source_artifact_id,
        "patchRef": prepared.patch_ref,
        "approvalTicketId": ticket.approval_ticket_id,
        "changedFiles": prepared.changed_files,
        "backupRefs": prepared.backup_refs,
        "writeRecords": write_records,
    });
    let refs = store.append_rollback_patch_artifact_and_evidence(
        session_id,
        turn_id,
        op_id,
        &format!("Rolled back {}", prepared.applied_record.title),
        &prepared.patch_ref,
        metadata,
        changed_files_json,
    )?;
    store.update_artifact_status(
        session_id,
        &prepared.applied_record.artifact_id,
        "rolled_back",
    )?;
    Ok(RollbackPatch {
        approval_ticket_id: ticket.approval_ticket_id,
        artifact_id: refs.artifact_id,
        evidence_id: refs.evidence_id,
        rolled_back_artifact_id: prepared.applied_record.artifact_id,
        patch_ref: prepared.patch_ref,
        changed_files: prepared.changed_files,
    })
}

fn preflight_rollback(
    store: &AiStore,
    session_id: &str,
    context: &ToolExecutionContext,
    prepared: &PreparedPatchRollback,
) -> Result<Vec<RollbackFileAction>> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let mut actions = Vec::with_capacity(prepared.backups.len());
    for backup in &prepared.backups {
        let relative_path = security.validate_relative_path_for_write_preview(&backup.path)?;
        let target_path = security.root().join(&relative_path);
        let expected_hash = backup.post_apply_sha256.as_deref().ok_or_else(|| {
            tool_error(
                TOOL_ROLLBACK_UNSAFE,
                format!("missing post-apply hash for {}", backup.path),
            )
        })?;
        let current_bytes = fs::read(&target_path).map_err(|error| {
            tool_error(
                TOOL_ROLLBACK_UNSAFE,
                format!("rollback target is unavailable: {} ({error})", backup.path),
            )
        })?;
        let current_hash = sha256_hex(&current_bytes);
        if current_hash != expected_hash {
            return Err(tool_error(
                TOOL_ROLLBACK_UNSAFE,
                format!("rollback target changed after apply: {}", backup.path),
            ));
        }
        let backup_content = if backup.existed {
            let content_ref = backup.content_ref.as_deref().ok_or_else(|| {
                tool_error(
                    TOOL_ROLLBACK_UNSAFE,
                    format!("missing backup content for {}", backup.path),
                )
            })?;
            Some(store.read_patch_backup_content(session_id, content_ref)?)
        } else {
            None
        };
        actions.push(RollbackFileAction {
            path: relative_path,
            target_path,
            existed: backup.existed,
            backup_content,
        });
    }
    Ok(actions)
}

pub(super) fn create_rollback_approval_ticket(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    prepared: &PreparedPatchRollback,
    status: &str,
    approval_mode: &str,
) -> Result<crate::storage::ApprovalTicketRecord> {
    store.append_approval_ticket(
        session_id,
        turn_id,
        status,
        approval_mode,
        "Rollback workspace patch",
        json!({
            "level": "medium",
            "kinds": ["workspace_write"],
            "reversible": "drift_checked_backup_restore",
            "summary": format!(
                "Rollback patch touching {} workspace file{}.",
                prepared.changed_files.len(),
                if prepared.changed_files.len() == 1 { "" } else { "s" }
            )
        }),
        json!({
            "workspace": "bound",
            "files": prepared.changed_files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
        }),
        json!({
            "toolPath": TOOL_FS_ROLLBACK_PATCH,
            "toolOperationId": op_id,
            "appliedArtifactId": prepared.applied_record.artifact_id,
            "artifactId": prepared.applied_record.artifact_id,
            "patchRef": prepared.patch_ref,
        }),
    )
}

pub(super) fn rollback_content(
    status: &str,
    detail: &str,
    rolled_back: &RollbackPatch,
) -> Result<String> {
    json_string(&json!({
        "status": status,
        "detail": detail,
        "approvalTicketId": rolled_back.approval_ticket_id,
        "artifactId": rolled_back.artifact_id,
        "evidenceId": rolled_back.evidence_id,
        "rolledBackArtifactId": rolled_back.rolled_back_artifact_id,
        "patchRef": rolled_back.patch_ref,
        "changedFiles": rolled_back.changed_files,
    }))
}

pub(super) fn rollback_metadata(rolled_back: &RollbackPatch) -> Value {
    json!({
        "kind": "patch_rollback",
        "status": "rolled_back",
        "approvalTicketId": rolled_back.approval_ticket_id,
        "artifactId": rolled_back.artifact_id,
        "evidenceId": rolled_back.evidence_id,
        "rolledBackArtifactId": rolled_back.rolled_back_artifact_id,
        "patchRef": rolled_back.patch_ref,
        "changedFiles": rolled_back.changed_files,
    })
}

pub(super) fn rollback_operation_for_args(
    op_id: &str,
    args: &RollbackPatchArgs,
) -> ToolOperationEnvelope {
    ToolOperationEnvelope {
        schema_version: TOOL_SCHEMA_VERSION.to_string(),
        kind: "tool_operation".to_string(),
        op_id: op_id.to_string(),
        op: ToolFsOp::Run,
        path: TOOL_FS_ROLLBACK_PATCH.to_string(),
        args: json!({
            "appliedArtifactId": args.applied_artifact_id,
        }),
    }
}
