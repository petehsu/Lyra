use super::*;
use crate::storage::{
    AgentLongWorkSummary, AgentSession, AgentTurn, CreateLongWorkRunInput, CreatedTodoRefs,
};
use crate::tool_runtime::catalog::{
    TOOL_FS_APPLY_PATCH, TOOL_FS_ROLLBACK_PATCH, TOOL_SHELL_RUN_COMMAND,
};
use std::fs;

fn storage_request(storage_root: &str) -> StorageRequest {
    StorageRequest {
        storage_root: Some(storage_root.to_string()),
    }
}

fn seed_turn(store: &AiStore, workspace_root: &str) -> (String, String, String) {
    let now = now_ms();
    let session = AgentSession {
        id: new_id("session"),
        title: "Follow test".to_string(),
        profile_id: Some("profile-test".to_string()),
        model_id: None,
        system_prompt: None,
        permission_mode: None,
        execution_target: None,
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
        permission_mode: "sandbox".to_string(),
        execution_target: "host".to_string(),
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
        content: "implement change".to_string(),
        content_parts: None,
        display_content: Some("implement change".to_string()),
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
    (session.id, turn.id, user_message.id)
}

fn seed_todo_for_tool(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    tool_path: &str,
) -> CreatedTodoRefs {
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
        .expect("todo")
}

fn seed_run_for_refs(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    user_message_id: &str,
    refs: &CreatedTodoRefs,
) -> AgentLongWorkSummary {
    store
        .create_long_work_run(CreateLongWorkRunInput {
            session_id: session_id.to_string(),
            runtime_turn_id: Some(turn_id.to_string()),
            user_message_id: Some(user_message_id.to_string()),
            plan_id: None,
            todo_list_id: refs.todo_list_id.clone(),
            execution_run_id: refs.execution_run_id.clone(),
            objective_summary: "Execute follow test work".to_string(),
            completion_contract: json!({ "type": "test" }),
            budget: json!({}),
            checkpoint_ids: Vec::new(),
        })
        .expect("work run")
        .summary
}

fn seed_diff_artifact(store: &AiStore, session_id: &str, turn_id: &str) -> (String, String) {
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
            "/tools/filesystem/propose_patch",
            "completed",
            patch,
        )
        .expect("patch blob");
    let refs = store
        .append_patch_artifact_and_evidence(
            session_id,
            turn_id,
            "op-propose",
            "Patch README",
            &blob.result_ref,
            json!({ "changedFiles": changed_files.clone() }),
            changed_files,
        )
        .expect("artifact");
    (refs.artifact_id, blob.result_ref)
}

#[test]
fn follow_schema_creates_tables_and_session_detail_is_empty_without_follow() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store = AiStore::open(Some(temp.path().to_string_lossy().as_ref())).expect("store");
    let (session_id, _turn_id, _message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());

    for table in [
        "follow_session",
        "follow_target",
        "follow_event",
        "live_edit_stream",
        "workspace_commit",
    ] {
        assert_eq!(
            store
                .count_rows_for_test(&session_id, table)
                .expect("count"),
            0
        );
    }
    let detail = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session");
    assert!(detail.follow_summary.is_none());
}

#[test]
fn follow_enabled_send_creates_summary_but_pure_chat_without_follow_does_not() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let followed = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: RuntimeTurnInput {
            text: "what is this project?".to_string(),
            attachments: Vec::new(),
            parts: Vec::new(),
            ui_action: None,
        },
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            follow_enabled: Some(true),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    assert_eq!(
        followed
            .detail
            .follow_summary
            .as_ref()
            .expect("follow")
            .status,
        "enabled"
    );

    let plain = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: RuntimeTurnInput {
            text: "what is this project?".to_string(),
            attachments: Vec::new(),
            parts: Vec::new(),
            ui_action: None,
        },
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");
    assert!(plain.detail.follow_summary.is_none());
}

#[test]
fn long_work_send_creates_follow_summary() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let result = send_turn(SendTurnRequest {
        storage: storage_request(&storage_root),
        session_id: None,
        input: RuntimeTurnInput {
            text: "实现一个小的 runtime ledger 改动".to_string(),
            attachments: Vec::new(),
            parts: Vec::new(),
            ui_action: None,
        },
        options: RuntimeThreadOptions {
            profile_id: Some("profile-test".to_string()),
            cwd: Some(temp.path().to_string_lossy().to_string()),
            ..RuntimeThreadOptions::default()
        },
    })
    .expect("send");

    let work = result.detail.durable_work_summary.as_ref().expect("work");
    let follow = result.detail.follow_summary.as_ref().expect("follow");
    assert_eq!(follow.status, "auto_following");
    assert_eq!(
        follow.long_work_run_id.as_deref(),
        Some(work.long_work_run_id.as_str())
    );
}

#[test]
fn follow_reuses_session_for_continuation_resume() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    let run = seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    ensure_follow_for_long_work(&store, &run).expect("follow");

    store
        .evaluate_completion_audit_and_delivery_proof(&session_id, Some(&turn_id))
        .expect("audit");
    let projection = project_work_after_model_candidate(
        &store,
        &session_id,
        Some(&turn_id),
        "Done. Everything is complete.",
    )
    .expect("projection");
    assert!(projection.suppress_user_output);
    let continuation_id = store
        .read_session_detail(&session_id)
        .expect("detail")
        .expect("session")
        .durable_work_summary
        .and_then(|summary| summary.continuation)
        .map(|continuation| continuation.continuation_id)
        .expect("continuation");
    let before = store
        .read_follow_summary(&session_id)
        .expect("follow")
        .expect("summary");
    resume_work_continuation(&store, &session_id, &continuation_id).expect("resume");
    let after = store
        .read_follow_summary(&session_id)
        .expect("follow")
        .expect("summary");

    assert_eq!(before.follow_session_id, after.follow_session_id);
    assert!(after
        .recent_events
        .iter()
        .any(|event| event.label == "Continuation resumed"));
}

#[test]
fn follow_projects_apply_patch_rollback_and_workspace_commits() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_FS_APPLY_PATCH);
    let run = seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    ensure_follow_for_long_work(&store, &run).expect("follow");
    let (artifact_id, patch_ref) = seed_diff_artifact(&store, &session_id, &turn_id);
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
    .expect("apply");
    let applied = store
        .find_applied_patch_artifact(&session_id, &artifact_id, &patch_ref)
        .expect("find applied")
        .expect("applied");
    assert_eq!(
        store
            .count_rows_for_test(&session_id, "workspace_commit")
            .expect("commit count"),
        1
    );
    let follow = store
        .read_follow_summary(&session_id)
        .expect("follow")
        .expect("summary");
    assert_eq!(follow.active_target.as_ref().expect("target").kind, "diff");
    assert_eq!(
        follow
            .active_target
            .as_ref()
            .expect("target")
            .workspace_uri
            .as_deref(),
        Some("README.md")
    );

    let rollback = ToolOperationEnvelope {
        schema_version: "v1".to_string(),
        kind: "tool_operation".to_string(),
        op_id: "op-rollback".to_string(),
        op: ToolFsOp::Run,
        path: TOOL_FS_ROLLBACK_PATCH.to_string(),
        args: json!({ "appliedArtifactId": applied.artifact_id }),
    };
    inspected.insert(TOOL_FS_ROLLBACK_PATCH.to_string());
    run_tool_operation(
        &store,
        &session_id,
        &turn_id,
        &ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        },
        &rollback,
        PermissionMode::FullAccess,
        &mut messages,
        &mut inspected,
    )
    .expect("rollback");

    let statuses = store
        .with_session_conn(&session_id, |conn| {
            let mut stmt =
                conn.prepare("SELECT status FROM workspace_commit ORDER BY created_at_ms ASC")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
            let mut statuses = Vec::new();
            for row in rows {
                statuses.push(row?);
            }
            Ok(statuses)
        })
        .expect("statuses");
    assert!(statuses.iter().any(|status| status == "rolled_back"));
    assert!(statuses.iter().any(|status| status == "committed"));
}

#[test]
fn follow_projects_command_success_failure_and_verification_refs() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let refs = seed_todo_for_tool(&store, &session_id, &turn_id, TOOL_SHELL_RUN_COMMAND);
    let run = seed_run_for_refs(&store, &session_id, &turn_id, &user_message_id, &refs);
    ensure_follow_for_long_work(&store, &run).expect("follow");
    let mut messages = Vec::new();
    let mut inspected = HashSet::from([TOOL_SHELL_RUN_COMMAND.to_string()]);

    for (op_id, argv) in [
        ("op-test-pass", vec!["echo", "ok"]),
        ("op-test-fail", vec!["sh", "-c", "exit 2"]),
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
                "purpose": "test"
            }),
        };
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
        .expect("command");
    }

    let follow = store
        .read_follow_summary(&session_id)
        .expect("follow")
        .expect("summary");
    let target = follow.active_target.as_ref().expect("active target");
    assert_eq!(target.kind, "test_report");
    assert_eq!(target.status, "failed");
    assert!(target.artifact_refs.is_empty() == false);
    assert!(target.evidence_refs.is_empty() == false);
    assert!(follow
        .recent_events
        .iter()
        .any(|event| event.label == "Tests failed"));
}

#[test]
fn follow_pause_resume_records_monotonic_events() {
    let temp = tempfile::tempdir().expect("tempdir");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(&storage_root)).expect("store");
    let (session_id, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    ensure_follow_for_turn(&store, &session_id, &turn_id, &user_message_id).expect("follow");

    let paused = pause_follow(AgentPauseFollowRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        follow_session_id: None,
    })
    .expect("pause")
    .expect("summary");
    assert_eq!(paused.status, "paused_by_user");
    let resumed = resume_follow(AgentResumeFollowRequest {
        storage: storage_request(&storage_root),
        session_id: session_id.clone(),
        follow_session_id: None,
    })
    .expect("resume")
    .expect("summary");
    assert_eq!(resumed.status, "enabled");

    let sequences = store
        .with_session_conn(&session_id, |conn| {
            let mut stmt =
                conn.prepare("SELECT sequence FROM follow_event ORDER BY sequence ASC")?;
            let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
            let mut sequences = Vec::new();
            for row in rows {
                sequences.push(row?);
            }
            Ok(sequences)
        })
        .expect("sequences");
    assert_eq!(sequences, vec![1, 2]);
}
