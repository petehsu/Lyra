use serde_json::{Value, json};

use crate::{
    HardwareActionRequest, HardwareActionResponse, HardwareCapability, HardwareDevice,
    HardwareDeviceFilter, HardwareError, HardwareProtocolHint, HardwareProvider,
    HardwareProviderStatus, HardwareTransport,
    providers::os::{driver_backends, os_permissions},
};

#[derive(Default)]
pub struct InputProvider;

impl HardwareProvider for InputProvider {
    fn id(&self) -> &'static str {
        "input"
    }

    fn list_devices(
        &self,
        filter: &HardwareDeviceFilter,
    ) -> Result<Vec<HardwareDevice>, HardwareError> {
        if filter
            .transport
            .as_ref()
            .is_some_and(|transport| transport != &HardwareTransport::Hid)
            || filter
                .provider_id
                .as_deref()
                .is_some_and(|requested| requested != self.id())
            || !filter.include_system
        {
            return Ok(Vec::new());
        }
        Ok(vec![input_device()])
    }

    fn invoke(
        &self,
        request: &HardwareActionRequest,
    ) -> Result<Option<HardwareActionResponse>, HardwareError> {
        if request.capability_id != "input.global_inject" {
            return Ok(None);
        }
        invoke_input(request).map(Some)
    }

    fn status(&self) -> HardwareProviderStatus {
        HardwareProviderStatus {
            provider_id: self.id().to_string(),
            status: "registered".to_string(),
            detail: Some(
                "global input injection backend is gated by OS accessibility/input permissions"
                    .to_string(),
            ),
        }
    }
}

fn input_device() -> HardwareDevice {
    HardwareDevice {
        id: "input:global".to_string(),
        path: "input://global".to_string(),
        title: "Global input controller".to_string(),
        transport: HardwareTransport::Hid,
        provider_id: "input".to_string(),
        transport_path: Some("input://global".to_string()),
        tags: vec![
            "keyboard".to_string(),
            "mouse".to_string(),
            "touchpad".to_string(),
            "system".to_string(),
        ],
        confidence: Some(0.5),
        status: Some("registered".to_string()),
        os_permissions: os_permissions()
            .into_iter()
            .filter(|state| state.id == "accessibility" || state.id == "input_monitoring")
            .collect(),
        driver_backends: driver_backends()
            .into_iter()
            .filter(|driver| driver.id == "hidapi")
            .collect(),
        native_access: Some("global_inject".to_string()),
        platform: Some(std::env::consts::OS.to_string()),
        vendor_id: None,
        product_id: None,
        manufacturer: Some("OS".to_string()),
        product: Some("Global input controller".to_string()),
        serial_number: None,
        protocol_hints: vec![HardwareProtocolHint::HidReports],
        capabilities: vec![HardwareCapability {
            id: "input.global_inject".to_string(),
            title: "Global keyboard, mouse, and touchpad injection".to_string(),
            risk: "hardware.input.global_inject".to_string(),
            permission: Some("hardware.input.global_inject".to_string()),
            risk_level: Some("critical".to_string()),
            input_schema: Some(json!({ "type": "object" })),
            output_schema: Some(json!({ "type": "object" })),
            streaming: false,
            destructive: false,
            os_permission: Some("accessibility".to_string()),
            native_access: Some("global_inject".to_string()),
            actions: vec!["inject".to_string()],
        }],
    }
}

fn invoke_input(request: &HardwareActionRequest) -> Result<HardwareActionResponse, HardwareError> {
    let action = request.action_id.as_deref().unwrap_or(&request.action);
    if action != "inject" {
        return Err(HardwareError::new(
            "unsupported_hardware_action",
            format!("unsupported input action {action}"),
        ));
    }
    let reason = required_arg(&request.args, "reason")?;
    let target = required_arg(&request.args, "targetDescription")?;
    let events = request
        .args
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(|| HardwareError::new("bad_input_injection", "args.events is required"))?;
    if events.is_empty() || events.len() > 200 {
        return Err(HardwareError::new(
            "bad_input_injection",
            "events must contain 1..=200 items",
        ));
    }
    let duration_limit = request
        .args
        .get("durationLimitMs")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let event_limit = request
        .args
        .get("eventLimit")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if duration_limit == 0 && event_limit == 0 {
        return Err(HardwareError::new(
            "bad_input_injection",
            "durationLimitMs or eventLimit is required",
        ));
    }
    Ok(HardwareActionResponse {
        status: "requires_approval".to_string(),
        action: action.to_string(),
        detail: json!({
            "providerId": "input",
            "eventCount": events.len(),
            "durationLimitMs": duration_limit,
            "eventLimit": event_limit,
            "targetDescription": target,
            "reason": reason,
            "message": "Global input injection requires Agent approval and OS accessibility/input permissions.",
        }),
        stream_id: None,
        artifact_ref: None,
        payload_bytes: Some(request.args.to_string().len()),
        payload_sha256: Some("sha256:withheld-input-events".to_string()),
        os_permission_state: Some("unknown".to_string()),
        driver_backend: Some("os_input".to_string()),
        audit_summary: Some(format!(
            "input.global_inject action=inject eventCount={} durationLimitMs={} eventLimit={} targetBytes={} reasonBytes={}",
            events.len(),
            duration_limit,
            event_limit,
            target.len(),
            reason.len()
        )),
        missing_requirements: vec![
            "permission:hardware.input.global_inject".to_string(),
            "os_permission:accessibility".to_string(),
        ],
        needs_user_action: Some(json!({
            "kind": "hardware_input_global_inject",
            "providerId": "input",
            "eventCount": events.len(),
        })),
    })
}

fn required_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, HardwareError> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| HardwareError::new("bad_input_injection", format!("args.{key} is required")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_injection_requires_bounds_and_hides_payload() {
        let response = invoke_input(&HardwareActionRequest {
            device_id: Some("input:global".to_string()),
            session_id: None,
            capability_id: "input.global_inject".to_string(),
            action_id: Some("inject".to_string()),
            action: "inject".to_string(),
            args: json!({
                "reason": "test injection",
                "targetDescription": "test target",
                "eventLimit": 1,
                "events": [{ "type": "text", "text": "secret text" }]
            }),
        })
        .expect("input response");
        assert_eq!(response.status, "requires_approval");
        assert!(
            !response
                .audit_summary
                .as_deref()
                .unwrap_or_default()
                .contains("secret text")
        );
    }
}
