use napi::Result;
use serde_json::{json, Value};

use crate::agent::emit_runtime_event;
use crate::agent::interaction_manager::list_pending_interactions;
use crate::agent::types::{AgentPendingInteraction, AgentRuntimeEvent};
use crate::error::now_ms;
use crate::storage::registry_db;

pub fn emit_event(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    phase: &str,
    payload: Value,
) -> Result<()> {
    let event = AgentRuntimeEvent {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        phase: phase.to_string(),
        payload,
        timestamp: now_ms(),
    };
    let stored_event = registry_db::append_agent_runtime_event(storage_root, &event)?;
    emit_runtime_event(stored_event);
    Ok(())
}

pub fn emit_transient_event(
    session_id: &str,
    turn_id: &str,
    phase: &str,
    payload: Value,
) -> Result<()> {
    emit_runtime_event(AgentRuntimeEvent {
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        phase: phase.to_string(),
        payload,
        timestamp: now_ms(),
    });
    Ok(())
}

pub fn emit_interaction_pending_event(
    storage_root: &str,
    interaction: &AgentPendingInteraction,
) -> Result<()> {
    emit_event(
        storage_root,
        &interaction.session_id,
        &interaction.turn_id,
        "interaction_pending",
        json!({ "interaction": interaction }),
    )
}

pub fn emit_interaction_resolved_event(
    storage_root: &str,
    interaction: &AgentPendingInteraction,
) -> Result<()> {
    emit_event(
        storage_root,
        &interaction.session_id,
        &interaction.turn_id,
        "interaction_resolved",
        json!({ "interaction": interaction }),
    )
}

pub fn emit_interaction_queue_updated(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
) -> Result<()> {
    let pending = list_pending_interactions(storage_root, session_id)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "interaction_queue_updated",
        json!({ "pendingInteractions": pending }),
    )
}

pub fn emit_tool_failure_diagnosed_event(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    error_payload: &Value,
) -> Result<()> {
    let diagnosis = error_payload
        .as_object()
        .and_then(|value| value.get("diagnosis"))
        .cloned()
        .unwrap_or(Value::Null);
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "tool_failure_diagnosed",
        json!({
            "toolCallId": tool_call_id,
            "toolName": tool_name,
            "error": error_payload,
            "diagnosis": diagnosis,
        }),
    )
}
