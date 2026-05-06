use super::*;
use crate::storage::SideEffectRecordInput;
use crate::tool_runtime::operation::TOOL_APPROVAL_REQUIRED;
use anyhow::Context;
use rusqlite::{params, OptionalExtension};

pub(crate) fn project_recovery_side_effect(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
    result: &ToolResultEnvelope,
) -> Result<()> {
    if result.error_code.as_deref() == Some(TOOL_APPROVAL_REQUIRED) {
        return Ok(());
    }
    if operation.path == TOOL_FS_APPLY_PATCH || operation.path == TOOL_FS_ROLLBACK_PATCH {
        project_patch_side_effects(store, session_id, turn_id, operation, result)?;
        return Ok(());
    }
    if operation.path == TOOL_SHELL_RUN_COMMAND {
        project_command_side_effect(store, session_id, turn_id, operation, result)?;
    }
    Ok(())
}

fn project_patch_side_effects(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
    result: &ToolResultEnvelope,
) -> Result<()> {
    if result.status != ToolResultStatus::Completed {
        return Ok(());
    }
    let metadata = result.metadata.as_ref();
    let follow_target_id =
        store.read_follow_target_id_for_operation(session_id, &operation.op_id)?;
    let artifact_refs = collect_artifact_refs(metadata);
    let evidence_ref = string_field(metadata, "evidenceId");
    for changed_file in changed_files(metadata) {
        let kind = workspace_effect_kind(&operation.path, &changed_file.change_type);
        store.append_side_effect_record(SideEffectRecordInput {
            session_id: session_id.to_string(),
            runtime_turn_id: turn_id.to_string(),
            user_message_id: user_message_id_for_turn(store, session_id, turn_id)?,
            tool_operation_id: Some(operation.op_id.clone()),
            kind: kind.to_string(),
            target_ref: changed_file.path,
            rollback_status: "reversible".to_string(),
            evidence_ref: evidence_ref.clone(),
            follow_target_id: follow_target_id.clone(),
            artifact_refs: artifact_refs.clone(),
        })?;
    }
    Ok(())
}

fn workspace_effect_kind(tool_path: &str, change_type: &str) -> &'static str {
    let deleted_by_patch = change_type.contains("delete") || change_type.contains("remove");
    let created_by_patch = change_type.contains("create") || change_type.contains("add");
    if tool_path == TOOL_FS_ROLLBACK_PATCH {
        if created_by_patch {
            "workspace_delete"
        } else {
            "workspace_write"
        }
    } else if deleted_by_patch {
        "workspace_delete"
    } else {
        "workspace_write"
    }
}

fn project_command_side_effect(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    operation: &ToolOperationEnvelope,
    result: &ToolResultEnvelope,
) -> Result<()> {
    if result.status != ToolResultStatus::Completed {
        return Ok(());
    }
    let metadata = result.metadata.as_ref();
    let command = string_field(metadata, "command")
        .or_else(|| command_from_args(&operation.args))
        .unwrap_or_else(|| "command".to_string());
    if is_read_only_verification(metadata, &command) {
        return Ok(());
    }
    let follow_target_id =
        store.read_follow_target_id_for_operation(session_id, &operation.op_id)?;
    store.append_side_effect_record(SideEffectRecordInput {
        session_id: session_id.to_string(),
        runtime_turn_id: turn_id.to_string(),
        user_message_id: user_message_id_for_turn(store, session_id, turn_id)?,
        tool_operation_id: Some(operation.op_id.clone()),
        kind: "unknown".to_string(),
        target_ref: command,
        rollback_status: "manual_review_required".to_string(),
        evidence_ref: string_field(metadata, "evidenceId"),
        follow_target_id,
        artifact_refs: collect_artifact_refs(metadata),
    })?;
    Ok(())
}

struct ChangedFile {
    path: String,
    change_type: String,
}

fn changed_files(metadata: Option<&Value>) -> Vec<ChangedFile> {
    metadata
        .and_then(|value| value.get("changedFiles"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let path = item
                        .get("path")
                        .and_then(Value::as_str)
                        .and_then(trim_to_string)?;
                    let change_type = item
                        .get("changeType")
                        .and_then(Value::as_str)
                        .unwrap_or("modified")
                        .to_ascii_lowercase();
                    Some(ChangedFile { path, change_type })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn user_message_id_for_turn(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
) -> Result<Option<String>> {
    store.with_session_conn(session_id, |conn| {
        conn.query_row(
            "SELECT user_message_id FROM runtime_turn WHERE runtime_turn_id = ?1",
            params![turn_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read user message for turn")
    })
}

fn collect_artifact_refs(metadata: Option<&Value>) -> Vec<String> {
    let mut refs = Vec::new();
    for key in [
        "artifactId",
        "appliedFromArtifactId",
        "rolledBackArtifactId",
    ] {
        if let Some(value) = string_field(metadata, key) {
            push_unique(&mut refs, value);
        }
    }
    refs
}

fn string_field(metadata: Option<&Value>, key: &str) -> Option<String> {
    metadata
        .and_then(|value| value.get(key))
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

fn is_read_only_verification(metadata: Option<&Value>, command: &str) -> bool {
    let purpose = string_field(metadata, "purpose").unwrap_or_default();
    let normalized = format!("{purpose} {command}").to_ascii_lowercase();
    normalized.contains("test")
        || normalized.contains("vitest")
        || normalized.contains("cargo test")
        || normalized.contains("lint")
        || normalized.contains("check")
        || normalized.contains("fmt")
        || normalized.starts_with("echo ")
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if value.trim().is_empty() == false && values.iter().any(|entry| entry == &value) == false {
        values.push(value);
    }
}
