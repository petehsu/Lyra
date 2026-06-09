use crate::{
    HardwareDriverBackend, HardwareError, HardwareOsPermissionState, HardwareOsStatusResponse,
    HardwarePermissionRequest, HardwarePermissionResponse, HardwareProviderStatus,
};

#[derive(Default)]
pub struct OsProvider;

impl OsProvider {
    pub fn status(
        &self,
        provider_statuses: Vec<HardwareProviderStatus>,
    ) -> HardwareOsStatusResponse {
        HardwareOsStatusResponse {
            platform: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            family: std::env::consts::FAMILY.to_string(),
            permissions: os_permissions(),
            driver_backends: driver_backends(),
            system_limits: system_limits(),
            provider_statuses,
        }
    }

    pub fn request_permission(
        &self,
        request: HardwarePermissionRequest,
    ) -> Result<HardwarePermissionResponse, HardwareError> {
        if request.permission_id.trim().is_empty() {
            return Err(HardwareError::new(
                "bad_hardware_permission",
                "permissionId is required",
            ));
        }
        Ok(HardwarePermissionResponse {
            permission_id: request.permission_id.clone(),
            status: "blocked".to_string(),
            platform: std::env::consts::OS.to_string(),
            guidance: Some(permission_guidance(&request.permission_id)),
            attempted_system_prompt: can_attempt_system_prompt(&request.permission_id),
        })
    }
}

pub fn os_permissions() -> Vec<HardwareOsPermissionState> {
    [
        ("camera", "Camera"),
        ("microphone", "Microphone"),
        ("input_monitoring", "Input monitoring"),
        ("accessibility", "Accessibility input control"),
        ("bluetooth", "Bluetooth"),
        ("removable_storage", "Removable storage"),
    ]
    .into_iter()
    .map(|(id, title)| HardwareOsPermissionState {
        id: id.to_string(),
        title: title.to_string(),
        state: "unknown".to_string(),
        platform_hint: Some(permission_guidance(id)),
    })
    .collect()
}

pub fn driver_backends() -> Vec<HardwareDriverBackend> {
    [
        ("nokhwa", "Camera capture backend"),
        ("cpal", "Audio capture backend"),
        ("hidapi", "HID native backend"),
        ("btleplug", "Bluetooth LE backend"),
        ("rusb", "USB native backend"),
    ]
    .into_iter()
    .map(|(id, title)| HardwareDriverBackend {
        id: id.to_string(),
        title: title.to_string(),
        status: "registered".to_string(),
        detail: Some(
            "backend is registered; platform runtime access is checked per action".to_string(),
        ),
    })
    .collect()
}

fn system_limits() -> Vec<String> {
    vec![
        "OS privacy permissions are not bypassed".to_string(),
        "media streams require bounded duration or explicit stream session".to_string(),
        "global input injection requires eventLimit or durationLimitMs".to_string(),
    ]
}

fn can_attempt_system_prompt(permission_id: &str) -> bool {
    matches!(permission_id, "camera" | "microphone" | "bluetooth")
}

fn permission_guidance(permission_id: &str) -> String {
    match (std::env::consts::OS, permission_id) {
        ("macos", "camera") => {
            "Open System Settings > Privacy & Security > Camera and allow Lyra.".to_string()
        }
        ("macos", "microphone") => {
            "Open System Settings > Privacy & Security > Microphone and allow Lyra.".to_string()
        }
        ("macos", "input_monitoring") | ("macos", "accessibility") => {
            "Open System Settings > Privacy & Security and allow Lyra for Accessibility/Input Monitoring.".to_string()
        }
        ("windows", _) => {
            "Open Windows Settings > Privacy & security and allow Lyra for the requested hardware permission.".to_string()
        }
        ("linux", _) => {
            "Check desktop portal, udev, group membership, and session permissions for the requested device.".to_string()
        }
        _ => "Grant the requested hardware permission in the operating system settings.".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn os_provider_reports_permissions_and_guidance() {
        let provider = OsProvider;
        let status = provider.status(Vec::new());
        assert!(!status.permissions.is_empty());
        assert!(!status.driver_backends.is_empty());
        let response = provider
            .request_permission(HardwarePermissionRequest {
                permission_id: "camera".to_string(),
                device_id: None,
                provider_id: Some("media_camera".to_string()),
                reason: Some("test".to_string()),
            })
            .expect("permission response");
        assert_eq!(response.permission_id, "camera");
        assert!(response.guidance.is_some());
    }
}
