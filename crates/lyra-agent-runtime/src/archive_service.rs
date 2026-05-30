use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct ArchiveService {
    backend: BackendHandle,
}

impl Default for ArchiveService {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl ArchiveService {
    pub const NAME: &'static str = "archive_service";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn archive_session(
        &self,
        session_id: String,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.session.archive",
            serde_json::json!({ "sessionId": session_id, "archived": true }),
        )
    }
}
