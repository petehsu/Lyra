use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SharedMemoryStatus {
    Candidate,
    DelayedPromotion,
    Active,
    ConflictCandidate,
    Deprecated,
    Rejected,
}

impl SharedMemoryStatus {
    pub fn as_storage_str(&self) -> &'static str {
        match self {
            Self::Candidate => "candidate",
            Self::DelayedPromotion => "delayed_promotion",
            Self::Active => "active",
            Self::ConflictCandidate => "conflict_candidate",
            Self::Deprecated => "deprecated",
            Self::Rejected => "rejected",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedMemoryRecord {
    pub memory_id: String,
    pub scope: String,
    pub status: SharedMemoryStatus,
    pub content_json: Value,
    pub evidence_refs: Vec<String>,
    pub conflict_set_id: Option<String>,
    pub negative: bool,
    pub created_at_ms: i64,
    pub created_at_iso: String,
    pub updated_at_ms: i64,
    pub updated_at_iso: String,
}
