use anyhow::Result;
use rusqlite::Connection;

pub(super) fn migrate_long_work_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS native_long_work_goal (
            goal_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            status TEXT NOT NULL,
            objective_summary TEXT NOT NULL,
            completion_contract_json TEXT NOT NULL,
            budget_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS long_work_run (
            long_work_run_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            user_message_id TEXT,
            plan_id TEXT,
            todo_list_id TEXT NOT NULL,
            execution_run_id TEXT NOT NULL,
            goal_id TEXT NOT NULL,
            status TEXT NOT NULL,
            objective_summary TEXT NOT NULL,
            completion_contract_json TEXT NOT NULL,
            budget_json TEXT NOT NULL,
            checkpoint_ids_json TEXT NOT NULL,
            blocker_ids_json TEXT NOT NULL,
            current_slice_id TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_slice (
            work_slice_id TEXT PRIMARY KEY,
            long_work_run_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            todo_list_id TEXT NOT NULL,
            execution_run_id TEXT NOT NULL,
            status TEXT NOT NULL,
            sequence INTEGER NOT NULL DEFAULT 1,
            stop_cause TEXT,
            model_invocation_ids_json TEXT NOT NULL DEFAULT '[]',
            tool_operation_ids_json TEXT NOT NULL DEFAULT '[]',
            execution_step_ids_json TEXT NOT NULL DEFAULT '[]',
            evidence_refs_json TEXT NOT NULL DEFAULT '[]',
            artifact_refs_json TEXT NOT NULL DEFAULT '[]',
            progress_delta_json TEXT NOT NULL DEFAULT '{}',
            user_visible_output_ref TEXT,
            item_ids_json TEXT NOT NULL,
            checkpoint_ids_json TEXT NOT NULL,
            blocker_ids_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL,
            closed_at_ms INTEGER,
            closed_at_iso TEXT
        );
        CREATE INDEX IF NOT EXISTS long_work_run_session_status_idx
            ON long_work_run(session_id, status, updated_at_ms);
        CREATE INDEX IF NOT EXISTS work_slice_run_idx
            ON work_slice(long_work_run_id, updated_at_ms);
        CREATE TABLE IF NOT EXISTS long_work_continuation (
            continuation_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            long_work_run_id TEXT NOT NULL,
            previous_slice_id TEXT NOT NULL,
            next_slice_sequence INTEGER NOT NULL,
            runtime_turn_id TEXT,
            status TEXT NOT NULL,
            recommended_action TEXT NOT NULL,
            packet_json TEXT NOT NULL,
            reason_summary TEXT,
            started_side_effect INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL,
            consumed_at_ms INTEGER,
            consumed_at_iso TEXT
        );
        CREATE TABLE IF NOT EXISTS premature_stop_report (
            report_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            long_work_run_id TEXT NOT NULL,
            work_slice_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            is_premature_stop INTEGER NOT NULL,
            signals_json TEXT NOT NULL,
            open_todo_item_ids_json TEXT NOT NULL,
            missing_evidence_json TEXT NOT NULL,
            recommended_action TEXT NOT NULL,
            suppressed_message_id TEXT,
            suppressed_output_json TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS stuck_report (
            stuck_report_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            long_work_run_id TEXT NOT NULL,
            work_slice_id TEXT NOT NULL,
            runtime_turn_id TEXT,
            repeated_failure_count INTEGER NOT NULL,
            no_progress_slice_count INTEGER NOT NULL,
            suspected_cause TEXT NOT NULL,
            recommended_action TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            reason_summary TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS long_work_continuation_run_status_idx
            ON long_work_continuation(long_work_run_id, status, updated_at_ms);
        CREATE INDEX IF NOT EXISTS premature_stop_report_run_idx
            ON premature_stop_report(long_work_run_id, created_at_ms);
        CREATE INDEX IF NOT EXISTS stuck_report_run_idx
            ON stuck_report(long_work_run_id, created_at_ms);
        ",
    )?;
    ensure_column(
        conn,
        "work_slice",
        "sequence",
        "sequence INTEGER NOT NULL DEFAULT 1",
    )?;
    ensure_column(conn, "work_slice", "stop_cause", "stop_cause TEXT")?;
    ensure_column(
        conn,
        "work_slice",
        "model_invocation_ids_json",
        "model_invocation_ids_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "work_slice",
        "tool_operation_ids_json",
        "tool_operation_ids_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "work_slice",
        "execution_step_ids_json",
        "execution_step_ids_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "work_slice",
        "evidence_refs_json",
        "evidence_refs_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "work_slice",
        "artifact_refs_json",
        "artifact_refs_json TEXT NOT NULL DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "work_slice",
        "progress_delta_json",
        "progress_delta_json TEXT NOT NULL DEFAULT '{}'",
    )?;
    ensure_column(
        conn,
        "work_slice",
        "user_visible_output_ref",
        "user_visible_output_ref TEXT",
    )?;
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for existing in columns {
        if existing? == column {
            return Ok(());
        }
    }
    conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {definition}"), [])?;
    Ok(())
}
