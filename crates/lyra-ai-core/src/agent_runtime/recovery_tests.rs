use super::*;
use crate::storage::{now_iso, AgentExecuteMessageRollbackResult, SideEffectRecordInput};
use anyhow::Context;
use rusqlite::params;
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

fn seed_patch_artifact(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    patch: &str,
    changed_files: Value,
) -> String {
    let op_id = new_id("op_propose");
    let blob = store
        .append_tool_result_blob(
            session_id,
            turn_id,
            &op_id,
            TOOL_FS_PROPOSE_PATCH,
            "completed",
            patch,
        )
        .expect("patch blob");
    store
        .append_patch_artifact_and_evidence(
            session_id,
            turn_id,
            &op_id,
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

fn seed_diff_artifact(store: &AiStore, session_id: &str, turn_id: &str) -> String {
    seed_patch_artifact(
        store,
        session_id,
        turn_id,
        "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
        json!([{
            "path": "README.md",
            "changeType": "modified",
            "additions": 1,
            "deletions": 1
        }]),
    )
}

fn seed_created_file_artifact(store: &AiStore, session_id: &str, turn_id: &str) -> String {
    seed_patch_artifact(
        store,
        session_id,
        turn_id,
        "--- /dev/null\n+++ b/NEW.md\n@@ -0,0 +1 @@\n+created\n",
        json!([{
            "path": "NEW.md",
            "changeType": "created",
            "additions": 1,
            "deletions": 0
        }]),
    )
}

fn run_apply_patch_artifact(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    workspace_root: &str,
    artifact_id: String,
    op_id: &str,
) {
    let operation = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: op_id.to_string(),
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

fn run_apply_patch(store: &AiStore, session_id: &str, turn_id: &str, workspace_root: &str) {
    let artifact_id = seed_diff_artifact(store, session_id, turn_id);
    run_apply_patch_artifact(
        store,
        session_id,
        turn_id,
        workspace_root,
        artifact_id,
        "op-apply",
    );
}

fn append_later_assistant_message(store: &AiStore, session_id: &str, turn_id: &str) -> String {
    store
        .append_or_update_assistant_message(session_id, turn_id, "Applied the change.")
        .expect("assistant message")
}

fn execute_preview(
    storage_root: &str,
    session_id: &str,
    rollback_id: &str,
) -> AgentExecuteMessageRollbackResult {
    execute_message_rollback(AgentExecuteMessageRollbackRequest {
        storage: storage_request(storage_root),
        session_id: session_id.to_string(),
        rollback_id: rollback_id.to_string(),
        confirmation_token: Some("restore".to_string()),
        strategy: None,
    })
    .expect("execute rollback")
}

struct BranchRecordIds {
    approval_ticket_id: String,
    todo_list_id: String,
    execution_run_id: String,
    verification_run_id: String,
    completion_audit_id: String,
    delivery_proof_id: String,
    long_work_run_id: String,
    continuation_id: String,
    follow_session_id: String,
    follow_event_id: String,
    live_edit_id: String,
}

fn seed_active_branch_records_after_checkpoint(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    user_message_id: &str,
) -> BranchRecordIds {
    let now = now_ms();
    let now_iso = now_iso();
    let approval_ticket_id = new_id("approval");
    let todo_list_id = new_id("todo_list");
    let todo_item_id = new_id("todo_item");
    let execution_run_id = new_id("execution_run");
    let execution_step_id = new_id("execution_step");
    let verification_plan_id = new_id("verification_plan");
    let verification_run_id = new_id("verification_run");
    let completion_audit_id = new_id("completion_audit");
    let delivery_proof_id = new_id("delivery_proof");
    let goal_id = new_id("long_work_goal");
    let long_work_run_id = new_id("long_work_run");
    let work_slice_id = new_id("work_slice");
    let continuation_id = new_id("continuation");
    let follow_session_id = new_id("follow_session");
    let follow_target_id = new_id("follow_target");
    let follow_event_id = new_id("follow_event");
    let live_edit_id = new_id("live_edit");

    store
        .with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO approval_ticket (
                    approval_ticket_id, session_id, runtime_turn_id, status, approval_mode,
                    title, risk_summary_json, impact_scope_json, requested_action_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, 'pending_user', 'on_request', 'Approve',
                    '{}', '{}', '{}', ?4, ?5, ?4, ?5)",
                params![approval_ticket_id, session_id, turn_id, now, now_iso],
            )?;
            conn.execute(
                "INSERT INTO execution_todo_list (
                    todo_list_id, session_id, runtime_turn_id, kind, status, source_json,
                    title, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, 'mini', 'active', '{}', 'Todo',
                    ?4, ?5, ?4, ?5)",
                params![todo_list_id, session_id, turn_id, now, now_iso],
            )?;
            conn.execute(
                "INSERT INTO todo_item (
                    todo_item_id, todo_list_id, status, title, actions_json,
                    expected_tools_json, risk_level, completion_criteria_json,
                    evidence_refs_json, blockers_json, source_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, 'pending', 'Step', '[]', '[]', 'low',
                    '[]', '[]', '[]', '{}', ?3, ?4, ?3, ?4)",
                params![todo_item_id, todo_list_id, now, now_iso],
            )?;
            conn.execute(
                "INSERT INTO execution_run (
                    execution_run_id, session_id, runtime_turn_id, todo_list_id, status,
                    step_ids_json, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'running', ?5, ?6, ?7, ?6, ?7)",
                params![
                    execution_run_id,
                    session_id,
                    turn_id,
                    todo_list_id,
                    json!([execution_step_id]).to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO execution_step (
                    execution_step_id, execution_run_id, todo_item_id, kind, status,
                    tool_operation_ids_json, evidence_refs_json, artifact_refs_json,
                    skip_reason, blocker_json, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, 'tool', 'running', '[]', '[]', '[]',
                    NULL, NULL, ?4, ?5, ?4, ?5)",
                params![
                    execution_step_id,
                    execution_run_id,
                    todo_item_id,
                    now,
                    now_iso
                ],
            )?;
            conn.execute(
                "INSERT INTO verification_plan (
                    verification_plan_id, session_id, runtime_turn_id, execution_run_id,
                    status, title, required_json, optional_json, not_run_json, source_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'pending', 'Verify', '[]', '[]',
                    '[]', '{}', ?5, ?6, ?5, ?6)",
                params![
                    verification_plan_id,
                    session_id,
                    turn_id,
                    execution_run_id,
                    now,
                    now_iso
                ],
            )?;
            conn.execute(
                "INSERT INTO verification_run (
                    verification_run_id, verification_plan_id, session_id, runtime_turn_id,
                    execution_run_id, kind, status, command, cwd, tool_operation_id,
                    report_artifact_id, evidence_refs_json, exit_code, output_bytes,
                    failure_summary, skip_reason, residual_risk_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'command', 'pending', 'cargo test',
                    NULL, NULL, NULL, '[]', NULL, NULL, NULL, NULL, '{}',
                    ?6, ?7, ?6, ?7)",
                params![
                    verification_run_id,
                    verification_plan_id,
                    session_id,
                    turn_id,
                    execution_run_id,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO completion_audit (
                    completion_audit_id, session_id, runtime_turn_id, execution_run_id,
                    status, summary_json, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'blocked', ?5, ?6, ?7, ?6, ?7)",
                params![
                    completion_audit_id,
                    session_id,
                    turn_id,
                    execution_run_id,
                    json!({
                        "summary": "blocked",
                        "pendingApprovalTicketIds": [approval_ticket_id]
                    })
                    .to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO delivery_proof (
                    delivery_proof_id, session_id, runtime_turn_id, execution_run_id,
                    status, objective_ref, changed_files_refs_json, artifact_refs_json,
                    evidence_refs_json, verification_run_ids_json, completion_audit_id,
                    side_effect_refs_json, unresolved_risks_json, user_visible_summary_ref,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'blocked', NULL, '[]', '[]', '[]',
                    ?5, ?6, '[]', '[]', 'Delivery blocked', ?7, ?8, ?7, ?8)",
                params![
                    delivery_proof_id,
                    session_id,
                    turn_id,
                    execution_run_id,
                    json!([verification_run_id]).to_string(),
                    completion_audit_id,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO native_long_work_goal (
                    goal_id, session_id, status, objective_summary, completion_contract_json,
                    budget_json, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, 'running', 'Goal', '{}', '{}', ?3, ?4, ?3, ?4)",
                params![goal_id, session_id, now, now_iso],
            )?;
            conn.execute(
                "INSERT INTO long_work_run (
                    long_work_run_id, session_id, runtime_turn_id, user_message_id, plan_id,
                    todo_list_id, execution_run_id, goal_id, status, objective_summary,
                    completion_contract_json, budget_json, checkpoint_ids_json,
                    blocker_ids_json, current_slice_id, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, 'running', 'Goal',
                    '{}', '{}', '[]', '[]', ?8, ?9, ?10, ?9, ?10)",
                params![
                    long_work_run_id,
                    session_id,
                    turn_id,
                    user_message_id,
                    todo_list_id,
                    execution_run_id,
                    goal_id,
                    work_slice_id,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO work_slice (
                    work_slice_id, long_work_run_id, session_id, runtime_turn_id,
                    todo_list_id, execution_run_id, status, sequence, stop_cause,
                    model_invocation_ids_json, tool_operation_ids_json, execution_step_ids_json,
                    evidence_refs_json, artifact_refs_json, progress_delta_json,
                    user_visible_output_ref, item_ids_json, checkpoint_ids_json, blocker_ids_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso,
                    closed_at_ms, closed_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', 1, NULL, '[]', '[]',
                    '[]', '[]', '[]', '{}', NULL, '[]', '[]', '[]', ?7, ?8, ?7,
                    ?8, NULL, NULL)",
                params![
                    work_slice_id,
                    long_work_run_id,
                    session_id,
                    turn_id,
                    todo_list_id,
                    execution_run_id,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO long_work_continuation (
                    continuation_id, session_id, long_work_run_id, previous_slice_id,
                    next_slice_sequence, runtime_turn_id, status, recommended_action,
                    packet_json, reason_summary, started_side_effect, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso, consumed_at_ms,
                    consumed_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 2, ?5, 'queued', 'continue',
                    '{}', 'continue', 0, ?6, ?7, ?6, ?7, NULL, NULL)",
                params![
                    continuation_id,
                    session_id,
                    long_work_run_id,
                    work_slice_id,
                    turn_id,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO follow_session (
                    follow_session_id, session_id, runtime_turn_id, user_message_id,
                    long_work_run_id, status, active_target_id, target_ids_json,
                    event_stream_ref, created_at_ms, created_at_iso, updated_at_ms,
                    updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'enabled', ?6, ?7, 'agent.runtime',
                    ?8, ?9, ?8, ?9)",
                params![
                    follow_session_id,
                    session_id,
                    turn_id,
                    user_message_id,
                    long_work_run_id,
                    follow_target_id,
                    json!([follow_target_id]).to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO follow_target (
                    follow_target_id, follow_session_id, session_id, runtime_turn_id,
                    work_slice_id, kind, title, resource_ref, workspace_uri, status,
                    tool_operation_id, artifact_refs_json, evidence_refs_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'file', 'README.md', NULL,
                    'README.md', 'active', NULL, '[]', '[]', ?6, ?7, ?6, ?7)",
                params![
                    follow_target_id,
                    follow_session_id,
                    session_id,
                    turn_id,
                    work_slice_id,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO follow_event (
                    follow_event_id, follow_session_id, follow_target_id, session_id,
                    runtime_turn_id, tool_operation_id, work_slice_id, event_type,
                    payload_ref, payload_json, sequence, created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, 'follow_started', NULL,
                    ?7, 1, ?8, ?9)",
                params![
                    follow_event_id,
                    follow_session_id,
                    follow_target_id,
                    session_id,
                    turn_id,
                    work_slice_id,
                    json!({ "label": "Following", "status": "active" }).to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO live_edit_stream (
                    live_edit_id, follow_session_id, follow_target_id, path, base_revision_id,
                    status, draft_buffer_ref, commit_operation_id, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, 'README.md', NULL, 'drafting', NULL, NULL,
                    ?4, ?5, ?4, ?5)",
                params![
                    live_edit_id,
                    follow_session_id,
                    follow_target_id,
                    now,
                    now_iso
                ],
            )?;
            Ok(())
        })
        .expect("seed active branch records");

    BranchRecordIds {
        approval_ticket_id,
        todo_list_id,
        execution_run_id,
        verification_run_id,
        completion_audit_id,
        delivery_proof_id,
        long_work_run_id,
        continuation_id,
        follow_session_id,
        follow_event_id,
        live_edit_id,
    }
}

fn row_status(store: &AiStore, session_id: &str, table: &str, id_column: &str, id: &str) -> String {
    store
        .with_session_conn(session_id, |conn| {
            conn.query_row(
                &format!("SELECT status FROM {table} WHERE {id_column} = ?1"),
                params![id],
                |row| row.get(0),
            )
            .context("status")
        })
        .expect("row status")
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

#[test]
fn rollback_execute_missing_preview_returns_clear_error() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session, _turn_id, _user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());

    let error = execute_message_rollback(AgentExecuteMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session.id,
        rollback_id: "rollback-missing".to_string(),
        confirmation_token: Some("restore".to_string()),
        strategy: None,
    })
    .expect_err("missing preview");

    assert!(error
        .to_string()
        .contains("rollback preview not found: rollback-missing"));
}

#[test]
fn rollback_execute_blocks_conflict_preview_without_restoring() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    run_apply_patch(
        &store,
        &session.id,
        &turn_id,
        temp.path().to_string_lossy().as_ref(),
    );
    fs::write(temp.path().join("README.md"), "user drift\n").expect("drift");
    let preview = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session.id.clone(),
        target_user_message_id: user_message_id,
    })
    .expect("preview");

    let result = execute_preview(&storage_root, &session.id, &preview.rollback_id);

    assert_eq!(preview.impact_level, "conflict");
    assert_eq!(result.status, "blocked");
    assert!(result.detail.contains("TOOL_ROLLBACK_CONFLICT"));
    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).expect("readme"),
        "user drift\n"
    );
}

#[test]
fn rollback_execute_blocks_external_side_effect_preview() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let side_effect_id = store
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
    let preview = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session.id.clone(),
        target_user_message_id: user_message_id,
    })
    .expect("preview");

    let result = execute_preview(&storage_root, &session.id, &preview.rollback_id);

    assert_eq!(preview.impact_level, "external_side_effect");
    assert_eq!(result.status, "blocked");
    assert!(result.detail.contains("TOOL_ROLLBACK_EXTERNAL_SIDE_EFFECT"));
    assert_eq!(result.unresolved_side_effect_ids, vec![side_effect_id]);
}

#[test]
fn rollback_execute_blocks_workspace_drift_between_preview_and_execute() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    run_apply_patch(
        &store,
        &session.id,
        &turn_id,
        temp.path().to_string_lossy().as_ref(),
    );
    let preview = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session.id.clone(),
        target_user_message_id: user_message_id,
    })
    .expect("preview");
    fs::write(temp.path().join("README.md"), "late drift\n").expect("drift");

    let result = execute_preview(&storage_root, &session.id, &preview.rollback_id);

    assert_eq!(preview.impact_level, "safe");
    assert_eq!(result.status, "blocked");
    assert!(result
        .detail
        .contains("workspace changed since rollback preview"));
    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).expect("readme"),
        "late drift\n"
    );
}

#[test]
fn rollback_execute_safe_preview_restores_workspace_and_reopens_message() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    run_apply_patch(
        &store,
        &session.id,
        &turn_id,
        temp.path().to_string_lossy().as_ref(),
    );
    let created_artifact = seed_created_file_artifact(&store, &session.id, &turn_id);
    run_apply_patch_artifact(
        &store,
        &session.id,
        &turn_id,
        temp.path().to_string_lossy().as_ref(),
        created_artifact,
        "op-apply-created",
    );
    let assistant_id = append_later_assistant_message(&store, &session.id, &turn_id);
    let preview = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session.id.clone(),
        target_user_message_id: user_message_id.clone(),
    })
    .expect("preview");

    let result = execute_preview(&storage_root, &session.id, &preview.rollback_id);
    let repeated = execute_preview(&storage_root, &session.id, &preview.rollback_id);
    let detail = store
        .read_session_detail(&session.id)
        .expect("detail")
        .expect("session");

    assert_eq!(preview.impact_level, "safe");
    assert_eq!(result.status, "completed");
    assert_eq!(repeated.status, "completed");
    assert_eq!(
        fs::read_to_string(temp.path().join("README.md")).expect("readme"),
        "old\n"
    );
    assert!(temp.path().join("NEW.md").exists() == false);
    assert!(result.artifact_id.is_some());
    assert!(result.evidence_id.is_some());
    assert_eq!(
        result.reopened_user_message_id.as_deref(),
        Some(user_message_id.as_str())
    );
    assert!(result
        .superseded_message_ids
        .iter()
        .any(|message_id| message_id == &assistant_id));
    assert!(detail
        .messages
        .iter()
        .any(|message| message.id == user_message_id));
    assert!(detail
        .messages
        .iter()
        .all(|message| message.id != assistant_id));
    assert_eq!(
        detail
            .recovery_summary
            .as_ref()
            .and_then(|summary| summary.latest_execution.as_ref())
            .map(|execution| execution.status.as_str()),
        Some("completed")
    );
    assert_eq!(
        detail
            .recovery_summary
            .as_ref()
            .and_then(|summary| summary.reopened_message_id.as_deref()),
        Some(user_message_id.as_str())
    );
}

#[test]
fn rollback_execute_supersedes_active_branch_projections_and_live_drafts() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    run_apply_patch(
        &store,
        &session.id,
        &turn_id,
        temp.path().to_string_lossy().as_ref(),
    );
    let branch = seed_active_branch_records_after_checkpoint(
        &store,
        &session.id,
        &turn_id,
        &user_message_id,
    );
    let preview = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session.id.clone(),
        target_user_message_id: user_message_id,
    })
    .expect("preview");

    let result = execute_preview(&storage_root, &session.id, &preview.rollback_id);
    let detail = store
        .read_session_detail(&session.id)
        .expect("detail")
        .expect("session");

    assert_eq!(result.status, "completed");
    assert!(detail.pending_interactions.is_empty());
    assert!(detail.active_todo.is_none());
    assert!(detail.execution_summary.is_none());
    assert!(detail.verification_summary.is_none());
    assert!(detail.completion_audit.is_none());
    assert!(detail.delivery_proof.is_none());
    assert!(detail.durable_work_summary.is_none());
    assert!(detail.follow_summary.is_none());
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "approval_ticket",
            "approval_ticket_id",
            &branch.approval_ticket_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "execution_todo_list",
            "todo_list_id",
            &branch.todo_list_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "execution_run",
            "execution_run_id",
            &branch.execution_run_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "verification_run",
            "verification_run_id",
            &branch.verification_run_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "completion_audit",
            "completion_audit_id",
            &branch.completion_audit_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "delivery_proof",
            "delivery_proof_id",
            &branch.delivery_proof_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "long_work_run",
            "long_work_run_id",
            &branch.long_work_run_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "long_work_continuation",
            "continuation_id",
            &branch.continuation_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "follow_session",
            "follow_session_id",
            &branch.follow_session_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "follow_event",
            "follow_event_id",
            &branch.follow_event_id,
        ),
        "superseded_by_rollback"
    );
    assert_eq!(
        row_status(
            &store,
            &session.id,
            "live_edit_stream",
            "live_edit_id",
            &branch.live_edit_id,
        ),
        "discarded"
    );
}
