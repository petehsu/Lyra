use anyhow::Result;
use rusqlite::Connection;

pub(super) fn migrate_policy_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS effective_policy_snapshot (
            snapshot_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            project_root TEXT,
            project_id TEXT,
            source TEXT NOT NULL,
            status TEXT NOT NULL,
            manifest_path TEXT,
            manifest_hash TEXT,
            effective_json TEXT NOT NULL,
            source_records_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            superseded_by_rollback_id TEXT
        );
        CREATE INDEX IF NOT EXISTS effective_policy_snapshot_turn_idx
            ON effective_policy_snapshot(session_id, turn_id, created_at_ms);
        CREATE TABLE IF NOT EXISTS policy_source_record (
            source_record_id TEXT PRIMARY KEY,
            snapshot_id TEXT NOT NULL,
            layer TEXT NOT NULL,
            source_ref TEXT NOT NULL,
            status TEXT NOT NULL,
            hash TEXT,
            warnings_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS policy_source_record_snapshot_idx
            ON policy_source_record(snapshot_id, created_at_ms);
        ",
    )?;
    Ok(())
}
