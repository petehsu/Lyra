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

    pub fn create_longterm(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.longterm.create", payload)
    }

    pub fn search_longterm(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.longterm.search", payload)
    }

    pub fn update_longterm(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.longterm.update", payload)
    }

    pub fn forget_longterm(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.longterm.forget", payload)
    }

    pub fn list_longterm(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.longterm.list", payload)
    }

    pub fn link_longterm(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.longterm.link", payload)
    }

    pub fn rebuild_longterm_index(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend
            .call("agent.memory.longterm.rebuildIndex", payload)
    }

    pub fn cleanup_longterm_candidates(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend
            .call("agent.memory.longterm.cleanupCandidates", payload)
    }

    pub fn review_candidates(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.candidates.review", payload)
    }

    pub fn apply_candidate(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.candidates.apply", payload)
    }

    pub fn reject_candidate(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.candidates.reject", payload)
    }

    pub fn explain_injection(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.explainInjection", payload)
    }

    pub fn search_frozen(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.frozen.search", payload)
    }

    pub fn create_frozen(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.frozen.create", payload)
    }

    pub fn update_frozen(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.frozen.update", payload)
    }

    pub fn forget_frozen(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.frozen.forget", payload)
    }

    pub fn describe_layers(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.layers.describe", payload)
    }

    pub fn reconcile_sync(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.sync.reconcile", payload)
    }

    pub fn export_audit(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.memory.exportAudit", payload)
    }

    pub fn export_layer_projections(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend
            .call("agent.memory.exportLayerProjections", payload)
    }
}
