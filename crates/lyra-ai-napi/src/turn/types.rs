use serde::{Deserialize, Serialize};

use crate::session::types::{AiChatSession, AiChatToken};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAiChatTurnRequest {
    pub storage_root: String,
    pub session_id: String,
    pub mode: String,
    pub text: String,
    pub tokens: Vec<AiChatToken>,
    pub fallback_title: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAiChatTurnResponse {
    pub turn_id: String,
    pub session: AiChatSession,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAiChatTurnRequest {
    pub storage_root: String,
    pub session_id: String,
    pub turn_id: String,
}
