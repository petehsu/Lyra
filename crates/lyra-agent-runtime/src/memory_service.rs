use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct MemoryService {
    backend: BackendHandle,
}

impl Default for MemoryService {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl MemoryService {
    pub const NAME: &'static str = "memory_service";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn snapshot_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.snapshot", payload)
    }

    pub fn snapshot(
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
        self.backend
            .call("agent.memory.snapshot", serde_json::Value::Object(payload))
    }

    pub fn audit(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.audit", payload)
    }

    pub fn trim(&self, payload: serde_json::Value) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.trim.run", payload)
    }

    pub fn recover(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.recover.run", payload)
    }

    pub fn search_shared_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.shared.search", payload)
    }

    pub fn search_shared(&self, query: String) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.memory.shared.search",
            serde_json::json!({ "query": query }),
        )
    }

    pub fn write_shared_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.shared.update", payload)
    }

    pub fn write_shared(
        &self,
        scope: String,
        content: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.memory.shared.update",
            serde_json::json!({ "scope": scope, "content": content }),
        )
    }
}
