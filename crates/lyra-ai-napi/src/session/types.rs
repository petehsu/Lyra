use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AiChatToken {
    Text {
        value: String,
    },
    File {
        name: String,
        entry_kind: String,
        source: String,
        path: Option<String>,
        icon_kind: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatMessage {
    pub id: String,
    pub session_id: String,
    pub turn_id: Option<String>,
    pub role: String,
    pub mode: String,
    pub content: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub tokens: Option<Vec<AiChatToken>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatSessionSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub summary: String,
    pub mode: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatSession {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub summary: String,
    pub mode: String,
    pub active_turn_id: Option<String>,
    pub messages: Vec<AiChatMessage>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAiSessionRequest {
    pub storage_root: String,
    pub session_id: String,
    pub fallback_title: Option<String>,
    pub preferred_mode: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAiSessionHistoryRequest {
    pub storage_root: String,
    pub limit: Option<u32>,
}
