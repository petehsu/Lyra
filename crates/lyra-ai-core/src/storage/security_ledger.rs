use super::*;

impl AiStore {
    pub fn create_security_decision_record(
        &self,
        input: CreateSecurityDecisionRecordInput,
    ) -> Result<SecurityDecisionRecord> {
        let now = now_ms();
        let now_iso = now_iso();
        let record = SecurityDecisionRecord {
            decision_id: new_id("security_decision"),
            session_id: input.session_id,
            turn_id: input.turn_id,
            operation_id: input.operation_id,
            snapshot_id: input.snapshot_id,
            resource_kind: input.resource_kind,
            resource_ref: input.resource_ref,
            decision: input.decision,
            reason_codes: input.reason_codes,
            risk_level: input.risk_level,
            redaction_applied: input.redaction_applied,
            approval_ticket_id: input.approval_ticket_id,
            evidence_refs: input.evidence_refs,
            status: "active".to_string(),
            created_at: now,
        };
        self.with_session_conn(&record.session_id, |conn| {
            conn.execute(
                "INSERT INTO security_decision_record (
                    decision_id, session_id, turn_id, operation_id, snapshot_id, resource_kind,
                    resource_ref, decision, reason_codes_json, risk_level, redaction_applied,
                    approval_ticket_id, evidence_refs_json, status, created_at_ms,
                    created_at_iso, superseded_by_rollback_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'active', ?14, ?15, NULL)",
                params![
                    record.decision_id,
                    record.session_id,
                    record.turn_id,
                    record.operation_id,
                    record.snapshot_id,
                    record.resource_kind,
                    record.resource_ref,
                    record.decision,
                    json_string(&record.reason_codes)?,
                    record.risk_level,
                    if record.redaction_applied { 1 } else { 0 },
                    record.approval_ticket_id,
                    json_string(&record.evidence_refs)?,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(record)
    }

    pub fn create_secret_detection_report(
        &self,
        input: CreateSecretDetectionReportInput,
    ) -> Result<SecretDetectionReport> {
        let now = now_ms();
        let now_iso = now_iso();
        let report = SecretDetectionReport {
            report_id: new_id("secret_report"),
            session_id: input.session_id,
            turn_id: input.turn_id,
            resource_kind: input.resource_kind,
            resource_ref: input.resource_ref,
            status: input.status,
            findings: input.findings,
            redacted_preview: input.redacted_preview,
            created_at: now,
        };
        self.with_session_conn(&report.session_id, |conn| {
            conn.execute(
                "INSERT INTO secret_detection_report (
                    report_id, session_id, turn_id, resource_kind, resource_ref, status,
                    findings_json, redacted_preview, created_at_ms, created_at_iso,
                    superseded_by_rollback_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL)",
                params![
                    report.report_id,
                    report.session_id,
                    report.turn_id,
                    report.resource_kind,
                    report.resource_ref,
                    report.status,
                    json_string(&report.findings)?,
                    report.redacted_preview,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(report)
    }

    pub fn create_redacted_projection_record(
        &self,
        input: CreateRedactedProjectionRecordInput,
    ) -> Result<RedactedProjectionRecord> {
        let now = now_ms();
        let now_iso = now_iso();
        let record = RedactedProjectionRecord {
            projection_id: new_id("redacted_projection"),
            session_id: input.session_id,
            turn_id: input.turn_id,
            source_kind: input.source_kind,
            source_ref: input.source_ref,
            projection_kind: input.projection_kind,
            redaction_profile: input.redaction_profile,
            content_hash: input.content_hash,
            redacted_ref: input.redacted_ref,
            decision_id: input.decision_id,
            status: "active".to_string(),
            created_at: now,
        };
        self.with_session_conn(&record.session_id, |conn| {
            conn.execute(
                "INSERT INTO redacted_projection_record (
                    projection_id, session_id, turn_id, source_kind, source_ref,
                    projection_kind, redaction_profile, content_hash, redacted_ref,
                    decision_id, status, created_at_ms, created_at_iso, superseded_by_rollback_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'active', ?11, ?12, NULL)",
                params![
                    record.projection_id,
                    record.session_id,
                    record.turn_id,
                    record.source_kind,
                    record.source_ref,
                    record.projection_kind,
                    record.redaction_profile,
                    record.content_hash,
                    record.redacted_ref,
                    record.decision_id,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(record)
    }

    pub fn read_security_summary(&self, session_id: &str) -> Result<Option<AgentSecuritySummary>> {
        self.with_session_conn(session_id, |conn| {
            let snapshot = conn
                .query_row(
                    "SELECT snapshot_id, effective_json
                     FROM effective_policy_snapshot
                     WHERE session_id = ?1
                       AND status NOT IN ('stale', 'superseded', 'superseded_by_rollback')
                     ORDER BY created_at_ms DESC LIMIT 1",
                    params![session_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            let (snapshot_id, redaction_profile) = match snapshot {
                Some((snapshot_id, effective_json)) => {
                    let profile = serde_json::from_str::<Value>(&effective_json)
                        .ok()
                        .and_then(|value| {
                            value
                                .get("security")
                                .and_then(|security| security.get("redactionProfile"))
                                .and_then(Value::as_str)
                                .map(ToString::to_string)
                        })
                        .unwrap_or_else(|| "strict".to_string());
                    (Some(snapshot_id), profile)
                }
                None => (None, "strict".to_string()),
            };
            let recent = read_recent_security_decisions_from_conn(conn, session_id, 8)?;
            let findings = read_secret_finding_summary_from_conn(conn, session_id)?;
            let stale_state = snapshot_id.is_none() && has_stale_security_state(conn, session_id)?;
            let status = if recent.iter().any(|decision| decision.decision == "deny") {
                "blocked"
            } else if recent
                .iter()
                .any(|decision| decision.decision == "approval_required")
            {
                "approval_required"
            } else if recent
                .iter()
                .any(|decision| decision.redaction_applied || decision.decision == "allow_redacted")
            {
                "redacted"
            } else if snapshot_id.is_some() {
                "clear"
            } else if stale_state {
                "stale"
            } else {
                "stale"
            }
            .to_string();
            if snapshot_id.is_none() && recent.is_empty() && findings.total == 0 && !stale_state {
                return Ok(None);
            }
            Ok(Some(AgentSecuritySummary {
                snapshot_id,
                status,
                redaction_profile,
                recent_decisions: recent,
                secret_findings: findings,
            }))
        })
    }
}

fn has_stale_security_state(conn: &Connection, session_id: &str) -> Result<bool> {
    let exists = conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM effective_policy_snapshot
             WHERE session_id = ?1 AND status IN ('stale', 'superseded', 'superseded_by_rollback')
            UNION ALL
            SELECT 1 FROM security_decision_record
             WHERE session_id = ?1 AND status != 'active'
            UNION ALL
            SELECT 1 FROM secret_detection_report
             WHERE session_id = ?1 AND status != 'active'
            UNION ALL
            SELECT 1 FROM redacted_projection_record
             WHERE session_id = ?1 AND status != 'active'
        )",
        params![session_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(exists != 0)
}

fn read_recent_security_decisions_from_conn(
    conn: &Connection,
    session_id: &str,
    limit: usize,
) -> Result<Vec<AgentSecurityDecisionSummary>> {
    let mut stmt = conn.prepare(
        "SELECT decision_id, resource_kind, resource_ref, decision, reason_codes_json,
                risk_level, redaction_applied, approval_ticket_id, created_at_ms
         FROM security_decision_record
         WHERE session_id = ?1 AND status = 'active'
         ORDER BY created_at_ms DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![session_id, limit as i64], |row| {
        let reason_codes_json: String = row.get(4)?;
        Ok(AgentSecurityDecisionSummary {
            decision_id: row.get(0)?,
            resource_kind: row.get(1)?,
            resource_ref: row.get(2)?,
            decision: row.get(3)?,
            reason_codes: parse_json_vec_string(&reason_codes_json),
            risk_level: row.get(5)?,
            redaction_applied: row.get::<_, i64>(6)? != 0,
            approval_ticket_id: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

fn read_secret_finding_summary_from_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<AgentSecretFindingSummary> {
    let mut stmt = conn.prepare(
        "SELECT report_id, findings_json
         FROM secret_detection_report
         WHERE session_id = ?1 AND status = 'active'
         ORDER BY created_at_ms DESC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut total = 0_i64;
    let mut high_confidence = 0_i64;
    let mut last_report_id = None;
    for row in rows {
        let (report_id, findings_json) = row?;
        if last_report_id.is_none() {
            last_report_id = Some(report_id);
        }
        let findings = serde_json::from_str::<Vec<Value>>(&findings_json).unwrap_or_default();
        total += findings.len() as i64;
        high_confidence += findings
            .iter()
            .filter(|finding| {
                finding
                    .get("confidence")
                    .and_then(Value::as_str)
                    .is_some_and(|confidence| confidence == "high")
            })
            .count() as i64;
    }
    Ok(AgentSecretFindingSummary {
        total,
        high_confidence,
        last_report_id,
    })
}
