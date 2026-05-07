use anyhow::Result;
use rusqlite::Connection;

pub(super) fn migrate_intent_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS user_intent_envelope (
            intent_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            confidence REAL NOT NULL,
            mode_candidate TEXT,
            source_message_ref TEXT,
            ui_action_id TEXT,
            raw_text_ref TEXT,
            segment_refs_json TEXT NOT NULL,
            inline_reference_ids_json TEXT NOT NULL,
            constraints_json TEXT NOT NULL,
            classification_evidence_refs_json TEXT NOT NULL,
            ambiguity_flags_json TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS user_intent_envelope_turn_idx
            ON user_intent_envelope(session_id, runtime_turn_id, created_at_ms);
        CREATE TABLE IF NOT EXISTS intent_target_binding (
            binding_id TEXT PRIMARY KEY,
            intent_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            target_kind TEXT NOT NULL,
            target_id TEXT NOT NULL,
            freshness_status TEXT NOT NULL,
            confidence REAL NOT NULL,
            status TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS intent_target_binding_intent_idx
            ON intent_target_binding(intent_id, status);
        CREATE TABLE IF NOT EXISTS runtime_decision_record (
            decision_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            intent_id TEXT,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT NOT NULL,
            reason_json TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS runtime_decision_record_turn_idx
            ON runtime_decision_record(session_id, runtime_turn_id, created_at_ms);
        ",
    )?;
    Ok(())
}
