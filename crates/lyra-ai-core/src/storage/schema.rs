use anyhow::{Context, Result};
use rusqlite::Connection;
use std::time::Duration;

pub(super) fn configure_conn(conn: &Connection) -> Result<()> {
    conn.busy_timeout(Duration::from_secs(10))
        .context("failed to configure AI database busy timeout")?;
    conn.execute_batch("PRAGMA busy_timeout = 10000;")?;
    Ok(())
}

pub(super) fn migrate_index(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS ai_profile (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            protocol_id TEXT NOT NULL,
            runtime_provider_id TEXT NOT NULL,
            runtime_supported INTEGER NOT NULL,
            preset_id TEXT,
            connection_config_json TEXT NOT NULL,
            auth_config_json TEXT NOT NULL,
            headers_json TEXT NOT NULL,
            model TEXT NOT NULL,
            model_runtime_metadata_json TEXT,
            custom_models_json TEXT NOT NULL,
            discovery_state_json TEXT NOT NULL,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS profile_secret (
            profile_id TEXT NOT NULL,
            field_id TEXT NOT NULL,
            secret_ref_id TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(profile_id, field_id)
        );
        CREATE TABLE IF NOT EXISTS agent_session_index (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            profile_id TEXT,
            model_id TEXT,
            system_prompt TEXT,
            permission_mode TEXT,
            execution_target TEXT,
            project_root TEXT,
            project_name TEXT,
            collaboration_mode TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )?;
    ensure_column(conn, "agent_session_index", "model_id", "TEXT")?;
    ensure_column(conn, "agent_session_index", "system_prompt", "TEXT")?;
    ensure_column(conn, "agent_session_index", "permission_mode", "TEXT")?;
    ensure_column(conn, "agent_session_index", "execution_target", "TEXT")?;
    Ok(())
}

pub(super) fn migrate_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS session_dialog (
            msg_id TEXT PRIMARY KEY,
            turn_index INTEGER NOT NULL,
            role TEXT NOT NULL,
            content_raw TEXT NOT NULL,
            content_parts_json TEXT,
            token_count INTEGER NOT NULL DEFAULT 0,
            char_count INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            metadata_json TEXT NOT NULL,
            stream_id TEXT,
            turn_id TEXT
        );
        CREATE TABLE IF NOT EXISTS runtime_turn (
            runtime_turn_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            profile_id TEXT NOT NULL,
            status TEXT NOT NULL,
            current_state TEXT NOT NULL,
            collaboration_mode TEXT,
            permission_mode TEXT NOT NULL DEFAULT 'sandbox',
            execution_target TEXT NOT NULL DEFAULT 'host',
            project_policy_snapshot_id TEXT,
            security_policy_snapshot_id TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            error_code TEXT,
            error_message TEXT,
            usage_json TEXT
        );
        CREATE TABLE IF NOT EXISTS runtime_event (
            event_id TEXT PRIMARY KEY,
            sequence INTEGER NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS runtime_event_sequence_idx ON runtime_event(sequence);
        CREATE TABLE IF NOT EXISTS tool_result_blob (
            result_ref TEXT PRIMARY KEY,
            runtime_turn_id TEXT NOT NULL,
            op_id TEXT NOT NULL,
            tool_path TEXT NOT NULL,
            status TEXT NOT NULL,
            content_json TEXT NOT NULL,
            content_sha256 TEXT NOT NULL,
            content_bytes INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS artifact_record (
            artifact_id TEXT PRIMARY KEY,
            artifact_version_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            title TEXT NOT NULL,
            content_ref TEXT NOT NULL,
            projection_ref TEXT,
            metadata_json TEXT NOT NULL,
            source_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS evidence_record (
            evidence_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            claim_json TEXT NOT NULL,
            artifact_ids_json TEXT NOT NULL,
            tool_operation_ids_json TEXT NOT NULL,
            confidence TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            stale_reason TEXT
        );
        CREATE TABLE IF NOT EXISTS approval_ticket (
            approval_ticket_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            status TEXT NOT NULL,
            approval_mode TEXT NOT NULL,
            title TEXT NOT NULL,
            risk_summary_json TEXT NOT NULL,
            impact_scope_json TEXT NOT NULL,
            requested_action_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS file_backup_record (
            backup_ref TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            approval_ticket_id TEXT NOT NULL,
            source_artifact_id TEXT NOT NULL,
            patch_ref TEXT NOT NULL,
            path TEXT NOT NULL,
            existed INTEGER NOT NULL,
            content_ref TEXT,
            content_sha256 TEXT,
            content_bytes INTEGER NOT NULL,
            post_apply_sha256 TEXT,
            post_apply_bytes INTEGER,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS timeline_checkpoint (
            checkpoint_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            conversation_snapshot_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS planning_session (
            planning_session_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            status TEXT NOT NULL,
            title TEXT NOT NULL,
            objective_summary TEXT NOT NULL,
            source_json TEXT NOT NULL,
            active_version_id TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plan_version (
            plan_version_id TEXT PRIMARY KEY,
            planning_session_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            version_number INTEGER NOT NULL,
            status TEXT NOT NULL,
            version_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plan_review_panel (
            panel_id TEXT PRIMARY KEY,
            planning_session_id TEXT NOT NULL,
            plan_version_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plan_review_annotation (
            annotation_id TEXT PRIMARY KEY,
            panel_id TEXT NOT NULL,
            planning_session_id TEXT NOT NULL,
            plan_version_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            block_id TEXT,
            anchor TEXT NOT NULL,
            note TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plan_coverage_report (
            coverage_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            plan_id TEXT NOT NULL,
            approved_version_id TEXT NOT NULL,
            todo_list_id TEXT,
            execution_run_id TEXT,
            status TEXT NOT NULL,
            covered_plan_step_ids_json TEXT NOT NULL,
            missing_plan_step_ids_json TEXT NOT NULL,
            extra_todo_item_ids_json TEXT NOT NULL,
            risk_mismatches_json TEXT NOT NULL,
            verification_gaps_json TEXT NOT NULL,
            missing_reference_ids_json TEXT NOT NULL,
            mismatched_reference_ids_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS execution_todo_list (
            todo_list_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            source_json TEXT NOT NULL,
            title TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS todo_item (
            todo_item_id TEXT PRIMARY KEY,
            todo_list_id TEXT NOT NULL,
            status TEXT NOT NULL,
            title TEXT NOT NULL,
            actions_json TEXT NOT NULL,
            expected_tools_json TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            completion_criteria_json TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            blockers_json TEXT NOT NULL,
            source_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS execution_run (
            execution_run_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            todo_list_id TEXT NOT NULL,
            status TEXT NOT NULL,
            step_ids_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS execution_step (
            execution_step_id TEXT PRIMARY KEY,
            execution_run_id TEXT NOT NULL,
            todo_item_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            tool_operation_ids_json TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            artifact_refs_json TEXT NOT NULL,
            skip_reason TEXT,
            blocker_json TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS verification_plan (
            verification_plan_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            execution_run_id TEXT,
            status TEXT NOT NULL,
            title TEXT NOT NULL,
            required_json TEXT NOT NULL,
            optional_json TEXT NOT NULL,
            not_run_json TEXT NOT NULL,
            source_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS verification_run (
            verification_run_id TEXT PRIMARY KEY,
            verification_plan_id TEXT,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            execution_run_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            command TEXT,
            cwd TEXT,
            tool_operation_id TEXT,
            report_artifact_id TEXT,
            evidence_refs_json TEXT NOT NULL,
            exit_code INTEGER,
            output_bytes INTEGER,
            failure_summary TEXT,
            skip_reason TEXT,
            residual_risk_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS completion_audit (
            completion_audit_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            execution_run_id TEXT,
            status TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS delivery_proof (
            delivery_proof_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            execution_run_id TEXT,
            status TEXT NOT NULL,
            objective_ref TEXT,
            changed_files_refs_json TEXT NOT NULL,
            artifact_refs_json TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            verification_run_ids_json TEXT NOT NULL,
            completion_audit_id TEXT,
            side_effect_refs_json TEXT NOT NULL,
            unresolved_risks_json TEXT NOT NULL,
            user_visible_summary_ref TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        ",
    )?;
    ensure_column(
        conn,
        "runtime_turn",
        "permission_mode",
        "TEXT NOT NULL DEFAULT 'sandbox'",
    )?;
    ensure_column(
        conn,
        "runtime_turn",
        "execution_target",
        "TEXT NOT NULL DEFAULT 'host'",
    )?;
    ensure_column(conn, "runtime_turn", "security_policy_snapshot_id", "TEXT")?;
    ensure_column(conn, "file_backup_record", "post_apply_sha256", "TEXT")?;
    ensure_column(conn, "file_backup_record", "post_apply_bytes", "INTEGER")?;
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )?;
    Ok(())
}
