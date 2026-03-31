use serde::{Deserialize, Serialize};

use crate::session::types::{AiChatSession, AiChatSessionSummary};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRuntimeEvent {
    pub kind: String,
    pub session: AiChatSession,
    pub summary: AiChatSessionSummary,
}
