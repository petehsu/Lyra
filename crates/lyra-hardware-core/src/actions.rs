use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{
    HardwareError, HardwareSessionWriteRequest, ToolchainDetector, ToolchainStatus,
    session::HardwareSessionRegistry,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareActionRequest {
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    pub capability_id: String,
    #[serde(default)]
    pub action_id: Option<String>,
    pub action: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareActionResponse {
    pub status: String,
    pub action: String,
    #[serde(default)]
    pub detail: Value,
    #[serde(default)]
    pub stream_id: Option<String>,
    #[serde(default)]
    pub artifact_ref: Option<String>,
    #[serde(default)]
    pub payload_bytes: Option<usize>,
    #[serde(default)]
    pub payload_sha256: Option<String>,
    #[serde(default)]
    pub os_permission_state: Option<String>,
    #[serde(default)]
    pub driver_backend: Option<String>,
    #[serde(default)]
    pub audit_summary: Option<String>,
    #[serde(default)]
    pub missing_requirements: Vec<String>,
    #[serde(default)]
    pub needs_user_action: Option<Value>,
}

pub(crate) fn run_action(
    sessions: &mut HardwareSessionRegistry,
    toolchains: &dyn ToolchainDetector,
    request: HardwareActionRequest,
) -> Result<HardwareActionResponse, HardwareError> {
    let action = request.action_id.as_deref().unwrap_or(&request.action);
    match (request.capability_id.as_str(), action) {
        ("serial.uart" | "micropython.repl", "write_line") => {
            let session_id = request.session_id.clone().ok_or_else(|| {
                HardwareError::new("bad_hardware_action", "sessionId is required")
            })?;
            let line = request
                .args
                .get("text")
                .and_then(Value::as_str)
                .ok_or_else(|| HardwareError::new("bad_hardware_action", "args.text is required"))?
                .to_string();
            let written = sessions.write(HardwareSessionWriteRequest {
                session_id,
                text: None,
                line: Some(line),
            })?;
            Ok(HardwareActionResponse {
                status: "completed".to_string(),
                action: action.to_string(),
                detail: json!({ "bytesWritten": written.bytes_written }),
                stream_id: None,
                artifact_ref: None,
                payload_bytes: Some(written.bytes_written),
                payload_sha256: None,
                os_permission_state: None,
                driver_backend: Some("serialport".to_string()),
                audit_summary: Some("serial write_line".to_string()),
                missing_requirements: Vec::new(),
                needs_user_action: None,
            })
        }
        ("esp.flash", "flash") => {
            let available = toolchains.detect().into_iter().any(|tool| {
                tool.name == "esptool" && matches!(tool.status, ToolchainStatus::Available)
            });
            let firmware = request.args.get("firmwarePath").and_then(Value::as_str);
            Ok(HardwareActionResponse {
                status: if available { "ready" } else { "blocked" }.to_string(),
                action: action.to_string(),
                detail: json!({
                    "deviceId": request.device_id,
                    "firmwarePath": firmware,
                    "requiredTool": "esptool",
                    "toolAvailable": available,
                }),
                stream_id: None,
                artifact_ref: None,
                payload_bytes: None,
                payload_sha256: None,
                os_permission_state: None,
                driver_backend: Some("esptool".to_string()),
                audit_summary: Some(format!(
                    "esp.flash firmwarePath={} toolAvailable={available}",
                    firmware.unwrap_or("<missing>")
                )),
                missing_requirements: if available {
                    Vec::new()
                } else {
                    vec!["toolchain:esptool".to_string()]
                },
                needs_user_action: (!available).then(|| {
                    json!({
                        "kind": "hardware_toolchain_install",
                        "tool": "esptool",
                        "reason": "ESP flashing requires esptool before firmware can be written."
                    })
                }),
            })
        }
        ("toolchain.install", "install") => Ok(HardwareActionResponse {
            status: "requires_approval".to_string(),
            action: action.to_string(),
            detail: json!({
                "tool": request.args.get("tool").and_then(Value::as_str),
                "message": "Tool installation is routed through an approved shell command by the Agent host."
            }),
            stream_id: None,
            artifact_ref: None,
            payload_bytes: None,
            payload_sha256: None,
            os_permission_state: None,
            driver_backend: Some("shell".to_string()),
            audit_summary: Some(format!(
                "toolchain.install tool={}",
                request
                    .args
                    .get("tool")
                    .and_then(Value::as_str)
                    .unwrap_or("<missing>")
            )),
            missing_requirements: Vec::new(),
            needs_user_action: Some(json!({
                "kind": "hardware_toolchain_install",
                "tool": request.args.get("tool").and_then(Value::as_str),
            })),
        }),
        _ => Err(HardwareError::new(
            "unsupported_hardware_action",
            format!(
                "unsupported hardware action {}.{}",
                request.capability_id, action
            ),
        )),
    }
}
