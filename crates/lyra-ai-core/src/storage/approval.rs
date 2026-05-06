use super::*;

impl AiStore {
    pub fn append_approval_ticket(
        &self,
        session_id: &str,
        turn_id: &str,
        status: &str,
        approval_mode: &str,
        title: &str,
        risk_summary: Value,
        impact_scope: Value,
        requested_action: Value,
    ) -> Result<ApprovalTicketRecord> {
        let approval_ticket_id = new_id("approval");
        let created_at = now_ms();
        let created_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "INSERT INTO approval_ticket (
                    approval_ticket_id, session_id, runtime_turn_id, status, approval_mode,
                    title, risk_summary_json, impact_scope_json, requested_action_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?10, ?11)",
                params![
                    approval_ticket_id,
                    session_id,
                    turn_id,
                    status,
                    approval_mode,
                    title,
                    risk_summary.to_string(),
                    impact_scope.to_string(),
                    requested_action.to_string(),
                    created_at,
                    created_iso,
                ],
            )?;
            Ok(())
        })?;
        Ok(ApprovalTicketRecord {
            approval_ticket_id,
            session_id: session_id.to_string(),
            runtime_turn_id: turn_id.to_string(),
            status: status.to_string(),
            approval_mode: approval_mode.to_string(),
            title: title.to_string(),
            created_at,
            updated_at: created_at,
        })
    }

    pub fn update_approval_ticket_status(
        &self,
        session_id: &str,
        approval_ticket_id: &str,
        status: &str,
        approval_mode: &str,
    ) -> Result<ApprovalTicketRecord> {
        let updated_at = now_ms();
        let updated_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let existing = conn
                .query_row(
                    "SELECT approval_ticket_id, session_id, runtime_turn_id, status,
                            approval_mode, title, created_at_ms, updated_at_ms
                     FROM approval_ticket WHERE session_id = ?1 AND approval_ticket_id = ?2",
                    params![session_id, approval_ticket_id],
                    read_approval_ticket_row,
                )
                .optional()?;
            let Some(mut ticket) = existing else {
                return Err(anyhow!("approval ticket not found: {approval_ticket_id}"));
            };
            conn.execute(
                "UPDATE approval_ticket
                 SET status = ?1, approval_mode = ?2, updated_at_ms = ?3, updated_at_iso = ?4
                 WHERE session_id = ?5 AND approval_ticket_id = ?6",
                params![
                    status,
                    approval_mode,
                    updated_at,
                    updated_iso,
                    session_id,
                    approval_ticket_id
                ],
            )?;
            ticket.status = status.to_string();
            ticket.approval_mode = approval_mode.to_string();
            ticket.updated_at = updated_at;
            Ok(ticket)
        })
    }

    pub fn read_approval_ticket_detail(
        &self,
        session_id: &str,
        approval_ticket_id: &str,
    ) -> Result<Option<ApprovalTicketDetailRecord>> {
        self.with_session_conn(session_id, |conn| {
            Ok(conn
                .query_row(
                    "SELECT approval_ticket_id, session_id, runtime_turn_id, status,
                        approval_mode, title, risk_summary_json, impact_scope_json,
                        requested_action_json, created_at_ms, updated_at_ms
                 FROM approval_ticket
                 WHERE session_id = ?1 AND approval_ticket_id = ?2",
                    params![session_id, approval_ticket_id],
                    |row| {
                        let risk_json: String = row.get(6)?;
                        let impact_json: String = row.get(7)?;
                        let requested_json: String = row.get(8)?;
                        Ok(ApprovalTicketDetailRecord {
                            approval_ticket_id: row.get(0)?,
                            session_id: row.get(1)?,
                            runtime_turn_id: row.get(2)?,
                            status: row.get(3)?,
                            approval_mode: row.get(4)?,
                            title: row.get(5)?,
                            risk_summary: serde_json::from_str(&risk_json)
                                .unwrap_or_else(|_| json!({})),
                            impact_scope: serde_json::from_str(&impact_json)
                                .unwrap_or_else(|_| json!({})),
                            requested_action: serde_json::from_str(&requested_json)
                                .unwrap_or_else(|_| json!({})),
                            created_at: row.get(9)?,
                            updated_at: row.get(10)?,
                        })
                    },
                )
                .optional()?)
        })
    }

    pub fn find_pending_approval_for_tool_source(
        &self,
        session_id: &str,
        tool_path: &str,
        artifact_id: Option<&str>,
        patch_ref: Option<&str>,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.find_approval_for_tool_source(
            session_id,
            "pending_user",
            tool_path,
            artifact_id,
            patch_ref,
        )
    }

    pub fn find_denied_approval_for_tool_source(
        &self,
        session_id: &str,
        tool_path: &str,
        artifact_id: Option<&str>,
        patch_ref: Option<&str>,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.find_approval_for_tool_source(session_id, "denied", tool_path, artifact_id, patch_ref)
    }

    pub fn find_pending_approval_for_tool_command(
        &self,
        session_id: &str,
        tool_path: &str,
        command_hash: &str,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.find_approval_for_tool_command(session_id, "pending_user", tool_path, command_hash)
    }

    pub fn find_denied_approval_for_tool_command(
        &self,
        session_id: &str,
        tool_path: &str,
        command_hash: &str,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.find_approval_for_tool_command(session_id, "denied", tool_path, command_hash)
    }

    fn find_approval_for_tool_source(
        &self,
        session_id: &str,
        status: &str,
        tool_path: &str,
        artifact_id: Option<&str>,
        patch_ref: Option<&str>,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT approval_ticket_id, session_id, runtime_turn_id, status,
                        approval_mode, title, created_at_ms, updated_at_ms,
                        requested_action_json
                 FROM approval_ticket
                 WHERE session_id = ?1 AND status = ?2
                 ORDER BY created_at_ms ASC",
            )?;
            let rows = stmt.query_map(params![session_id, status], |row| {
                Ok((read_approval_ticket_row(row)?, row.get::<_, String>(8)?))
            })?;
            for row in rows {
                let (ticket, requested_json) = row?;
                let requested: Value =
                    serde_json::from_str(&requested_json).unwrap_or_else(|_| json!({}));
                if requested.get("toolPath").and_then(Value::as_str) != Some(tool_path) {
                    continue;
                }
                let requested_artifact_id = requested
                    .get("artifactId")
                    .or_else(|| requested.get("appliedArtifactId"))
                    .and_then(Value::as_str);
                let requested_patch_ref = requested.get("patchRef").and_then(Value::as_str);
                let artifact_matches = artifact_id
                    .is_some_and(|artifact_id| requested_artifact_id == Some(artifact_id));
                let patch_matches =
                    patch_ref.is_some_and(|patch_ref| requested_patch_ref == Some(patch_ref));
                if artifact_matches || patch_matches {
                    return Ok(Some(ticket));
                }
            }
            Ok(None)
        })
    }

    fn find_approval_for_tool_command(
        &self,
        session_id: &str,
        status: &str,
        tool_path: &str,
        command_hash: &str,
    ) -> Result<Option<ApprovalTicketRecord>> {
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT approval_ticket_id, session_id, runtime_turn_id, status,
                        approval_mode, title, created_at_ms, updated_at_ms,
                        requested_action_json
                 FROM approval_ticket
                 WHERE session_id = ?1 AND status = ?2
                 ORDER BY created_at_ms ASC",
            )?;
            let rows = stmt.query_map(params![session_id, status], |row| {
                Ok((read_approval_ticket_row(row)?, row.get::<_, String>(8)?))
            })?;
            for row in rows {
                let (ticket, requested_json) = row?;
                let requested: Value =
                    serde_json::from_str(&requested_json).unwrap_or_else(|_| json!({}));
                if requested.get("toolPath").and_then(Value::as_str) != Some(tool_path) {
                    continue;
                }
                if requested.get("commandHash").and_then(Value::as_str) == Some(command_hash) {
                    return Ok(Some(ticket));
                }
            }
            Ok(None)
        })
    }

    pub fn read_recent_denied_approval_summaries(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<Value>> {
        let limit = i64::try_from(limit.max(1)).unwrap_or(5);
        self.with_session_conn(session_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT approval_ticket_id, runtime_turn_id, title, approval_mode,
                        risk_summary_json, impact_scope_json, requested_action_json,
                        updated_at_ms
                 FROM approval_ticket
                 WHERE session_id = ?1 AND status = 'denied'
                 ORDER BY updated_at_ms DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![session_id, limit], |row| {
                let risk_json: String = row.get(4)?;
                let impact_json: String = row.get(5)?;
                let requested_json: String = row.get(6)?;
                let risk_summary: Value =
                    serde_json::from_str(&risk_json).unwrap_or_else(|_| json!({}));
                let impact_scope: Value =
                    serde_json::from_str(&impact_json).unwrap_or_else(|_| json!({}));
                let requested_action: Value =
                    serde_json::from_str(&requested_json).unwrap_or_else(|_| json!({}));
                Ok(json!({
                    "approvalTicketId": row.get::<_, String>(0)?,
                    "turnId": row.get::<_, String>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "approvalMode": row.get::<_, String>(3)?,
                    "status": "denied",
                    "toolPath": requested_action.get("toolPath").cloned().unwrap_or(Value::Null),
                    "artifactId": requested_action
                        .get("artifactId")
                        .or_else(|| requested_action.get("appliedArtifactId"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "patchRef": requested_action.get("patchRef").cloned().unwrap_or(Value::Null),
                    "riskSummary": risk_summary,
                    "impactScope": impact_scope,
                    "updatedAt": row.get::<_, i64>(7)?,
                }))
            })?;
            let mut result = Vec::new();
            for row in rows {
                result.push(row?);
            }
            Ok(result)
        })
    }
}
