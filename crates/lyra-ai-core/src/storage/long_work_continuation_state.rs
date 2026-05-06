use super::long_work_status::{progress_from_items, LongWorkAuditStatus};
use super::*;

#[derive(Clone)]
pub(super) struct WorkRunRow {
    pub(super) run_id: String,
    pub(super) session_id: String,
    pub(super) runtime_turn_id: Option<String>,
    pub(super) todo_list_id: String,
    pub(super) execution_run_id: String,
    pub(super) goal_id: String,
    pub(super) status: String,
    pub(super) objective_summary: String,
    pub(super) checkpoint_ids: Vec<String>,
    pub(super) current_slice_id: String,
}

pub(super) struct ProgressSnapshot {
    pub(super) execution_step_ids: Vec<String>,
    pub(super) tool_operation_ids: Vec<String>,
    pub(super) evidence_refs: Vec<String>,
    pub(super) artifact_refs: Vec<String>,
    pub(super) value: Value,
    pub(super) has_progress: bool,
}

pub(super) fn read_latest_controller_run(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<WorkRunRow>> {
    conn.query_row(
        "SELECT long_work_run_id, session_id, runtime_turn_id, todo_list_id, execution_run_id,
                goal_id, status, objective_summary, checkpoint_ids_json, current_slice_id
         FROM long_work_run
         WHERE session_id = ?1
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![session_id],
        |row| {
            let checkpoint_json: String = row.get(8)?;
            let current_slice_id = row
                .get::<_, Option<String>>(9)?
                .unwrap_or_else(|| "missing_work_slice".to_string());
            Ok(WorkRunRow {
                run_id: row.get(0)?,
                session_id: row.get(1)?,
                runtime_turn_id: row.get(2)?,
                todo_list_id: row.get(3)?,
                execution_run_id: row.get(4)?,
                goal_id: row.get(5)?,
                status: row.get(6)?,
                objective_summary: row.get(7)?,
                checkpoint_ids: parse_json_vec_string(&checkpoint_json),
                current_slice_id,
            })
        },
    )
    .optional()
    .context("failed to read long work controller run")
}

pub(super) fn read_slice_sequence(conn: &Connection, slice_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT sequence FROM work_slice WHERE work_slice_id = ?1",
        params![slice_id],
        |row| row.get(0),
    )
    .optional()
    .map(|value| value.unwrap_or(1))
    .context("failed to read work slice sequence")
}

pub(super) fn stop_slice(
    conn: &Connection,
    slice_id: &str,
    status: &str,
    sequence: i64,
    stop_cause: &str,
    progress: &ProgressSnapshot,
    user_visible_output_ref: Option<&str>,
) -> Result<()> {
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "UPDATE work_slice
         SET status = ?1, sequence = ?2, stop_cause = ?3, model_invocation_ids_json = '[]',
             tool_operation_ids_json = ?4, execution_step_ids_json = ?5,
             evidence_refs_json = ?6, artifact_refs_json = ?7, progress_delta_json = ?8,
             user_visible_output_ref = ?9, updated_at_ms = ?10, updated_at_iso = ?11,
             closed_at_ms = COALESCE(closed_at_ms, ?10),
             closed_at_iso = COALESCE(closed_at_iso, ?11)
         WHERE work_slice_id = ?12",
        params![
            status,
            sequence,
            stop_cause,
            json_string(&progress.tool_operation_ids)?,
            json_string(&progress.execution_step_ids)?,
            json_string(&progress.evidence_refs)?,
            json_string(&progress.artifact_refs)?,
            progress.value.to_string(),
            user_visible_output_ref,
            now,
            now_iso,
            slice_id,
        ],
    )?;
    Ok(())
}

pub(super) fn read_progress_snapshot(
    conn: &Connection,
    execution_run_id: &str,
    items: &[AgentTodoItem],
    audit: Option<&LongWorkAuditStatus>,
) -> Result<ProgressSnapshot> {
    let mut stmt = conn.prepare(
        "SELECT execution_step_id, tool_operation_ids_json, evidence_refs_json, artifact_refs_json
         FROM execution_step
         WHERE execution_run_id = ?1
         ORDER BY updated_at_ms, created_at_ms",
    )?;
    let rows = stmt.query_map(params![execution_run_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    let mut execution_step_ids = Vec::new();
    let mut tool_operation_ids = Vec::new();
    let mut evidence_refs = Vec::new();
    let mut artifact_refs = Vec::new();
    for row in rows {
        let (step_id, tool_json, evidence_json, artifact_json) = row?;
        execution_step_ids = merge_string_refs(&execution_step_ids, &[step_id]);
        tool_operation_ids =
            merge_string_refs(&tool_operation_ids, &parse_json_vec_string(&tool_json));
        evidence_refs = merge_string_refs(&evidence_refs, &parse_json_vec_string(&evidence_json));
        artifact_refs = merge_string_refs(&artifact_refs, &parse_json_vec_string(&artifact_json));
    }
    let todo_progress = progress_from_items(items);
    let audit_status = audit.map(|audit| audit.status.clone());
    let has_progress = todo_progress.completed > 0
        || execution_step_ids.is_empty() == false
        || tool_operation_ids.is_empty() == false
        || evidence_refs.is_empty() == false
        || artifact_refs.is_empty() == false
        || audit_status.as_deref() == Some("passed");
    let value = json!({
        "todoProgress": todo_progress,
        "executionStepIds": execution_step_ids,
        "toolOperationIds": tool_operation_ids,
        "evidenceRefs": evidence_refs,
        "artifactRefs": artifact_refs,
        "completionAuditStatus": audit_status,
        "hasProgress": has_progress,
    });
    Ok(ProgressSnapshot {
        execution_step_ids,
        tool_operation_ids,
        evidence_refs,
        artifact_refs,
        value,
        has_progress,
    })
}

pub(super) fn consecutive_no_progress_slices(conn: &Connection, run_id: &str) -> Result<i64> {
    let mut stmt = conn.prepare(
        "SELECT progress_delta_json
         FROM work_slice
         WHERE long_work_run_id = ?1
           AND status IN ('continuation_queued', 'superseded_by_continuation', 'stuck')
         ORDER BY sequence DESC, updated_at_ms DESC
         LIMIT 3",
    )?;
    let rows = stmt.query_map(params![run_id], |row| row.get::<_, String>(0))?;
    let mut count = 0_i64;
    for row in rows {
        let value: Value = serde_json::from_str(&row?).unwrap_or_else(|_| json!({}));
        if value
            .get("hasProgress")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            break;
        }
        count += 1;
    }
    Ok(count)
}

pub(super) fn repeated_same_tool_failure_count(
    conn: &Connection,
    turn_id: Option<&str>,
) -> Result<i64> {
    let Some(turn_id) = turn_id else {
        return Ok(0);
    };
    conn.query_row(
        "SELECT COUNT(*)
         FROM tool_result_blob
         WHERE runtime_turn_id = ?1
           AND status = 'failed'
           AND tool_path = (
             SELECT tool_path
             FROM tool_result_blob
             WHERE runtime_turn_id = ?1 AND status = 'failed'
             GROUP BY tool_path
             ORDER BY COUNT(*) DESC
             LIMIT 1
           )",
        params![turn_id],
        |row| row.get(0),
    )
    .optional()
    .map(|value| value.unwrap_or(0))
    .context("failed to count repeated tool failures")
}
