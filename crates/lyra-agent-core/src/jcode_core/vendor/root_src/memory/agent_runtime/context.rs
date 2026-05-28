use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ContextLayerKind {
    SystemContract,
    RuntimeState,
    LatestUserIntent,
    Pinned,
    Tail,
    ToolCapabilitySnapshot,
    MiddleAnchors,
    Head,
    RetrievedArchives,
    SharedFrozenMemory,
}

impl ContextLayerKind {
    pub fn as_storage_str(&self) -> &'static str {
        match self {
            Self::SystemContract => "system_contract",
            Self::RuntimeState => "runtime_state",
            Self::LatestUserIntent => "latest_user_intent",
            Self::Pinned => "pinned",
            Self::Tail => "tail",
            Self::ToolCapabilitySnapshot => "tool_capability_snapshot",
            Self::MiddleAnchors => "middle_anchors",
            Self::Head => "head",
            Self::RetrievedArchives => "retrieved_archives",
            Self::SharedFrozenMemory => "shared_frozen_memory",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextLayer {
    pub kind: ContextLayerKind,
    pub priority: i64,
    pub token_budget: i64,
    #[serde(default)]
    pub payload_json: Value,
    #[serde(default)]
    pub source_refs: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSnapshot {
    pub context_snapshot_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub model_context_window: i64,
    pub created_at_ms: i64,
    pub created_at_iso: String,
    pub layers: Vec<ContextLayer>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryProjection {
    pub summary_id: String,
    pub source_event_range: Option<(String, String)>,
    pub source_archive_refs: Vec<String>,
    pub created_by: String,
    pub created_at_ms: i64,
    pub confidence: f64,
    pub known_omissions: Vec<String>,
    pub latest_user_intent_at_creation: Option<String>,
}
