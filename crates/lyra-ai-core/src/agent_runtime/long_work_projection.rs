use super::*;
use crate::storage::{
    AgentLongWorkSummary, AgentPlanCoverageSummary, CreateLongWorkRunInput, CreatedTodoRefs,
    LongWorkStatusUpdate,
};

use super::long_work_controller::{
    project_model_candidate_after_completion, recover_resumable_continuation,
    resume_queued_continuation, ModelCandidateWorkProjection,
};

pub(super) fn create_plan_run_after_valid_coverage(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    detail: &AgentSessionDetail,
    coverage: &AgentPlanCoverageSummary,
) -> Result<Option<AgentLongWorkSummary>> {
    if coverage.status != "valid" {
        return Ok(None);
    }
    let (Some(todo_list_id), Some(execution_run_id)) = (
        coverage.todo_list_id.as_ref(),
        coverage.execution_run_id.as_ref(),
    ) else {
        return Ok(None);
    };
    let Some(todo) = detail.active_todo.as_ref() else {
        return Ok(None);
    };
    if todo.kind != "plan_bound" || todo.todo_list_id != *todo_list_id {
        return Ok(None);
    }
    let planning = detail.planning_summary.as_ref();
    let objective = planning
        .map(|summary| summary.objective_summary.clone())
        .unwrap_or_else(|| "Execute approved plan".to_string());
    let created = store.create_long_work_run(CreateLongWorkRunInput {
        session_id: session_id.to_string(),
        runtime_turn_id: turn_id.map(ToString::to_string),
        user_message_id: None,
        plan_id: Some(coverage.plan_id.clone()),
        todo_list_id: todo_list_id.clone(),
        execution_run_id: execution_run_id.clone(),
        objective_summary: objective,
        completion_contract: json!({
            "type": "plan_bound_completion_audit_v1",
            "coverageId": coverage.coverage_id,
            "planId": coverage.plan_id,
            "approvedVersionId": coverage.approved_version_id,
            "todoListId": todo_list_id,
            "executionRunId": execution_run_id,
        }),
        budget: json!({}),
        checkpoint_ids: vec![coverage.coverage_id.clone()],
    })?;
    emit_created_events(store, turn_id, &created.summary)?;
    Ok(Some(created.summary))
}

pub(super) fn create_mini_run_after_todo(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    user_message_id: &str,
    user_text: &str,
    checkpoint_id: &str,
    refs: &CreatedTodoRefs,
) -> Result<Option<AgentLongWorkSummary>> {
    let created = store.create_long_work_run(CreateLongWorkRunInput {
        session_id: session_id.to_string(),
        runtime_turn_id: Some(turn_id.to_string()),
        user_message_id: Some(user_message_id.to_string()),
        plan_id: None,
        todo_list_id: refs.todo_list_id.clone(),
        execution_run_id: refs.execution_run_id.clone(),
        objective_summary: mini_objective_summary(user_text),
        completion_contract: json!({
            "type": "mini_completion_audit_v1",
            "todoListId": refs.todo_list_id,
            "executionRunId": refs.execution_run_id,
        }),
        budget: json!({}),
        checkpoint_ids: vec![checkpoint_id.to_string()],
    })?;
    emit_created_events(store, Some(turn_id), &created.summary)?;
    Ok(Some(created.summary))
}

pub(crate) fn project_work_after_tool_result(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
) -> Result<()> {
    let before = store.read_active_work_summary(session_id)?;
    let after = store.refresh_active_work_status(session_id, turn_id)?;
    emit_transition_event(store, turn_id, before.as_ref(), after.as_ref())
}

pub(crate) fn project_work_after_completion(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
) -> Result<()> {
    let before = store.read_active_work_summary(session_id)?;
    let after = store.refresh_active_work_status(session_id, turn_id)?;
    emit_transition_event(store, turn_id, before.as_ref(), after.as_ref())
}

pub(crate) fn project_work_after_model_candidate(
    store: &AiStore,
    session_id: &str,
    turn_id: Option<&str>,
    candidate_text: &str,
) -> Result<ModelCandidateWorkProjection> {
    project_model_candidate_after_completion(store, session_id, turn_id, candidate_text, None)
}

#[allow(dead_code)]
pub(crate) fn resume_work_continuation(
    store: &AiStore,
    session_id: &str,
    continuation_id: &str,
) -> Result<Option<AgentLongWorkSummary>> {
    let summary = resume_queued_continuation(store, session_id, continuation_id)?;
    if let Some(summary) = summary.as_ref() {
        super::follow_controller::append_follow_progress_event(
            store,
            summary,
            "operation_progress",
            "Continuation resumed",
        )?;
    }
    Ok(summary)
}

#[allow(dead_code)]
pub(crate) fn recover_work_continuation(
    store: &AiStore,
    session_id: &str,
) -> Result<Option<AgentLongWorkSummary>> {
    recover_resumable_continuation(store, session_id)
}

#[allow(dead_code)]
pub(super) fn force_work_status_for_test(
    store: &AiStore,
    session_id: &str,
    run_id: &str,
    status: &str,
) -> Result<Option<AgentLongWorkSummary>> {
    store.update_long_work_status(
        session_id,
        run_id,
        LongWorkStatusUpdate {
            status: status.to_string(),
            checkpoint_ids: Vec::new(),
            blocker_ids: Vec::new(),
        },
    )
}

fn emit_created_events(
    store: &AiStore,
    turn_id: Option<&str>,
    summary: &AgentLongWorkSummary,
) -> Result<()> {
    ensure_follow_for_long_work(store, summary)?;
    emit_store_event(
        store,
        &summary.session_id,
        turn_id,
        "long_work.created",
        event_payload(summary, turn_id, "created"),
    )?;
    emit_store_event(
        store,
        &summary.session_id,
        turn_id,
        "long_work.slice_started",
        event_payload(summary, turn_id, "running"),
    )
}

fn emit_transition_event(
    store: &AiStore,
    turn_id: Option<&str>,
    before: Option<&AgentLongWorkSummary>,
    after: Option<&AgentLongWorkSummary>,
) -> Result<()> {
    let Some(after) = after else {
        return Ok(());
    };
    if before
        .map(|summary| summary.status.as_str() == after.status.as_str())
        .unwrap_or(false)
    {
        return Ok(());
    }
    let event_type = match after.status.as_str() {
        "blocked" | "failed" => "long_work.blocked",
        "completed" => "long_work.completed",
        _ => return Ok(()),
    };
    emit_store_event(
        store,
        &after.session_id,
        turn_id.or(after.runtime_turn_id.as_deref()),
        event_type,
        event_payload(
            after,
            turn_id.or(after.runtime_turn_id.as_deref()),
            &after.status,
        ),
    )
}

fn event_payload(summary: &AgentLongWorkSummary, turn_id: Option<&str>, status: &str) -> Value {
    json!({
        "sessionId": summary.session_id,
        "turnId": turn_id,
        "longWorkRunId": summary.long_work_run_id,
        "goalId": summary.goal_id,
        "todoListId": summary.todo_list_id,
        "executionRunId": summary.execution_run_id,
        "status": status,
        "objectiveSummary": summary.objective_summary,
        "todoProgress": summary.todo_progress,
        "blockerSummary": summary.blocker_summary,
        "currentSliceId": summary.current_slice.as_ref().map(|slice| slice.work_slice_id.clone()),
    })
}

fn mini_objective_summary(text: &str) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.is_empty() {
        return "Execute requested workspace change".to_string();
    }
    let mut value = normalized.chars().take(120).collect::<String>();
    if normalized.chars().count() > 120 {
        value.push_str("...");
    }
    value
}
