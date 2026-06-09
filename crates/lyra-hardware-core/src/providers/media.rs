use serde_json::json;
use uuid::Uuid;

use crate::{
    HardwareActionRequest, HardwareActionResponse, HardwareCapability, HardwareDevice,
    HardwareDeviceFilter, HardwareError, HardwareProtocolHint, HardwareProvider,
    HardwareProviderStatus, HardwareTransport,
    providers::os::{driver_backends, os_permissions},
};

#[derive(Clone, Copy, Debug)]
enum MediaKind {
    Camera,
    Audio,
}

#[derive(Default)]
pub struct MediaCameraProvider;

#[derive(Default)]
pub struct MediaAudioProvider;

impl HardwareProvider for MediaCameraProvider {
    fn id(&self) -> &'static str {
        "media_camera"
    }

    fn list_devices(
        &self,
        filter: &HardwareDeviceFilter,
    ) -> Result<Vec<HardwareDevice>, HardwareError> {
        list_media_device(filter, self.id(), MediaKind::Camera)
    }

    fn invoke(
        &self,
        request: &HardwareActionRequest,
    ) -> Result<Option<HardwareActionResponse>, HardwareError> {
        invoke_media(self.id(), MediaKind::Camera, request)
    }

    fn status(&self) -> HardwareProviderStatus {
        HardwareProviderStatus {
            provider_id: self.id().to_string(),
            status: "registered".to_string(),
            detail: Some(
                "nokhwa backend is registered; OS camera permission is checked per action"
                    .to_string(),
            ),
        }
    }
}

impl HardwareProvider for MediaAudioProvider {
    fn id(&self) -> &'static str {
        "media_audio"
    }

    fn list_devices(
        &self,
        filter: &HardwareDeviceFilter,
    ) -> Result<Vec<HardwareDevice>, HardwareError> {
        list_media_device(filter, self.id(), MediaKind::Audio)
    }

    fn invoke(
        &self,
        request: &HardwareActionRequest,
    ) -> Result<Option<HardwareActionResponse>, HardwareError> {
        invoke_media(self.id(), MediaKind::Audio, request)
    }

    fn status(&self) -> HardwareProviderStatus {
        HardwareProviderStatus {
            provider_id: self.id().to_string(),
            status: "registered".to_string(),
            detail: Some(
                "cpal backend is registered; OS microphone permission is checked per action"
                    .to_string(),
            ),
        }
    }
}

fn list_media_device(
    filter: &HardwareDeviceFilter,
    provider_id: &str,
    kind: MediaKind,
) -> Result<Vec<HardwareDevice>, HardwareError> {
    let transport = match kind {
        MediaKind::Camera => HardwareTransport::MediaCamera,
        MediaKind::Audio => HardwareTransport::MediaAudio,
    };
    if filter
        .transport
        .as_ref()
        .is_some_and(|requested| requested != &transport)
        || filter
            .provider_id
            .as_deref()
            .is_some_and(|requested| requested != provider_id)
        || !filter.include_system
    {
        return Ok(Vec::new());
    }
    Ok(vec![media_device(provider_id, kind)])
}

fn media_device(provider_id: &str, kind: MediaKind) -> HardwareDevice {
    let (title, transport, permission, backend, capability_id, actions) = match kind {
        MediaKind::Camera => (
            "Camera capture controller",
            HardwareTransport::MediaCamera,
            "camera",
            "nokhwa",
            "media.camera.capture",
            vec![
                "capture_frame",
                "stream_open",
                "stream_read",
                "stream_close",
            ],
        ),
        MediaKind::Audio => (
            "Audio capture controller",
            HardwareTransport::MediaAudio,
            "microphone",
            "cpal",
            "media.audio.capture",
            vec![
                "capture_short",
                "stream_open",
                "stream_read",
                "stream_close",
            ],
        ),
    };
    HardwareDevice {
        id: format!("{provider_id}:default"),
        path: format!("{provider_id}://default"),
        title: title.to_string(),
        transport,
        provider_id: provider_id.to_string(),
        transport_path: Some(format!("{provider_id}://default")),
        tags: vec![
            "media".to_string(),
            permission.to_string(),
            "system".to_string(),
        ],
        confidence: Some(0.5),
        status: Some("registered".to_string()),
        os_permissions: os_permissions()
            .into_iter()
            .filter(|state| state.id == permission)
            .collect(),
        driver_backends: driver_backends()
            .into_iter()
            .filter(|driver| driver.id == backend)
            .collect(),
        native_access: Some("capture_stream".to_string()),
        platform: Some(std::env::consts::OS.to_string()),
        vendor_id: None,
        product_id: None,
        manufacturer: Some("OS".to_string()),
        product: Some(title.to_string()),
        serial_number: None,
        protocol_hints: vec![HardwareProtocolHint::MediaCapture],
        capabilities: vec![HardwareCapability {
            id: capability_id.to_string(),
            title: title.to_string(),
            risk: "hardware.media.stream".to_string(),
            permission: Some("hardware.media.stream".to_string()),
            risk_level: Some("critical".to_string()),
            input_schema: Some(json!({ "type": "object" })),
            output_schema: Some(json!({ "type": "object" })),
            streaming: true,
            destructive: false,
            os_permission: Some(permission.to_string()),
            native_access: Some("capture_stream".to_string()),
            actions: actions.into_iter().map(str::to_string).collect(),
        }],
    }
}

fn invoke_media(
    provider_id: &str,
    kind: MediaKind,
    request: &HardwareActionRequest,
) -> Result<Option<HardwareActionResponse>, HardwareError> {
    let expected_capability = match kind {
        MediaKind::Camera => "media.camera.capture",
        MediaKind::Audio => "media.audio.capture",
    };
    if request.capability_id != expected_capability {
        return Ok(None);
    }
    let action = request.action_id.as_deref().unwrap_or(&request.action);
    let duration_ms = request
        .args
        .get("durationMs")
        .and_then(|value| value.as_u64())
        .unwrap_or(1_000)
        .min(30_000);
    let max_bytes = request
        .args
        .get("maxBytes")
        .and_then(|value| value.as_u64())
        .unwrap_or(512_000)
        .min(2_000_000) as usize;
    match action {
        "capture_frame" | "capture_short" => Ok(Some(media_response(
            provider_id,
            action,
            "requires_approval",
            None,
            max_bytes,
            duration_ms,
        ))),
        "stream_open" => Ok(Some(media_response(
            provider_id,
            action,
            "requires_approval",
            Some(format!("hardware-media-stream-{}", Uuid::new_v4())),
            max_bytes,
            duration_ms,
        ))),
        "stream_read" | "stream_close" => Ok(Some(media_response(
            provider_id,
            action,
            "blocked",
            request
                .args
                .get("streamId")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            max_bytes,
            duration_ms,
        ))),
        _ => Err(HardwareError::new(
            "unsupported_hardware_action",
            format!("unsupported media action {action}"),
        )),
    }
}

fn media_response(
    provider_id: &str,
    action: &str,
    status: &str,
    stream_id: Option<String>,
    max_bytes: usize,
    duration_ms: u64,
) -> HardwareActionResponse {
    HardwareActionResponse {
        status: status.to_string(),
        action: action.to_string(),
        detail: json!({
            "providerId": provider_id,
            "durationMs": duration_ms,
            "maxBytes": max_bytes,
            "message": "Media access is gated by Agent approval and OS privacy permission.",
        }),
        stream_id,
        artifact_ref: None,
        payload_bytes: Some(0),
        payload_sha256: Some("sha256:pending-os-capture".to_string()),
        os_permission_state: Some("unknown".to_string()),
        driver_backend: Some(
            if provider_id == "media_camera" {
                "nokhwa"
            } else {
                "cpal"
            }
            .to_string(),
        ),
        audit_summary: Some(format!(
            "{provider_id}.{action} durationMs={duration_ms} maxBytes={max_bytes}"
        )),
        missing_requirements: vec!["permission:hardware.media.stream".to_string()],
        needs_user_action: Some(json!({
            "kind": "hardware_media_permission",
            "providerId": provider_id,
            "actionId": action,
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_capture_and_stream_are_bounded() {
        let provider = MediaCameraProvider;
        let devices = provider
            .list_devices(&HardwareDeviceFilter {
                include_system: true,
                ..HardwareDeviceFilter::default()
            })
            .expect("media devices");
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].native_access.as_deref(), Some("capture_stream"));
        let response = provider
            .invoke(&HardwareActionRequest {
                device_id: Some("media_camera:default".to_string()),
                session_id: None,
                capability_id: "media.camera.capture".to_string(),
                action_id: Some("stream_open".to_string()),
                action: "stream_open".to_string(),
                args: json!({ "durationMs": 90_000_u64, "maxBytes": 9_000_000_u64 }),
            })
            .expect("invoke ok")
            .expect("media handled");
        assert_eq!(response.status, "requires_approval");
        assert!(response.stream_id.is_some());
        assert_eq!(response.payload_bytes, Some(0));
        assert!(
            response
                .audit_summary
                .as_deref()
                .is_some_and(|summary| summary.contains("durationMs=30000"))
        );
    }
}
