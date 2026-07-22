use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct TurnRunner {
    backend: BackendHandle,
}

impl Default for TurnRunner {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl TurnRunner {
    pub const NAME: &'static str = "turn_runner";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn send(&self, payload: serde_json::Value) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.turn.send", payload)
    }

    pub fn cancel(&self, session_id: String) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.turn.cancel",
            serde_json::json!({ "sessionId": session_id }),
        )
    }

    pub fn cancel_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.turn.cancel", payload)
    }
}