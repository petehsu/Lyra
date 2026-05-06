use super::*;

pub(super) fn migrate_recovery_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS conversation_snapshot (
            conversation_snapshot_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            visible_message_ids_json TEXT NOT NULL,
            active_cursor_message_id TEXT,
            open_panel_ids_json TEXT NOT NULL,
            open_follow_session_ids_json TEXT NOT NULL,
            active_plan_ids_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspace_snapshot (
            workspace_snapshot_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            workspace_root TEXT,
            status TEXT NOT NULL,
            file_count INTEGER NOT NULL,
            source TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workspace_file_snapshot (
            workspace_file_snapshot_id TEXT PRIMARY KEY,
            workspace_snapshot_id TEXT NOT NULL,
            path TEXT NOT NULL,
            exists_at_snapshot INTEGER NOT NULL,
            content_hash TEXT,
            content_ref TEXT,
            size_bytes INTEGER NOT NULL,
            encoding TEXT,
            unavailable_reason TEXT,
            captured_at_ms INTEGER NOT NULL,
            captured_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS message_rollback_anchor (
            anchor_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            checkpoint_id TEXT NOT NULL,
            conversation_snapshot_id TEXT NOT NULL,
            workspace_snapshot_id TEXT NOT NULL,
            created_before_agent_response INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS message_rollback_anchor_active_user_idx
            ON message_rollback_anchor(session_id, user_message_id)
            WHERE status = 'active';
        CREATE TABLE IF NOT EXISTS side_effect_record (
            side_effect_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            user_message_id TEXT,
            tool_operation_id TEXT,
            kind TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            rollback_status TEXT NOT NULL,
            evidence_ref TEXT,
            follow_target_id TEXT,
            artifact_refs_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS side_effect_record_session_idx
            ON side_effect_record(session_id, created_at_ms);
        CREATE INDEX IF NOT EXISTS side_effect_record_tool_idx
            ON side_effect_record(session_id, tool_operation_id);
        CREATE TABLE IF NOT EXISTS rollback_preview (
            rollback_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            target_user_message_id TEXT NOT NULL,
            checkpoint_id TEXT NOT NULL,
            impact_level TEXT NOT NULL,
            conversation_changes_json TEXT NOT NULL,
            workspace_changes_json TEXT NOT NULL,
            artifact_changes_json TEXT NOT NULL,
            panel_changes_json TEXT NOT NULL,
            process_changes_json TEXT NOT NULL,
            external_side_effects_json TEXT NOT NULL,
            requires_confirmation INTEGER NOT NULL,
            status TEXT NOT NULL,
            preview_artifact_id TEXT,
            evidence_id TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS rollback_preview_session_idx
            ON rollback_preview(session_id, target_user_message_id, updated_at_ms);
        ",
    )?;
    Ok(())
}
