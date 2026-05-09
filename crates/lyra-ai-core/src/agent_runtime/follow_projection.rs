use super::*;
use crate::storage::{
    AgentFollowSummary, AgentFollowTargetSummary, FollowEventInput, FollowTargetInput,
    WorkspaceCommitInput,
};
use crate::tool_runtime::operation::TOOL_APPROVAL_REQUIRED;

pub(crate) fn project_follow_operation_started(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
) -> Result<()> {
    let context = projection_context(store, session_id)?;
    let target = target_from_operation(operation, None, None);
    let summary = store.upsert_follow_target(FollowTargetInput {
        session_id: session_id.to_string(),
        runtime_turn_id: Some(turn_id.to_string()),
        long_work_run_id: context.long_work_run_id.clone(),
        work_slice_id: context.work_slice_id.clone(),
        kind: target.kind,
        title: target.title.clone(),
        resource_ref: target.resource_ref,
        workspace_uri: target.workspace_uri,
        status: "active".to_string(),
        tool_operation_id: Some(operation.op_id.clone()),
        artifact_refs: Vec::new(),
        evidence_refs: Vec::new(),
    })?;
    let target_id = summary
        .as_ref()
        .and_then(|summary| summary.active_target_id.clone());
    let summary = store.append_follow_event(FollowEventInput {
        session_id: session_id.to_string(),
        runtime_turn_id: Some(turn_id.to_string()),
        long_work_run_id: context.long_work_run_id,
        follow_target_id: target_id.clone(),
        tool_operation_id: Some(operation.op_id.clone()),
        work_slice_id: context.work_slice_id,
        event_type: "operation_started".to_string(),
        payload_ref: None,
        payload: json!({
            "label": target.started_label,
            "status": "running",
            "toolPath": operation.path,
            "opId": operation.op_id,
        }),
    })?;
    emit_follow_projection_updated(
        store,
        session_id,
        turn_id,
        operation,
        summary.as_ref(),
        "running",
    )?;
    Ok(())
}

pub(crate) fn project_follow_operation_finished(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
    result: &ToolResultEnvelope,
    blob: &ToolResultBlobMeta,
) -> Result<()> {
    let context = projection_context(store, session_id)?;
    let metadata = result.metadata.as_ref();
    let target = target_from_operation(operation, Some(result), metadata);
    let status = if result.status == ToolResultStatus::Completed {
        "completed"
    } else {
        "failed"
    };
    let refs = refs_from_metadata(metadata);
    let summary = store.upsert_follow_target(FollowTargetInput {
        session_id: session_id.to_string(),
        runtime_turn_id: Some(turn_id.to_string()),
        long_work_run_id: context.long_work_run_id.clone(),
        work_slice_id: context.work_slice_id.clone(),
        kind: target.kind.clone(),
        title: target.title.clone(),
        resource_ref: target
            .resource_ref
            .clone()
            .or_else(|| Some(blob.result_ref.clone())),
        workspace_uri: target.workspace_uri.clone(),
        status: status.to_string(),
        tool_operation_id: Some(operation.op_id.clone()),
        artifact_refs: refs.artifact_refs.clone(),
        evidence_refs: refs.evidence_refs.clone(),
    })?;
    let target_id = summary
        .as_ref()
        .and_then(|summary| summary.active_target_id.clone());
    let summary = store.append_follow_event(FollowEventInput {
        session_id: session_id.to_string(),
        runtime_turn_id: Some(turn_id.to_string()),
        long_work_run_id: context.long_work_run_id.clone(),
        follow_target_id: target_id.clone(),
        tool_operation_id: Some(operation.op_id.clone()),
        work_slice_id: context.work_slice_id.clone(),
        event_type: "operation_finished".to_string(),
        payload_ref: Some(blob.result_ref.clone()),
        payload: json!({
            "label": if result.status == ToolResultStatus::Completed { target.finished_label } else { target.failed_label },
            "status": status,
            "toolPath": operation.path,
            "opId": operation.op_id,
            "resultRef": blob.result_ref,
            "errorCode": result.error_code,
            "errorMessage": result.error_message,
        }),
    })?;
    emit_follow_projection_updated(
        store,
        session_id,
        turn_id,
        operation,
        summary.as_ref(),
        status,
    )?;
    if operation.path == TOOL_FS_APPLY_PATCH && result.status == ToolResultStatus::Completed {
        let paths = changed_file_paths(metadata);
        append_workspace_commits_for_patch(
            store,
            session_id,
            turn_id,
            &operation.op_id,
            context.long_work_run_id.as_deref(),
            target_id.as_deref(),
            metadata,
            "apply_patch",
            "committed",
        )?;
        store.commit_matching_live_edit_for_operation(session_id, &operation.op_id, &paths)?;
    } else if operation.path == TOOL_FS_APPLY_PATCH {
        store.mark_matching_live_edit_failed(session_id, &changed_file_paths(metadata))?;
    }
    if operation.path == TOOL_FS_ROLLBACK_PATCH && result.status == ToolResultStatus::Completed {
        store.mark_workspace_commits_rolled_back(
            session_id,
            context.long_work_run_id.as_deref(),
            Some(turn_id),
            metadata
                .and_then(|value| value.get("rolledBackArtifactId"))
                .and_then(Value::as_str),
            metadata
                .and_then(|value| value.get("patchRef"))
                .and_then(Value::as_str),
        )?;
        append_workspace_commits_for_patch(
            store,
            session_id,
            turn_id,
            &operation.op_id,
            context.long_work_run_id.as_deref(),
            target_id.as_deref(),
            metadata,
            "rollback_patch",
            "committed",
        )?;
    }
    if operation.path.starts_with("/tools/agent/") && result.status == ToolResultStatus::Completed {
        append_agent_tool_live_edit_events(
            store,
            session_id,
            turn_id,
            &operation.op_id,
            target_id.as_deref(),
            metadata,
        )?;
    }
    Ok(())
}

fn emit_follow_projection_updated(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
    summary: Option<&AgentFollowSummary>,
    status: &str,
) -> Result<()> {
    let operations = summary
        .map(|summary| {
            summary
                .targets
                .iter()
                .map(|target| projection_operation_payload(target, &operation.path))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![fallback_operation_payload(operation, status)]);
    let follow_session_id = summary.map(|summary| summary.follow_session_id.as_str());
    let active_target_id = summary.and_then(|summary| summary.active_target_id.as_deref());
    let targets = summary
        .map(|summary| json!(&summary.targets))
        .unwrap_or_else(|| json!([]));
    let recent_events = summary
        .map(|summary| json!(&summary.recent_events))
        .unwrap_or_else(|| json!([]));
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "follow_projection_updated",
        json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "followSessionId": follow_session_id,
            "status": status,
            "activeTargetId": active_target_id,
            "operations": operations,
            "targets": targets,
            "recentEvents": recent_events,
        }),
    )
}

fn projection_operation_payload(
    target: &AgentFollowTargetSummary,
    fallback_tool_path: &str,
) -> Value {
    let finished_at = if matches!(target.status.as_str(), "completed" | "failed") {
        json!(target.updated_at)
    } else {
        Value::Null
    };
    let file_path = if is_openable_target_kind(&target.kind) {
        target
            .workspace_uri
            .as_deref()
            .or_else(|| openable_resource_ref(target.resource_ref.as_deref()))
    } else {
        None
    };
    json!({
        "targetId": target.follow_target_id.as_str(),
        "toolName": target
            .tool_operation_id
            .as_deref()
            .unwrap_or(fallback_tool_path),
        "toolPath": fallback_tool_path,
        "status": target.status.as_str(),
        "filePath": file_path,
        "startedAt": target.updated_at,
        "finishedAt": finished_at,
    })
}

fn fallback_operation_payload(operation: &ToolOperationEnvelope, status: &str) -> Value {
    let finished_at = if matches!(status, "completed" | "failed") {
        json!(now_ms())
    } else {
        Value::Null
    };
    json!({
        "targetId": Value::Null,
        "toolName": operation.op_id.as_str(),
        "toolPath": operation.path.as_str(),
        "status": status,
        "filePath": openable_operation_arg(operation, "path")
            .or_else(|| openable_operation_arg(operation, "toPath")),
        "startedAt": now_ms(),
        "finishedAt": finished_at,
    })
}

struct ProjectionContext {
    long_work_run_id: Option<String>,
    work_slice_id: Option<String>,
}

struct ProjectedRefs {
    artifact_refs: Vec<String>,
    evidence_refs: Vec<String>,
}

struct ProjectedTarget {
    kind: String,
    title: String,
    resource_ref: Option<String>,
    workspace_uri: Option<String>,
    started_label: String,
    finished_label: String,
    failed_label: String,
}

fn projection_context(store: &AiStore, session_id: &str) -> Result<ProjectionContext> {
    let summary = store.read_active_work_summary(session_id)?;
    Ok(ProjectionContext {
        long_work_run_id: summary
            .as_ref()
            .map(|summary| summary.long_work_run_id.clone()),
        work_slice_id: summary
            .as_ref()
            .and_then(|summary| summary.current_slice.as_ref())
            .map(|slice| slice.work_slice_id.clone()),
    })
}

fn target_from_operation(
    operation: &ToolOperationEnvelope,
    result: Option<&ToolResultEnvelope>,
    metadata: Option<&Value>,
) -> ProjectedTarget {
    if matches!(
        operation.path.as_str(),
        TOOL_FS_READ_FILE | TOOL_FS_READ_RANGE
    ) {
        let workspace_uri =
            openable_operation_arg(operation, "path").or_else(|| content_path_from_result(result));
        let title = workspace_uri
            .clone()
            .unwrap_or_else(|| "Reading file".to_string());
        return ProjectedTarget {
            kind: if workspace_uri.is_some() {
                "file".to_string()
            } else {
                "operation".to_string()
            },
            title,
            resource_ref: workspace_uri.clone(),
            workspace_uri,
            started_label: "Reading".to_string(),
            finished_label: "File read".to_string(),
            failed_label: "Read failed".to_string(),
        };
    }
    if operation.path == TOOL_FS_STAT_PATH {
        let workspace_uri =
            openable_operation_arg(operation, "path").or_else(|| content_path_from_result(result));
        let title = workspace_uri
            .clone()
            .unwrap_or_else(|| "Reading metadata".to_string());
        return ProjectedTarget {
            kind: if workspace_uri.is_some() {
                "file".to_string()
            } else {
                "operation".to_string()
            },
            title,
            resource_ref: workspace_uri.clone(),
            workspace_uri,
            started_label: "Reading metadata".to_string(),
            finished_label: "Metadata read".to_string(),
            failed_label: "Metadata read failed".to_string(),
        };
    }
    if operation.path == TOOL_FS_APPLY_PATCH {
        let title = changed_files_title(metadata, "Applying patch");
        return ProjectedTarget {
            kind: "diff".to_string(),
            title,
            resource_ref: string_field(metadata, "patchRef")
                .or_else(|| arg_string(operation, "patchRef")),
            workspace_uri: first_openable_changed_file(metadata),
            started_label: "Editing".to_string(),
            finished_label: "Patch applied".to_string(),
            failed_label: "Patch failed".to_string(),
        };
    }
    if operation.path == TOOL_FS_ROLLBACK_PATCH {
        let title = changed_files_title(metadata, "Rolling back patch");
        return ProjectedTarget {
            kind: "diff".to_string(),
            title,
            resource_ref: string_field(metadata, "patchRef")
                .or_else(|| arg_string(operation, "appliedArtifactId")),
            workspace_uri: first_openable_changed_file(metadata),
            started_label: "Rolling back".to_string(),
            finished_label: "Patch rolled back".to_string(),
            failed_label: "Rollback failed".to_string(),
        };
    }
    if operation.path == TOOL_SHELL_RUN_COMMAND {
        let command = string_field(metadata, "command")
            .or_else(|| command_from_args(&operation.args))
            .unwrap_or_else(|| "command".to_string());
        let kind = command_target_kind(metadata, &command);
        let failed_label = if result
            .map(|result| result.error_code.as_deref() == Some(TOOL_APPROVAL_REQUIRED))
            .unwrap_or(false)
        {
            "Command blocked"
        } else if kind == "test_report" {
            "Tests failed"
        } else {
            "Command failed"
        };
        return ProjectedTarget {
            kind: kind.to_string(),
            title: trim_title(&command),
            resource_ref: string_field(metadata, "commandHash"),
            workspace_uri: None,
            started_label: "Running command".to_string(),
            finished_label: if kind == "test_report" {
                "Tests passed".to_string()
            } else {
                "Command finished".to_string()
            },
            failed_label: failed_label.to_string(),
        };
    }
    if operation.path.starts_with("/tools/agent/") {
        let workspace_uri = string_field(metadata, "workspaceUri")
            .filter(|value| is_openable_workspace_ref(value))
            .or_else(|| first_openable_changed_file(metadata))
            .or_else(|| openable_operation_arg(operation, "path"))
            .or_else(|| openable_operation_arg(operation, "toPath"));
        let title = workspace_uri.clone().unwrap_or_else(|| {
            operation
                .path
                .trim_start_matches("/tools/agent/")
                .to_string()
        });
        return ProjectedTarget {
            kind: "file".to_string(),
            title,
            resource_ref: workspace_uri.clone(),
            workspace_uri,
            started_label: "Editing".to_string(),
            finished_label: "Edit finalized".to_string(),
            failed_label: "Edit failed".to_string(),
        };
    }
    ProjectedTarget {
        kind: "operation".to_string(),
        title: format!("Run {}", operation.path),
        resource_ref: None,
        workspace_uri: None,
        started_label: "Operation started".to_string(),
        finished_label: "Operation finished".to_string(),
        failed_label: "Operation failed".to_string(),
    }
}

fn is_openable_target_kind(kind: &str) -> bool {
    matches!(kind, "file" | "diff" | "editor" | "document")
}

fn openable_resource_ref(value: Option<&str>) -> Option<&str> {
    let value = value?;
    if is_virtual_follow_ref(value) || is_tool_path_ref(value) {
        None
    } else {
        Some(value)
    }
}

fn openable_operation_arg(operation: &ToolOperationEnvelope, key: &str) -> Option<String> {
    arg_string(operation, key).filter(|value| is_openable_workspace_ref(value))
}

fn content_path_from_result(result: Option<&ToolResultEnvelope>) -> Option<String> {
    let result = result?;
    let value: Value = serde_json::from_str(&result.content).ok()?;
    value
        .get("path")
        .and_then(Value::as_str)
        .filter(|path| is_openable_workspace_ref(path))
        .map(ToString::to_string)
}

fn first_openable_changed_file(metadata: Option<&Value>) -> Option<String> {
    first_changed_file(metadata).filter(|value| is_openable_workspace_ref(value))
}

fn is_openable_workspace_ref(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || is_virtual_follow_ref(trimmed) || is_tool_path_ref(trimmed) {
        return false;
    }
    if trimmed
        .split(['/', '\\'])
        .any(|segment| segment == ".." || segment.contains('\0'))
    {
        return false;
    }
    true
}

fn is_tool_path_ref(value: &str) -> bool {
    value == "/tools" || value.starts_with("/tools/")
}

fn is_virtual_follow_ref(value: &str) -> bool {
    let first_segment = value.split(['/', '\\']).next().unwrap_or_default();
    first_segment.starts_with("tool_result_")
        || first_segment.starts_with("artifact_")
        || first_segment.starts_with("evidence_")
}

fn append_agent_tool_live_edit_events(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    follow_target_id: Option<&str>,
    metadata: Option<&Value>,
) -> Result<()> {
    let paths = changed_file_paths(metadata);
    if paths.is_empty() {
        return Ok(());
    }
    let payload = json!({
        "operationId": op_id,
        "filePath": paths[0],
        "diffHunks": metadata
            .and_then(|value| value.get("changedFiles"))
            .cloned()
            .unwrap_or_else(|| json!([])),
    });
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "follow_live_edit_delta",
        payload.clone(),
    )?;
    store.append_follow_event(FollowEventInput {
        session_id: session_id.to_string(),
        runtime_turn_id: Some(turn_id.to_string()),
        long_work_run_id: None,
        follow_target_id: follow_target_id.map(ToString::to_string),
        tool_operation_id: Some(op_id.to_string()),
        work_slice_id: None,
        event_type: "live_edit_delta".to_string(),
        payload_ref: None,
        payload: payload.clone(),
    })?;
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "follow_live_edit_finalized",
        json!({
            "operationId": op_id,
            "filePath": paths[0],
            "changedFileCount": paths.len(),
        }),
    )
}

fn refs_from_metadata(metadata: Option<&Value>) -> ProjectedRefs {
    let mut artifact_refs = Vec::new();
    let mut evidence_refs = Vec::new();
    for key in [
        "artifactId",
        "appliedFromArtifactId",
        "rolledBackArtifactId",
    ] {
        if let Some(value) = string_field(metadata, key) {
            push_unique(&mut artifact_refs, value);
        }
    }
    if let Some(value) = string_field(metadata, "evidenceId") {
        push_unique(&mut evidence_refs, value);
    }
    ProjectedRefs {
        artifact_refs,
        evidence_refs,
    }
}

fn append_workspace_commits_for_patch(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    op_id: &str,
    long_work_run_id: Option<&str>,
    target_id: Option<&str>,
    metadata: Option<&Value>,
    method: &str,
    status: &str,
) -> Result<()> {
    let paths = changed_file_paths(metadata);
    if paths.is_empty() {
        return Ok(());
    }
    for path in paths {
        store.append_workspace_commit(WorkspaceCommitInput {
            session_id: session_id.to_string(),
            runtime_turn_id: Some(turn_id.to_string()),
            long_work_run_id: long_work_run_id.map(ToString::to_string),
            follow_target_id: target_id.map(ToString::to_string),
            live_edit_id: None,
            path,
            base_revision_id: string_field(metadata, "appliedFromArtifactId"),
            final_revision_id: string_field(metadata, "artifactId"),
            tool_operation_id: Some(op_id.to_string()),
            method: method.to_string(),
            diff_ref: string_field(metadata, "patchRef"),
            status: status.to_string(),
        })?;
    }
    Ok(())
}

fn command_target_kind(metadata: Option<&Value>, command: &str) -> &'static str {
    let purpose = string_field(metadata, "purpose").unwrap_or_default();
    let normalized = format!("{purpose} {command}").to_ascii_lowercase();
    if normalized.contains("test")
        || normalized.contains("vitest")
        || normalized.contains("cargo test")
    {
        return "test_report";
    }
    if normalized.contains("lint")
        || normalized.contains("clippy")
        || normalized.contains("fmt")
        || normalized.contains("check")
    {
        return "lint_report";
    }
    if normalized.contains("build") || normalized.contains("assemble") {
        return "build_report";
    }
    "terminal"
}

fn changed_files_title(metadata: Option<&Value>, fallback: &str) -> String {
    let paths = changed_file_paths(metadata);
    if paths.is_empty() {
        return fallback.to_string();
    }
    if paths.len() == 1 {
        return paths[0].clone();
    }
    format!("{} files changed", paths.len())
}

fn first_changed_file(metadata: Option<&Value>) -> Option<String> {
    changed_file_paths(metadata).into_iter().next()
}

fn changed_file_paths(metadata: Option<&Value>) -> Vec<String> {
    metadata
        .and_then(|value| value.get("changedFiles"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("path").and_then(Value::as_str))
                .filter_map(trim_to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn string_field(metadata: Option<&Value>, key: &str) -> Option<String> {
    metadata
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .and_then(trim_to_string)
}

fn arg_string(operation: &ToolOperationEnvelope, key: &str) -> Option<String> {
    operation
        .args
        .get(key)
        .and_then(Value::as_str)
        .and_then(trim_to_string)
}

fn command_from_args(args: &Value) -> Option<String> {
    if let Some(command) = args
        .get("command")
        .and_then(Value::as_str)
        .and_then(trim_to_string)
    {
        return Some(command);
    }
    args.get("argv")
        .and_then(Value::as_array)
        .map(|parts| {
            parts
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .and_then(|value| trim_to_string(&value))
}

fn trim_title(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut title = normalized.chars().take(92).collect::<String>();
    if normalized.chars().count() > 92 {
        title.push_str("...");
    }
    title
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if value.trim().is_empty() == false && values.iter().any(|entry| entry == &value) == false {
        values.push(value);
    }
}
