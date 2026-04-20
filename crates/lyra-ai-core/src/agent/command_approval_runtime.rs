use napi::Result;
use serde_json::json;

use crate::agent::interaction_manager::resolve_pending_interaction;
use crate::agent::runtime_events::emit_event;
use crate::agent::runtime_events::{
    emit_interaction_queue_updated, emit_interaction_resolved_event,
};
use crate::agent::types::AgentPendingInteractionStatus;
use crate::agent::types::CommandApprovalSubmitRequest;
use crate::error::normalize_required_text;

pub(crate) fn submit_command_approval_decision(
    request: CommandApprovalSubmitRequest,
) -> Result<()> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let turn_id = normalize_required_text(&request.turn_id, "turnId")?;
    let tool_call_id = normalize_required_text(&request.tool_call_id, "toolCallId")?;
    let decision = normalize_required_text(&request.decision, "decision")?;

    crate::agent::tools::resolve_approval(&tool_call_id, &decision);
    if let Some(interaction) = resolve_pending_interaction(
        &storage_root,
        &tool_call_id,
        AgentPendingInteractionStatus::Resolved,
        Some(json!({ "decision": decision.clone() })),
    )? {
        emit_interaction_resolved_event(&storage_root, &interaction)?;
    }
    emit_event(
        &storage_root,
        &session_id,
        &turn_id,
        "interaction_submitted",
        json!({
            "toolCallId": tool_call_id,
            "interactionKind": "command_approval",
            "decision": decision,
        }),
    )?;
    emit_interaction_queue_updated(&storage_root, &session_id, &turn_id)?;

    Ok(())
}
