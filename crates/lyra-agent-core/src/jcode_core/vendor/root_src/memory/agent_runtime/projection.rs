use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::runtime_turn::RuntimeTurnRecord;
use super::session::SessionRecord;
use super::visibility::EventRole;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineProjectionItem {
    pub event_id: String,
    pub runtime_turn_id: Option<String>,
    pub kind: String,
    pub role: EventRole,
    #[serde(default)]
    pub payload_json: Value,
    pub created_at_ms: i64,
    pub created_at_iso: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemorySnapshot {
    pub session: Option<SessionRecord>,
    pub runtime_turns: Vec<RuntimeTurnRecord>,
    pub timeline_projection: Vec<TimelineProjectionItem>,
    pub active_todos: Vec<Value>,
    pub active_browser_targets: Vec<Value>,
    pub active_clarification: Option<Value>,
    pub status: String,
    pub provider_label: Option<String>,
    pub model_label: Option<String>,
}
