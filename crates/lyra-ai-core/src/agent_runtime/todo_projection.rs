use super::*;

pub(super) fn record_todo_from_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
    result: &ToolResultEnvelope,
) -> Result<()> {
    let tool_path = normalized_tool_path(&operation.path);
    let Some((item_status, step_status, blocker)) =
        todo_status_from_tool_result(&tool_path, result)
    else {
        return Ok(());
    };
    let metadata = result.metadata.as_ref().unwrap_or(&Value::Null);
    let mut evidence_refs = collect_string_metadata_refs(metadata, &["evidenceId"]);
    let artifact_refs =
        collect_string_metadata_refs(metadata, &["artifactId", "rolledBackArtifactId"]);
    if let Some(evidence_id) = metadata.get("evidenceId").and_then(Value::as_str) {
        if evidence_refs.iter().any(|value| value == evidence_id) == false {
            evidence_refs.push(evidence_id.to_string());
        }
    }
    let Some(record) = store.record_tool_execution_step(
        session_id,
        turn_id,
        &tool_path,
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
    emit_todo_update_events(store, session_id, Some(turn_id), &record)?;
    project_work_after_tool_result(store, session_id, Some(turn_id))
}

fn todo_status_from_tool_result(
    tool_path: &str,
    result: &ToolResultEnvelope,
) -> Option<(&'static str, &'static str, Value)> {
    match result.status {
        ToolResultStatus::Completed => Some(("completed", "completed", Value::Null)),
        ToolResultStatus::Failed => match result.error_code.as_deref() {
            Some("TOOL_APPROVAL_REQUIRED") => Some((
                "blocked",
                "blocked",
                json!({
                    "kind": "approval_required",
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
                }),
            )),
            Some("TOOL_APPROVAL_DENIED") => Some((
                "failed",
                "failed",
                json!({
                    "kind": "approval_denied",
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
                }),
            )),
            _ if tool_path == TOOL_SHELL_RUN_COMMAND => Some((
                "failed",
                "failed",
                json!({
                    "kind": "verification_failed",
                    "toolPath": tool_path,
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
            )),
            _ if matches!(tool_path, TOOL_FS_APPLY_PATCH | TOOL_FS_ROLLBACK_PATCH) => Some((
                "failed",
                "failed",
                json!({
                    "kind": "tool_failed",
                    "toolPath": tool_path,
                    "errorCode": result.error_code,
                    "errorMessage": result.error_message,
                }),
            )),
            _ => None,
        },
    }
}

fn collect_string_metadata_refs(metadata: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .filter_map(|key| metadata.get(*key).and_then(Value::as_str))
        .filter(|value| value.trim().is_empty() == false)
        .map(ToString::to_string)
        .collect()
}

fn emit_todo_update_events(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    record: &TodoUpdateRecord,
) -> Result<()> {
    emit_store_event(
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
    emit_store_event(
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
