use napi::Result;
use serde_json::{json, Value};

use crate::agent::interaction_manager::resolve_pending_interaction;
use crate::agent::plan_helpers::select_plan_handoff_input;
use crate::agent::runtime_events::{
    emit_event, emit_interaction_queue_updated, emit_interaction_resolved_event,
};
use crate::agent::turn_entry::resolve_profile_for_turn;
use crate::agent::turn_runner::run_plan_implementation_handoff;
use crate::agent::types::{
    AgentCollaborationMode, AgentPendingInteractionStatus, AgentResolvePlanApprovalRequest,
    AgentSendTurnRequest, AgentSendTurnResult,
};
use crate::error::normalize_required_text;
use crate::storage::registry_db;

pub(crate) fn execute_plan_approval_resolution(
    request: AgentResolvePlanApprovalRequest,
) -> Result<Option<AgentSendTurnResult>> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let turn_id = normalize_required_text(&request.turn_id, "turnId")?;
    let request_id = normalize_required_text(&request.request_id, "requestId")?;
    let decision = normalize_required_text(&request.decision, "decision")?;
    let feedback = request.feedback.clone();
    let resolved_live_waiter =
        crate::agent::tools::resolve_plan_approval(&request_id, &decision, feedback.clone());
    let resolved_interaction = resolve_pending_interaction(
        &storage_root,
        &request_id,
        AgentPendingInteractionStatus::Resolved,
        Some(json!({
            "decision": decision,
            "feedback": feedback,
        })),
    )?;
    if let Some(interaction) = resolved_interaction.as_ref() {
        emit_interaction_resolved_event(&storage_root, interaction)?;
    }
    emit_event(
        &storage_root,
        &session_id,
        &turn_id,
        "interaction_submitted",
        json!({
            "requestId": request_id,
            "interactionKind": "plan_approval",
            "decision": decision,
            "feedback": request.feedback,
        }),
    )?;
    let phase = if decision == "approve_and_implement" {
        "plan_approved"
    } else {
        "plan_rejected"
    };
    emit_event(
        &storage_root,
        &session_id,
        &turn_id,
        phase,
        json!({
            "requestId": request_id,
            "decision": decision,
            "feedback": request.feedback,
        }),
    )?;
    emit_interaction_queue_updated(&storage_root, &session_id, &turn_id)?;

    if resolved_live_waiter {
        return Ok(None);
    }

    let Some(session) = registry_db::read_agent_session(&storage_root, &session_id)? else {
        return Ok(None);
    };
    if decision != "approve_and_implement" {
        return Ok(None);
    }

    let approved_plan = resolved_interaction
        .as_ref()
        .and_then(|interaction| interaction.payload.get("proposedMarkdown"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            registry_db::read_agent_plan(&storage_root, &session_id)
                .ok()
                .flatten()
                .and_then(|plan| plan.proposed_markdown.or(plan.approved_markdown))
        })
        .unwrap_or_default();
    if approved_plan.trim().is_empty() {
        return Ok(None);
    }

    let requested_profile_id = session
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let profile = resolve_profile_for_turn(&storage_root, &session, requested_profile_id)?;
    registry_db::set_agent_session_collaboration_mode(
        &storage_root,
        &session_id,
        AgentCollaborationMode::Default,
    )?;
    emit_event(
        &storage_root,
        &session_id,
        &turn_id,
        "plan_mode_exited",
        json!({
            "reason": "approved_and_implement",
            "source": "pending_interaction",
        }),
    )?;
    let fallback_input = select_plan_handoff_input(&storage_root, &session_id, "")?;
    run_plan_implementation_handoff(
        &storage_root,
        &session_id,
        &fallback_input,
        &AgentSendTurnRequest {
            storage_root: storage_root.clone(),
            session_id: session_id.clone(),
            input: fallback_input.clone(),
            profile_id: session.profile_id.clone(),
            model: None,
            project_root: session.project_root.clone(),
            max_steps: None,
            enable_planning: true,
            planning_min_chars: None,
            enable_reflection: true,
            reflection_min_tool_calls: None,
            enable_context_collapse: Some(true),
            strategy_preset: None,
            request_user_input_enabled: None,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
        },
        &profile,
        &session,
        &approved_plan,
    )
    .map(Some)
}
