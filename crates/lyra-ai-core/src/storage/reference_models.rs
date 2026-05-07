use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceAnchor {
    pub insertion_index: i64,
    pub char_start: i64,
    pub char_end: i64,
    pub source_part_index: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineReference {
    pub inline_reference_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: String,
    pub kind: String,
    pub target_ref: String,
    pub label: Option<String>,
    pub anchor: ReferenceAnchor,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceResolution {
    pub resolution_id: String,
    pub inline_reference_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub kind: String,
    pub target_ref: String,
    pub status: String,
    pub resolved_ref: Option<String>,
    pub content_hash: Option<String>,
    pub content_bytes: Option<i64>,
    pub reason: Option<String>,
    pub metadata: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReferenceSummary {
    pub total: usize,
    pub resolved: usize,
    pub unresolved: usize,
    pub references: Vec<InlineReference>,
    pub resolutions: Vec<ReferenceResolution>,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateInlineReferenceInput {
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: String,
    pub kind: String,
    pub target_ref: String,
    pub label: Option<String>,
    pub anchor: ReferenceAnchor,
}

#[derive(Clone, Debug)]
pub struct CreateReferenceResolutionInput {
    pub inline_reference_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub kind: String,
    pub target_ref: String,
    pub status: String,
    pub resolved_ref: Option<String>,
    pub content_hash: Option<String>,
    pub content_bytes: Option<i64>,
    pub reason: Option<String>,
    pub metadata: Value,
}
