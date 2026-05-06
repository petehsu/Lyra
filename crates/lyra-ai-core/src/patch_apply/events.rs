use super::*;

pub(super) fn operation_payload(operation: &ToolOperationEnvelope) -> Value {
    json!({
        "schemaVersion": operation.schema_version,
        "opId": operation.op_id,
        "op": operation.op,
        "path": operation.path,
        "toolPath": operation.path,
        "riskLevel": "medium",
        "summary": format!("Run {}", operation.path),
    })
}

pub(super) fn result_payload(
    result: &ToolResultEnvelope,
    result_ref: &str,
    content_bytes: i64,
    content_preview: &str,
) -> Value {
    let mut payload = json!({
        "schemaVersion": result.schema_version,
        "opId": result.op_id,
        "op": result.op,
        "path": result.path,
        "resultRef": result_ref,
        "status": result.status,
        "summary": result.summary,
        "contentPreview": content_preview,
        "contentBytes": content_bytes,
        "truncated": result.truncated,
        "errorCode": result.error_code,
        "errorMessage": result.error_message,
    });
    if let (Some(payload), Some(metadata)) = (payload.as_object_mut(), result.metadata.as_ref()) {
        if let Some(metadata) = metadata.as_object() {
            for (key, value) in metadata {
                payload.insert(key.clone(), value.clone());
            }
        }
    }
    payload
}

pub(super) fn append_result_and_emit_event(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    operation: &ToolOperationEnvelope,
    tool_path: &str,
    mut result: ToolResultEnvelope,
    event_type: &str,
) -> Result<ToolResultEnvelope> {
    let status = match &result.status {
        ToolResultStatus::Completed => "completed",
        ToolResultStatus::Failed => "failed",
    };
    let blob = store.append_tool_result_blob(
        session_id,
        turn_id.unwrap_or_default(),
        &operation.op_id,
        tool_path,
        status,
        &result.content,
    )?;
    result.result_ref = Some(blob.result_ref.clone());
    enrich_patch_runtime_result_metadata(
        store,
        session_id,
        turn_id.unwrap_or_default(),
        &mut result,
        &blob,
    )?;
    emit_apply_event(
        store,
        session_id,
        turn_id,
        event_type,
        json!({
            "operation": operation_payload(operation),
            "result": result_payload(&result, &blob.result_ref, blob.content_bytes, &blob.content_preview),
        }),
    )?;
    emit_verification_projection_events(store, session_id, turn_id, &result)?;
    record_todo_from_patch_result(store, session_id, turn_id, operation, &result)?;
    crate::agent_runtime::project_work_after_tool_result(store, session_id, turn_id)?;
    store.evaluate_completion_audit_and_delivery_proof(session_id, turn_id)?;
    crate::agent_runtime::project_work_after_completion(store, session_id, turn_id)?;
    let detail = store.read_session_detail(session_id)?;
    emit_completion_projection_events(store, session_id, turn_id, detail.as_ref())?;
    Ok(result)
}

pub(super) fn emit_verification_projection_events(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    result: &ToolResultEnvelope,
) -> Result<()> {
    let Some(metadata) = result.metadata.as_ref() else {
        return Ok(());
    };
    if let Some(verification_plan_id) = metadata.get("verificationPlanId").and_then(Value::as_str) {
        emit_apply_event(
            store,
            session_id,
            turn_id,
            "verification_plan_created",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "verificationPlanId": verification_plan_id,
                "toolPath": result.path,
                "status": metadata.get("status").cloned().unwrap_or(Value::Null),
            }),
        )?;
    }
    if let Some(verification_run_id) = metadata.get("verificationRunId").and_then(Value::as_str) {
        emit_apply_event(
            store,
            session_id,
            turn_id,
            "verification_run_updated",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "verificationRunId": verification_run_id,
                "verificationPlanId": metadata.get("verificationPlanId").cloned().unwrap_or(Value::Null),
                "toolPath": result.path,
                "status": metadata.get("status").cloned().unwrap_or(Value::Null),
                "artifactId": metadata.get("artifactId").cloned().unwrap_or(Value::Null),
                "evidenceId": metadata.get("evidenceId").cloned().unwrap_or(Value::Null),
            }),
        )?;
    }
    Ok(())
}

pub(super) fn emit_completion_projection_events(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    detail: Option<&crate::storage::AgentSessionDetail>,
) -> Result<()> {
    let Some(detail) = detail else {
        return Ok(());
    };
    if let Some(audit) = detail.completion_audit.as_ref() {
        emit_apply_event(
            store,
            session_id,
            turn_id,
            "completion_audit_updated",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "completionAuditId": audit.completion_audit_id.clone(),
                "status": audit.status.clone(),
                "summary": audit.summary.clone(),
                "missingTodoItemIds": audit.missing_todo_item_ids.clone(),
                "failedVerificationRunIds": audit.failed_verification_run_ids.clone(),
                "blockedVerificationRunIds": audit.blocked_verification_run_ids.clone(),
                "notRunVerificationRunIds": audit.not_run_verification_run_ids.clone(),
                "pendingApprovalTicketIds": audit.pending_approval_ticket_ids.clone(),
            }),
        )?;
    }
    if let Some(proof) = detail.delivery_proof.as_ref() {
        emit_apply_event(
            store,
            session_id,
            turn_id,
            "delivery_proof_updated",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "deliveryProofId": proof.delivery_proof_id.clone(),
                "completionAuditId": proof.completion_audit_id.clone(),
                "status": proof.status.clone(),
                "summary": proof.summary.clone(),
                "verificationRunIds": proof.verification_run_ids.clone(),
            }),
        )?;
    }
    Ok(())
}

pub(super) fn enrich_patch_runtime_result_metadata(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    result: &mut ToolResultEnvelope,
    blob: &crate::storage::ToolResultBlobMeta,
) -> Result<()> {
    let Some(metadata) = result.metadata.as_mut().and_then(Value::as_object_mut) else {
        return Ok(());
    };
    if metadata.get("kind").and_then(Value::as_str) != Some("command_log") {
        return Ok(());
    }
    let command = metadata
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or("command");
    let cwd = metadata.get("cwd").and_then(Value::as_str).unwrap_or(".");
    let status = metadata
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("failed");
    let refs = store.append_command_log_artifact_and_evidence(
        session_id,
        turn_id,
        &result.op_id,
        &blob.result_ref,
        status,
        command,
        cwd,
        metadata.get("exitCode").and_then(Value::as_i64),
        metadata
            .get("outputBytes")
            .and_then(Value::as_i64)
            .unwrap_or(blob.content_bytes),
        Value::Object(metadata.clone()),
    )?;
    metadata.insert("artifactId".to_string(), Value::String(refs.artifact_id));
    metadata.insert("evidenceId".to_string(), Value::String(refs.evidence_id));
    metadata.insert(
        "verificationPlanId".to_string(),
        Value::String(refs.verification_plan_id),
    );
    metadata.insert(
        "verificationRunId".to_string(),
        Value::String(refs.verification_run_id),
    );
    Ok(())
}

pub(super) fn record_todo_from_patch_result(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    operation: &ToolOperationEnvelope,
    result: &ToolResultEnvelope,
) -> Result<()> {
    let tool_path = operation.path.as_str();
    if matches!(
        tool_path,
        TOOL_FS_APPLY_PATCH | TOOL_FS_ROLLBACK_PATCH | TOOL_SHELL_RUN_COMMAND
    ) == false
    {
        return Ok(());
    }
    let (item_status, step_status, blocker) = match result.status {
        ToolResultStatus::Completed => ("completed", "completed", Value::Null),
        ToolResultStatus::Failed => {
            let kind = if result.error_code.as_deref() == Some(TOOL_APPROVAL_DENIED) {
                "approval_denied"
            } else {
                "tool_failed"
            };
            (
                "failed",
                "failed",
                json!({
                    "kind": kind,
                    "toolPath": tool_path,
                    "approvalTicketId": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("approvalTicketId"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "artifactId": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("artifactId"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "patchRef": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("patchRef"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "errorCode": result.error_code,
                    "errorMessage": result.error_message,
                    "command": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("command"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "verificationRunId": result
                        .metadata
                        .as_ref()
                        .and_then(|metadata| metadata.get("verificationRunId"))
                        .cloned()
                        .unwrap_or(Value::Null),
                }),
            )
        }
    };
    let metadata = result.metadata.as_ref().unwrap_or(&Value::Null);
    let evidence_refs = collect_string_metadata_refs(metadata, &["evidenceId"]);
    let artifact_refs =
        collect_string_metadata_refs(metadata, &["artifactId", "rolledBackArtifactId"]);
    let Some(record) = store.record_tool_execution_step(
        session_id,
        turn_id.unwrap_or_default(),
        tool_path,
        &operation.op_id,
        item_status,
        step_status,
        evidence_refs,
        artifact_refs,
        blocker,
    )?
    else {
        return Ok(());
    };
    emit_todo_update_events(store, session_id, turn_id, &record)
}

pub(super) fn collect_string_metadata_refs(metadata: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .filter_map(|key| metadata.get(*key).and_then(Value::as_str))
        .filter(|value| value.trim().is_empty() == false)
        .map(ToString::to_string)
        .collect()
}

pub(super) fn emit_todo_update_events(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    record: &TodoUpdateRecord,
) -> Result<()> {
    emit_apply_event(
        store,
        session_id,
        turn_id,
        "todo_item_updated",
        json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "todoListId": record.todo_list_id,
            "todoItemId": record.todo_item_id,
            "status": record.status,
            "title": record.title,
            "evidenceRefs": record.evidence_refs,
            "artifactRefs": record.artifact_refs,
            "blocker": record.blocker
        }),
    )?;
    emit_apply_event(
        store,
        session_id,
        turn_id,
        "execution_step_updated",
        json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "todoListId": record.todo_list_id,
            "todoItemId": record.todo_item_id,
            "executionRunId": record.execution_run_id,
            "executionStepId": record.execution_step_id,
            "status": record.step_status,
            "evidenceRefs": record.evidence_refs,
            "artifactRefs": record.artifact_refs,
            "blocker": record.blocker
        }),
    )
}

pub(super) fn emit_approval_resolved_event(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    decision: &str,
    status: &str,
    tool_path: &str,
    metadata: Value,
) -> Result<()> {
    emit_apply_event(
        store,
        session_id,
        turn_id,
        "approval_ticket_resolved",
        json!({
            "decision": decision,
            "status": status,
            "toolPath": tool_path,
            "approvalTicketId": metadata.get("approvalTicketId").cloned().unwrap_or(Value::Null),
            "artifactId": metadata.get("artifactId").cloned().unwrap_or(Value::Null),
            "evidenceId": metadata.get("evidenceId").cloned().unwrap_or(Value::Null),
            "patchRef": metadata.get("patchRef").cloned().unwrap_or(Value::Null),
            "commandHash": metadata.get("commandHash").cloned().unwrap_or(Value::Null),
            "changedFiles": metadata.get("changedFiles").cloned().unwrap_or_else(|| json!([])),
        }),
    )
}

pub(super) fn emit_apply_event(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    event_type: &str,
    payload: Value,
) -> Result<()> {
    let event = store.append_event(session_id, turn_id, event_type, payload)?;
    emit_event(&event);
    Ok(())
}

#[allow(dead_code)]
pub(super) fn _tool_result_message_for_debug(result: &ToolResultEnvelope) -> Result<String> {
    tool_result_chat_message(result)
}
