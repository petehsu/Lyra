use super::*;
use crate::storage::{
    AgentMessageCheckpointSummary, AgentPreviewMessageRollbackResult, CreateRecoveryAnchorInput,
};

pub fn read_rollback_preview(
    request: AgentReadRollbackPreviewRequest,
) -> Result<AgentPreviewMessageRollbackResult> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    store
        .read_message_rollback_preview(&request.session_id, &request.rollback_id)?
        .ok_or_else(|| anyhow!("rollback preview not found: {}", request.rollback_id))
}

pub fn preview_message_rollback(
    request: AgentPreviewMessageRollbackRequest,
) -> Result<AgentPreviewMessageRollbackResult> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    let result =
        store.preview_message_rollback(&request.session_id, &request.target_user_message_id)?;
    let event_type = if result.impact_level == "conflict" {
        "rollback.conflict_detected"
    } else {
        "rollback.preview_created"
    };
    let detail = store.read_session_detail(&request.session_id)?;
    super::events::emit_store_event(
        &store,
        &request.session_id,
        None,
        event_type,
        json!({
            "rollbackId": result.rollback_id,
            "targetUserMessageId": result.target_user_message_id,
            "impactLevel": result.impact_level,
            "requiresConfirmation": result.requires_confirmation,
            "artifactId": result.artifact_id,
            "evidenceId": result.evidence_id,
            "previewOnly": true,
            "detail": detail
        }),
    )?;
    Ok(result)
}

pub(super) fn ensure_recovery_checkpoint_for_turn(
    store: &AiStore,
    session: &AgentSession,
    turn_id: &str,
    user_message_id: &str,
    checkpoint_id: &str,
) -> Result<AgentMessageCheckpointSummary> {
    let summary = store.create_recovery_anchor(CreateRecoveryAnchorInput {
        session_id: session.id.clone(),
        runtime_turn_id: turn_id.to_string(),
        user_message_id: user_message_id.to_string(),
        checkpoint_id: checkpoint_id.to_string(),
        workspace_root: session.project_root.clone(),
    })?;
    super::events::emit_store_event(
        store,
        &session.id,
        Some(turn_id),
        "rollback.anchor_created",
        json!({
            "anchorId": summary.anchor_id,
            "userMessageId": summary.user_message_id,
            "runtimeTurnId": summary.runtime_turn_id,
            "checkpointId": summary.checkpoint_id,
            "workspaceSnapshotId": summary.workspace_snapshot_id
        }),
    )?;
    Ok(summary)
}

pub(crate) fn ensure_recovery_anchor_for_write(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
) -> Result<()> {
    if store
        .read_active_recovery_anchor_for_turn(session_id, turn_id)?
        .is_none()
    {
        return Err(anyhow!(
            "write operation blocked: message rollback checkpoint is missing"
        ));
    }
    Ok(())
}
