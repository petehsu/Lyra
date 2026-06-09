use serde_json::json;

use crate::{
    HardwareActionRequest, HardwareActionResponse, HardwareCapability, HardwareDevice,
    HardwareDeviceFilter, HardwareError, HardwareProtocolHint, HardwareProvider, HardwareTransport,
    ToolchainDetector, ToolchainProbe, ToolchainStatus,
};

#[derive(Default)]
pub struct ToolchainProvider {
    detector: ToolchainProbe,
}

impl HardwareProvider for ToolchainProvider {
    fn id(&self) -> &'static str {
        "toolchain"
    }

    fn list_devices(
        &self,
        filter: &HardwareDeviceFilter,
    ) -> Result<Vec<HardwareDevice>, HardwareError> {
        if !matches!(filter.transport, None | Some(HardwareTransport::Toolchain))
            || filter
                .provider_id
                .as_deref()
                .is_some_and(|requested| requested != self.id())
            || !filter.include_system
        {
            return Ok(Vec::new());
        }
        let toolchains = self.detector.detect();
        Ok(vec![
            HardwareDevice {
                id: "toolchain:controller".to_string(),
                path: "toolchain://controller".to_string(),
                title: "Hardware toolchains".to_string(),
                transport: HardwareTransport::Toolchain,
                provider_id: self.id().to_string(),
                transport_path: Some("toolchain://controller".to_string()),
                tags: vec!["toolchain".to_string(), "system".to_string()],
                confidence: Some(1.0),
                status: Some("available".to_string()),
                os_permissions: Vec::new(),
                driver_backends: vec![crate::HardwareDriverBackend {
                    id: "shell".to_string(),
                    title: "Approved shell toolchain runner".to_string(),
                    status: "available".to_string(),
                    detail: None,
                }],
                native_access: Some("toolchain".to_string()),
                platform: Some(std::env::consts::OS.to_string()),
                vendor_id: None,
                product_id: None,
                manufacturer: Some("Lyra".to_string()),
                product: Some("Hardware toolchains".to_string()),
                serial_number: None,
                protocol_hints: vec![HardwareProtocolHint::Toolchain],
                capabilities: vec![HardwareCapability {
                    id: "toolchain.install".to_string(),
                    title: "Install missing hardware toolchain".to_string(),
                    risk: "hardware.toolchain.install".to_string(),
                    permission: Some("hardware.toolchain.install".to_string()),
                    risk_level: Some("high".to_string()),
                    input_schema: Some(
                        json!({ "type": "object", "properties": { "tool": { "type": "string" } } }),
                    ),
                    output_schema: Some(json!({ "type": "object" })),
                    streaming: false,
                    destructive: false,
                    os_permission: None,
                    native_access: Some("toolchain".to_string()),
                    actions: vec!["install".to_string()],
                }],
            }
            .with_status_detail(toolchains),
        ])
    }

    fn invoke(
        &self,
        request: &HardwareActionRequest,
    ) -> Result<Option<HardwareActionResponse>, HardwareError> {
        if request.capability_id != "toolchain.install" {
            return Ok(None);
        }
        let tool = request
            .args
            .get("tool")
            .and_then(|value| value.as_str())
            .unwrap_or("<missing>");
        Ok(Some(HardwareActionResponse {
            status: "requires_approval".to_string(),
            action: request
                .action_id
                .clone()
                .unwrap_or_else(|| request.action.clone()),
            detail: json!({
                "tool": tool,
                "message": "Toolchain installation must be routed through an approved shell command.",
            }),
            stream_id: None,
            artifact_ref: None,
            payload_bytes: None,
            payload_sha256: None,
            os_permission_state: None,
            driver_backend: Some("shell".to_string()),
            audit_summary: Some(format!("toolchain.install tool={tool}")),
            missing_requirements: Vec::new(),
            needs_user_action: Some(json!({
                "kind": "hardware_toolchain_install",
                "tool": tool,
            })),
        }))
    }
}

trait ToolchainDeviceExt {
    fn with_status_detail(self, toolchains: Vec<crate::HardwareToolchainState>) -> Self;
}

impl ToolchainDeviceExt for HardwareDevice {
    fn with_status_detail(mut self, toolchains: Vec<crate::HardwareToolchainState>) -> Self {
        let missing = toolchains
            .iter()
            .filter(|tool| matches!(tool.status, ToolchainStatus::Missing))
            .count();
        self.status = Some(if missing == 0 {
            "available".to_string()
        } else {
            format!("{missing} missing")
        });
        self
    }
}
