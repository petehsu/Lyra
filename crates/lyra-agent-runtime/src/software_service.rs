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

    pub fn inspect_capability(
        &self,
        software_id: &str,
        capability_id: Option<&str>,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        let mut payload = serde_json::json!({
            "softwareId": software_id,
        });
        if let Some(capability_id) = capability_id {
            payload["capabilityId"] = serde_json::Value::String(capability_id.to_string());
        }
        match self
            .backend
            .call_host_capability("software.inspectCapability", payload)
        {
            Ok(value) => Ok(value),
            Err(error) => Ok(serde_json::json!({
                "softwareId": software_id,
                "capabilityId": capability_id,
                "hostCapabilityAvailable": false,
                "message": error,
            })),
        }
    }

    pub fn read_state(
        &self,
        software_id: Option<&str>,
        capability_id: Option<&str>,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        let mut payload = serde_json::json!({});
        if let Some(software_id) = software_id {
            payload["softwareId"] = serde_json::Value::String(software_id.to_string());
        }
        if let Some(capability_id) = capability_id {
            payload["capabilityId"] = serde_json::Value::String(capability_id.to_string());
        }
        match self
            .backend
            .call_host_capability("software.readState", payload)
        {
            Ok(value) => Ok(value),
            Err(error) => Ok(serde_json::json!({
                "softwareId": software_id,
                "capabilityId": capability_id,
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

    #[test]
    fn software_service_declares_inspect_and_read_state_policy_fields() {
        let policy = SoftwareService::default().minimal_exposure_policy();
        assert!(
            policy["fields"]
                .as_array()
                .expect("fields")
                .contains(&"readableState".into())
        );
        assert!(
            policy["fields"]
                .as_array()
                .expect("fields")
                .contains(&"commands".into())
        );
    }
}
