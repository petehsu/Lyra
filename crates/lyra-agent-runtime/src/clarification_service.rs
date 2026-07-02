use crate::BackendHandle;
use serde::{Deserialize, Serialize};

/// Typed client→server clarification response message.
///
/// Validates at the trust boundary: malformed payloads fail with a clear
/// error instead of silent missing fields downstream.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationResponse {
    pub session_id: String,
    pub clarification_id: String,
    pub answer: String,
    #[serde(default)]
    pub selected_option: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ClarificationService {
    backend: BackendHandle,
}

impl Default for ClarificationService {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl ClarificationService {
    pub const NAME: &'static str = "clarification_service";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn respond_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        let msg: ClarificationResponse = serde_json::from_value(payload)
            .map_err(|e| crate::AgentRuntimeError::Serialization(e.to_string()))?;
        self.backend.call(
            "agent.clarification.respond",
            serde_json::to_value(&msg).unwrap_or_default(),
        )
    }

    pub fn respond(
        &self,
        session_id: String,
        clarification_id: String,
        answer: String,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        let msg = ClarificationResponse {
            session_id,
            clarification_id,
            answer,
            selected_option: None,
        };
        self.backend.call(
            "agent.clarification.respond",
            serde_json::to_value(&msg).unwrap_or_default(),
        )
    }
}
