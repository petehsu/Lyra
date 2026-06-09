use std::sync::Arc;

use crate::{
    HardwareActionRequest, HardwareActionResponse, HardwareCapabilitiesRequest,
    HardwareCapabilitiesResponse, HardwareCapabilityEntry, HardwareDevice, HardwareDeviceFilter,
    HardwareError, HardwareListRequest, HardwareListResponse, HardwareProvider,
    HardwareProviderStatus,
};

#[derive(Clone)]
pub struct HardwareBroker {
    providers: Arc<Vec<Arc<dyn HardwareProvider>>>,
}

impl HardwareBroker {
    pub fn new(providers: Vec<Arc<dyn HardwareProvider>>) -> Self {
        Self {
            providers: Arc::new(providers),
        }
    }

    pub fn providers(&self) -> &[Arc<dyn HardwareProvider>] {
        self.providers.as_ref()
    }

    pub fn list(&self, request: HardwareListRequest) -> HardwareListResponse {
        let mut devices = Vec::new();
        let mut provider_statuses = Vec::new();
        for provider in self.providers() {
            if !provider_matches_filter(provider.id(), &request.filter) {
                continue;
            }
            match provider.list_devices(&request.filter) {
                Ok(mut provider_devices) => {
                    devices.append(&mut provider_devices);
                    provider_statuses.push(provider.status());
                }
                Err(error) => provider_statuses.push(HardwareProviderStatus {
                    provider_id: provider.id().to_string(),
                    status: "failed".to_string(),
                    detail: Some(error.to_string()),
                }),
            }
        }
        HardwareListResponse {
            devices,
            provider_statuses,
        }
    }

    pub fn find_device(&self, device_id: &str) -> Result<HardwareDevice, HardwareError> {
        let response = self.list(HardwareListRequest {
            filter: HardwareDeviceFilter::default(),
        });
        response
            .devices
            .into_iter()
            .find(|device| {
                device.id == device_id
                    || device.path == device_id
                    || device.transport_path.as_deref() == Some(device_id)
            })
            .ok_or_else(|| HardwareError::not_found("device", device_id.to_string()))
    }

    pub fn capabilities(
        &self,
        request: HardwareCapabilitiesRequest,
    ) -> HardwareCapabilitiesResponse {
        let response = self.list(HardwareListRequest {
            filter: HardwareDeviceFilter {
                transport: request.transport.clone(),
                provider_id: request.provider_id.clone(),
                tag: request.tag.clone(),
                include_system: true,
            },
        });
        let mut capabilities = Vec::new();
        for device in response.devices {
            if !device_matches_capability_filter(&device, &request) {
                continue;
            }
            for capability in device.capabilities {
                if let Some(risk) = request.risk.as_deref()
                    && capability.risk != risk
                    && capability.permission.as_deref() != Some(risk)
                {
                    continue;
                }
                if let Some(os_permission) = request.os_permission.as_deref()
                    && capability.os_permission.as_deref() != Some(os_permission)
                {
                    continue;
                }
                if let Some(native_access) = request.native_access.as_deref()
                    && capability.native_access.as_deref() != Some(native_access)
                {
                    continue;
                }
                if let Some(streaming) = request.streaming
                    && capability.streaming != streaming
                {
                    continue;
                }
                if let Some(destructive) = request.destructive
                    && capability.destructive != destructive
                {
                    continue;
                }
                capabilities.push(HardwareCapabilityEntry {
                    device_id: device.id.clone(),
                    provider_id: device.provider_id.clone(),
                    transport: device.transport.clone(),
                    capability,
                });
            }
        }
        HardwareCapabilitiesResponse { capabilities }
    }

    pub fn invoke(
        &self,
        request: HardwareActionRequest,
    ) -> Result<HardwareActionResponse, HardwareError> {
        for provider in self.providers() {
            if let Some(response) = provider.invoke(&request)? {
                return Ok(response);
            }
        }
        Err(HardwareError::new(
            "unsupported_hardware_action",
            format!(
                "unsupported hardware action {}.{}",
                request.capability_id,
                request.action_id.as_deref().unwrap_or(&request.action)
            ),
        ))
    }
}

fn provider_matches_filter(provider_id: &str, filter: &HardwareDeviceFilter) -> bool {
    filter
        .provider_id
        .as_deref()
        .is_none_or(|requested| requested == provider_id)
}

fn device_matches_capability_filter(
    device: &HardwareDevice,
    request: &HardwareCapabilitiesRequest,
) -> bool {
    if let Some(transport) = &request.transport
        && &device.transport != transport
    {
        return false;
    }
    if let Some(provider_id) = request.provider_id.as_deref()
        && device.provider_id != provider_id
    {
        return false;
    }
    if let Some(tag) = request.tag.as_deref()
        && !device.tags.iter().any(|value| value == tag)
    {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{HardwareCapability, HardwareTransport};

    struct GoodProvider;

    impl HardwareProvider for GoodProvider {
        fn id(&self) -> &'static str {
            "good"
        }

        fn list_devices(
            &self,
            _filter: &HardwareDeviceFilter,
        ) -> Result<Vec<HardwareDevice>, HardwareError> {
            Ok(vec![HardwareDevice {
                id: "good:device".to_string(),
                path: "good://device".to_string(),
                title: "Good Device".to_string(),
                transport: HardwareTransport::Usb,
                provider_id: "good".to_string(),
                transport_path: Some("good://device".to_string()),
                tags: vec!["test".to_string()],
                confidence: Some(1.0),
                status: Some("available".to_string()),
                os_permissions: Vec::new(),
                driver_backends: Vec::new(),
                native_access: Some("read".to_string()),
                platform: Some(std::env::consts::OS.to_string()),
                vendor_id: None,
                product_id: None,
                manufacturer: None,
                product: None,
                serial_number: None,
                protocol_hints: Vec::new(),
                capabilities: vec![HardwareCapability {
                    id: "good.read".to_string(),
                    title: "Read".to_string(),
                    risk: "hardware.read.stream".to_string(),
                    permission: Some("hardware.read.stream".to_string()),
                    risk_level: Some("low".to_string()),
                    input_schema: Some(json!({ "type": "object" })),
                    output_schema: None,
                    streaming: false,
                    destructive: false,
                    os_permission: None,
                    native_access: Some("read".to_string()),
                    actions: vec!["read".to_string()],
                }],
            }])
        }
    }

    struct FailingProvider;

    impl HardwareProvider for FailingProvider {
        fn id(&self) -> &'static str {
            "failing"
        }

        fn list_devices(
            &self,
            _filter: &HardwareDeviceFilter,
        ) -> Result<Vec<HardwareDevice>, HardwareError> {
            Err(HardwareError::new("provider_failed", "provider failed"))
        }
    }

    #[test]
    fn broker_aggregates_and_isolates_provider_failures() {
        let broker = HardwareBroker::new(vec![Arc::new(GoodProvider), Arc::new(FailingProvider)]);
        let response = broker.list(HardwareListRequest {
            filter: HardwareDeviceFilter::default(),
        });
        assert_eq!(response.devices.len(), 1);
        assert!(
            response
                .provider_statuses
                .iter()
                .any(|status| status.provider_id == "failing" && status.status == "failed")
        );
    }

    #[test]
    fn broker_filters_capabilities() {
        let broker = HardwareBroker::new(vec![Arc::new(GoodProvider)]);
        let response = broker.capabilities(HardwareCapabilitiesRequest {
            transport: Some(HardwareTransport::Usb),
            provider_id: Some("good".to_string()),
            risk: Some("hardware.read.stream".to_string()),
            tag: Some("test".to_string()),
            os_permission: None,
            native_access: None,
            streaming: None,
            destructive: None,
        });
        assert_eq!(response.capabilities.len(), 1);
        assert_eq!(response.capabilities[0].capability.id, "good.read");
    }
}
