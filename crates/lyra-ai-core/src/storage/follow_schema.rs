use anyhow::Result;
use rusqlite::Connection;

pub(super) fn migrate_follow_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS follow_session (
            follow_session_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            user_message_id TEXT,
            long_work_run_id TEXT,
            status TEXT NOT NULL,
            active_target_id TEXT,
            target_ids_json TEXT NOT NULL,
            event_stream_ref TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS follow_target (
            follow_target_id TEXT PRIMARY KEY,
            follow_session_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            work_slice_id TEXT,
            kind TEXT NOT NULL,
            title TEXT NOT NULL,
            resource_ref TEXT,
            workspace_uri TEXT,
            status TEXT NOT NULL,
            tool_operation_id TEXT,
            artifact_refs_json TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS follow_event (
            follow_event_id TEXT PRIMARY KEY,
            follow_session_id TEXT NOT NULL,
            follow_target_id TEXT,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            tool_operation_id TEXT,
            work_slice_id TEXT,
            event_type TEXT NOT NULL,
            payload_ref TEXT,
            payload_json TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS live_edit_stream (
            live_edit_id TEXT PRIMARY KEY,
            follow_session_id TEXT NOT NULL,
            follow_target_id TEXT NOT NULL,
            path TEXT NOT NULL,
            base_revision_id TEXT,
            status TEXT NOT NULL,
            draft_buffer_ref TEXT,
            commit_operation_id TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspace_commit (
            workspace_commit_id TEXT PRIMARY KEY,
            follow_session_id TEXT NOT NULL,
            follow_target_id TEXT,
            live_edit_id TEXT,
            path TEXT NOT NULL,
            base_revision_id TEXT,
            final_revision_id TEXT,
            tool_operation_id TEXT,
            method TEXT NOT NULL,
            diff_ref TEXT,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS follow_session_session_idx
            ON follow_session(session_id, status, updated_at_ms);
        CREATE INDEX IF NOT EXISTS follow_target_session_idx
            ON follow_target(follow_session_id, updated_at_ms);
        CREATE INDEX IF NOT EXISTS follow_target_operation_idx
            ON follow_target(follow_session_id, tool_operation_id);
        CREATE INDEX IF NOT EXISTS follow_event_sequence_idx
            ON follow_event(follow_session_id, sequence);
        CREATE INDEX IF NOT EXISTS workspace_commit_session_idx
            ON workspace_commit(follow_session_id, tool_operation_id, status);
        ",
    )?;
    Ok(())
}
