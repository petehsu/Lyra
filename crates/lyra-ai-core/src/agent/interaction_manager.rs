use napi::Result;
use serde_json::{json, Value};

use crate::agent::types::{
    AgentPendingInteraction, AgentPendingInteractionKind, AgentPendingInteractionStatus,
};
use crate::error::now_ms;
use crate::storage::registry_db;

pub fn create_pending_interaction(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    interaction_id: &str,
    kind: AgentPendingInteractionKind,
    payload: Value,
) -> Result<AgentPendingInteraction> {
    let now = now_ms();
    registry_db::upsert_agent_pending_interaction(
        storage_root,
        &AgentPendingInteraction {
            id: interaction_id.to_string(),
            session_id: session_id.to_string(),
            turn_id: turn_id.to_string(),
            kind,
            status: AgentPendingInteractionStatus::Pending,
            payload,
            created_at: now,
            updated_at: now,
        },
    )
}

pub fn resolve_pending_interaction(
    storage_root: &str,
    interaction_id: &str,
    status: AgentPendingInteractionStatus,
    resolution: Option<Value>,
) -> Result<Option<AgentPendingInteraction>> {
    let Some(mut interaction) =
        registry_db::read_agent_pending_interaction(storage_root, interaction_id)?
    else {
        return Ok(None);
    };
    interaction.status = status;
    interaction.updated_at = now_ms();
    if let Some(resolution) = resolution {
        let mut payload = interaction.payload.as_object().cloned().unwrap_or_default();
        payload.insert("resolution".to_string(), resolution);
        interaction.payload = Value::Object(payload);
    }
    registry_db::upsert_agent_pending_interaction(storage_root, &interaction).map(Some)
}

pub fn expire_pending_interaction(
    storage_root: &str,
    interaction_id: &str,
    reason: &str,
) -> Result<Option<AgentPendingInteraction>> {
    resolve_pending_interaction(
        storage_root,
        interaction_id,
        AgentPendingInteractionStatus::Expired,
        Some(json!({ "reason": reason })),
    )
}

pub fn cancel_pending_interaction(
    storage_root: &str,
    interaction_id: &str,
    reason: &str,
) -> Result<Option<AgentPendingInteraction>> {
    resolve_pending_interaction(
        storage_root,
        interaction_id,
        AgentPendingInteractionStatus::Cancelled,
        Some(json!({ "reason": reason })),
    )
}

pub fn list_pending_interactions(
    storage_root: &str,
    session_id: &str,
) -> Result<Vec<AgentPendingInteraction>> {
    registry_db::list_agent_pending_interactions(storage_root, session_id)
}
