use super::*;
use lyra_hardware_core::{
    HardwareActionRequest, HardwareCapabilitiesRequest, HardwareInspectRequest,
    HardwareListRequest, HardwareOsStatusRequest, HardwarePermissionRequest, HardwareService,
    HardwareSessionConfig, HardwareSessionReadRequest, HardwareSessionWriteRequest,
};

static HARDWARE_SERVICE: OnceLock<HardwareService> = OnceLock::new();

pub(crate) fn tool_hardware_list(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwareListRequest>(input)?;
    let response = hardware_service().list(request)?;
    Ok(NativeToolSuccess {
        content: format!("Hardware devices found: {}", response.devices.len()),
        raw: serde_json::to_value(response).unwrap_or(Value::Null),
        recommended_next_action: Some(
            "Inspect a device before opening a serial session or running hardware actions."
                .to_string(),
        ),
    })
}

pub(crate) fn tool_hardware_capabilities(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwareCapabilitiesRequest>(input)?;
    let response = hardware_service().capabilities(request)?;
    Ok(NativeToolSuccess {
        content: format!(
            "Hardware capabilities found: {}",
            response.capabilities.len()
        ),
        raw: serde_json::to_value(response).unwrap_or(Value::Null),
        recommended_next_action: Some(
            "Inspect the target device before invoking mutating hardware capabilities.".to_string(),
        ),
    })
}

pub(crate) fn tool_hardware_inspect(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwareInspectRequest>(input)?;
    let response = hardware_service().inspect(request)?;
    let missing = response.missing_tools.join(", ");
    Ok(NativeToolSuccess {
        content: if missing.is_empty() {
            format!("Hardware device inspected: {}", response.device.title)
        } else {
            format!(
                "Hardware device inspected: {}. Missing toolchains: {missing}",
                response.device.title
            )
        },
        raw: serde_json::to_value(response).unwrap_or(Value::Null),
        recommended_next_action: Some(
            "Open a hardware session for serial logs, or request approval before write/flash actions."
                .to_string(),
        ),
    })
}

pub(crate) fn tool_hardware_os_status(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwareOsStatusRequest>(input)?;
    let response = hardware_service().os_status(request)?;
    Ok(NativeToolSuccess {
        content: format!(
            "Hardware OS status: {} {} with {} permissions tracked.",
            response.platform,
            response.arch,
            response.permissions.len()
        ),
        raw: serde_json::to_value(response).unwrap_or(Value::Null),
        recommended_next_action: Some(
            "Request missing OS permissions before invoking media or global input actions."
                .to_string(),
        ),
    })
}

pub(crate) fn tool_hardware_permissions_request(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwarePermissionRequest>(input)?;
    let response = hardware_service().permissions_request(request)?;
    Ok(NativeToolSuccess {
        content: format!(
            "Hardware OS permission {}: {}.",
            response.permission_id, response.status
        ),
        raw: serde_json::to_value(response).unwrap_or(Value::Null),
        recommended_next_action: Some(
            "Follow the platform guidance if the OS permission remains blocked.".to_string(),
        ),
    })
}

pub(crate) fn tool_hardware_session_open(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwareSessionConfig>(input)?;
    let response = hardware_service().session_open(request)?;
    Ok(NativeToolSuccess {
        content: format!(
            "Hardware serial session opened: {} at {} baud.",
            response.path, response.baud_rate
        ),
        raw: serde_json::to_value(response).unwrap_or(Value::Null),
        recommended_next_action: Some("Read the session output before sending input.".to_string()),
    })
}

pub(crate) fn tool_hardware_session_read(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwareSessionReadRequest>(input)?;
    let response = hardware_service().session_read(request)?;
    Ok(NativeToolSuccess {
        content: if response.text.is_empty() {
            "No hardware session output is currently buffered.".to_string()
        } else {
            response.text.clone()
        },
        raw: serde_json::to_value(response).unwrap_or(Value::Null),
        recommended_next_action: None,
    })
}

pub(crate) fn tool_hardware_session_write(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwareSessionWriteRequest>(input)?;
    let response = hardware_service().session_write(request)?;
    Ok(NativeToolSuccess {
        content: format!(
            "Wrote {} bytes to hardware session.",
            response.bytes_written
        ),
        raw: serde_json::to_value(response).unwrap_or(Value::Null),
        recommended_next_action: Some(
            "Read the session output to observe the device response.".to_string(),
        ),
    })
}

pub(crate) fn tool_hardware_session_close(input: &Value) -> NativeToolResult {
    let session_id = required_value_string(input, "sessionId")?;
    hardware_service().session_close(&session_id)?;
    Ok(NativeToolSuccess {
        content: format!("Hardware session closed: {session_id}"),
        raw: json!({ "sessionId": session_id, "closed": true }),
        recommended_next_action: None,
    })
}

pub(crate) fn tool_hardware_run_action(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwareActionRequest>(input)?;
    let response = hardware_service().run_action(request)?;
    hardware_action_success(response)
}

pub(crate) fn tool_hardware_invoke(input: &Value) -> NativeToolResult {
    let request = parse_hardware_input::<HardwareActionRequest>(input)?;
    let response = hardware_service().invoke(request)?;
    hardware_action_success(response)
}

fn hardware_action_success(
    response: lyra_hardware_core::HardwareActionResponse,
) -> NativeToolResult {
    Ok(NativeToolSuccess {
        content: format!("Hardware action {}: {}", response.action, response.status),
        raw: serde_json::to_value(response).unwrap_or(Value::Null),
        recommended_next_action: Some(
            "If the action reports a missing toolchain, request approved installation before retrying."
                .to_string(),
        ),
    })
}

fn hardware_service() -> &'static HardwareService {
    HARDWARE_SERVICE.get_or_init(HardwareService::default)
}

fn parse_hardware_input<T: for<'de> Deserialize<'de>>(
    input: &Value,
) -> Result<T, NativeToolFailure> {
    serde_json::from_value(input.clone()).map_err(|error| {
        NativeToolFailure::new(
            "bad_hardware_request",
            format!("invalid hardware request: {error}"),
            "Retry with arguments matching the hardware tool schema.",
        )
    })
}

impl From<lyra_hardware_core::HardwareError> for NativeToolFailure {
    fn from(error: lyra_hardware_core::HardwareError) -> Self {
        NativeToolFailure::new(
            error.code(),
            error.to_string(),
            "Inspect connected devices, verify permissions, and retry with a supported hardware action.",
        )
    }
}
