use super::*;
use crate::storage::SideEffectRecordInput;
use std::collections::HashSet;
use std::fs;

fn storage_request(storage_root: &str) -> StorageRequest {
    StorageRequest {
        storage_root: Some(storage_root.to_string()),
    }
}

fn seed_turn(store: &AiStore, workspace_root: &str) -> (AgentSession, String, String) {
    let now = now_ms();
    let session = AgentSession {
        id: new_id("session"),
        title: "Recovery test".to_string(),
        profile_id: Some("profile-test".to_string()),
        project_root: Some(workspace_root.to_string()),
        project_name: Some("workspace".to_string()),
        collaboration_mode: "default".to_string(),
        created_at: now,
        updated_at: now,
    };
    store.upsert_session_index(&session).expect("session");
    let turn = AgentTurn {
        id: new_id("turn"),
        session_id: session.id.clone(),
        profile_id: "profile-test".to_string(),
        status: "running".to_string(),
        collaboration_mode: Some("default".to_string()),
        permission_mode: "full_access".to_string(),
        error_code: None,
        error_message: None,
        usage: None,
        created_at: now,
        updated_at: now,
    };
    let user_message = AgentMessage {
        id: new_id("msg"),
        session_id: session.id.clone(),
        turn_id: Some(turn.id.clone()),
        role: "user".to_string(),
        content: "change the workspace".to_string(),
        content_parts: None,
        display_content: Some("change the workspace".to_string()),
        created_at: now,
    };
    store.append_message(&user_message).expect("message");
    store
        .insert_turn(&turn, &user_message.id, None)
        .expect("turn");
    let checkpoint_id = store
        .create_timeline_checkpoint(&session.id, &turn.id, &user_message.id)
        .expect("checkpoint");
    ensure_recovery_checkpoint_for_turn(
        store,
        &session,
        &turn.id,
        &user_message.id,
        &checkpoint_id,
    )
    .expect("recovery checkpoint");
    (session, turn.id, user_message.id)
}

fn seed_turn_without_anchor(store: &AiStore, workspace_root: &str) -> (String, String) {
    let now = now_ms();
    let session = AgentSession {
        id: new_id("session"),
        title: "Missing anchor".to_string(),
        profile_id: Some("profile-test".to_string()),
        project_root: Some(workspace_root.to_string()),
        project_name: Some("workspace".to_string()),
        collaboration_mode: "default".to_string(),
        created_at: now,
        updated_at: now,
    };
    store.upsert_session_index(&session).expect("session");
    let turn = AgentTurn {
        id: new_id("turn"),
        session_id: session.id.clone(),
        profile_id: "profile-test".to_string(),
        status: "running".to_string(),
        collaboration_mode: Some("default".to_string()),
        permission_mode: "full_access".to_string(),
        error_code: None,
        error_message: None,
        usage: None,
        created_at: now,
        updated_at: now,
    };
    let user_message = AgentMessage {
        id: new_id("msg"),
        session_id: session.id.clone(),
        turn_id: Some(turn.id.clone()),
        role: "user".to_string(),
        content: "change without anchor".to_string(),
        content_parts: None,
        display_content: Some("change without anchor".to_string()),
        created_at: now,
    };
    store.append_message(&user_message).expect("message");
    store
        .insert_turn(&turn, &user_message.id, None)
        .expect("turn");
    (session.id, turn.id)
}

fn seed_diff_artifact(store: &AiStore, session_id: &str, turn_id: &str) -> String {
    let patch = "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n";
    let changed_files = json!([{
        "path": "README.md",
        "changeType": "modified",
        "additions": 1,
        "deletions": 1
    }]);
    let blob = store
        .append_tool_result_blob(
            session_id,
            turn_id,
            "op-propose",
            TOOL_FS_PROPOSE_PATCH,
            "completed",
            patch,
        )
        .expect("patch blob");
    store
        .append_patch_artifact_and_evidence(
            session_id,
            turn_id,
            "op-propose",
            "Patch README",
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

fn run_apply_patch(store: &AiStore, session_id: &str, turn_id: &str, workspace_root: &str) {
    let artifact_id = seed_diff_artifact(store, session_id, turn_id);
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-apply".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_FS_APPLY_PATCH.to_string(),
        args: json!({ "artifactId": artifact_id }),
    };
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_FS_APPLY_PATCH.to_string()]);
    run_tool_operation(
        store,
        session_id,
        turn_id,
        &ToolExecutionContext {
            workspace_root: Some(workspace_root.to_string()),
        },
        &operation,
        PermissionMode::FullAccess,
        &mut messages,
        &mut inspected,
    )
    .expect("apply patch");
}

#[test]
fn send_turn_creates_message_checkpoint_summary() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: RuntimeTurnInput {
            text: "plain chat".to_string(),
            attachments: Vec::new(),
            parts: Vec::new(),
        },
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");

    let recovery = result.detail.recovery_summary.expect("recovery summary");
    assert_eq!(recovery.rollback_ready_message_ids.len(), 1);
    assert_eq!(
        recovery.latest_anchor.expect("anchor").user_message_id,
        result.detail.messages[0].id
    );
}

#[test]
fn write_without_message_checkpoint_is_blocked() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id) =
        seed_turn_without_anchor(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session_id, &turn_id);
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-apply".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_FS_APPLY_PATCH.to_string(),
        args: json!({ "artifactId": artifact_id }),
    };
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_FS_APPLY_PATCH.to_string()]);

    run_tool_operation(
        &store,
        &session_id,
        &turn_id,
        &ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        },
        &operation,
        PermissionMode::FullAccess,
        &mut messages,
        &mut inspected,
    )
    .expect_err("missing checkpoint blocks write");
}

#[test]
fn apply_patch_records_side_effect_and_workspace_file_snapshot() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session, turn_id, _message_id) = seed_turn(&store, temp.path().to_string_lossy().as_ref());

    run_apply_patch(
        &store,
        &session.id,
        &turn_id,
        temp.path().to_string_lossy().as_ref(),
    );

    assert_eq!(
        store
            .count_side_effects_for_test(&session.id)
            .expect("effects"),
        1
    );
    assert_eq!(
        store
            .latest_side_effect_kind_for_test(&session.id)
            .expect("kind")
            .as_deref(),
        Some("workspace_write")
    );
    assert_eq!(
        store
            .count_rows_for_test(&session.id, "workspace_file_snapshot")
            .expect("snapshot files"),
        1
    );
}

#[test]
fn preview_latest_message_is_safe_and_writes_artifact_evidence() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session, _turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());

    let result = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(temp.path().join("ai").to_string_lossy().as_ref()),
        session_id: session.id.clone(),
        target_user_message_id: user_message_id,
    })
    .expect("preview");

    assert_eq!(result.impact_level, "safe");
    assert!(result.conversation_changes.is_empty());
    assert!(result.artifact_id.is_some());
    assert!(result.evidence_id.is_some());
    assert_eq!(
        store
            .count_rows_for_test(&session.id, "rollback_preview")
            .expect("previews"),
        1
    );
}

#[test]
fn preview_detects_workspace_drift_conflict() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    run_apply_patch(
        &store,
        &session.id,
        &turn_id,
        temp.path().to_string_lossy().as_ref(),
    );
    fs::write(temp.path().join("README.md"), "user drift\n").expect("drift");

    let result = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(temp.path().join("ai").to_string_lossy().as_ref()),
        session_id: session.id,
        target_user_message_id: user_message_id,
    })
    .expect("preview");

    assert_eq!(result.impact_level, "conflict");
    assert!(result
        .workspace_changes
        .iter()
        .any(|change| change.status == "conflict"));
}

#[test]
fn preview_detects_external_side_effect_and_missing_anchor() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    store
        .append_side_effect_record(SideEffectRecordInput {
            session_id: session.id.clone(),
            runtime_turn_id: turn_id,
            user_message_id: Some(user_message_id.clone()),
            tool_operation_id: Some("op-command".to_string()),
            kind: "unknown".to_string(),
            target_ref: "deploy production".to_string(),
            rollback_status: "manual_review_required".to_string(),
            evidence_ref: None,
            follow_target_id: None,
            artifact_refs: Vec::new(),
        })
        .expect("side effect");

    let result = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(temp.path().join("ai").to_string_lossy().as_ref()),
        session_id: session.id.clone(),
        target_user_message_id: user_message_id,
    })
    .expect("preview");
    assert_eq!(result.impact_level, "external_side_effect");

    let missing = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(temp.path().join("ai").to_string_lossy().as_ref()),
        session_id: session.id,
        target_user_message_id: "msg-missing".to_string(),
    })
    .expect_err("missing anchor");
    assert!(missing.to_string().contains("rollback anchor not found"));
}

#[test]
fn run_command_side_effect_screening_records_only_unknown_commands() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session, turn_id, _user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_SHELL_RUN_COMMAND.to_string()]);

    for (op_id, argv, purpose) in [
        ("op-test", vec!["echo", "ok"], "test"),
        (
            "op-write",
            vec!["sh", "-c", "touch side-effect.txt"],
            "mutate workspace",
        ),
    ] {
        let operation = ToolOperationEnvelope {
            schema_version: "v1".to_string(),
            kind: "tool_operation".to_string(),
            op_id: op_id.to_string(),
            op: ToolFsOp::Run,
            path: TOOL_SHELL_RUN_COMMAND.to_string(),
            args: json!({
                "mode": "argv",
                "argv": argv,
                "cwd": ".",
                "purpose": purpose
            }),
        };
        run_tool_operation(
            &store,
            &session.id,
            &turn_id,
            &ToolExecutionContext {
                workspace_root: Some(temp.path().to_string_lossy().to_string()),
            },
            &operation,
            PermissionMode::FullAccess,
            &mut messages,
            &mut inspected,
        )
        .expect("command");
    }

    assert_eq!(
        store
            .count_side_effects_for_test(&session.id)
            .expect("effects"),
        1
    );
    assert_eq!(
        store
            .latest_side_effect_kind_for_test(&session.id)
            .expect("kind")
            .as_deref(),
        Some("unknown")
    );
}
