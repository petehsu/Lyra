use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrimJournalState {
    PendingTrim,
    Archived,
    LiveCompacted,
}

impl TrimJournalState {
    pub fn as_storage_str(&self) -> &'static str {
        match self {
            Self::PendingTrim => "pending_trim",
            Self::Archived => "archived",
            Self::LiveCompacted => "live_compacted",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimDecision {
    pub trim_batch_id: String,
    pub session_id: String,
    pub reason: String,
    pub token_budget: Option<i64>,
    pub char_budget: Option<i64>,
    pub state: TrimJournalState,
}
