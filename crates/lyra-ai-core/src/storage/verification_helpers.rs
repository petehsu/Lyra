use super::*;

pub(super) fn infer_verification_requirements(changed_files: &Value) -> Vec<Value> {
    let mut commands = Vec::<Value>::new();
    let mut seen = Vec::<String>::new();
    let paths = changed_files
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("path").and_then(Value::as_str))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for path in paths {
        let command = if path.ends_with(".rs") {
            let crate_name = path
                .strip_prefix("crates/")
                .and_then(|rest| rest.split('/').next())
                .filter(|value| value.is_empty() == false)
                .unwrap_or("");
            if crate_name.is_empty() {
                "cargo test".to_string()
            } else {
                format!("cargo test -p {crate_name}")
            }
        } else if path.starts_with("apps/desktop/")
            && (path.ends_with(".ts")
                || path.ends_with(".tsx")
                || path.ends_with(".css")
                || path.ends_with(".scss"))
        {
            "npm --prefix apps/desktop run test -- ai-panel".to_string()
        } else {
            continue;
        };
        if seen.iter().any(|value| value == &command) {
            continue;
        }
        seen.push(command.clone());
        commands.push(json!({
            "kind": "command",
            "toolPath": "/tools/shell/run_command",
            "command": command,
            "cwd": ".",
            "required": true,
            "reason": "write_after_patch"
        }));
    }
    commands
}

pub(super) fn ensure_verification_plan_for_command(
    conn: &Connection,
    session_id: &str,
    turn_id: Option<&str>,
    execution_run_id: Option<&str>,
    command: &str,
    cwd: &str,
) -> Result<String> {
    let existing = conn
        .query_row(
            "SELECT verification_plan_id
             FROM verification_plan
             WHERE session_id = ?1
             ORDER BY updated_at_ms DESC, created_at_ms DESC
             LIMIT 1",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(verification_plan_id) = existing {
        return Ok(verification_plan_id);
    }
    let verification_plan_id = new_id("verification_plan");
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "INSERT INTO verification_plan (
            verification_plan_id, session_id, runtime_turn_id, execution_run_id,
            status, title, required_json, optional_json, not_run_json, source_json,
            created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, 'pending', 'Ad-hoc command verification', ?5, '[]', '[]', ?6, ?7, ?8, ?7, ?8)",
        params![
            verification_plan_id,
            session_id,
            turn_id,
            execution_run_id,
            json!([{
                "kind": "command",
                "toolPath": "/tools/shell/run_command",
                "command": command,
                "cwd": cwd,
                "required": true,
                "reason": "ad_hoc_command"
            }])
            .to_string(),
            json!({ "type": "run_command", "command": command, "cwd": cwd }).to_string(),
            now,
            now_iso,
        ],
    )?;
    Ok(verification_plan_id)
}

pub(super) fn read_verification_runs_for_plan(
    conn: &Connection,
    verification_plan_id: &str,
) -> Result<Vec<AgentVerificationRunSummary>> {
    let mut stmt = conn.prepare(
        "SELECT verification_run_id, verification_plan_id, execution_run_id, runtime_turn_id,
                kind, status, command, cwd, exit_code, report_artifact_id,
                evidence_refs_json, skip_reason, residual_risk_json, updated_at_ms
         FROM verification_run
         WHERE verification_plan_id = ?1
         ORDER BY created_at_ms ASC",
    )?;
    let rows = stmt.query_map(params![verification_plan_id], |row| {
        let evidence_refs_json: String = row.get(10)?;
        let residual_risk_json: String = row.get(12)?;
        Ok(AgentVerificationRunSummary {
            verification_run_id: row.get(0)?,
            verification_plan_id: row.get(1)?,
            execution_run_id: row.get(2)?,
            runtime_turn_id: row.get(3)?,
            kind: row.get(4)?,
            status: row.get(5)?,
            command: row.get(6)?,
            cwd: row.get(7)?,
            exit_code: row.get(8)?,
            artifact_id: row.get(9)?,
            evidence_refs: parse_json_vec_string(&evidence_refs_json),
            skip_reason: row.get(11)?,
            residual_risk: serde_json::from_str(&residual_risk_json).unwrap_or_else(|_| json!({})),
            updated_at: row.get(13)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows {
        result.push(row?);
    }
    Ok(result)
}

pub(super) fn compute_verification_plan_status(
    conn: &Connection,
    verification_plan_id: &str,
) -> Result<String> {
    let mut stmt =
        conn.prepare("SELECT status FROM verification_run WHERE verification_plan_id = ?1")?;
    let rows = stmt.query_map(params![verification_plan_id], |row| row.get::<_, String>(0))?;
    let mut statuses = Vec::new();
    for row in rows {
        statuses.push(row?);
    }
    if statuses.iter().any(|status| status == "failed") {
        return Ok("failed".to_string());
    }
    if statuses.iter().any(|status| status == "blocked") {
        return Ok("blocked".to_string());
    }
    if statuses.is_empty() {
        return Ok("pending".to_string());
    }
    if statuses.iter().all(|status| status == "not_run") {
        return Ok("not_run".to_string());
    }
    if statuses
        .iter()
        .all(|status| matches!(status.as_str(), "passed" | "not_run"))
    {
        return Ok("passed".to_string());
    }
    Ok("pending".to_string())
}

pub(super) fn normalize_verification_run_status(status: &str) -> &'static str {
    match status {
        "passed" | "completed" => "passed",
        "failed" => "failed",
        "blocked" => "blocked",
        "not_run" => "not_run",
        "running" => "running",
        _ => "pending",
    }
}
