
use super::*;
use crate::storage::{now_ms, AgentSession, CreateTodoItemInput};
use crate::tool_runtime::operation::{
    tool_error_code, ToolResultStatus, TOOL_PATH_OUTSIDE_WORKSPACE, TOOL_UNSUPPORTED_ENCODING,
};
use std::fs;

fn seed_session(store: &AiStore, workspace_root: &str) -> String {
    let session_id = new_id("session");
    let now = now_ms();
    store
        .upsert_session_index(&AgentSession {
            id: session_id.clone(),
            title: "Apply patch".to_string(),
            profile_id: None,
            project_root: Some(workspace_root.to_string()),
            project_name: Some("workspace".to_string()),
            collaboration_mode: "default".to_string(),
            created_at: now,
            updated_at: now,
        })
        .expect("session");
    store
        .with_session_conn(&session_id, |_| Ok(()))
        .expect("session db");
    session_id
}

fn seed_diff_artifact_with_patch(
    store: &AiStore,
    session_id: &str,
    patch: &str,
    changed_files: Value,
) -> String {
    let blob = store
        .append_tool_result_blob(
            session_id,
            "turn-ui",
            "op-propose",
            "/tools/filesystem/propose_patch",
            "completed",
            patch,
        )
        .expect("blob");
    store
        .append_patch_artifact_and_evidence(
            session_id,
            "turn-ui",
            "op-propose",
            "Update README",
            &blob.result_ref,
            json!({
                "changedFiles": changed_files.clone(),
                "approvalPreview": { "risk": { "level": "medium" } }
            }),
            changed_files,
        )
        .expect("artifact")
        .artifact_id
}

fn seed_diff_artifact(store: &AiStore, session_id: &str) -> String {
    seed_diff_artifact_with_patch(
        store,
        session_id,
        "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
        json!([{
            "path": "README.md",
            "changeType": "modified",
            "additions": 1,
            "deletions": 1
        }]),
    )
}

fn storage_request(storage_root: &str) -> StorageRequest {
    StorageRequest {
        storage_root: Some(storage_root.to_string()),
    }
}

fn seed_todo_for_tool(store: &AiStore, session_id: &str, turn_id: &str, tool_path: &str) {
    store
        .create_execution_todo_list(
            session_id,
            Some(turn_id),
            "mini",
            "Execution checklist",
            json!({ "type": "test" }),
            &[CreateTodoItemInput {
                title: format!("Run {tool_path}"),
                actions: Vec::new(),
                expected_tools: vec![tool_path.to_string()],
                risk_level: "medium".to_string(),
                completion_criteria: Vec::new(),
                source: json!({}),
            }],
        )
        .expect("todo");
}

fn tool_context(temp: &tempfile::TempDir) -> ToolExecutionContext {
    ToolExecutionContext {
        workspace_root: Some(temp.path().to_string_lossy().to_string()),
    }
}

fn rollback_operation(applied_artifact_id: &str) -> ToolOperationEnvelope {
    ToolOperationEnvelope {
        schema_version: TOOL_SCHEMA_VERSION.to_string(),
        kind: "tool_operation".to_string(),
        op_id: new_id("op"),
        op: ToolFsOp::Run,
        path: TOOL_FS_ROLLBACK_PATCH.to_string(),
        args: json!({ "appliedArtifactId": applied_artifact_id }),
    }
}

#[test]
fn ui_apply_patch_creates_backup_artifact_evidence_ticket_and_event() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id);
    seed_todo_for_tool(&store, &session_id, "turn-ui", TOOL_FS_APPLY_PATCH);

    let result = apply_agent_patch(AgentApplyPatchRequest {
        storage: StorageRequest {
            storage_root: Some(storage_root),
        },
        session_id: session_id.clone(),
        artifact_id: Some(artifact_id),
        patch_ref: None,
        permission_mode: None,
    })
    .expect("apply");

    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).unwrap(),
        "new\n"
    );
    assert_eq!(result.status, "applied");
    assert_eq!(result.changed_files[0].path, "README.md");
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "approval_ticket")
            .expect("approval count"),
        1
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "file_backup_record")
            .expect("backup count"),
        1
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "artifact_record")
            .expect("artifact count"),
        2
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "evidence_record")
            .expect("evidence count"),
        2
    );
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(
        detail.active_todo.as_ref().expect("todo").items[0].status,
        "completed"
    );
    assert_eq!(
        detail
            .execution_summary
            .as_ref()
            .expect("summary")
            .completed_step_count,
        1
    );
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "tool_operation_completed"
            && event.payload["operation"]["path"] == TOOL_FS_APPLY_PATCH
    }));
    assert!(detail
        .runtime_events
        .iter()
        .any(|event| event.phase == "todo_item_updated"));
}

#[test]
fn duplicate_apply_by_artifact_or_patch_ref_is_rejected_without_extra_audit_rows() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id);

    let result = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(artifact_id.clone()),
        patch_ref: None,
        permission_mode: None,
    })
    .expect("apply");
    let backup_count = store
        .count_rows_for_test(&session_id, "file_backup_record")
        .expect("backup count");
    let approval_count = store
        .count_rows_for_test(&session_id, "approval_ticket")
        .expect("approval count");
    let artifact_count = store
        .count_rows_for_test(&session_id, "artifact_record")
        .expect("artifact count");

    let duplicate_by_artifact = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(artifact_id),
        patch_ref: None,
        permission_mode: None,
    })
    .expect_err("duplicate artifact apply should fail");
    assert_eq!(
        tool_error_code(&duplicate_by_artifact, TOOL_PATCH_INVALID),
        TOOL_PATCH_ALREADY_APPLIED
    );

    let duplicate_by_ref = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: None,
        patch_ref: Some(result.patch_ref),
        permission_mode: None,
    })
    .expect_err("duplicate patchRef apply should fail");
    assert_eq!(
        tool_error_code(&duplicate_by_ref, TOOL_PATCH_INVALID),
        TOOL_PATCH_ALREADY_APPLIED
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "file_backup_record")
            .expect("backup count"),
        backup_count
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "approval_ticket")
            .expect("approval count"),
        approval_count
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "artifact_record")
            .expect("artifact count"),
        artifact_count
    );
}

#[test]
fn sandbox_apply_reuses_pending_ticket_and_session_detail_exposes_it() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id);
    let context = tool_context(&temp);
    let args = ApplyPatchArgs {
        artifact_id: Some(artifact_id),
        patch_ref: None,
    };
    let operation_a = apply_operation("op-apply-a", &args);
    let operation_b = apply_operation("op-apply-b", &args);

    let first = apply_patch_tool_result(
        &store,
        &session_id,
        "turn-model",
        &context,
        &operation_a,
        PermissionMode::Sandbox,
    );
    let second = apply_patch_tool_result(
        &store,
        &session_id,
        "turn-model",
        &context,
        &operation_b,
        PermissionMode::Sandbox,
    );

    assert_eq!(first.status, ToolResultStatus::Failed);
    assert_eq!(first.error_code.as_deref(), Some(TOOL_APPROVAL_REQUIRED));
    assert_eq!(second.error_code.as_deref(), Some(TOOL_APPROVAL_REQUIRED));
    assert_eq!(
        first.metadata.as_ref().unwrap()["approvalTicketId"],
        second.metadata.as_ref().unwrap()["approvalTicketId"]
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).unwrap(),
        "old\n"
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "approval_ticket")
            .expect("approval count"),
        1
    );
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert_eq!(detail.pending_interactions.len(), 1);
    assert_eq!(detail.pending_interactions[0]["kind"], "tool_approval");
    assert_eq!(
        detail.pending_interactions[0]["payload"]["toolPath"],
        TOOL_FS_APPLY_PATCH
    );
}

#[test]
fn resolve_approval_approve_pending_apply_reuses_ticket_and_writes() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id);
    seed_todo_for_tool(&store, &session_id, "turn-model", TOOL_FS_APPLY_PATCH);
    let operation = apply_operation(
        "op-apply",
        &ApplyPatchArgs {
            artifact_id: Some(artifact_id),
            patch_ref: None,
        },
    );
    let pending = apply_patch_tool_result(
        &store,
        &session_id,
        "turn-model",
        &tool_context(&temp),
        &operation,
        PermissionMode::Sandbox,
    );
    let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
        .as_str()
        .unwrap()
        .to_string();

    let result = resolve_agent_approval(AgentResolveApprovalRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        approval_ticket_id: approval_ticket_id.clone(),
        decision: ApprovalDecision::Approve,
    })
    .expect("approve");

    assert_eq!(result.status, "approved");
    assert_eq!(result.approval_ticket_id, approval_ticket_id);
    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).unwrap(),
        "new\n"
    );
    assert_eq!(
        store
            .read_session_detail(&session_id)
            .expect("detail")
            .expect("detail")
            .pending_interactions
            .len(),
        0
    );
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "approval_ticket")
            .expect("approval count"),
        1
    );
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    let verification = detail
        .verification_summary
        .as_ref()
        .expect("verification plan");
    assert_eq!(verification.status, "not_run");
    assert_eq!(verification.not_run_count, 1);
    assert_eq!(
        detail
            .completion_audit
            .as_ref()
            .expect("completion audit")
            .status,
        "partial_allowed"
    );
    assert_eq!(
        detail
            .delivery_proof
            .as_ref()
            .expect("delivery proof")
            .status,
        "partial"
    );
}

#[test]
fn resolve_approval_deny_pending_apply_blocks_same_source_retry() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id);
    seed_todo_for_tool(&store, &session_id, "turn-model", TOOL_FS_APPLY_PATCH);
    let operation = apply_operation(
        "op-apply",
        &ApplyPatchArgs {
            artifact_id: Some(artifact_id),
            patch_ref: None,
        },
    );
    let pending = apply_patch_tool_result(
        &store,
        &session_id,
        "turn-model",
        &tool_context(&temp),
        &operation,
        PermissionMode::Sandbox,
    );
    let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
        .as_str()
        .unwrap()
        .to_string();

    let result = resolve_agent_approval(AgentResolveApprovalRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        approval_ticket_id: approval_ticket_id.clone(),
        decision: ApprovalDecision::Deny,
    })
    .expect("deny");

    assert_eq!(result.status, "denied");
    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).unwrap(),
        "old\n"
    );
    let ticket = store
        .read_approval_ticket_detail(&session_id, &approval_ticket_id)
        .expect("ticket")
        .expect("ticket");
    assert_eq!(ticket.status, "denied");
    assert_eq!(ticket.approval_mode, "user_denied");
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("detail");
    assert_eq!(detail.pending_interactions.len(), 0);
    assert_eq!(
        detail.active_todo.as_ref().expect("todo").items[0].status,
        "failed"
    );
    assert_eq!(
        detail
            .execution_summary
            .as_ref()
            .expect("summary")
            .failed_step_count,
        1
    );
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "tool_operation_failed"
            && event.payload["result"]["errorCode"] == TOOL_APPROVAL_DENIED
    }));
    assert!(detail.runtime_events.iter().any(|event| {
        event.phase == "approval_ticket_resolved"
            && event.payload["status"] == "denied"
            && event.payload["approvalTicketId"] == approval_ticket_id
    }));

    let retry = apply_patch_tool_result(
        &store,
        &session_id,
        "turn-model",
        &tool_context(&temp),
        &operation,
        PermissionMode::Sandbox,
    );
    assert_eq!(retry.error_code.as_deref(), Some(TOOL_APPROVAL_DENIED));
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "approval_ticket")
            .expect("approval count"),
        1
    );
}

#[test]
fn resolving_non_pending_ticket_is_rejected() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id);
    let operation = apply_operation(
        "op-apply",
        &ApplyPatchArgs {
            artifact_id: Some(artifact_id),
            patch_ref: None,
        },
    );
    let pending = apply_patch_tool_result(
        &store,
        &session_id,
        "turn-model",
        &tool_context(&temp),
        &operation,
        PermissionMode::Sandbox,
    );
    let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
        .as_str()
        .unwrap()
        .to_string();
    resolve_agent_approval(AgentResolveApprovalRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        approval_ticket_id: approval_ticket_id.clone(),
        decision: ApprovalDecision::Deny,
    })
    .expect("deny");

    let repeated = resolve_agent_approval(AgentResolveApprovalRequest {
        storage: storage_request(&storage_root),
        session_id,
        approval_ticket_id,
        decision: ApprovalDecision::Approve,
    })
    .expect_err("non-pending");
    assert_eq!(
        tool_error_code(&repeated, TOOL_PATCH_INVALID),
        TOOL_APPROVAL_NOT_PENDING
    );
}

#[test]
fn rollback_restores_modified_file_and_rejects_repeated_rollback() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id);
    let applied = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(artifact_id),
        patch_ref: None,
        permission_mode: None,
    })
    .expect("apply");

    let rollback = rollback_patch_tool_result(
        &store,
        &session_id,
        "turn-rollback",
        &tool_context(&temp),
        &rollback_operation(&applied.artifact_id),
        PermissionMode::FullAccess,
    );

    assert_eq!(rollback.status, ToolResultStatus::Completed);
    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).unwrap(),
        "old\n"
    );
    assert_eq!(
        store
            .read_patch_artifact_record(&session_id, &applied.artifact_id)
            .expect("artifact")
            .expect("artifact")
            .status,
        "rolled_back"
    );
    let repeated = rollback_patch_tool_result(
        &store,
        &session_id,
        "turn-rollback",
        &tool_context(&temp),
        &rollback_operation(&applied.artifact_id),
        PermissionMode::FullAccess,
    );
    assert_eq!(
        repeated.error_code.as_deref(),
        Some(TOOL_PATCH_ALREADY_ROLLED_BACK)
    );
}

#[test]
fn rollback_removes_created_file_and_rejects_drift() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let created_artifact = seed_diff_artifact_with_patch(
        &store,
        &session_id,
        "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+hello\n",
        json!([{
            "path": "new.txt",
            "changeType": "created",
            "additions": 1,
            "deletions": 0
        }]),
    );
    let created = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(created_artifact),
        patch_ref: None,
        permission_mode: None,
    })
    .expect("apply created");
    assert!(temp.path().join("new.txt").exists());
    let rollback_created = rollback_patch_tool_result(
        &store,
        &session_id,
        "turn-rollback",
        &tool_context(&temp),
        &rollback_operation(&created.artifact_id),
        PermissionMode::FullAccess,
    );
    assert_eq!(rollback_created.status, ToolResultStatus::Completed);
    assert!(temp.path().join("new.txt").exists() == false);

    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let drift_artifact = seed_diff_artifact(&store, &session_id);
    let drift_applied = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(drift_artifact),
        patch_ref: None,
        permission_mode: None,
    })
    .expect("apply drift");
    fs::write(temp.path().join("README.md"), "drift\n").expect("drift");
    let drift = rollback_patch_tool_result(
        &store,
        &session_id,
        "turn-rollback",
        &tool_context(&temp),
        &rollback_operation(&drift_applied.artifact_id),
        PermissionMode::FullAccess,
    );
    assert_eq!(drift.status, ToolResultStatus::Failed);
    assert_eq!(drift.error_code.as_deref(), Some(TOOL_ROLLBACK_UNSAFE));
    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).unwrap(),
        "drift\n"
    );
}

#[test]
fn resolve_approval_approve_pending_rollback_reuses_ticket_and_restores() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id);
    let applied = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(artifact_id),
        patch_ref: None,
        permission_mode: None,
    })
    .expect("apply");
    seed_todo_for_tool(&store, &session_id, "turn-model", TOOL_FS_ROLLBACK_PATCH);
    let operation = rollback_operation(&applied.artifact_id);
    let pending = rollback_patch_tool_result(
        &store,
        &session_id,
        "turn-model",
        &tool_context(&temp),
        &operation,
        PermissionMode::Sandbox,
    );
    let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
        .as_str()
        .unwrap()
        .to_string();

    let result = resolve_agent_approval(AgentResolveApprovalRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        approval_ticket_id: approval_ticket_id.clone(),
        decision: ApprovalDecision::Approve,
    })
    .expect("approve rollback");

    assert_eq!(result.status, "approved");
    assert_eq!(result.approval_ticket_id, approval_ticket_id);
    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).unwrap(),
        "old\n"
    );
    assert_eq!(
        store
            .read_patch_artifact_record(&session_id, &applied.artifact_id)
            .expect("artifact")
            .expect("artifact")
            .status,
        "rolled_back"
    );
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("detail");
    assert_eq!(
        detail.active_todo.as_ref().expect("todo").items[0].status,
        "completed"
    );
}

#[test]
fn resolve_approval_deny_pending_rollback_blocks_same_source_retry() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id);
    let applied = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(artifact_id),
        patch_ref: None,
        permission_mode: None,
    })
    .expect("apply");
    let operation = rollback_operation(&applied.artifact_id);
    let pending = rollback_patch_tool_result(
        &store,
        &session_id,
        "turn-model",
        &tool_context(&temp),
        &operation,
        PermissionMode::Sandbox,
    );
    let approval_ticket_id = pending.metadata.as_ref().unwrap()["approvalTicketId"]
        .as_str()
        .unwrap()
        .to_string();
    resolve_agent_approval(AgentResolveApprovalRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        approval_ticket_id,
        decision: ApprovalDecision::Deny,
    })
    .expect("deny rollback");

    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).unwrap(),
        "new\n"
    );
    let retry = rollback_patch_tool_result(
        &store,
        &session_id,
        "turn-model",
        &tool_context(&temp),
        &operation,
        PermissionMode::Sandbox,
    );
    assert_eq!(retry.error_code.as_deref(), Some(TOOL_APPROVAL_DENIED));
}

#[test]
fn apply_patch_rejects_boundary_and_patch_integrity_failures() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let session_id = seed_session(&store, temp.path().to_string_lossy().as_ref());

    let outside = seed_diff_artifact_with_patch(
        &store,
        &session_id,
        "--- /dev/null\n+++ b/../outside.txt\n@@ -0,0 +1 @@\n+outside\n",
        json!([{
            "path": "../outside.txt",
            "changeType": "created",
            "additions": 1,
            "deletions": 0
        }]),
    );
    let error = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(outside),
        patch_ref: None,
        permission_mode: None,
    })
    .expect_err("outside path should fail");
    assert_eq!(
        tool_error_code(&error, TOOL_PATCH_INVALID),
        TOOL_PATH_OUTSIDE_WORKSPACE
    );

    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let deleted = seed_diff_artifact_with_patch(
        &store,
        &session_id,
        "--- a/README.md\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n",
        json!([{
            "path": "README.md",
            "changeType": "deleted",
            "additions": 0,
            "deletions": 1
        }]),
    );
    let error = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(deleted),
        patch_ref: None,
        permission_mode: None,
    })
    .expect_err("delete patch should fail");
    assert_eq!(
        tool_error_code(&error, TOOL_PATCH_INVALID),
        TOOL_PATCH_INVALID
    );

    let created_existing = seed_diff_artifact_with_patch(
        &store,
        &session_id,
        "--- /dev/null\n+++ b/README.md\n@@ -0,0 +1 @@\n+new\n",
        json!([{
            "path": "README.md",
            "changeType": "created",
            "additions": 1,
            "deletions": 0
        }]),
    );
    assert!(apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(created_existing),
        patch_ref: None,
        permission_mode: None,
    })
    .expect_err("created existing should fail")
    .to_string()
    .contains("created file already exists"));

    let mismatch = seed_diff_artifact_with_patch(
        &store,
        &session_id,
        "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-missing\n+new\n",
        json!([{
            "path": "README.md",
            "changeType": "modified",
            "additions": 1,
            "deletions": 1
        }]),
    );
    assert!(apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(mismatch),
        patch_ref: None,
        permission_mode: None,
    })
    .expect_err("hunk mismatch should fail")
    .to_string()
    .contains("patch hunk does not match"));

    fs::write(temp.path().join("binary.txt"), [0xff, 0xfe]).expect("binary");
    let binary = seed_diff_artifact_with_patch(
        &store,
        &session_id,
        "--- a/binary.txt\n+++ b/binary.txt\n@@ -1 +1 @@\n-old\n+new\n",
        json!([{
            "path": "binary.txt",
            "changeType": "modified",
            "additions": 1,
            "deletions": 1
        }]),
    );
    let error = apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some(binary),
        patch_ref: None,
        permission_mode: None,
    })
    .expect_err("non UTF-8 should fail");
    assert_eq!(
        tool_error_code(&error, TOOL_PATCH_INVALID),
        TOOL_UNSUPPORTED_ENCODING
    );

    assert!(apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: Some("artifact_missing".to_string()),
        patch_ref: None,
        permission_mode: None,
    })
    .expect_err("missing artifact should fail")
    .to_string()
    .contains("AI diff artifact not found"));
    assert!(apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        artifact_id: None,
        patch_ref: Some("tool_result_missing".to_string()),
        permission_mode: None,
    })
    .expect_err("orphan patchRef should fail")
    .to_string()
    .contains("AI diff artifact not found"));

    let other_session = seed_session(&store, temp.path().to_string_lossy().as_ref());
    let cross_session_artifact = seed_diff_artifact(&store, &other_session);
    assert!(apply_agent_patch(AgentApplyPatchRequest {
        storage: storage_request(&storage_root),
        session_id,
        artifact_id: Some(cross_session_artifact),
        patch_ref: None,
        permission_mode: None,
    })
    .expect_err("cross-session artifact should fail")
    .to_string()
    .contains("AI diff artifact not found"));
}
