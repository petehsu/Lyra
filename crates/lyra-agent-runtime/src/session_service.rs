use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct SessionService {
    backend: BackendHandle,
}

impl Default for SessionService {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl SessionService {
    pub const NAME: &'static str = "session_service";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn create_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.session.create", payload)
    }

    pub fn create(
        &self,
        title: Option<String>,
        working_dir: Option<String>,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        let mut payload = serde_json::Map::new();
        if let Some(title) = title {
            payload.insert("title".to_string(), serde_json::Value::String(title));
        }
        if let Some(working_dir) = working_dir {
            payload.insert(
                "workingDir".to_string(),
                serde_json::Value::String(working_dir),
            );
        }
        self.backend
            .call("agent.session.create", serde_json::Value::Object(payload))
    }

    pub fn list(&self, limit: Option<usize>) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.session.list",
            serde_json::json!({ "limit": limit.unwrap_or(100) }),
        )
    }

    pub fn list_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.session.list", payload)
    }

    pub fn read(&self, session_id: Option<String>) -> crate::AgentRuntimeResult<serde_json::Value> {
        let mut payload = serde_json::Map::new();
        if let Some(session_id) = session_id {
            payload.insert(
                "sessionId".to_string(),
                serde_json::Value::String(session_id),
            );
        }
        self.backend
            .call("agent.session.read", serde_json::Value::Object(payload))
    }

    pub fn read_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.session.read", payload)
    }

    pub fn save(&self, payload: serde_json::Value) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.session.save", payload)
    }

    pub fn unsave(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.session.unsave", payload)
    }

    pub fn rename(
        &self,
        session_id: String,
        title: Option<String>,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.session.rename",
            serde_json::json!({ "sessionId": session_id, "title": title }),
        )
    }

    pub fn rename_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.session.rename", payload)
    }

    pub fn archive(
        &self,
        session_id: String,
        archived: bool,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.session.archive",
            serde_json::json!({ "sessionId": session_id, "archived": archived }),
        )
    }

    pub fn archive_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.session.archive", payload)
    }

    pub fn delete(&self, session_id: String) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.session.delete",
            serde_json::json!({ "sessionId": session_id }),
        )
    }

    pub fn delete_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.session.delete", payload)
    }

    pub fn bind_project(
        &self,
        session_id: String,
        working_dir: String,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.session.bindProject",
            serde_json::json!({ "sessionId": session_id, "workingDir": working_dir }),
        )
    }

    pub fn bind_project_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.session.bindProject", payload)
    }
}
