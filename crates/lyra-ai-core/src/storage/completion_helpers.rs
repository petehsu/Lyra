use super::*;

struct TodoAuditSnapshot {
    missing_todo_item_ids: Vec<String>,
    failed_todo_item_ids: Vec<String>,
    blocked_todo_item_ids: Vec<String>,
    missing_evidence_refs: Vec<String>,
    evidence_refs: Vec<String>,
}

struct ExecutionAuditSnapshot {
    execution_run_id: String,
    status: String,
    step_count: i64,
    failed_step_count: i64,
    blocked_step_count: i64,
    artifact_refs: Vec<String>,
    evidence_refs: Vec<String>,
}

struct VerificationPlanAuditSnapshot {
    required: Vec<Value>,
    not_run: Vec<Value>,
    runs: Vec<AgentVerificationRunSummary>,
}

pub(super) fn upsert_completion_audit_and_delivery_proof(
    conn: &Connection,
    session_id: &str,
    turn_id: Option<&str>,
    execution_run_id: Option<&str>,
) -> Result<bool> {
    let todo = read_latest_todo_audit(conn, session_id)?;
    let execution = read_execution_audit(conn, session_id, execution_run_id)?;
    let verification_plan = read_latest_verification_plan_audit(conn, session_id)?;
    let pending_approval_ticket_ids = read_pending_approval_ticket_ids(conn, session_id)?;
    if todo.is_none()
        && execution.is_none()
        && verification_plan.is_none()
        && pending_approval_ticket_ids.is_empty()
    {
        return Ok(false);
    }
    let now = now_ms();
    let now_iso = now_iso();
    let verification_runs = verification_plan
        .as_ref()
        .map(|plan| plan.runs.clone())
        .unwrap_or_default();
    let failed_runs = verification_runs
        .iter()
        .filter(|run| run.status == "failed")
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let blocked_runs = verification_runs
        .iter()
        .filter(|run| run.status == "blocked")
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let not_run = verification_runs
        .iter()
        .filter(|run| run.status == "not_run")
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let pending_runs = verification_runs
        .iter()
        .filter(|run| matches!(run.status.as_str(), "pending" | "running"))
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let verification_missing_evidence = verification_runs
        .iter()
        .filter(|run| run.status == "passed" && run.evidence_refs.is_empty())
        .map(|run| format!("verification_run:{}", run.verification_run_id))
        .collect::<Vec<_>>();
    let required_count = verification_plan
        .as_ref()
        .map(|plan| plan.required.len())
        .unwrap_or_default();
    let missing_required_verification_count =
        required_count.saturating_sub(verification_runs.len());
    let not_run_plan_records = verification_plan
        .as_ref()
        .map(|plan| plan.not_run.clone())
        .unwrap_or_default();
    let failed_todo_item_ids = todo
        .as_ref()
        .map(|todo| todo.failed_todo_item_ids.clone())
        .unwrap_or_default();
    let blocked_todo_item_ids = todo
        .as_ref()
        .map(|todo| todo.blocked_todo_item_ids.clone())
        .unwrap_or_default();
    let missing_todo_item_ids = todo
        .as_ref()
        .map(|todo| todo.missing_todo_item_ids.clone())
        .unwrap_or_default();
    let mut missing_evidence_refs = todo
        .as_ref()
        .map(|todo| todo.missing_evidence_refs.clone())
        .unwrap_or_default();
    missing_evidence_refs =
        merge_string_refs(&missing_evidence_refs, &verification_missing_evidence);
    let execution_failed = execution
        .as_ref()
        .map(|execution| execution.failed_step_count > 0 || execution.status == "failed")
        .unwrap_or(false);
    let execution_blocked = execution
        .as_ref()
        .map(|execution| execution.blocked_step_count > 0 || execution.status == "blocked")
        .unwrap_or(false);
    let has_not_run = not_run.is_empty() == false || not_run_plan_records.is_empty() == false;
    let has_failure = failed_runs.is_empty() == false
        || failed_todo_item_ids.is_empty() == false
        || execution_failed;
    let has_blocker = blocked_runs.is_empty() == false
        || pending_runs.is_empty() == false
        || blocked_todo_item_ids.is_empty() == false
        || pending_approval_ticket_ids.is_empty() == false
        || missing_todo_item_ids.is_empty() == false
        || missing_evidence_refs.is_empty() == false
        || missing_required_verification_count > 0
        || execution_blocked;
    let audit_status = if has_failure {
        "failed"
    } else if has_blocker {
        "blocked"
    } else if has_not_run {
        "partial_allowed"
    } else {
        "passed"
    };
    let residual_risks = verification_runs
        .iter()
        .filter(|run| {
            run.status == "not_run"
                || (run.residual_risk.is_null() == false && run.residual_risk != json!({}))
        })
        .map(|run| {
            json!({
                "verificationRunId": run.verification_run_id,
                "status": run.status,
                "skipReason": run.skip_reason,
                "residualRisk": run.residual_risk,
            })
        })
        .chain(not_run_plan_records.iter().map(|record| {
            json!({
                "source": "verification_plan",
                "record": record,
            })
        }))
        .collect::<Vec<_>>();
    let execution_run_id = execution
        .as_ref()
        .map(|execution| execution.execution_run_id.as_str())
        .or(execution_run_id);
    let audit_summary = delivery_audit_summary_text(
        audit_status,
        failed_runs.len(),
        blocked_runs.len() + pending_runs.len(),
        not_run.len() + not_run_plan_records.len(),
        missing_todo_item_ids.len(),
        pending_approval_ticket_ids.len(),
    );
    let completion_audit_id = new_id("completion_audit");
    conn.execute(
        "INSERT INTO completion_audit (
            completion_audit_id, session_id, runtime_turn_id, execution_run_id, status,
            summary_json, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?7, ?8)",
        params![
            completion_audit_id,
            session_id,
            turn_id,
            execution_run_id,
            audit_status,
            json!({
                "summary": audit_summary,
                "missingTodoItemIds": missing_todo_item_ids.clone(),
                "failedTodoItemIds": failed_todo_item_ids.clone(),
                "blockedTodoItemIds": blocked_todo_item_ids.clone(),
                "missingEvidenceRefs": missing_evidence_refs.clone(),
                "failedVerificationRunIds": failed_runs.clone(),
                "blockedVerificationRunIds": blocked_runs.clone(),
                "pendingVerificationRunIds": pending_runs.clone(),
                "notRunVerificationRunIds": not_run.clone(),
                "missingRequiredVerificationCount": missing_required_verification_count,
                "pendingApprovalTicketIds": pending_approval_ticket_ids.clone(),
                "execution": execution.as_ref().map(|execution| json!({
                    "executionRunId": execution.execution_run_id.clone(),
                    "status": execution.status.clone(),
                    "stepCount": execution.step_count,
                    "failedStepCount": execution.failed_step_count,
                    "blockedStepCount": execution.blocked_step_count,
                })),
                "residualRisks": residual_risks.clone(),
            })
            .to_string(),
            now,
            now_iso,
        ],
    )?;
    let verification_run_ids = verification_runs
        .iter()
        .map(|run| run.verification_run_id.clone())
        .collect::<Vec<_>>();
    let artifact_refs = verification_runs
        .iter()
        .filter_map(|run| run.artifact_id.clone())
        .collect::<Vec<_>>();
    let step_artifact_refs = execution
        .as_ref()
        .map(|execution| execution.artifact_refs.clone())
        .unwrap_or_default();
    let artifact_refs = merge_string_refs(&artifact_refs, &step_artifact_refs);
    let evidence_refs = verification_runs
        .iter()
        .flat_map(|run| run.evidence_refs.clone())
        .collect::<Vec<_>>();
    let todo_evidence_refs = todo
        .as_ref()
        .map(|todo| todo.evidence_refs.clone())
        .unwrap_or_default();
    let step_evidence_refs = execution
        .as_ref()
        .map(|execution| execution.evidence_refs.clone())
        .unwrap_or_default();
    let evidence_refs = merge_string_refs(
        &merge_string_refs(&evidence_refs, &todo_evidence_refs),
        &step_evidence_refs,
    );
    let unresolved_risks = json!({
        "failedVerificationRunIds": failed_runs,
        "blockedVerificationRunIds": blocked_runs,
        "pendingVerificationRunIds": pending_runs,
        "notRunVerificationRunIds": not_run,
        "pendingApprovalTicketIds": pending_approval_ticket_ids,
        "missingTodoItemIds": missing_todo_item_ids,
        "missingEvidenceRefs": missing_evidence_refs,
        "missingRequiredVerificationCount": missing_required_verification_count,
        "residualRisks": residual_risks,
    });
    let delivery_status = match audit_status {
        "passed" => "ready",
        "partial_allowed" => "partial",
        "failed" => "failed",
        "blocked" => "blocked",
        _ => "pending_verification",
    };
    let delivery_proof_id = new_id("delivery_proof");
    conn.execute(
        "INSERT INTO delivery_proof (
            delivery_proof_id, session_id, runtime_turn_id, execution_run_id, status,
            objective_ref, changed_files_refs_json, artifact_refs_json, evidence_refs_json,
            verification_run_ids_json, completion_audit_id, side_effect_refs_json,
            unresolved_risks_json, user_visible_summary_ref, created_at_ms, created_at_iso,
            updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, '[]', ?6, ?7, ?8, ?9, '[]', ?10, ?11, ?12, ?13, ?12, ?13)",
        params![
            delivery_proof_id,
            session_id,
            turn_id,
            execution_run_id,
            delivery_status,
            json_string(&artifact_refs)?,
            json_string(&evidence_refs)?,
            json_string(&verification_run_ids)?,
            completion_audit_id,
            unresolved_risks.to_string(),
            delivery_summary_text(delivery_status, &audit_summary),
            now,
            now_iso,
        ],
    )?;
    Ok(true)
}

fn read_latest_todo_audit(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<TodoAuditSnapshot>> {
    let todo_list_id = conn
        .query_row(
            "SELECT todo_list_id
             FROM execution_todo_list
             WHERE session_id = ?1 AND status NOT IN ('superseded', 'superseded_by_rollback')
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(todo_list_id) = todo_list_id else {
        return Ok(None);
    };
    let items = read_todo_items_for_list(conn, &todo_list_id)?;
    let mut missing_todo_item_ids = Vec::new();
    let mut failed_todo_item_ids = Vec::new();
    let mut blocked_todo_item_ids = Vec::new();
    let mut missing_evidence_refs = Vec::new();
    let mut evidence_refs = Vec::new();
    for item in items {
        evidence_refs = merge_string_refs(&evidence_refs, &item.evidence_refs);
        match item.status.as_str() {
            "completed" => {
                if item.evidence_refs.is_empty() {
                    missing_evidence_refs.push(format!("todo_item:{}", item.todo_item_id));
                }
            }
            "skipped" => {}
            "failed" => {
                failed_todo_item_ids.push(item.todo_item_id.clone());
                missing_todo_item_ids.push(item.todo_item_id);
            }
            "blocked" => {
                blocked_todo_item_ids.push(item.todo_item_id.clone());
                missing_todo_item_ids.push(item.todo_item_id);
            }
            _ => missing_todo_item_ids.push(item.todo_item_id),
        }
    }
    Ok(Some(TodoAuditSnapshot {
        missing_todo_item_ids,
        failed_todo_item_ids,
        blocked_todo_item_ids,
        missing_evidence_refs,
        evidence_refs,
    }))
}

fn read_execution_audit(
    conn: &Connection,
    session_id: &str,
    execution_run_id: Option<&str>,
) -> Result<Option<ExecutionAuditSnapshot>> {
    let row = if let Some(execution_run_id) = execution_run_id {
        conn.query_row(
            "SELECT execution_run_id, status
             FROM execution_run
             WHERE session_id = ?1 AND execution_run_id = ?2",
            params![session_id, execution_run_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    } else {
        conn.query_row(
            "SELECT execution_run_id, status
             FROM execution_run
             WHERE session_id = ?1 AND status != 'superseded_by_rollback'
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
    };
    let Some((execution_run_id, status)) = row else {
        return Ok(None);
    };
    let counts = read_execution_step_counts(conn, &execution_run_id)?;
    let (artifact_refs, evidence_refs) = read_execution_step_refs(conn, &execution_run_id)?;
    Ok(Some(ExecutionAuditSnapshot {
        execution_run_id,
        status,
        step_count: counts.0,
        failed_step_count: counts.2,
        blocked_step_count: counts.3,
        artifact_refs,
        evidence_refs,
    }))
}

pub(super) fn read_execution_step_refs(
    conn: &Connection,
    execution_run_id: &str,
) -> Result<(Vec<String>, Vec<String>)> {
    let mut stmt = conn.prepare(
        "SELECT artifact_refs_json, evidence_refs_json
         FROM execution_step
         WHERE execution_run_id = ?1",
    )?;
    let rows = stmt.query_map(params![execution_run_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut artifact_refs = Vec::new();
    let mut evidence_refs = Vec::new();
    for row in rows {
        let (artifact_json, evidence_json) = row?;
        artifact_refs = merge_string_refs(&artifact_refs, &parse_json_vec_string(&artifact_json));
        evidence_refs = merge_string_refs(&evidence_refs, &parse_json_vec_string(&evidence_json));
    }
    Ok((artifact_refs, evidence_refs))
}

fn read_latest_verification_plan_audit(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<VerificationPlanAuditSnapshot>> {
    let row = conn
        .query_row(
            "SELECT verification_plan_id, required_json, not_run_json
             FROM verification_plan
             WHERE session_id = ?1 AND status != 'superseded_by_rollback'
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((verification_plan_id, required_json, not_run_json)) = row else {
        return Ok(None);
    };
    Ok(Some(VerificationPlanAuditSnapshot {
        required: parse_json_vec_value(&required_json),
        not_run: parse_json_vec_value(&not_run_json),
        runs: read_verification_runs_for_plan(conn, &verification_plan_id)?,
    }))
}

pub(super) fn read_pending_approval_ticket_ids(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT approval_ticket_id
             FROM approval_ticket
         WHERE session_id = ?1 AND status = 'pending_user'
         ORDER BY updated_at_ms DESC, created_at_ms DESC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| row.get::<_, String>(0))?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(super) fn read_latest_execution_run_id(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT execution_run_id
         FROM execution_run
         WHERE session_id = ?1 AND status != 'superseded_by_rollback'
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![session_id],
        |row| row.get(0),
    )
    .optional()
    .context("failed to read latest execution run id")
}

pub(super) fn read_completion_audit_summary_from_conn(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<AgentCompletionAuditSummary>> {
    conn.query_row(
        "SELECT completion_audit_id, session_id, runtime_turn_id, execution_run_id,
                status, summary_json, updated_at_ms
         FROM completion_audit
         WHERE session_id = ?1 AND status != 'superseded_by_rollback'
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
                missing_todo_item_ids: value_string_array(&summary_value, "missingTodoItemIds"),
                missing_evidence_refs: value_string_array(&summary_value, "missingEvidenceRefs"),
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
}

pub(super) fn delivery_audit_summary_text(
    status: &str,
    failed_verification_count: usize,
    blocked_verification_count: usize,
    not_run_count: usize,
    missing_todo_count: usize,
    pending_approval_count: usize,
) -> String {
    match status {
        "passed" => "Completion audit passed.".to_string(),
        "failed" => format!(
            "Completion audit failed: {failed_verification_count} failed verification run(s)."
        ),
        "blocked" => format!(
            "Completion audit blocked: {missing_todo_count} todo item(s), {blocked_verification_count} verification run(s), and {pending_approval_count} approval(s) still need resolution."
        ),
        "partial_allowed" => format!(
            "Completion audit allows partial delivery with {not_run_count} not-run verification record(s)."
        ),
        _ => "Completion audit is pending.".to_string(),
    }
}

pub(super) fn delivery_summary_text(status: &str, audit_summary: &str) -> String {
    match status {
        "ready" => "Delivery proof is ready.".to_string(),
        "partial" => format!("Delivery proof is partial. {audit_summary}"),
        "failed" => format!("Delivery proof failed. {audit_summary}"),
        "blocked" => format!("Delivery proof is blocked. {audit_summary}"),
        _ => "Delivery proof is pending verification.".to_string(),
    }
}
