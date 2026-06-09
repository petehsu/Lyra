use serde_json::json;

use crate::{
    HardwareActionRequest, HardwareActionResponse, HardwareCapability, HardwareDevice,
    HardwareDeviceFilter, HardwareError, HardwareProtocolHint, HardwareProvider,
    HardwareProviderStatus, HardwareTransport, provider::unsupported_provider_status,
};

macro_rules! generic_provider {
    ($name:ident, $id:literal, $transport:expr, $title:literal, $hint:expr, $capabilities:expr) => {
        #[derive(Default)]
        pub struct $name;

        impl HardwareProvider for $name {
            fn id(&self) -> &'static str {
                $id
            }

            fn list_devices(
                &self,
                filter: &HardwareDeviceFilter,
            ) -> Result<Vec<HardwareDevice>, HardwareError> {
                if !matches_transport(&filter.transport, &$transport)
                    || !matches_provider(filter, $id)
                    || !filter.include_system
                {
                    return Ok(Vec::new());
                }
                Ok(vec![controller_device(
                    $id,
                    $transport,
                    $title,
                    $hint,
                    $capabilities,
                )])
            }

            fn invoke(
                &self,
                request: &HardwareActionRequest,
            ) -> Result<Option<HardwareActionResponse>, HardwareError> {
                Ok(invoke_generic($id, request))
            }

            fn status(&self) -> HardwareProviderStatus {
                unsupported_provider_status(
                    $id,
                    "provider interface is registered; native driver backend is not enabled in V1.1",
                )
            }
        }
    };
}

generic_provider!(
    UsbProvider,
    "usb",
    HardwareTransport::Usb,
    "USB bus controller",
    HardwareProtocolHint::UsbDevice,
    &[
        cap(
            "usb.inspect",
            "USB descriptor inspection",
            "hardware.inspect",
            "low",
            &["inspect"],
            false,
            false
        ),
        cap(
            "usb.control_transfer",
            "USB control transfer",
            "hardware.write.stream",
            "high",
            &["control_transfer"],
            false,
            false
        ),
    ]
);

generic_provider!(
    HidProvider,
    "hid",
    HardwareTransport::Hid,
    "HID controller",
    HardwareProtocolHint::HidReports,
    &[
        cap(
            "hid.feature_report",
            "HID feature reports",
            "hardware.write.stream",
            "high",
            &["read_feature", "write_feature"],
            false,
            false
        ),
        cap(
            "hid.input_inject",
            "HID input injection",
            "hardware.input.inject",
            "critical",
            &["inject"],
            false,
            false
        ),
    ]
);

generic_provider!(
    BluetoothBleProvider,
    "bluetooth_ble",
    HardwareTransport::Bluetooth,
    "Bluetooth LE adapter",
    HardwareProtocolHint::BleGatt,
    &[cap(
        "ble.gatt",
        "BLE GATT access",
        "hardware.write.stream",
        "high",
        &["read", "write", "notify"],
        true,
        false
    ),]
);

generic_provider!(
    NetworkInterfaceProvider,
    "network_interface",
    HardwareTransport::Network,
    "Network interface controller",
    HardwareProtocolHint::NetworkInterface,
    &[
        cap(
            "network.interface.inspect",
            "Network interface inspection",
            "hardware.inspect",
            "low",
            &["inspect"],
            false,
            false
        ),
        cap(
            "network.interface.configure",
            "Network interface configuration",
            "hardware.network.configure",
            "high",
            &["configure"],
            false,
            false
        ),
    ]
);

generic_provider!(
    StorageProvider,
    "storage",
    HardwareTransport::Storage,
    "Storage controller",
    HardwareProtocolHint::StorageVolume,
    &[
        cap(
            "storage.volume.inspect",
            "Storage volume inspection",
            "hardware.inspect",
            "low",
            &["inspect"],
            false,
            false
        ),
        cap(
            "storage.volume.write",
            "Storage volume write",
            "hardware.storage.write",
            "critical",
            &["write", "erase"],
            false,
            true
        ),
    ]
);

generic_provider!(
    DebugProbeProvider,
    "debug_probe",
    HardwareTransport::DebugProbe,
    "Debug probe controller",
    HardwareProtocolHint::DebugProbe,
    &[
        cap(
            "debug.probe.inspect",
            "Debug probe inspection",
            "hardware.inspect",
            "low",
            &["inspect"],
            false,
            false
        ),
        cap(
            "debug.probe.flash",
            "Debug probe flashing",
            "hardware.flash",
            "critical",
            &["flash"],
            false,
            true
        ),
    ]
);

const fn cap(
    id: &'static str,
    title: &'static str,
    permission: &'static str,
    risk_level: &'static str,
    actions: &'static [&'static str],
    streaming: bool,
    destructive: bool,
) -> CapabilitySpec {
    CapabilitySpec {
        id,
        title,
        permission,
        risk_level,
        actions,
        streaming,
        destructive,
    }
}

#[derive(Clone, Copy)]
struct CapabilitySpec {
    id: &'static str,
    title: &'static str,
    permission: &'static str,
    risk_level: &'static str,
    actions: &'static [&'static str],
    streaming: bool,
    destructive: bool,
}

fn controller_device(
    provider_id: &str,
    transport: HardwareTransport,
    title: &str,
    hint: HardwareProtocolHint,
    capabilities: &[CapabilitySpec],
) -> HardwareDevice {
    HardwareDevice {
        id: format!("{provider_id}:controller"),
        path: format!("{provider_id}://controller"),
        title: title.to_string(),
        transport,
        provider_id: provider_id.to_string(),
        transport_path: Some(format!("{provider_id}://controller")),
        tags: vec![provider_id.to_string(), "system".to_string()],
        confidence: Some(0.35),
        status: Some("registered".to_string()),
        os_permissions: Vec::new(),
        driver_backends: Vec::new(),
        native_access: Some("registered".to_string()),
        platform: Some(std::env::consts::OS.to_string()),
        vendor_id: None,
        product_id: None,
        manufacturer: Some("Lyra".to_string()),
        product: Some(title.to_string()),
        serial_number: None,
        protocol_hints: vec![hint],
        capabilities: capabilities.iter().map(capability_from_spec).collect(),
    }
}

fn capability_from_spec(spec: &CapabilitySpec) -> HardwareCapability {
    HardwareCapability {
        id: spec.id.to_string(),
        title: spec.title.to_string(),
        risk: spec.permission.to_string(),
        permission: Some(spec.permission.to_string()),
        risk_level: Some(spec.risk_level.to_string()),
        input_schema: Some(json!({ "type": "object" })),
        output_schema: Some(json!({ "type": "object" })),
        streaming: spec.streaming,
        destructive: spec.destructive,
        os_permission: None,
        native_access: Some("registered".to_string()),
        actions: spec
            .actions
            .iter()
            .map(|action| (*action).to_string())
            .collect(),
    }
}

fn matches_transport(
    requested: &Option<HardwareTransport>,
    provider_transport: &HardwareTransport,
) -> bool {
    requested
        .as_ref()
        .is_none_or(|transport| transport == provider_transport)
}

fn matches_provider(filter: &HardwareDeviceFilter, provider_id: &str) -> bool {
    filter
        .provider_id
        .as_deref()
        .is_none_or(|requested| requested == provider_id)
}

fn invoke_generic(
    provider_id: &str,
    request: &HardwareActionRequest,
) -> Option<HardwareActionResponse> {
    let action = request.action_id.as_deref().unwrap_or(&request.action);
    let permission = generic_permission(&request.capability_id)?;
    Some(HardwareActionResponse {
        status: "requires_approval".to_string(),
        action: action.to_string(),
        detail: json!({
            "providerId": provider_id,
            "deviceId": request.device_id,
            "capabilityId": request.capability_id,
            "actionId": action,
            "message": "Native driver execution is gated behind explicit hardware approval.",
        }),
        stream_id: None,
        artifact_ref: None,
        payload_bytes: Some(request.args.to_string().len()),
        payload_sha256: Some("sha256:withheld-driver-payload".to_string()),
        os_permission_state: None,
        driver_backend: Some(provider_id.to_string()),
        audit_summary: Some(format!(
            "{provider_id}.{} action={action} argsBytes={}",
            request.capability_id,
            request.args.to_string().len()
        )),
        missing_requirements: vec![format!("permission:{permission}")],
        needs_user_action: Some(json!({
            "kind": "hardware_permission",
            "providerId": provider_id,
            "permission": permission,
            "capabilityId": request.capability_id,
            "actionId": action,
        })),
    })
}

fn generic_permission(capability_id: &str) -> Option<&'static str> {
    match capability_id {
        "usb.control_transfer" | "hid.feature_report" | "ble.gatt" => Some("hardware.write.stream"),
        "hid.input_inject" => Some("hardware.input.inject"),
        "network.interface.configure" => Some("hardware.network.configure"),
        "media.audio.capture" | "media.camera.capture" => Some("hardware.media.capture"),
        "storage.volume.write" => Some("hardware.storage.write"),
        "debug.probe.flash" => Some("hardware.flash"),
        "usb.inspect"
        | "network.interface.inspect"
        | "storage.volume.inspect"
        | "debug.probe.inspect" => Some("hardware.inspect"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_providers_declare_v11_capabilities() {
        let providers: Vec<Box<dyn HardwareProvider>> = vec![
            Box::new(UsbProvider),
            Box::new(HidProvider),
            Box::new(BluetoothBleProvider),
            Box::new(NetworkInterfaceProvider),
            Box::new(StorageProvider),
            Box::new(DebugProbeProvider),
        ];
        let filter = HardwareDeviceFilter {
            include_system: true,
            ..HardwareDeviceFilter::default()
        };
        for provider in providers {
            let devices = provider.list_devices(&filter).expect("provider list");
            assert_eq!(devices.len(), 1, "{} declares controller", provider.id());
            assert!(
                !devices[0].capabilities.is_empty(),
                "{} declares capabilities",
                provider.id()
            );
            assert_eq!(provider.status().status, "unsupported");
        }
    }

    #[test]
    fn generic_invoke_reports_approval_without_raw_payload() {
        let response = invoke_generic(
            "hid",
            &HardwareActionRequest {
                device_id: Some("hid:controller".to_string()),
                session_id: None,
                capability_id: "hid.input_inject".to_string(),
                action_id: Some("inject".to_string()),
                action: "inject".to_string(),
                args: json!({ "payload": "secret keystrokes" }),
            },
        )
        .expect("generic response");
        assert_eq!(response.status, "requires_approval");
        assert_eq!(
            response.missing_requirements,
            ["permission:hardware.input.inject"]
        );
        assert!(
            response
                .audit_summary
                .as_deref()
                .is_some_and(|summary| summary.contains("argsBytes="))
        );
        assert!(
            !response
                .audit_summary
                .as_deref()
                .unwrap_or_default()
                .contains("secret keystrokes")
        );
    }
}
