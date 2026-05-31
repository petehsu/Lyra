use crate::{AgentRuntimeError, BackendHandle};

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

    pub fn browser_recovery_anchor(&self) -> crate::AgentRuntimeResult<serde_json::Value> {
        let snapshot = self
            .backend
            .call_host_capability(
                "workbench.browser.readSessionSnapshot",
                serde_json::json!({ "includeRecoveryAnchor": true, "includeStorageState": true }),
            )
            .map_err(AgentRuntimeError::HostCapability)?;
        if snapshot.is_null() {
            return Ok(serde_json::json!({
                "available": false,
                "reason": "snapshot_missing"
            }));
        }
        let anchor = snapshot
            .get("recoveryAnchor")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        Ok(serde_json::json!({
            "available": !anchor.is_null(),
            "reason": if anchor.is_null() {
                serde_json::Value::String("recovery_anchor_missing".to_string())
            } else {
                serde_json::Value::Null
            },
            "anchor": anchor,
            "snapshotId": snapshot.get("snapshotId").cloned().unwrap_or(serde_json::Value::Null),
            "capturedAt": snapshot.get("capturedAt").cloned().unwrap_or(serde_json::Value::Null),
            "activeTabId": snapshot.get("activeTabId").cloned().unwrap_or(serde_json::Value::Null)
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AgentRuntimeBackend, AgentRuntimeResult, EventCallback, HostCapabilityDispatcher};
    use serde_json::{Value, json};
    use std::sync::Arc;

    struct FakeBackend {
        snapshot: Value,
    }

    impl AgentRuntimeBackend for FakeBackend {
        fn call_agent_method(&self, method: &str, _payload: Value) -> AgentRuntimeResult<Value> {
            Err(AgentRuntimeError::UnknownMethod(method.to_string()))
        }

        fn register_event_callback(&self, _callback: Arc<EventCallback>) {}

        fn clear_event_callback(&self) {}

        fn register_host_capability_dispatcher(&self, _dispatcher: Arc<HostCapabilityDispatcher>) {}

        fn clear_host_capability_dispatcher(&self) {}

        fn call_host_capability(&self, method: &str, payload: Value) -> Result<Value, String> {
            assert_eq!(method, "workbench.browser.readSessionSnapshot");
            assert_eq!(payload["includeRecoveryAnchor"], true);
            Ok(self.snapshot.clone())
        }
    }

    #[test]
    fn browser_recovery_anchor_reads_host_snapshot_without_secret_values() {
        let service = RecoveryService::new(BackendHandle::new(Arc::new(FakeBackend {
            snapshot: json!({
                "snapshotId": "browser-session-1",
                "capturedAt": 42,
                "activeTabId": "browser-tab-1",
                "recoveryAnchor": {
                    "schemaVersion": 1,
                    "tabId": "browser-tab-1",
                    "address": "https://example.com/app",
                    "title": "Example App",
                    "targetRef": "lumen:stable-target",
                    "textHash": "sha256:abc",
                    "storageStateRef": {
                        "profilePartition": "persist:lyra-browser-live",
                        "siteOrigin": "https://example.com"
                    },
                    "authState": "possibly_logged_in",
                    "capturedAt": 42
                }
            }),
        })));

        let anchor = service
            .browser_recovery_anchor()
            .expect("browser recovery anchor");

        assert_eq!(anchor["available"], true);
        assert_eq!(anchor["anchor"]["targetRef"], "lumen:stable-target");
        assert_eq!(
            anchor["anchor"]["storageStateRef"]["profilePartition"],
            "persist:lyra-browser-live"
        );
        assert!(
            !serde_json::to_string(&anchor)
                .expect("anchor json")
                .contains("cookie")
        );
    }
}
