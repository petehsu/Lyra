use super::*;

impl AiStore {
    pub fn create_verification_plan_for_changed_files(
        &self,
        session_id: &str,
        turn_id: &str,
        source_artifact_id: &str,
        changed_files: Value,
    ) -> Result<VerificationPlanRecord> {
        let verification_plan_id = new_id("verification_plan");
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let execution_run_id = find_execution_run_for_turn(conn, session_id, turn_id)?
                .map(|(run_id, _)| run_id);
            let required = infer_verification_requirements(&changed_files);
            let not_run = if required.is_empty() {
                vec![json!({
                    "kind": "not_run_record",
                    "reason": "no_safe_verification_command",
                    "changedFiles": changed_files
                })]
            } else {
                Vec::new()
            };
            let status = if required.is_empty() {
                "not_run"
            } else {
                "pending"
            };
            conn.execute(
                "INSERT INTO verification_plan (
                    verification_plan_id, session_id, runtime_turn_id, execution_run_id,
                    status, title, required_json, optional_json, not_run_json, source_json,
                    created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'Write-after verification', ?6, '[]', ?7, ?8, ?9, ?10, ?9, ?10)",
                params![
                    verification_plan_id,
                    session_id,
                    turn_id,
                    execution_run_id,
                    status,
                    json_string(&required)?,
                    json_string(&not_run)?,
                    json!({
                        "type": "apply_patch",
                        "sourceArtifactId": source_artifact_id,
                        "changedFiles": changed_files
                    })
                    .to_string(),
                    now,
                    now_iso,
                ],
            )?;
            if required.is_empty() {
                let verification_run_id = new_id("verification_run");
                conn.execute(
                    "INSERT INTO verification_run (
                        verification_run_id, verification_plan_id, session_id, runtime_turn_id,
                        execution_run_id, kind, status, command, cwd, tool_operation_id,
                        report_artifact_id, evidence_refs_json, exit_code, output_bytes,
                        failure_summary, skip_reason, residual_risk_json, created_at_ms,
                        created_at_iso, updated_at_ms, updated_at_iso
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 'not_run_record', 'not_run', NULL, NULL, NULL,
                        NULL, '[]', NULL, NULL, NULL, 'No safe verification command could be inferred',
                        ?6, ?7, ?8, ?7, ?8)",
                    params![
                        verification_run_id,
                        verification_plan_id,
                        session_id,
                        turn_id,
                        execution_run_id,
                        json!({
                            "reason": "no_safe_verification_command",
                            "changedFiles": changed_files
                        })
                        .to_string(),
                        now,
                        now_iso,
                    ],
                )?;
            }
            upsert_completion_audit_and_delivery_proof(
                conn,
                session_id,
                Some(turn_id),
                execution_run_id.as_deref(),
            )?;
            Ok(VerificationPlanRecord {
                verification_plan_id,
                session_id: session_id.to_string(),
                runtime_turn_id: Some(turn_id.to_string()),
                execution_run_id,
                status: status.to_string(),
                required,
                not_run,
                updated_at: now,
            })
        })
    }

    pub fn append_command_log_artifact_and_evidence(
        &self,
        session_id: &str,
        turn_id: &str,
        op_id: &str,
        result_ref: &str,
        status: &str,
        command: &str,
        cwd: &str,
        exit_code: Option<i64>,
        output_bytes: i64,
        metadata: Value,
    ) -> Result<CommandArtifactRefs> {
        let artifact_id = new_id("artifact");
        let artifact_version_id = new_id("artifact_version");
        let evidence_id = new_id("evidence");
        let verification_run_id = new_id("verification_run");
        let now = now_ms();
        let now_iso = now_iso();
        self.with_session_conn(session_id, |conn| {
            let execution_run_id = find_execution_run_for_turn(conn, session_id, turn_id)?
                .map(|(run_id, _)| run_id);
            let verification_plan_id = ensure_verification_plan_for_command(
                conn,
                session_id,
                Some(turn_id),
                execution_run_id.as_deref(),
                command,
                cwd,
            )?;
            conn.execute(
                "INSERT INTO artifact_record (
                    artifact_id, artifact_version_id, session_id, runtime_turn_id, kind, status,
                    title, content_ref, projection_ref, metadata_json, source_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, 'command_log', ?5, ?6, ?7, NULL, ?8, ?9, ?10, ?11, ?10, ?11)",
                params![
                    artifact_id,
                    artifact_version_id,
                    session_id,
                    turn_id,
                    status,
                    format!("Command log: {command}"),
                    result_ref,
                    metadata.to_string(),
                    json!({
                        "sourceType": "tool_operation",
                        "toolOperationId": op_id
                    })
                    .to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO evidence_record (
                    evidence_id, session_id, runtime_turn_id, kind, status, claim_json,
                    artifact_ids_json, tool_operation_ids_json, confidence, created_at_ms,
                    created_at_iso, stale_reason
                 ) VALUES (?1, ?2, ?3, 'verification_run', 'active', ?4, ?5, ?6, 'high', ?7, ?8, NULL)",
                params![
                    evidence_id,
                    session_id,
                    turn_id,
                    json!({
                        "targetKind": "verification",
                        "claim": "A workspace command was executed and recorded.",
                        "command": command,
                        "cwd": cwd,
                        "status": status,
                        "exitCode": exit_code
                    })
                    .to_string(),
                    json!([artifact_id]).to_string(),
                    json!([op_id]).to_string(),
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "INSERT INTO verification_run (
                    verification_run_id, verification_plan_id, session_id, runtime_turn_id,
                    execution_run_id, kind, status, command, cwd, tool_operation_id,
                    report_artifact_id, evidence_refs_json, exit_code, output_bytes,
                    failure_summary, skip_reason, residual_risk_json, created_at_ms,
                    created_at_iso, updated_at_ms, updated_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'command', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                    ?14, NULL, ?15, ?16, ?17, ?16, ?17)",
                params![
                    verification_run_id,
                    verification_plan_id,
                    session_id,
                    turn_id,
                    execution_run_id,
                    normalize_verification_run_status(status),
                    command,
                    cwd,
                    op_id,
                    artifact_id,
                    json!([evidence_id]).to_string(),
                    exit_code,
                    output_bytes,
                    if status == "failed" {
                        Some("Command exited unsuccessfully")
                    } else {
                        None
                    },
                    if status == "failed" {
                        json!({ "level": "medium", "reason": "command_failed" })
                    } else {
                        json!({})
                    }
                    .to_string(),
                    now,
                    now_iso,
                ],
            )?;
            let plan_status = compute_verification_plan_status(conn, &verification_plan_id)?;
            conn.execute(
                "UPDATE verification_plan
                 SET status = ?1, updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE verification_plan_id = ?4",
                params![plan_status, now, now_iso, verification_plan_id],
            )?;
            upsert_completion_audit_and_delivery_proof(
                conn,
                session_id,
                Some(turn_id),
                execution_run_id.as_deref(),
            )?;
            Ok(CommandArtifactRefs {
                artifact_id,
                evidence_id,
                verification_plan_id,
                verification_run_id,
            })
        })
    }

    pub fn read_verification_summary(
        &self,
        session_id: &str,
    ) -> Result<Option<AgentVerificationSummary>> {
        self.with_session_conn(session_id, |conn| {
            let row = conn
                .query_row(
                    "SELECT verification_plan_id, session_id, runtime_turn_id, execution_run_id,
                            status, required_json, updated_at_ms
                     FROM verification_plan
                     WHERE session_id = ?1
                     ORDER BY updated_at_ms DESC, created_at_ms DESC
                     LIMIT 1",
                    params![session_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, Option<String>>(3)?,
                            row.get::<_, String>(4)?,
                            row.get::<_, String>(5)?,
                            row.get::<_, i64>(6)?,
                        ))
                    },
                )
                .optional()
                .context("failed to read verification summary")?;
            let Some((
                verification_plan_id,
                session_id,
                runtime_turn_id,
                execution_run_id,
                status,
                required_json,
                updated_at,
            )) = row
            else {
                return Ok(None);
            };
            let required = parse_json_vec_value(&required_json);
            let runs = read_verification_runs_for_plan(conn, &verification_plan_id)?;
            let passed = runs.iter().filter(|run| run.status == "passed").count() as i64;
            let failed = runs.iter().filter(|run| run.status == "failed").count() as i64;
            let blocked = runs.iter().filter(|run| run.status == "blocked").count() as i64;
            let not_run = runs.iter().filter(|run| run.status == "not_run").count() as i64;
            Ok(Some(AgentVerificationSummary {
                verification_plan_id,
                session_id,
                runtime_turn_id,
                execution_run_id,
                status,
                required_run_count: required.len() as i64,
                passed_run_count: passed,
                failed_run_count: failed,
                blocked_run_count: blocked,
                not_run_count: not_run,
                runs,
                updated_at,
            }))
        })
    }
}
