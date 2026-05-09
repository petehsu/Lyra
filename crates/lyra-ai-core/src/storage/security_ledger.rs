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

    pub fn create_secret_record(&self, input: CreateSecretRecordInput) -> Result<SecretRecord> {
        let now = now_ms();
        let now_iso = now_iso();
        let record = SecretRecord {
            secret_id: new_id("secret"),
            session_id: input.session_id,
            turn_id: input.turn_id,
            kind: input.kind,
            provider: input.provider,
            label: input.label,
            storage_ref: input.storage_ref,
            scope: input.scope,
            status: "active".to_string(),
            expires_at: input.expires_at,
            created_at: now,
            updated_at: now,
        };
        self.with_session_conn(&record.session_id, |conn| {
            conn.execute(
                "INSERT INTO secret_record (
                    secret_id, session_id, turn_id, kind, provider, label, storage_ref,
                    scope_json, status, expires_at_iso, created_at_ms, created_at_iso,
                    updated_at_ms, updated_at_iso, superseded_by_rollback_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?10, ?11, ?10, ?11, NULL)",
                params![
                    record.secret_id,
                    record.session_id,
                    record.turn_id,
                    record.kind,
                    record.provider,
                    record.label,
                    record.storage_ref,
                    record.scope.to_string(),
                    record.expires_at,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(record)
    }

    pub fn read_secret_record(
        &self,
        session_id: &str,
        secret_id: &str,
    ) -> Result<Option<SecretRecord>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT secret_id, session_id, turn_id, kind, provider, label, storage_ref,
                        scope_json, status, expires_at_iso, created_at_ms, updated_at_ms
                 FROM secret_record
                 WHERE session_id = ?1 AND secret_id = ?2",
                params![session_id, secret_id],
                |row| {
                    let scope_json: String = row.get(7)?;
                    Ok(SecretRecord {
                        secret_id: row.get(0)?,
                        session_id: row.get(1)?,
                        turn_id: row.get(2)?,
                        kind: row.get(3)?,
                        provider: row.get(4)?,
                        label: row.get(5)?,
                        storage_ref: row.get(6)?,
                        scope: serde_json::from_str(&scope_json).unwrap_or_else(|_| json!({})),
                        status: row.get(8)?,
                        expires_at: row.get(9)?,
                        created_at: row.get(10)?,
                        updated_at: row.get(11)?,
                    })
                },
            )
            .optional()
            .context("failed to read secret record")
        })
    }

    pub fn create_secret_handle(
        &self,
        input: CreateSecretHandleInput,
    ) -> Result<SecretHandleRecord> {
        let now = now_ms();
        let now_iso = now_iso();
        let expires_iso = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(input.expires_at)
            .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
            .unwrap_or_else(|| now_iso.clone());
        let record = SecretHandleRecord {
            handle_id: new_id("secret_handle"),
            session_id: input.session_id,
            turn_id: input.turn_id,
            secret_id: input.secret_id,
            lease_id: new_id("secret_lease"),
            granted_to_tool_path: input.granted_to_tool_path,
            granted_for_operation_id: input.granted_for_operation_id,
            allowed_target: input.allowed_target,
            reveal_mode: input.reveal_mode,
            status: "active".to_string(),
            expires_at: input.expires_at,
            created_at: now,
        };
        self.with_session_conn(&record.session_id, |conn| {
            conn.execute(
                "INSERT INTO secret_handle (
                    handle_id, session_id, turn_id, secret_id, lease_id, granted_to_tool_path,
                    granted_for_operation_id, allowed_target, reveal_mode, status, expires_at_ms,
                    expires_at_iso, created_at_ms, created_at_iso, revoked_at_ms, revoked_at_iso,
                    superseded_by_rollback_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active', ?10, ?11, ?12, ?13, NULL, NULL, NULL)",
                params![
                    record.handle_id,
                    record.session_id,
                    record.turn_id,
                    record.secret_id,
                    record.lease_id,
                    record.granted_to_tool_path,
                    record.granted_for_operation_id,
                    record.allowed_target,
                    record.reveal_mode,
                    record.expires_at,
                    expires_iso,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(record)
    }

    pub fn read_secret_handle(
        &self,
        session_id: &str,
        handle_id: &str,
    ) -> Result<Option<SecretHandleRecord>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT handle_id, session_id, turn_id, secret_id, lease_id, granted_to_tool_path,
                        granted_for_operation_id, allowed_target, reveal_mode, status,
                        expires_at_ms, created_at_ms
                 FROM secret_handle
                 WHERE session_id = ?1 AND handle_id = ?2",
                params![session_id, handle_id],
                |row| {
                    Ok(SecretHandleRecord {
                        handle_id: row.get(0)?,
                        session_id: row.get(1)?,
                        turn_id: row.get(2)?,
                        secret_id: row.get(3)?,
                        lease_id: row.get(4)?,
                        granted_to_tool_path: row.get(5)?,
                        granted_for_operation_id: row.get(6)?,
                        allowed_target: row.get(7)?,
                        reveal_mode: row.get(8)?,
                        status: row.get(9)?,
                        expires_at: row.get(10)?,
                        created_at: row.get(11)?,
                    })
                },
            )
            .optional()
            .context("failed to read secret handle")
        })
    }

    pub fn revoke_secret_handle(&self, session_id: &str, handle_id: &str) -> Result<()> {
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "UPDATE secret_handle
                 SET status = 'revoked', revoked_at_ms = ?1, revoked_at_iso = ?2
                 WHERE session_id = ?3 AND handle_id = ?4",
                params![now, now_iso, session_id, handle_id],
            )?;
            Ok(())
        })
    }

    pub fn record_secret_access(
        &self,
        input: CreateSecretAccessAuditInput,
    ) -> Result<SecretAccessAuditRecord> {
        let now = now_ms();
        let now_iso = now_iso();
        let record = SecretAccessAuditRecord {
            audit_id: new_id("secret_audit"),
            session_id: input.session_id,
            turn_id: input.turn_id,
            secret_id: input.secret_id,
            handle_id: input.handle_id,
            operation_id: input.operation_id,
            access_kind: input.access_kind,
            target_ref: input.target_ref,
            decision: input.decision,
            reason_codes: input.reason_codes,
            created_at: now,
        };
        self.with_session_conn(&record.session_id, |conn| {
            conn.execute(
                "INSERT INTO secret_access_audit (
                    audit_id, session_id, turn_id, secret_id, handle_id, operation_id,
                    access_kind, target_ref, decision, reason_codes_json, created_at_ms,
                    created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    record.audit_id,
                    record.session_id,
                    record.turn_id,
                    record.secret_id,
                    record.handle_id,
                    record.operation_id,
                    record.access_kind,
                    record.target_ref,
                    record.decision,
                    json_string(&record.reason_codes)?,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(record)
    }

    pub fn create_exfiltration_decision(
        &self,
        input: CreateExfiltrationDecisionInput,
    ) -> Result<ExfiltrationDecisionRecord> {
        let now = now_ms();
        let now_iso = now_iso();
        let record = ExfiltrationDecisionRecord {
            exfiltration_decision_id: new_id("exfiltration"),
            session_id: input.session_id,
            turn_id: input.turn_id,
            operation_id: input.operation_id,
            target_kind: input.target_kind,
            target_ref: input.target_ref,
            contains_sensitive_data: input.contains_sensitive_data,
            allowed: input.allowed,
            required_action: input.required_action,
            reason_codes: input.reason_codes,
            evidence_refs: input.evidence_refs,
            created_at: now,
        };
        self.with_session_conn(&record.session_id, |conn| {
            conn.execute(
                "INSERT INTO exfiltration_decision (
                    exfiltration_decision_id, session_id, turn_id, operation_id,
                    target_kind, target_ref, contains_sensitive_data, allowed,
                    required_action, reason_codes_json, evidence_refs_json,
                    created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    record.exfiltration_decision_id,
                    record.session_id,
                    record.turn_id,
                    record.operation_id,
                    record.target_kind,
                    record.target_ref,
                    if record.contains_sensitive_data { 1 } else { 0 },
                    if record.allowed { 1 } else { 0 },
                    record.required_action,
                    json_string(&record.reason_codes)?,
                    json_string(&record.evidence_refs)?,
                    now,
                    now_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(record)
    }

    pub fn create_capsule_bridge_audit(
        &self,
        input: CreateCapsuleBridgeAuditInput,
    ) -> Result<CapsuleBridgeAuditRecord> {
        let now = now_ms();
        let now_iso = now_iso();
        let record = CapsuleBridgeAuditRecord {
            bridge_audit_id: new_id("capsule_bridge"),
            session_id: input.session_id,
            turn_id: input.turn_id,
            capsule_id: input.capsule_id,
            operation_id: input.operation_id,
            decision: input.decision,
            bridge_policy: input.bridge_policy,
            reason_codes: input.reason_codes,
            approval_ticket_id: input.approval_ticket_id,
            created_at: now,
        };
        self.with_session_conn(&record.session_id, |conn| {
            conn.execute(
                "INSERT INTO capsule_bridge_audit (
                    bridge_audit_id, session_id, turn_id, capsule_id, operation_id,
                    decision, bridge_policy_json, reason_codes_json, approval_ticket_id,
                    created_at_ms, created_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    record.bridge_audit_id,
                    record.session_id,
                    record.turn_id,
                    record.capsule_id,
                    record.operation_id,
                    record.decision,
                    record.bridge_policy.to_string(),
                    json_string(&record.reason_codes)?,
                    record.approval_ticket_id,
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
            let active_secret_handles = read_active_secret_handle_count(conn, session_id)?;
            let last_exfiltration_action = read_last_exfiltration_action(conn, session_id)?;
            let last_capsule_bridge_decision = read_last_capsule_bridge_decision(conn, session_id)?;
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
                active_secret_handles,
                last_exfiltration_action,
                last_capsule_bridge_decision,
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
            UNION ALL
            SELECT 1 FROM secret_handle
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

fn read_active_secret_handle_count(conn: &Connection, session_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT COUNT(*)
         FROM secret_handle
         WHERE session_id = ?1 AND status = 'active' AND expires_at_ms > ?2",
        params![session_id, now_ms()],
        |row| row.get(0),
    )
    .context("failed to count active secret handles")
}

fn read_last_exfiltration_action(conn: &Connection, session_id: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT required_action
         FROM exfiltration_decision
         WHERE session_id = ?1
         ORDER BY created_at_ms DESC LIMIT 1",
        params![session_id],
        |row| row.get(0),
    )
    .optional()
    .context("failed to read latest exfiltration action")
}

fn read_last_capsule_bridge_decision(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT decision
         FROM capsule_bridge_audit
         WHERE session_id = ?1
         ORDER BY created_at_ms DESC LIMIT 1",
        params![session_id],
        |row| row.get(0),
    )
    .optional()
    .context("failed to read latest capsule bridge decision")
}
