use serde::{Deserialize, Serialize};
use crate::BackendHandle;

/// Typed client→server permission decision message.
///
/// Validates at the trust boundary: malformed payloads fail with a clear
/// error instead of silent missing fields downstream.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponse {
    pub session_id: String,
    pub permission_id: String,
    pub allowed: bool,
}

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
        let msg: PermissionResponse = serde_json::from_value(payload)
            .map_err(|e| crate::AgentRuntimeError::Serialization(e.to_string()))?;
        self.backend.call("agent.permission.respond", serde_json::to_value(&msg).unwrap_or_default())
    }

    pub fn respond(
        &self,
        session_id: String,
        permission_id: String,
        allowed: bool,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        let msg = PermissionResponse { session_id, permission_id, allowed };
        self.backend.call("agent.permission.respond", serde_json::to_value(&msg).unwrap_or_default())
    }
}