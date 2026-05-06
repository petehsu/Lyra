#![allow(dead_code)]

use super::long_work_ledger::read_latest_work_summary_from_conn;
use super::long_work_status::{
    approval_related_blocker, blocker_ids_from_items, progress_from_items,
    read_completion_audit_for_execution, todo_items_are_done, update_work_status_in_conn,
};
use super::*;

const MAX_CONTINUATION_SLICES: i64 = 3;

#[derive(Clone)]
struct WorkRunRow {
    run_id: String,
    session_id: String,
    runtime_turn_id: Option<String>,
    todo_list_id: String,
    execution_run_id: String,
    goal_id: String,
    status: String,
    objective_summary: String,
    checkpoint_ids: Vec<String>,
    current_slice_id: String,
}

struct ProgressSnapshot {
    execution_step_ids: Vec<String>,
    tool_operation_ids: Vec<String>,
    evidence_refs: Vec<String>,
    artifact_refs: Vec<String>,
    value: Value,
    has_progress: bool,
}

impl AiStore {
    pub fn evaluate_long_work_completion_candidate(
        &self,
        input: LongWorkCompletionCandidateInput,
    ) -> Result<LongWorkCandidateEvaluation> {
        self.with_session_conn(&input.session_id, |conn| {
            let Some(run) = read_latest_controller_run(conn, &input.session_id)? else {
                return Ok(LongWorkCandidateEvaluation {
                    summary: None,
                    suppressed: false,
                    blocked: false,
                    stuck: false,
                    report_id: None,
                    continuation_id: None,
                    stuck_report_id: None,
                    event_payload: json!({ "sessionId": input.session_id }),
                });
            };
            if matches!(
                run.status.as_str(),
                "completed" | "failed" | "cancelled" | "stuck"
            ) {
                return Ok(LongWorkCandidateEvaluation {
                    summary: read_latest_work_summary_from_conn(conn, &input.session_id)?,
                    suppressed: false,
                    blocked: run.status == "blocked",
                    stuck: run.status == "stuck",
                    report_id: None,
                    continuation_id: None,
                    stuck_report_id: None,
                    event_payload: base_event_payload(&run),
                });
            }

            let turn_id = input
                .runtime_turn_id
                .as_deref()
                .or(run.runtime_turn_id.as_deref());
            let items = read_todo_items_for_list(conn, &run.todo_list_id)?;
            let audit = read_completion_audit_for_execution(
                conn,
                &run.session_id,
                &run.execution_run_id,
                turn_id,
            )?;
            let open_todo_item_ids = open_todo_item_ids(&items);
            let completed_todo_items = completed_todo_items(&items);
            let missing_evidence = missing_evidence_refs(audit.as_ref());
            let pending_approval_ticket_ids = audit
                .as_ref()
                .map(|audit| value_string_array(&audit.summary, "pendingApprovalTicketIds"))
                .unwrap_or_default();
            let blocked_verification_run_ids = audit
                .as_ref()
                .map(|audit| value_string_array(&audit.summary, "blockedVerificationRunIds"))
                .unwrap_or_default();
            let progress =
                read_progress_snapshot(conn, &run.execution_run_id, &items, audit.as_ref())?;
            let current_sequence = read_slice_sequence(conn, &run.current_slice_id)?;
            let next_slice_sequence = current_sequence + 1;
            let stop_cause = "completion_candidate";

            let completed = audit
                .as_ref()
                .map(|audit| audit.status == "passed")
                .unwrap_or(false)
                && todo_items_are_done(&items);
            let real_blocker = approval_related_blocker(&items)
                || pending_approval_ticket_ids.is_empty() == false
                || blocked_verification_run_ids.is_empty() == false
                || items.iter().any(|item| item.status == "blocked");
            let repeated_failure = repeated_same_tool_failure_count(conn, turn_id)?;

            let mut signals = Vec::new();
            if open_todo_item_ids.is_empty() == false {
                signals.push("open_todo_items".to_string());
            }
            if missing_evidence.is_empty() == false {
                signals.push("missing_required_evidence".to_string());
            }
            if audit
                .as_ref()
                .map(|audit| {
                    value_string_array(&audit.summary, "notRunVerificationRunIds").is_empty()
                        == false
                })
                .unwrap_or(false)
            {
                signals.push("tests_not_run_after_code_change".to_string());
            }
            if progress.has_progress == false {
                signals.push("no_progress_since_last_slice".to_string());
            }
            if audit
                .as_ref()
                .map(|audit| audit.status == "failed")
                .unwrap_or(false)
            {
                signals.push("unresolved_error_log".to_string());
            }

            let candidate_output_ref = if input.candidate_text.trim().is_empty() {
                None
            } else {
                Some(format!(
                    "suppressed_output:{}",
                    sha256_hex(input.candidate_text.as_bytes())
                ))
            };

            if completed {
                stop_slice(
                    conn,
                    &run.current_slice_id,
                    "completed",
                    current_sequence,
                    stop_cause,
                    &progress,
                    candidate_output_ref.as_deref(),
                )?;
                update_work_status_in_conn(
                    conn,
                    &run.run_id,
                    &LongWorkStatusUpdate {
                        status: "completed".to_string(),
                        checkpoint_ids: run.checkpoint_ids.clone(),
                        blocker_ids: Vec::new(),
                    },
                    now_ms(),
                    &now_iso(),
                )?;
                return Ok(LongWorkCandidateEvaluation {
                    summary: read_latest_work_summary_from_conn(conn, &input.session_id)?,
                    suppressed: false,
                    blocked: false,
                    stuck: false,
                    report_id: None,
                    continuation_id: None,
                    stuck_report_id: None,
                    event_payload: base_event_payload(&run),
                });
            }

            if real_blocker {
                stop_slice(
                    conn,
                    &run.current_slice_id,
                    "blocked",
                    current_sequence,
                    if pending_approval_ticket_ids.is_empty() {
                        "blocking_clarification"
                    } else {
                        "blocking_approval"
                    },
                    &progress,
                    candidate_output_ref.as_deref(),
                )?;
                let blocker_ids = merge_string_refs(
                    &blocker_ids_from_items(&items),
                    &merge_string_refs(&pending_approval_ticket_ids, &blocked_verification_run_ids),
                );
                update_work_status_in_conn(
                    conn,
                    &run.run_id,
                    &LongWorkStatusUpdate {
                        status: "blocked".to_string(),
                        checkpoint_ids: run.checkpoint_ids.clone(),
                        blocker_ids,
                    },
                    now_ms(),
                    &now_iso(),
                )?;
                return Ok(LongWorkCandidateEvaluation {
                    summary: read_latest_work_summary_from_conn(conn, &input.session_id)?,
                    suppressed: false,
                    blocked: true,
                    stuck: false,
                    report_id: None,
                    continuation_id: None,
                    stuck_report_id: None,
                    event_payload: base_event_payload(&run),
                });
            }

            stop_slice(
                conn,
                &run.current_slice_id,
                "continuation_queued",
                current_sequence,
                stop_cause,
                &progress,
                None,
            )?;
            let no_progress_count = consecutive_no_progress_slices(conn, &run.run_id)?;
            if repeated_failure >= 2
                || no_progress_count >= 2
                || next_slice_sequence > MAX_CONTINUATION_SLICES + 1
            {
                let suspected_cause = if repeated_failure >= 2 {
                    "same_tool_failure"
                } else if no_progress_count >= 2 {
                    "model_looping"
                } else {
                    "unknown"
                };
                let reason = if repeated_failure >= 2 {
                    "Repeated same tool failure"
                } else if no_progress_count >= 2 {
                    "No progress across continuation slices"
                } else {
                    "Continuation slice limit reached"
                };
                let stuck_report_id = insert_stuck_report(
                    conn,
                    &run,
                    turn_id,
                    repeated_failure,
                    no_progress_count,
                    suspected_cause,
                    "stop_with_report",
                    &progress.evidence_refs,
                    reason,
                )?;
                update_work_status_in_conn(
                    conn,
                    &run.run_id,
                    &LongWorkStatusUpdate {
                        status: "stuck".to_string(),
                        checkpoint_ids: run.checkpoint_ids.clone(),
                        blocker_ids: vec![stuck_report_id.clone()],
                    },
                    now_ms(),
                    &now_iso(),
                )?;
                return Ok(LongWorkCandidateEvaluation {
                    summary: read_latest_work_summary_from_conn(conn, &input.session_id)?,
                    suppressed: true,
                    blocked: false,
                    stuck: true,
                    report_id: None,
                    continuation_id: None,
                    stuck_report_id: Some(stuck_report_id),
                    event_payload: base_event_payload(&run),
                });
            }

            if signals.is_empty() {
                signals.push("claimed_completion_without_artifact".to_string());
            }
            let recommended_action = if audit
                .as_ref()
                .map(|audit| audit.status == "failed")
                .unwrap_or(false)
            {
                "recover_and_continue"
            } else if missing_evidence.is_empty() == false {
                "auto_continue"
            } else {
                "auto_continue"
            };
            let report_id = insert_premature_stop_report(
                conn,
                &run,
                turn_id,
                &signals,
                &open_todo_item_ids,
                &missing_evidence,
                recommended_action,
                candidate_output_ref.as_deref(),
                &input.candidate_text,
            )?;
            let continuation_id = insert_continuation(
                conn,
                &run,
                turn_id,
                &run.current_slice_id,
                next_slice_sequence,
                recommended_action,
                &packet_for_continuation(
                    &run,
                    &open_todo_items(&items),
                    &completed_todo_items,
                    &missing_evidence,
                    &progress,
                    recommended_action,
                    next_slice_sequence,
                ),
                continuation_reason(&signals),
            )?;
            update_work_status_in_conn(
                conn,
                &run.run_id,
                &LongWorkStatusUpdate {
                    status: "running".to_string(),
                    checkpoint_ids: run.checkpoint_ids.clone(),
                    blocker_ids: Vec::new(),
                },
                now_ms(),
                &now_iso(),
            )?;
            let mut event_payload = base_event_payload(&run);
            event_payload["reportId"] = json!(report_id.clone());
            event_payload["continuationId"] = json!(continuation_id.clone());
            event_payload["signals"] = json!(signals);
            event_payload["recommendedAction"] = json!(recommended_action);
            Ok(LongWorkCandidateEvaluation {
                summary: read_latest_work_summary_from_conn(conn, &input.session_id)?,
                suppressed: true,
                blocked: false,
                stuck: false,
                report_id: Some(report_id),
                continuation_id: Some(continuation_id),
                stuck_report_id: None,
                event_payload,
            })
        })
    }

    pub fn resume_long_work_continuation(
        &self,
        input: ResumeLongWorkContinuationInput,
    ) -> Result<Option<AgentLongWorkSummary>> {
        self.with_session_conn(&input.session_id, |conn| {
            let Some(row) = read_continuation_resume_row(conn, &input.session_id, &input.continuation_id)? else {
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            };
            if row.status != "queued" && row.status != "resuming" {
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            }
            if row.started_side_effect {
                block_continuation(conn, &row, "Started side effects require manual recovery")?;
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            }
            let items = read_todo_items_for_list(conn, &row.todo_list_id)?;
            if approval_related_blocker(&items) || has_pending_approval(conn, &input.session_id)? {
                block_continuation(conn, &row, "Approval required before continuation")?;
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            }
            let now = now_ms();
            let now_iso = now_iso();
            let next_slice_id = new_id("work_slice");
            let item_ids = items
                .iter()
                .map(|item| item.todo_item_id.clone())
                .take(9)
                .collect::<Vec<_>>();
            conn.execute(
                "UPDATE work_slice
                 SET status = 'superseded_by_continuation', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE work_slice_id = ?3",
                params![now, now_iso, row.previous_slice_id],
            )?;
            conn.execute(
                "INSERT INTO work_slice (
                    work_slice_id, long_work_run_id, session_id, runtime_turn_id, todo_list_id,
                    execution_run_id, status, sequence, item_ids_json, checkpoint_ids_json,
                    blocker_ids_json, created_at_ms, created_at_iso, updated_at_ms,
                    updated_at_iso, closed_at_ms, closed_at_iso
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?7, ?8, ?9, '[]', ?10, ?11, ?10, ?11, NULL, NULL)",
                params![
                    next_slice_id,
                    row.run_id,
                    input.session_id,
                    row.runtime_turn_id,
                    row.todo_list_id,
                    row.execution_run_id,
                    row.next_slice_sequence,
                    json_string(&item_ids)?,
                    json_string(&row.checkpoint_ids)?,
                    now,
                    now_iso,
                ],
            )?;
            conn.execute(
                "UPDATE long_work_run
                 SET status = 'auto_resuming', current_slice_id = ?1,
                     updated_at_ms = ?2, updated_at_iso = ?3
                 WHERE long_work_run_id = ?4",
                params![next_slice_id, now, now_iso, row.run_id],
            )?;
            conn.execute(
                "UPDATE native_long_work_goal
                 SET status = 'auto_resuming', updated_at_ms = ?1, updated_at_iso = ?2
                 WHERE goal_id = ?3",
                params![now, now_iso, row.goal_id],
            )?;
            conn.execute(
                "UPDATE long_work_continuation
                 SET status = 'resuming', updated_at_ms = ?1, updated_at_iso = ?2,
                     consumed_at_ms = COALESCE(consumed_at_ms, ?1),
                     consumed_at_iso = COALESCE(consumed_at_iso, ?2)
                 WHERE continuation_id = ?3",
                params![now, now_iso, input.continuation_id],
            )?;
            read_latest_work_summary_from_conn(conn, &input.session_id)
        })
    }

    pub fn recover_long_work_continuation(
        &self,
        input: RecoverLongWorkContinuationInput,
    ) -> Result<Option<AgentLongWorkSummary>> {
        self.with_session_conn(&input.session_id, |conn| {
            let Some(row) = read_latest_resuming_continuation(conn, &input.session_id)? else {
                return read_latest_work_summary_from_conn(conn, &input.session_id);
            };
            let now = now_ms();
            let now_iso = now_iso();
            if row.started_side_effect {
                block_continuation(conn, &row, "Started side effects require manual recovery")?;
            } else {
                conn.execute(
                    "UPDATE long_work_continuation
                     SET status = 'queued', updated_at_ms = ?1, updated_at_iso = ?2
                     WHERE continuation_id = ?3",
                    params![now, now_iso, row.continuation_id],
                )?;
                conn.execute(
                    "UPDATE long_work_run
                     SET status = 'running', updated_at_ms = ?1, updated_at_iso = ?2
                     WHERE long_work_run_id = ?3",
                    params![now, now_iso, row.run_id],
                )?;
            }
            read_latest_work_summary_from_conn(conn, &input.session_id)
        })
    }

    #[cfg(test)]
    pub fn mark_long_work_continuation_started_side_effect_for_test(
        &self,
        session_id: &str,
        continuation_id: &str,
    ) -> Result<()> {
        self.with_session_conn(session_id, |conn| {
            conn.execute(
                "UPDATE long_work_continuation
                 SET started_side_effect = 1, status = 'resuming'
                 WHERE continuation_id = ?1",
                params![continuation_id],
            )?;
            Ok(())
        })
    }
}

pub(super) fn read_latest_continuation_summary(
    conn: &Connection,
    run_id: &str,
) -> Result<Option<AgentLongWorkContinuationSummary>> {
    conn.query_row(
        "SELECT continuation_id, status, recommended_action, previous_slice_id,
                next_slice_sequence, reason_summary, created_at_ms, updated_at_ms
         FROM long_work_continuation
         WHERE long_work_run_id = ?1
         ORDER BY updated_at_ms DESC, created_at_ms DESC
         LIMIT 1",
        params![run_id],
        |row| {
            Ok(AgentLongWorkContinuationSummary {
                continuation_id: row.get(0)?,
                status: row.get(1)?,
                recommended_action: row.get(2)?,
                previous_slice_id: row.get(3)?,
                next_slice_sequence: row.get(4)?,
                reason_summary: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .optional()
    .context("failed to read long work continuation summary")
}

pub(super) fn read_latest_premature_stop_summary(
    conn: &Connection,
    run_id: &str,
) -> Result<Option<AgentPrematureStopSummary>> {
    conn.query_row(
        "SELECT report_id, is_premature_stop, signals_json, open_todo_item_ids_json,
                missing_evidence_json, recommended_action, suppressed_message_id, created_at_ms
         FROM premature_stop_report
         WHERE long_work_run_id = ?1
         ORDER BY created_at_ms DESC
         LIMIT 1",
        params![run_id],
        |row| {
            let signals_json: String = row.get(2)?;
            let open_json: String = row.get(3)?;
            let missing_json: String = row.get(4)?;
            Ok(AgentPrematureStopSummary {
                report_id: row.get(0)?,
                is_premature_stop: row.get::<_, i64>(1)? != 0,
                signals: parse_json_vec_string(&signals_json),
                open_todo_item_ids: parse_json_vec_string(&open_json),
                missing_evidence: parse_json_vec_string(&missing_json),
                recommended_action: row.get(5)?,
                suppressed_message_id: row.get(6)?,
                created_at: row.get(7)?,
            })
        },
    )
    .optional()
    .context("failed to read premature stop summary")
}

pub(super) fn read_latest_stuck_summary(
    conn: &Connection,
    run_id: &str,
) -> Result<Option<AgentStuckSummary>> {
    conn.query_row(
        "SELECT stuck_report_id, repeated_failure_count, no_progress_slice_count,
                suspected_cause, recommended_action, evidence_refs_json, reason_summary,
                created_at_ms
         FROM stuck_report
         WHERE long_work_run_id = ?1
         ORDER BY created_at_ms DESC
         LIMIT 1",
        params![run_id],
        |row| {
            let evidence_json: String = row.get(5)?;
            Ok(AgentStuckSummary {
                stuck_report_id: row.get(0)?,
                repeated_failure_count: row.get(1)?,
                no_progress_slice_count: row.get(2)?,
                suspected_cause: row.get(3)?,
                recommended_action: row.get(4)?,
                evidence_refs: parse_json_vec_string(&evidence_json),
                reason_summary: row.get(6)?,
                created_at: row.get(7)?,
            })
        },
    )
    .optional()
    .context("failed to read stuck summary")
}

fn read_latest_controller_run(conn: &Connection, session_id: &str) -> Result<Option<WorkRunRow>> {
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

fn read_slice_sequence(conn: &Connection, slice_id: &str) -> Result<i64> {
    conn.query_row(
        "SELECT sequence FROM work_slice WHERE work_slice_id = ?1",
        params![slice_id],
        |row| row.get(0),
    )
    .optional()
    .map(|value| value.unwrap_or(1))
    .context("failed to read work slice sequence")
}

fn stop_slice(
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

fn read_progress_snapshot(
    conn: &Connection,
    execution_run_id: &str,
    items: &[AgentTodoItem],
    audit: Option<&super::long_work_status::LongWorkAuditStatus>,
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

fn consecutive_no_progress_slices(conn: &Connection, run_id: &str) -> Result<i64> {
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

fn repeated_same_tool_failure_count(conn: &Connection, turn_id: Option<&str>) -> Result<i64> {
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

fn insert_premature_stop_report(
    conn: &Connection,
    run: &WorkRunRow,
    turn_id: Option<&str>,
    signals: &[String],
    open_todo_item_ids: &[String],
    missing_evidence: &[String],
    recommended_action: &str,
    suppressed_message_id: Option<&str>,
    candidate_text: &str,
) -> Result<String> {
    let report_id = new_id("premature_stop");
    let now = now_ms();
    let now_iso = now_iso();
    let suppressed_output = if candidate_text.trim().is_empty() {
        None
    } else {
        Some(
            json!({
                "sha256": sha256_hex(candidate_text.as_bytes()),
                "preview": preview_text(candidate_text, 240),
            })
            .to_string(),
        )
    };
    conn.execute(
        "INSERT INTO premature_stop_report (
            report_id, session_id, long_work_run_id, work_slice_id, runtime_turn_id,
            is_premature_stop, signals_json, open_todo_item_ids_json, missing_evidence_json,
            recommended_action, suppressed_message_id, suppressed_output_json,
            created_at_ms, created_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            report_id,
            run.session_id,
            run.run_id,
            run.current_slice_id,
            turn_id,
            serde_json::to_string(signals)?,
            serde_json::to_string(open_todo_item_ids)?,
            serde_json::to_string(missing_evidence)?,
            recommended_action,
            suppressed_message_id,
            suppressed_output,
            now,
            now_iso,
        ],
    )?;
    Ok(report_id)
}

fn insert_continuation(
    conn: &Connection,
    run: &WorkRunRow,
    turn_id: Option<&str>,
    previous_slice_id: &str,
    next_slice_sequence: i64,
    recommended_action: &str,
    packet: &Value,
    reason_summary: &str,
) -> Result<String> {
    let continuation_id = packet
        .get("continuationId")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .unwrap_or_else(|| new_id("continuation"));
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "INSERT INTO long_work_continuation (
            continuation_id, session_id, long_work_run_id, previous_slice_id,
            next_slice_sequence, runtime_turn_id, status, recommended_action, packet_json,
            reason_summary, created_at_ms, created_at_iso, updated_at_ms, updated_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?8, ?9, ?10, ?11, ?10, ?11)",
        params![
            continuation_id,
            run.session_id,
            run.run_id,
            previous_slice_id,
            next_slice_sequence,
            turn_id,
            recommended_action,
            packet.to_string(),
            reason_summary,
            now,
            now_iso,
        ],
    )?;
    Ok(continuation_id)
}

fn insert_stuck_report(
    conn: &Connection,
    run: &WorkRunRow,
    turn_id: Option<&str>,
    repeated_failure_count: i64,
    no_progress_slice_count: i64,
    suspected_cause: &str,
    recommended_action: &str,
    evidence_refs: &[String],
    reason_summary: &str,
) -> Result<String> {
    let stuck_report_id = new_id("stuck_report");
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "INSERT INTO stuck_report (
            stuck_report_id, session_id, long_work_run_id, work_slice_id, runtime_turn_id,
            repeated_failure_count, no_progress_slice_count, suspected_cause,
            recommended_action, evidence_refs_json, reason_summary, created_at_ms,
            created_at_iso
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            stuck_report_id,
            run.session_id,
            run.run_id,
            run.current_slice_id,
            turn_id,
            repeated_failure_count,
            no_progress_slice_count,
            suspected_cause,
            recommended_action,
            serde_json::to_string(evidence_refs)?,
            reason_summary,
            now,
            now_iso,
        ],
    )?;
    Ok(stuck_report_id)
}

fn packet_for_continuation(
    run: &WorkRunRow,
    open_todo_items: &[String],
    completed_todo_items: &[String],
    missing_evidence: &[String],
    progress: &ProgressSnapshot,
    recommended_action: &str,
    next_slice_sequence: i64,
) -> Value {
    let continuation_id = new_id("continuation");
    json!({
        "schemaVersion": "v1",
        "continuationId": continuation_id,
        "longWorkRunId": run.run_id,
        "previousSliceId": run.current_slice_id,
        "nextSliceSequence": next_slice_sequence,
        "untrustedObjectiveSummary": run.objective_summary,
        "goalStatus": "running",
        "currentStateSummary": continuation_reason(&[
            if open_todo_items.is_empty() { "" } else { "open_todo_items" }.to_string(),
            if missing_evidence.is_empty() { "" } else { "missing_required_evidence" }.to_string(),
        ]),
        "openTodoItems": open_todo_items,
        "completedTodoItems": completed_todo_items,
        "blockers": [],
        "evidenceRefs": progress.evidence_refs,
        "changedFilesRefs": progress.artifact_refs,
        "nextRequiredActions": next_required_actions(open_todo_items, missing_evidence),
        "forbiddenUserVisiblePatterns": [
            "do not ask the user whether to continue without a real blocker",
            "do not claim completion while Todo, Verification, or CompletionAudit is incomplete",
            "do not repeat already completed Todo items"
        ],
        "recommendedAction": recommended_action,
        "budgetSnapshotRef": null,
        "usageSnapshot": {
            "tokensUsed": 0,
            "timeUsedSeconds": 0
        }
    })
}

fn open_todo_item_ids(items: &[AgentTodoItem]) -> Vec<String> {
    items
        .iter()
        .filter(|item| matches!(item.status.as_str(), "completed" | "skipped") == false)
        .map(|item| item.todo_item_id.clone())
        .collect()
}

fn open_todo_items(items: &[AgentTodoItem]) -> Vec<String> {
    items
        .iter()
        .filter(|item| matches!(item.status.as_str(), "completed" | "skipped") == false)
        .map(|item| format!("{}: {}", item.todo_item_id, item.title))
        .collect()
}

fn completed_todo_items(items: &[AgentTodoItem]) -> Vec<String> {
    items
        .iter()
        .filter(|item| matches!(item.status.as_str(), "completed" | "skipped"))
        .map(|item| format!("{}: {}", item.todo_item_id, item.title))
        .collect()
}

fn missing_evidence_refs(
    audit: Option<&super::long_work_status::LongWorkAuditStatus>,
) -> Vec<String> {
    let Some(audit) = audit else {
        return Vec::new();
    };
    let mut refs = value_string_array(&audit.summary, "missingEvidenceRefs");
    refs = merge_string_refs(
        &refs,
        &value_string_array(&audit.summary, "notRunVerificationRunIds"),
    );
    refs = merge_string_refs(
        &refs,
        &value_string_array(&audit.summary, "pendingVerificationRunIds"),
    );
    if audit
        .summary
        .get("missingRequiredVerificationCount")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0
    {
        refs = merge_string_refs(&refs, &["missing_required_verification".to_string()]);
    }
    refs
}

fn next_required_actions(open_todo_items: &[String], missing_evidence: &[String]) -> Vec<String> {
    let mut actions = Vec::new();
    if let Some(item) = open_todo_items.first() {
        actions.push(format!("Continue unresolved Todo item: {item}"));
    }
    if missing_evidence.is_empty() == false {
        actions.push("Run or record required verification evidence".to_string());
    }
    if actions.is_empty() {
        actions.push("Continue the next incomplete structured work item".to_string());
    }
    actions
}

fn continuation_reason(signals: &[String]) -> &str {
    if signals
        .iter()
        .any(|signal| signal == "missing_required_evidence")
    {
        "Verification or evidence is still missing"
    } else if signals.iter().any(|signal| signal == "open_todo_items") {
        "Todo items remain open"
    } else if signals
        .iter()
        .any(|signal| signal == "no_progress_since_last_slice")
    {
        "No progress was recorded in the stopped slice"
    } else {
        "Completion candidate was not accepted by structured state"
    }
}

fn base_event_payload(run: &WorkRunRow) -> Value {
    json!({
        "sessionId": run.session_id,
        "turnId": run.runtime_turn_id,
        "longWorkRunId": run.run_id,
        "goalId": run.goal_id,
        "todoListId": run.todo_list_id,
        "executionRunId": run.execution_run_id,
        "currentSliceId": run.current_slice_id,
        "status": run.status,
    })
}

struct ContinuationResumeRow {
    continuation_id: String,
    run_id: String,
    previous_slice_id: String,
    next_slice_sequence: i64,
    runtime_turn_id: Option<String>,
    status: String,
    started_side_effect: bool,
    todo_list_id: String,
    execution_run_id: String,
    goal_id: String,
    checkpoint_ids: Vec<String>,
}

fn read_continuation_resume_row(
    conn: &Connection,
    session_id: &str,
    continuation_id: &str,
) -> Result<Option<ContinuationResumeRow>> {
    conn.query_row(
        "SELECT c.continuation_id, c.long_work_run_id, c.previous_slice_id,
                c.next_slice_sequence, c.runtime_turn_id, c.status, c.started_side_effect,
                r.todo_list_id, r.execution_run_id, r.goal_id, r.checkpoint_ids_json
         FROM long_work_continuation c
         JOIN long_work_run r ON r.long_work_run_id = c.long_work_run_id
         WHERE c.session_id = ?1 AND c.continuation_id = ?2",
        params![session_id, continuation_id],
        read_continuation_resume_row_from_row,
    )
    .optional()
    .context("failed to read continuation resume row")
}

fn read_latest_resuming_continuation(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<ContinuationResumeRow>> {
    conn.query_row(
        "SELECT c.continuation_id, c.long_work_run_id, c.previous_slice_id,
                c.next_slice_sequence, c.runtime_turn_id, c.status, c.started_side_effect,
                r.todo_list_id, r.execution_run_id, r.goal_id, r.checkpoint_ids_json
         FROM long_work_continuation c
         JOIN long_work_run r ON r.long_work_run_id = c.long_work_run_id
         WHERE c.session_id = ?1 AND c.status = 'resuming'
         ORDER BY c.updated_at_ms DESC
         LIMIT 1",
        params![session_id],
        read_continuation_resume_row_from_row,
    )
    .optional()
    .context("failed to read resuming continuation")
}

fn read_continuation_resume_row_from_row(row: &Row<'_>) -> rusqlite::Result<ContinuationResumeRow> {
    let checkpoint_json: String = row.get(10)?;
    Ok(ContinuationResumeRow {
        continuation_id: row.get(0)?,
        run_id: row.get(1)?,
        previous_slice_id: row.get(2)?,
        next_slice_sequence: row.get(3)?,
        runtime_turn_id: row.get(4)?,
        status: row.get(5)?,
        started_side_effect: row.get::<_, i64>(6)? != 0,
        todo_list_id: row.get(7)?,
        execution_run_id: row.get(8)?,
        goal_id: row.get(9)?,
        checkpoint_ids: parse_json_vec_string(&checkpoint_json),
    })
}

fn block_continuation(conn: &Connection, row: &ContinuationResumeRow, reason: &str) -> Result<()> {
    let now = now_ms();
    let now_iso = now_iso();
    conn.execute(
        "UPDATE long_work_continuation
         SET status = 'blocked', reason_summary = ?1, updated_at_ms = ?2, updated_at_iso = ?3
         WHERE continuation_id = ?4",
        params![reason, now, now_iso, row.continuation_id],
    )?;
    update_work_status_in_conn(
        conn,
        &row.run_id,
        &LongWorkStatusUpdate {
            status: "blocked".to_string(),
            checkpoint_ids: row.checkpoint_ids.clone(),
            blocker_ids: vec![row.continuation_id.clone()],
        },
        now,
        &now_iso,
    )
}

fn has_pending_approval(conn: &Connection, session_id: &str) -> Result<bool> {
    let count = conn.query_row(
        "SELECT COUNT(*)
         FROM approval_ticket
         WHERE session_id = ?1 AND status = 'pending'",
        params![session_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count > 0)
}
