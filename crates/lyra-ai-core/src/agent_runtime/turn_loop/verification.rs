use super::*;

pub(super) fn enrich_tool_result_metadata(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    result: &mut ToolResultEnvelope,
    blob: &ToolResultBlobMeta,
) -> Result<()> {
    if let Some(metadata) = result.metadata.as_mut().and_then(Value::as_object_mut) {
        if metadata.get("kind").and_then(Value::as_str) == Some("command_log") {
            let command = metadata
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or("command");
            let cwd = metadata.get("cwd").and_then(Value::as_str).unwrap_or(".");
            let status = metadata
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_else(|| {
                    if result.status == ToolResultStatus::Completed {
                        "passed"
                    } else {
                        "failed"
                    }
                });
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
            return Ok(());
        }
    }
    if result.status != ToolResultStatus::Completed {
        return Ok(());
    }
    let Some(metadata) = result.metadata.as_mut().and_then(Value::as_object_mut) else {
        return Ok(());
    };
    if metadata.get("kind").and_then(Value::as_str) != Some("patch_proposal") {
        return Ok(());
    }
    let changed_files = metadata
        .get("changedFiles")
        .cloned()
        .unwrap_or_else(|| json!([]));
    let title = metadata
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Patch proposal");
    let artifact_metadata = json!({
        "mimeType": "text/x-diff",
        "sizeBytes": blob.content_bytes,
        "contentHash": blob.content_sha256,
        "createdByTool": result.path,
        "redactionApplied": true,
        "sensitive": false,
        "changedFiles": changed_files,
        "approvalPreview": metadata.get("approvalPreview").cloned()
    });
    let refs = store.append_patch_artifact_and_evidence(
        session_id,
        turn_id,
        &result.op_id,
        title,
        &blob.result_ref,
        artifact_metadata,
        changed_files,
    )?;
    metadata.insert(
        "artifactId".to_string(),
        Value::String(refs.artifact_id.clone()),
    );
    metadata.insert("evidenceId".to_string(), Value::String(refs.evidence_id));
    metadata.insert(
        "patchRef".to_string(),
        Value::String(blob.result_ref.clone()),
    );
    Ok(())
}

pub(super) fn tool_result_status_str(status: &ToolResultStatus) -> &'static str {
    match status {
        ToolResultStatus::Completed => "completed",
        ToolResultStatus::Failed => "failed",
    }
}
