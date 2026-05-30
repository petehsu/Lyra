use crate::BackendHandle;

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
        self.backend.call("agent.clarification.respond", payload)
    }

    pub fn respond(
        &self,
        session_id: String,
        clarification_id: String,
        answer: String,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.clarification.respond",
            serde_json::json!({ "sessionId": session_id, "clarificationId": clarification_id, "answer": answer }),
        )
    }
}
