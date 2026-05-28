use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveRecord {
    pub archive_id: String,
    pub source_session_id: String,
    pub source_event_start_id: String,
    pub source_event_end_id: String,
    pub content_raw: String,
    pub content_normalized: String,
    pub content_kind: String,
    pub raw_digest: String,
    pub normalized_digest: String,
    pub trim_batch_id: String,
    pub created_at_ms: i64,
    pub created_at_iso: String,
    #[serde(default)]
    pub lineage_json: Value,
}
