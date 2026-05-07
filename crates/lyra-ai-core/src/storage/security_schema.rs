use anyhow::Result;
use rusqlite::Connection;

pub(super) fn migrate_security_session(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS security_decision_record (
            decision_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            operation_id TEXT,
            snapshot_id TEXT,
            resource_kind TEXT NOT NULL,
            resource_ref TEXT NOT NULL,
            decision TEXT NOT NULL,
            reason_codes_json TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            redaction_applied INTEGER NOT NULL,
            approval_ticket_id TEXT,
            evidence_refs_json TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            superseded_by_rollback_id TEXT
        );
        CREATE INDEX IF NOT EXISTS security_decision_record_turn_idx
            ON security_decision_record(session_id, turn_id, created_at_ms);
        CREATE TABLE IF NOT EXISTS secret_detection_report (
            report_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            resource_kind TEXT NOT NULL,
            resource_ref TEXT NOT NULL,
            status TEXT NOT NULL,
            findings_json TEXT NOT NULL,
            redacted_preview TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            superseded_by_rollback_id TEXT
        );
        CREATE INDEX IF NOT EXISTS secret_detection_report_turn_idx
            ON secret_detection_report(session_id, turn_id, created_at_ms);
        CREATE TABLE IF NOT EXISTS redacted_projection_record (
            projection_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            source_kind TEXT NOT NULL,
            source_ref TEXT NOT NULL,
            projection_kind TEXT NOT NULL,
            redaction_profile TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            redacted_ref TEXT NOT NULL,
            decision_id TEXT,
            status TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            superseded_by_rollback_id TEXT
        );
        CREATE INDEX IF NOT EXISTS redacted_projection_record_turn_idx
            ON redacted_projection_record(session_id, turn_id, created_at_ms);
        ",
    )?;
    Ok(())
}
