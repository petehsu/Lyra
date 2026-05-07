use super::*;
use crate::storage::AgentExecuteMessageRollbackResult;

pub fn execute_message_rollback(
    request: AgentExecuteMessageRollbackRequest,
) -> Result<AgentExecuteMessageRollbackResult> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    store
        .read_session_index(&request.session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {}", request.session_id))?;
    emit_store_event(
        &store,
        &request.session_id,
        None,
        "runtime.rollback_freeze_started",
        json!({
            "rollbackId": request.rollback_id,
        }),
    )?;
    emit_store_event(
        &store,
        &request.session_id,
        None,
        "rollback.execution_started",
        json!({
            "rollbackId": request.rollback_id,
            "strategy": request.strategy,
        }),
    )?;
    let result = store.execute_message_rollback(
        &request.session_id,
        &request.rollback_id,
        request.confirmation_token.as_deref(),
        request.strategy.as_deref(),
    )?;
    let detail = store.read_session_detail(&request.session_id)?;
    if result.status == "completed" {
        emit_store_event(
            &store,
            &request.session_id,
            None,
            "rollback.workspace_restored",
            json!({
                "rollbackId": result.rollback_id,
                "workspaceSnapshotId": result.restored_workspace_snapshot_id,
            }),
        )?;
        emit_store_event(
            &store,
            &request.session_id,
            None,
            "rollback.conversation_restored",
            json!({
                "rollbackId": result.rollback_id,
                "conversationSnapshotId": result.restored_conversation_snapshot_id,
                "supersededMessageIds": result.superseded_message_ids,
            }),
        )?;
        emit_store_event(
            &store,
            &request.session_id,
            None,
            "rollback.records_superseded",
            json!({
                "rollbackId": result.rollback_id,
                "unresolvedSideEffectIds": result.unresolved_side_effect_ids,
            }),
        )?;
        emit_store_event(
            &store,
            &request.session_id,
            None,
            "rollback.message_reopened",
            json!({
                "rollbackId": result.rollback_id,
                "userMessageId": result.reopened_user_message_id,
            }),
        )?;
        emit_store_event(
            &store,
            &request.session_id,
            None,
            "rollback.completed",
            json!({
                "rollbackId": result.rollback_id,
                "artifactId": result.artifact_id,
                "evidenceId": result.evidence_id,
                "detail": detail,
            }),
        )?;
    } else {
        emit_store_event(
            &store,
            &request.session_id,
            None,
            "rollback.failed",
            json!({
                "rollbackId": result.rollback_id,
                "status": result.status,
                "impactLevel": result.impact_level,
                "detail": result.detail,
                "detailSnapshot": detail,
            }),
        )?;
    }
    Ok(result)
}
