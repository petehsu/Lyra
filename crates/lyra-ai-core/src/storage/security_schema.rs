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
        CREATE TABLE IF NOT EXISTS secret_record (
            secret_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            provider TEXT,
            label TEXT NOT NULL,
            storage_ref TEXT NOT NULL,
            scope_json TEXT NOT NULL,
            status TEXT NOT NULL,
            expires_at_iso TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            updated_at_iso TEXT NOT NULL,
            superseded_by_rollback_id TEXT
        );
        CREATE INDEX IF NOT EXISTS secret_record_session_idx
            ON secret_record(session_id, status, created_at_ms);
        CREATE TABLE IF NOT EXISTS secret_handle (
            handle_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            secret_id TEXT NOT NULL,
            lease_id TEXT NOT NULL,
            granted_to_tool_path TEXT NOT NULL,
            granted_for_operation_id TEXT NOT NULL,
            allowed_target TEXT NOT NULL,
            reveal_mode TEXT NOT NULL,
            status TEXT NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            expires_at_iso TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL,
            revoked_at_ms INTEGER,
            revoked_at_iso TEXT,
            superseded_by_rollback_id TEXT
        );
        CREATE INDEX IF NOT EXISTS secret_handle_session_idx
            ON secret_handle(session_id, status, expires_at_ms);
        CREATE TABLE IF NOT EXISTS secret_access_audit (
            audit_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            secret_id TEXT,
            handle_id TEXT,
            operation_id TEXT,
            access_kind TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            decision TEXT NOT NULL,
            reason_codes_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS secret_access_audit_session_idx
            ON secret_access_audit(session_id, created_at_ms);
        CREATE TABLE IF NOT EXISTS exfiltration_decision (
            exfiltration_decision_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            operation_id TEXT,
            target_kind TEXT NOT NULL,
            target_ref TEXT NOT NULL,
            contains_sensitive_data INTEGER NOT NULL,
            allowed INTEGER NOT NULL,
            required_action TEXT NOT NULL,
            reason_codes_json TEXT NOT NULL,
            evidence_refs_json TEXT NOT NULL,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS exfiltration_decision_turn_idx
            ON exfiltration_decision(session_id, turn_id, created_at_ms);
        CREATE TABLE IF NOT EXISTS capsule_bridge_audit (
            bridge_audit_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_id TEXT NOT NULL,
            capsule_id TEXT,
            operation_id TEXT,
            decision TEXT NOT NULL,
            bridge_policy_json TEXT NOT NULL,
            reason_codes_json TEXT NOT NULL,
            approval_ticket_id TEXT,
            created_at_ms INTEGER NOT NULL,
            created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS capsule_bridge_audit_session_idx
            ON capsule_bridge_audit(session_id, created_at_ms);
        ",
    )?;
    Ok(())
}
