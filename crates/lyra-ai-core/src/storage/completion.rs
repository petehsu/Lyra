use super::*;

impl AiStore {
    pub fn read_delivery_proof_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentDeliveryProofSummary>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT delivery_proof_id, session_id, runtime_turn_id, execution_run_id,
                        status, artifact_refs_json, evidence_refs_json,
                        verification_run_ids_json, completion_audit_id,
                        unresolved_risks_json, user_visible_summary_ref, updated_at_ms
                 FROM delivery_proof
                 WHERE session_id = ?1
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT 1",
                params![session_id],
                |row| {
                    let artifact_refs_json: String = row.get(5)?;
                    let evidence_refs_json: String = row.get(6)?;
                    let verification_run_ids_json: String = row.get(7)?;
                    let unresolved_risks_json: String = row.get(9)?;
                    Ok(AgentDeliveryProofSummary {
                        delivery_proof_id: row.get(0)?,
                        session_id: row.get(1)?,
                        runtime_turn_id: row.get(2)?,
                        execution_run_id: row.get(3)?,
                        status: row.get(4)?,
                        artifact_refs: parse_json_vec_string(&artifact_refs_json),
                        evidence_refs: parse_json_vec_string(&evidence_refs_json),
                        verification_run_ids: parse_json_vec_string(&verification_run_ids_json),
                        completion_audit_id: row.get(8)?,
                        unresolved_risks: serde_json::from_str(&unresolved_risks_json)
                            .unwrap_or_else(|_| json!([])),
                        summary: row.get::<_, Option<String>>(10)?.unwrap_or_else(|| {
                            "Delivery proof is pending verification.".to_string()
                        }),
                        updated_at: row.get(11)?,
                    })
                },
            )
            .optional()
            .context("failed to read delivery proof summary")
        })
    }

    pub fn read_completion_audit_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentCompletionAuditSummary>> {
        self.with_session_conn(session_id, |conn| {
            conn.query_row(
                "SELECT completion_audit_id, session_id, runtime_turn_id, execution_run_id,
                        status, summary_json, updated_at_ms
                 FROM completion_audit
                 WHERE session_id = ?1
                 ORDER BY updated_at_ms DESC, created_at_ms DESC
                 LIMIT 1",
                params![session_id],
                |row| {
                    let summary_json: String = row.get(5)?;
                    let summary_value: Value =
                        serde_json::from_str(&summary_json).unwrap_or_else(|_| json!({}));
                    Ok(AgentCompletionAuditSummary {
                        completion_audit_id: row.get(0)?,
                        session_id: row.get(1)?,
                        runtime_turn_id: row.get(2)?,
                        execution_run_id: row.get(3)?,
                        status: row.get(4)?,
                        missing_todo_item_ids: value_string_array(
                            &summary_value,
                            "missingTodoItemIds",
                        ),
                        missing_evidence_refs: value_string_array(
                            &summary_value,
                            "missingEvidenceRefs",
                        ),
                        failed_verification_run_ids: value_string_array(
                            &summary_value,
                            "failedVerificationRunIds",
                        ),
                        blocked_verification_run_ids: value_string_array(
                            &summary_value,
                            "blockedVerificationRunIds",
                        ),
                        not_run_verification_run_ids: value_string_array(
                            &summary_value,
                            "notRunVerificationRunIds",
                        ),
                        pending_approval_ticket_ids: value_string_array(
                            &summary_value,
                            "pendingApprovalTicketIds",
                        ),
                        residual_risks: summary_value
                            .get("residualRisks")
                            .cloned()
                            .unwrap_or_else(|| json!([])),
                        summary: summary_value
                            .get("summary")
                            .and_then(Value::as_str)
                            .unwrap_or("Completion audit is pending.")
                            .to_string(),
                        updated_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .context("failed to read completion audit summary")
        })
    }

    pub fn evaluate_completion_audit_and_delivery_proof(
        &self,
        session_id: &str,
        turn_id: Option<&str>,
    ) -> Result<Option<AgentCompletionAuditSummary>> {
        self.with_session_conn(session_id, |conn| {
            let execution_run_id = match turn_id {
                Some(turn_id) => find_execution_run_for_turn(conn, session_id, turn_id)?
                    .map(|(run_id, _)| run_id),
                None => read_latest_execution_run_id(conn, session_id)?,
            };
            let updated = upsert_completion_audit_and_delivery_proof(
                conn,
                session_id,
                turn_id,
                execution_run_id.as_deref(),
            )?;
            if updated {
                read_completion_audit_summary_from_conn(conn, session_id)
            } else {
                Ok(None)
            }
        })
    }
}
