use super::*;

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
        emit_store_event(
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
        emit_store_event(
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
    detail: Option<&AgentSessionDetail>,
) -> Result<()> {
    let Some(detail) = detail else {
        return Ok(());
    };
    if let Some(audit) = detail.completion_audit.as_ref() {
        emit_store_event(
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
        emit_store_event(
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

pub(super) fn delivery_gate_response(
    audit: &crate::storage::AgentCompletionAuditSummary,
    proof: Option<&crate::storage::AgentDeliveryProofSummary>,
) -> Option<String> {
    let proof_status = proof.map(|proof| proof.status.as_str()).unwrap_or("");
    match audit.status.as_str() {
        "failed" => Some(format!(
            "Delivery failed: {} Failed verification runs: {}. This cannot be reported as complete until the failure is repaired or explicitly accepted.",
            audit.summary,
            audit.failed_verification_run_ids.join(", ")
        )),
        "blocked" => Some(format!(
            "Delivery blocked: {} Pending approvals: {}. Missing or blocked work must be resolved before final delivery.",
            audit.summary,
            audit.pending_approval_ticket_ids.join(", ")
        )),
        "partial_allowed" if proof_status == "partial" => Some(format!(
            "Partial delivery: {} Not-run verification records: {}. Residual risk is recorded in the delivery proof.",
            audit.summary,
            audit.not_run_verification_run_ids.join(", ")
        )),
        _ => None,
    }
}

pub(super) fn emit_runtime_state(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    state: &str,
) -> Result<()> {
    store.update_turn_status(session_id, turn_id, "running", state, None, None)?;
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "runtime_state_changed",
        json!({
            "turnId": turn_id,
            "state": state
        }),
    )
}

pub(super) fn emit_tool_event(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    event_type: &str,
    payload: Value,
) -> Result<()> {
    emit_store_event(store, session_id, Some(turn_id), event_type, payload)
}

pub(super) fn tool_operation_payload(operation: &ToolOperationEnvelope) -> Value {
    let mut payload = tool_event_metadata(operation);
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            "schemaVersion".to_string(),
            Value::String(operation.schema_version.clone()),
        );
        object.insert("opId".to_string(), Value::String(operation.op_id.clone()));
        if let Some(args) = follow_safe_operation_args(operation) {
            object.insert("args".to_string(), args);
        }
    }
    payload
}

fn follow_safe_operation_args(operation: &ToolOperationEnvelope) -> Option<Value> {
    let args = operation.args.as_object()?;
    let mut safe = serde_json::Map::new();
    for key in [
        "path",
        "filePath",
        "workspaceUri",
        "toPath",
        "line",
        "startLine",
        "endLine",
        "column",
    ] {
        if let Some(value) = args.get(key) {
            safe.insert(key.to_string(), value.clone());
        }
    }
    if safe.is_empty() {
        None
    } else {
        Some(Value::Object(safe))
    }
}

pub(super) fn tool_result_payload(result: &ToolResultEnvelope, blob: &ToolResultBlobMeta) -> Value {
    let mut payload = json!({
        "schemaVersion": result.schema_version,
        "opId": result.op_id,
        "op": result.op,
        "path": result.path,
        "resultRef": blob.result_ref,
        "status": result.status,
        "summary": result.summary,
        "contentPreview": blob.content_preview,
        "contentBytes": blob.content_bytes,
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

pub(super) fn emit_store_event(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    event_type: &str,
    payload: Value,
) -> Result<()> {
    let stored_payload = stored_runtime_event_payload(&payload);
    let mut event = store.append_event(session_id, turn_id, event_type, stored_payload)?;
    event.payload = payload;
    emit_event(&event);
    Ok(())
}

fn stored_runtime_event_payload(payload: &Value) -> Value {
    let Some(object) = payload.as_object() else {
        return payload.clone();
    };
    if object.contains_key("detail") == false {
        return payload.clone();
    }
    let mut stored = serde_json::Map::with_capacity(object.len() + 1);
    for (key, value) in object {
        if key == "detail" {
            stored.insert(key.clone(), compact_session_detail_payload(value));
        } else {
            stored.insert(key.clone(), value.clone());
        }
    }
    stored.insert("detailCompacted".to_string(), Value::Bool(true));
    Value::Object(stored)
}

fn compact_session_detail_payload(detail: &Value) -> Value {
    let session = detail.get("session");
    json!({
        "compacted": true,
        "reason": "session_detail_not_stored_in_runtime_event",
        "sessionId": session.and_then(|value| value.get("id")).cloned().unwrap_or(Value::Null),
        "title": session.and_then(|value| value.get("title")).cloned().unwrap_or(Value::Null),
        "updatedAt": session.and_then(|value| value.get("updatedAt")).cloned().unwrap_or(Value::Null),
        "turnCount": detail
            .get("turns")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0),
        "messageCount": detail
            .get("messages")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0),
        "runtimeEventCount": detail
            .get("runtimeEvents")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0),
    })
}
