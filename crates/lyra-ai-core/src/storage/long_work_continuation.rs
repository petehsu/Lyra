use super::long_work_continuation_packet::{
    completed_todo_items, continuation_reason, missing_evidence_refs, open_todo_item_ids,
    open_todo_items, packet_for_continuation,
};
use super::long_work_continuation_records::{
    insert_continuation, insert_premature_stop_report, insert_stuck_report,
};
use super::long_work_continuation_state::{
    consecutive_no_progress_slices, read_latest_controller_run, read_progress_snapshot,
    read_slice_sequence, repeated_same_tool_failure_count, stop_slice, WorkRunRow,
};
use super::long_work_ledger::read_latest_work_summary_from_conn;
use super::long_work_status::{
    approval_related_blocker, blocker_ids_from_items, read_completion_audit_for_execution,
    todo_items_are_done, update_work_status_in_conn,
};
use super::*;

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
            let stop_cause = input
                .stop_cause
                .as_deref()
                .unwrap_or("completion_candidate");

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
            if repeated_failure >= 2 || no_progress_count >= 2 {
                let suspected_cause = if repeated_failure >= 2 {
                    "same_tool_failure"
                } else {
                    "model_looping"
                };
                let reason = if repeated_failure >= 2 {
                    "Repeated same tool failure"
                } else {
                    "No progress across continuation slices"
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
