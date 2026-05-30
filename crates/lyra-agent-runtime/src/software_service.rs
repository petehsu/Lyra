use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct SoftwareService {
    backend: BackendHandle,
}

impl Default for SoftwareService {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl SoftwareService {
    pub const NAME: &'static str = "software_service";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn list_capabilities(&self) -> crate::AgentRuntimeResult<serde_json::Value> {
        match self
            .backend
            .call_host_capability("software.listCapabilities", serde_json::json!({}))
        {
            Ok(value) => Ok(value),
            Err(error) => Ok(serde_json::json!({
                "software": [],
                "hostCapabilityAvailable": false,
                "message": error,
            })),
        }
    }

    pub fn minimal_exposure_policy(&self) -> serde_json::Value {
        serde_json::json!({
            "selection": "taskWorkspacePermission",
            "maxToolSchemaMode": "lightweightSummary",
            "fields": [
                "readableState",
                "commands",
                "events",
                "permissions",
                "uiAffordances",
                "lightweightSummary"
            ]
        })
    }
}

#[cfg(test)]
mod tests {
    use super::SoftwareService;

    #[test]
    fn software_policy_keeps_adapter_exposure_minimal() {
        let policy = SoftwareService::default().minimal_exposure_policy();
        assert_eq!(policy["selection"], "taskWorkspacePermission");
        assert_eq!(policy["maxToolSchemaMode"], "lightweightSummary");
    }
}
