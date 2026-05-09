use super::*;
use crate::storage::{
    AppendLiveEditDeltaInput, CommitLiveEditInput, DiscardLiveEditInput, StartLiveEditInput,
};
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
        title: "Live draft test".to_string(),
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
        permission_mode: "full_access".to_string(),
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
        content: "edit README".to_string(),
        content_parts: None,
        display_content: Some("edit README".to_string()),
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

fn seed_diff_artifact(store: &AiStore, session_id: &str, turn_id: &str) -> String {
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
            "op-propose-live",
            TOOL_FS_PROPOSE_PATCH,
            "completed",
            "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n",
        )
        .expect("patch blob");
    store
        .append_patch_artifact_and_evidence(
            session_id,
            turn_id,
            "op-propose-live",
            "Patch README",
            &blob.result_ref,
            json!({ "changedFiles": changed_files.clone() }),
            changed_files,
        )
        .expect("artifact")
        .artifact_id
}

fn run_apply_patch(
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

fn start_live_edit(store: &AiStore, session_id: &str, path: &str) -> String {
    let summary = store
        .start_follow_live_edit(StartLiveEditInput {
            session_id: session_id.to_string(),
            follow_session_id: None,
            follow_target_id: None,
            path: path.to_string(),
            base_revision_id: Some("base-1".to_string()),
            draft_buffer_ref: None,
        })
        .expect("start live edit")
        .expect("follow summary");
    summary.active_live_draft.expect("live draft").live_edit_id
}

fn live_edit_status(store: &AiStore, session_id: &str, live_edit_id: &str) -> String {
    store
        .with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT status FROM live_edit_stream WHERE live_edit_id = ?1",
                params![live_edit_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
        })
        .expect("live edit status")
}

#[test]
fn live_edit_start_append_large_delta_and_summary() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session, _turn_id, _user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let live_edit_id = start_live_edit(&store, &session.id, "src/lib.rs");

    let first = store
        .append_follow_live_edit_delta(AppendLiveEditDeltaInput {
            session_id: session.id.clone(),
            live_edit_id: live_edit_id.clone(),
            kind: "insert".to_string(),
            range: json!({ "start": 0, "end": 0 }),
            text_delta: Some("fn main() {}\n".to_string()),
            text_delta_ref: None,
            payload: json!({ "source": "test" }),
            ready_to_commit: false,
        })
        .expect("append first")
        .expect("summary");
    let large_delta = "x".repeat(5000);
    let second = store
        .append_follow_live_edit_delta(AppendLiveEditDeltaInput {
            session_id: session.id.clone(),
            live_edit_id: live_edit_id.clone(),
            kind: "replace".to_string(),
            range: json!({ "start": 0, "end": 12 }),
            text_delta: Some(large_delta),
            text_delta_ref: None,
            payload: json!({ "source": "test" }),
            ready_to_commit: true,
        })
        .expect("append second")
        .expect("summary");
    let (sequences, text_delta_ref) = store
        .with_session_conn(&session.id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT sequence FROM live_edit_delta
                 WHERE live_edit_id = ?1
                 ORDER BY sequence ASC",
            )?;
            let rows = stmt.query_map(params![live_edit_id], |row| row.get::<_, i64>(0))?;
            let mut sequences = Vec::new();
            for row in rows {
                sequences.push(row?);
            }
            let text_delta_ref = conn.query_row(
                "SELECT text_delta_ref FROM live_edit_delta
                 WHERE live_edit_id = ?1 AND sequence = 2",
                params![live_edit_id],
                |row| row.get::<_, Option<String>>(0),
            )?;
            Ok((sequences, text_delta_ref))
        })
        .expect("deltas");
    let text_delta_ref = text_delta_ref.expect("large ref");

    assert_eq!(first.active_live_draft.expect("draft").status, "drafting");
    let ready = second.active_live_draft.expect("ready draft");
    assert_eq!(ready.status, "ready_to_commit");
    assert_eq!(ready.delta_count, 2);
    assert_eq!(sequences, vec![1, 2]);
    assert!(store
        .session_dir(&session.id)
        .join("follow-live-drafts")
        .join(text_delta_ref)
        .is_file());
}

#[test]
fn live_edit_commit_requires_recorded_operation_and_discard_marks_status() {
    let temp = tempfile::tempdir().expect("tempdir");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session, turn_id, _user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let live_edit_id = start_live_edit(&store, &session.id, "README.md");

    let missing_operation = store
        .commit_follow_live_edit(CommitLiveEditInput {
            session_id: session.id.clone(),
            live_edit_id: live_edit_id.clone(),
            tool_operation_id: "op-missing".to_string(),
        })
        .expect_err("missing operation");
    assert!(missing_operation
        .to_string()
        .contains("toolOperationId does not reference a recorded operation"));
    store
        .append_tool_result_blob(
            &session.id,
            &turn_id,
            "op-live",
            TOOL_FS_APPLY_PATCH,
            "completed",
            "{}",
        )
        .expect("tool result");
    let committed = store
        .commit_follow_live_edit(CommitLiveEditInput {
            session_id: session.id.clone(),
            live_edit_id: live_edit_id.clone(),
            tool_operation_id: "op-live".to_string(),
        })
        .expect("commit")
        .expect("summary")
        .active_live_draft
        .expect("committed draft");
    let discarded_id = start_live_edit(&store, &session.id, "src/lib.rs");
    store
        .discard_follow_live_edit(DiscardLiveEditInput {
            session_id: session.id.clone(),
            live_edit_id: discarded_id.clone(),
            reason: Some("test discard".to_string()),
        })
        .expect("discard");

    assert_eq!(committed.status, "committed");
    assert_eq!(committed.commit_operation_id.as_deref(), Some("op-live"));
    assert_eq!(
        live_edit_status(&store, &session.id, &discarded_id),
        "discarded"
    );
}

#[test]
fn live_edit_apply_patch_binds_matching_draft_to_workspace_commit() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let store =
        AiStore::open(Some(temp.path().join("ai").to_string_lossy().as_ref())).expect("store");
    let (session, turn_id, _user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let live_edit_id = start_live_edit(&store, &session.id, "README.md");
    let artifact_id = seed_diff_artifact(&store, &session.id, &turn_id);

    run_apply_patch(
        &store,
        &session.id,
        &turn_id,
        temp.path().to_string_lossy().as_ref(),
        artifact_id,
        "op-apply-live",
    );
    let summary = store
        .read_follow_summary(&session.id)
        .expect("follow")
        .expect("summary")
        .active_live_draft
        .expect("live draft");
    let bound_count: i64 = store
        .with_session_conn(&session.id, |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM workspace_commit
                 WHERE live_edit_id = ?1 AND tool_operation_id = 'op-apply-live'",
                params![live_edit_id],
                |row| row.get(0),
            )
            .map_err(Into::into)
        })
        .expect("bound commit count");

    assert_eq!(summary.status, "committed");
    assert_eq!(
        summary.commit_operation_id.as_deref(),
        Some("op-apply-live")
    );
    assert_eq!(bound_count, 1);
}

#[test]
fn live_edit_rollback_execution_discards_uncommitted_draft() {
    let temp = tempfile::tempdir().expect("tempdir");
    fs::write(temp.path().join("README.md"), "old\n").expect("readme");
    let storage_root = temp.path().join("ai").to_string_lossy().to_string();
    let store = AiStore::open(Some(storage_root.as_str())).expect("store");
    let (session, turn_id, user_message_id) =
        seed_turn(&store, temp.path().to_string_lossy().as_ref());
    let artifact_id = seed_diff_artifact(&store, &session.id, &turn_id);
    run_apply_patch(
        &store,
        &session.id,
        &turn_id,
        temp.path().to_string_lossy().as_ref(),
        artifact_id,
        "op-apply-rollback-live",
    );
    let live_edit_id = start_live_edit(&store, &session.id, "README.md");
    let preview = preview_message_rollback(AgentPreviewMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session.id.clone(),
        target_user_message_id: user_message_id,
    })
    .expect("preview");

    let result = execute_message_rollback(AgentExecuteMessageRollbackRequest {
        storage: storage_request(&storage_root),
        session_id: session.id.clone(),
        rollback_id: preview.rollback_id,
        confirmation_token: Some("restore".to_string()),
        strategy: None,
    })
    .expect("execute");

    assert_eq!(result.status, "completed");
    assert_eq!(
        live_edit_status(&store, &session.id, &live_edit_id),
        "discarded"
    );
}
