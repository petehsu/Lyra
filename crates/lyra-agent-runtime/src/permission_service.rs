use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct PermissionService {
    backend: BackendHandle,
}

impl Default for PermissionService {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl PermissionService {
    pub const NAME: &'static str = "permission_service";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn respond_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.permission.respond", payload)
    }

    pub fn respond(
        &self,
        session_id: String,
        permission_id: String,
        allowed: bool,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.permission.respond",
            serde_json::json!({ "sessionId": session_id, "permissionId": permission_id, "allowed": allowed }),
        )
    }
}
