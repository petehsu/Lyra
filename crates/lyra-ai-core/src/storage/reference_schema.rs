use anyhow::Result;
use rusqlite::Connection;

pub(super) fn migrate_reference_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS inline_reference (
            inline_reference_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            user_message_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            label TEXT,
            anchor_json TEXT NOT NULL,
            insertion_index INTEGER NOT NULL,
            char_start INTEGER NOT NULL,
            char_end INTEGER NOT NULL,
            source_part_index INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS inline_reference_turn_idx
            ON inline_reference(session_id, runtime_turn_id, insertion_index);
        CREATE TABLE IF NOT EXISTS reference_resolution (
            resolution_id TEXT PRIMARY KEY,
            inline_reference_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            runtime_turn_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            status TEXT NOT NULL,
            resolved_ref TEXT,
            content_hash TEXT,
            content_bytes INTEGER,
            reason TEXT,
            metadata_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS reference_resolution_reference_idx
            ON reference_resolution(inline_reference_id, status);
        ",
    )?;
    Ok(())
}
