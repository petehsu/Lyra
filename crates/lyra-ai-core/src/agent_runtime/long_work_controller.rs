use super::*;
use crate::storage::{
    AgentLongWorkSummary, LongWorkCompletionCandidateInput, RecoverLongWorkContinuationInput,
    ResumeLongWorkContinuationInput,
};

pub(crate) struct ModelCandidateWorkProjection {
    pub suppress_user_output: bool,
    pub replacement_text: Option<String>,
}

#[allow(dead_code)]
pub(crate) fn resume_queued_continuation(
    store: &AiStore,
    session_id: &str,
    continuation_id: &str,
) -> Result<Option<AgentLongWorkSummary>> {
    let summary = store.resume_long_work_continuation(ResumeLongWorkContinuationInput {
        session_id: session_id.to_string(),
        continuation_id: continuation_id.to_string(),
    })?;
    if let Some(summary) = summary.as_ref() {
        if summary.status == "auto_resuming" {
            emit_store_event(
                store,
                session_id,
                summary.runtime_turn_id.as_deref(),
                "long_work.auto_resuming",
                summary_event_payload(summary),
            )?;
        } else if summary.status == "blocked" {
            emit_store_event(
                store,
                session_id,
                summary.runtime_turn_id.as_deref(),
                "long_work.blocked",
                summary_event_payload(summary),
            )?;
        }
    }
    Ok(summary)
}

#[allow(dead_code)]
pub(crate) fn recover_resumable_continuation(
    store: &AiStore,
    session_id: &str,
) -> Result<Option<AgentLongWorkSummary>> {
    let summary = store.recover_long_work_continuation(RecoverLongWorkContinuationInput {
        session_id: session_id.to_string(),
    })?;
    if let Some(summary) = summary.as_ref() {
        emit_store_event(
            store,
            session_id,
            summary.runtime_turn_id.as_deref(),
            "long_work.recovery_detected",
            summary_event_payload(summary),
        )?;
        if summary
            .continuation
            .as_ref()
            .map(|continuation| continuation.status.as_str() == "queued")
            .unwrap_or(false)
        {
            emit_store_event(
                store,
                session_id,
                summary.runtime_turn_id.as_deref(),
                "long_work.continuation_queued",
                summary_event_payload(summary),
            )?;
        } else if summary.status == "blocked" {
            emit_store_event(
                store,
                session_id,
                summary.runtime_turn_id.as_deref(),
                "long_work.blocked",
                summary_event_payload(summary),
            )?;
        }
    }
    Ok(summary)
}

pub(crate) fn project_model_candidate_after_completion(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    candidate_text: &str,
) -> Result<ModelCandidateWorkProjection> {
    let evaluation =
        store.evaluate_long_work_completion_candidate(LongWorkCompletionCandidateInput {
            session_id: session_id.to_string(),
            runtime_turn_id: turn_id.map(ToString::to_string),
            candidate_text: candidate_text.to_string(),
        })?;
    let Some(summary) = evaluation.summary.as_ref() else {
        return Ok(ModelCandidateWorkProjection {
            suppress_user_output: false,
            replacement_text: None,
        });
    };
    if let Some(slice) = summary.current_slice.as_ref() {
        emit_store_event(
            store,
            session_id,
            turn_id,
            "long_work.slice_stopped",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "longWorkRunId": summary.long_work_run_id,
                "workSliceId": slice.work_slice_id,
                "sequence": slice.sequence,
                "status": slice.status,
                "stopCause": slice.stop_cause,
                "progressDelta": slice.progress_delta,
            }),
        )?;
    }
    if evaluation.suppressed {
        if let Some(report_id) = evaluation.report_id.as_ref() {
            emit_store_event(
                store,
                session_id,
                turn_id,
                "long_work.premature_stop_detected",
                merge_event_payload(&evaluation.event_payload, json!({ "reportId": report_id })),
            )?;
            emit_store_event(
                store,
                session_id,
                turn_id,
                "long_work.output_suppressed",
                merge_event_payload(&evaluation.event_payload, json!({ "reportId": report_id })),
            )?;
        }
        if let Some(continuation_id) = evaluation.continuation_id.as_ref() {
            emit_store_event(
                store,
                session_id,
                turn_id,
                "long_work.continuation_queued",
                merge_event_payload(
                    &evaluation.event_payload,
                    json!({ "continuationId": continuation_id }),
                ),
            )?;
        }
    }
    if evaluation.stuck {
        emit_store_event(
            store,
            session_id,
            turn_id,
            "long_work.stuck",
            merge_event_payload(
                &evaluation.event_payload,
                json!({ "stuckReportId": evaluation.stuck_report_id }),
            ),
        )?;
        return Ok(ModelCandidateWorkProjection {
            suppress_user_output: true,
            replacement_text: None,
        });
    }
    if evaluation.blocked {
        emit_store_event(
            store,
            session_id,
            turn_id,
            "long_work.blocked",
            evaluation.event_payload,
        )?;
    }
    Ok(ModelCandidateWorkProjection {
        suppress_user_output: evaluation.suppressed,
        replacement_text: None,
    })
}

fn merge_event_payload(base: &Value, extra: Value) -> Value {
    let mut merged = base.clone();
    let Some(base_object) = merged.as_object_mut() else {
        return extra;
    };
    let Some(extra_object) = extra.as_object() else {
        return merged;
    };
    for (key, value) in extra_object {
        base_object.insert(key.clone(), value.clone());
    }
    merged
}

#[allow(dead_code)]
fn summary_event_payload(summary: &AgentLongWorkSummary) -> Value {
    json!({
        "sessionId": summary.session_id,
        "turnId": summary.runtime_turn_id,
        "longWorkRunId": summary.long_work_run_id,
        "goalId": summary.goal_id,
        "todoListId": summary.todo_list_id,
        "executionRunId": summary.execution_run_id,
        "status": summary.status,
        "continuation": summary.continuation,
        "currentSliceId": summary.current_slice.as_ref().map(|slice| slice.work_slice_id.clone()),
    })
}
