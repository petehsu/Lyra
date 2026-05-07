use anyhow::Result;
use rusqlite::Connection;

pub(super) fn migrate_clarification_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS question_ticket (
            question_ticket_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            intent_id TEXT,
            status TEXT NOT NULL,
            blocking_level TEXT NOT NULL,
            title TEXT NOT NULL,
            question TEXT NOT NULL,
            why TEXT NOT NULL,
            target_summary TEXT,
            options_json TEXT NOT NULL,
            allow_custom_answer INTEGER NOT NULL,
            selected_option_id TEXT,
            answer_text TEXT,
            answer_source TEXT,
            related_ids_json TEXT NOT NULL,
            target_bindings_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL,
            answered_at_ms INTEGER,
            answered_at_iso TEXT,
            superseded_by_rollback_id TEXT
        );
        CREATE INDEX IF NOT EXISTS question_ticket_session_status_idx
            ON question_ticket(session_id, status, created_at_ms);
        CREATE TABLE IF NOT EXISTS assumption_record (
            assumption_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            intent_id TEXT,
            status TEXT NOT NULL,
            statement TEXT NOT NULL,
            basis TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            reversible INTEGER NOT NULL,
            source_refs_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL,
            superseded_by_rollback_id TEXT
        );
        CREATE INDEX IF NOT EXISTS assumption_record_session_status_idx
            ON assumption_record(session_id, status, created_at_ms);
        ",
    )?;
    Ok(())
}
