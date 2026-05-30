use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct RecoveryService {
    backend: BackendHandle,
}

impl Default for RecoveryService {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl RecoveryService {
    pub const NAME: &'static str = "recovery_service";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn recover_session(
        &self,
        session_id: Option<String>,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        let mut payload = serde_json::Map::new();
        if let Some(session_id) = session_id {
            payload.insert(
                "sessionId".to_string(),
                serde_json::Value::String(session_id),
            );
        }
        self.backend.call(
            "agent.memory.recover.run",
            serde_json::Value::Object(payload),
        )
    }
}
