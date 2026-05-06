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
        ",
    )?;
    Ok(())
}
