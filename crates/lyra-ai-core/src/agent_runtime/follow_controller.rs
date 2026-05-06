use super::*;
use crate::storage::{
    AgentFollowSummary, AgentLongWorkSummary, EnsureFollowSessionInput, FollowEventInput,
};

pub fn read_follow(request: AgentReadFollowRequest) -> Result<Option<AgentFollowSummary>> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    store.read_follow_summary(&request.session_id)
}

pub fn pause_follow(request: AgentPauseFollowRequest) -> Result<Option<AgentFollowSummary>> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    store.pause_follow_session(&request.session_id, request.follow_session_id.as_deref())
}

pub fn resume_follow(request: AgentResumeFollowRequest) -> Result<Option<AgentFollowSummary>> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    store.resume_follow_session(&request.session_id, request.follow_session_id.as_deref())
}

pub(super) fn ensure_follow_for_turn(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    user_message_id: &str,
) -> Result<AgentFollowSummary> {
    store.ensure_follow_session(EnsureFollowSessionInput {
        session_id: session_id.to_string(),
        runtime_turn_id: Some(turn_id.to_string()),
        user_message_id: Some(user_message_id.to_string()),
        long_work_run_id: None,
        status: "enabled".to_string(),
        event_stream_ref: Some("agent.runtime".to_string()),
    })
}

pub(super) fn ensure_follow_for_long_work(
    store: &AiStore,
    summary: &AgentLongWorkSummary,
) -> Result<AgentFollowSummary> {
    store.ensure_follow_session(EnsureFollowSessionInput {
        session_id: summary.session_id.clone(),
        runtime_turn_id: summary.runtime_turn_id.clone(),
        user_message_id: summary.user_message_id.clone(),
        long_work_run_id: Some(summary.long_work_run_id.clone()),
        status: "auto_following".to_string(),
        event_stream_ref: Some("agent.runtime".to_string()),
    })
}

pub(crate) fn append_follow_progress_event(
    store: &AiStore,
    summary: &AgentLongWorkSummary,
    event_type: &str,
    label: &str,
) -> Result<()> {
    let _ = ensure_follow_for_long_work(store, summary)?;
    store.append_follow_event(FollowEventInput {
        session_id: summary.session_id.clone(),
        runtime_turn_id: summary.runtime_turn_id.clone(),
        long_work_run_id: Some(summary.long_work_run_id.clone()),
        follow_target_id: None,
        tool_operation_id: None,
        work_slice_id: summary
            .current_slice
            .as_ref()
            .map(|slice| slice.work_slice_id.clone()),
        event_type: event_type.to_string(),
        payload_ref: None,
        payload: json!({
            "label": label,
            "status": summary.status,
            "longWorkRunId": summary.long_work_run_id,
            "currentSliceId": summary.current_slice.as_ref().map(|slice| slice.work_slice_id.clone())
        }),
    })?;
    Ok(())
}
