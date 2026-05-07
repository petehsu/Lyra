use super::*;
use crate::storage::{
    AgentFollowSummary, AppendLiveEditDeltaInput, CommitLiveEditInput, DiscardLiveEditInput,
    StartLiveEditInput,
};

pub fn start_follow_live_edit(
    request: AgentStartFollowLiveEditRequest,
) -> Result<Option<AgentFollowSummary>> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    store.start_follow_live_edit(StartLiveEditInput {
        session_id: request.session_id,
        follow_session_id: request.follow_session_id,
        follow_target_id: request.follow_target_id,
        path: request.path,
        base_revision_id: request.base_revision_id,
        draft_buffer_ref: request.draft_buffer_ref,
    })
}

pub fn append_follow_live_edit(
    request: AgentAppendFollowLiveEditRequest,
) -> Result<Option<AgentFollowSummary>> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    store.append_follow_live_edit_delta(AppendLiveEditDeltaInput {
        session_id: request.session_id,
        live_edit_id: request.live_edit_id,
        kind: request.kind,
        range: request.range,
        text_delta: request.text_delta,
        text_delta_ref: request.text_delta_ref,
        payload: request.payload,
        ready_to_commit: request.ready_to_commit,
    })
}

pub fn commit_follow_live_edit(
    request: AgentCommitFollowLiveEditRequest,
) -> Result<Option<AgentFollowSummary>> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    store.commit_follow_live_edit(CommitLiveEditInput {
        session_id: request.session_id,
        live_edit_id: request.live_edit_id,
        tool_operation_id: request.tool_operation_id,
    })
}

pub fn discard_follow_live_edit(
    request: AgentDiscardFollowLiveEditRequest,
) -> Result<Option<AgentFollowSummary>> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    store.discard_follow_live_edit(DiscardLiveEditInput {
        session_id: request.session_id,
        live_edit_id: request.live_edit_id,
        reason: request.reason,
    })
}
