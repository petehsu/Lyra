use super::*;

const HARDWARE_TOOL_PATHS: &[(&str, &str)] = &[
    ("/tools/hardware/list", "list"),
    ("/tools/hardware/inspect", "inspect"),
    ("/tools/hardware/capabilities", "capabilities"),
    ("/tools/hardware/os_status", "os_status"),
    ("/tools/hardware/permissions_request", "permissions_request"),
    ("/tools/hardware/session_open", "session_open"),
    ("/tools/hardware/session_read", "session_read"),
    ("/tools/hardware/session_write", "session_write"),
    ("/tools/hardware/session_close", "session_close"),
    ("/tools/hardware/invoke", "invoke"),
    ("/tools/hardware/run_action", "run_action"),
];

#[test]
fn hardware_tool_fs_targets_exist_for_every_action() {
    let registry = tool_fs::runtime_registry();
    for (path, action) in HARDWARE_TOOL_PATHS {
        let manifest = registry
            .inspect_path(path)
            .unwrap_or_else(|_| panic!("{path} has a manifest"));
        assert_eq!(manifest.domain, "hardware");
        assert_eq!(manifest.operation, *action);
        assert!(
            matches!(
                tool_fs::runtime_target_for_manifest(&manifest),
                Some(tool_fs::RuntimeToolTarget::NativeAdapter {
                    display_name: "hardware",
                    action: resolved_action,
                    ..
                }) if resolved_action == *action
            ),
            "{path} resolves to hardware native adapter"
        );
    }
}

#[test]
fn hardware_permissions_cover_read_write_flash_and_install() {
    assert_eq!(
        permission_risk("hardware", "list", &json!({})),
        None,
        "hardware list is read-only"
    );
    assert_eq!(
        permission_risk("hardware", "inspect", &json!({ "deviceId": "serial:dev" })),
        None,
        "hardware inspect is read-only"
    );
    assert_eq!(
        permission_risk(
            "hardware",
            "session_open",
            &json!({ "deviceId": "serial:dev", "path": "/dev/ttyUSB0" })
        ),
        Some("hardware.read.stream".to_string())
    );
    assert_eq!(
        permission_risk(
            "hardware",
            "session_write",
            &json!({ "sessionId": "hardware-session-1", "line": "AT" })
        ),
        Some("hardware.write.stream".to_string())
    );
    assert_eq!(
        permission_risk(
            "hardware",
            "run_action",
            &json!({
                "deviceId": "serial:dev",
                "capabilityId": "esp.flash",
                "action": "flash",
                "args": { "firmwarePath": "target/firmware.bin" }
            })
        ),
        Some("hardware.flash".to_string())
    );
    assert_eq!(
        permission_risk(
            "hardware",
            "run_action",
            &json!({
                "capabilityId": "toolchain.install",
                "action": "install",
                "args": { "tool": "esptool" }
            })
        ),
        Some("hardware.toolchain.install".to_string())
    );
}

#[test]
fn hardware_permissions_cover_v11_capability_risks() {
    let cases = [
        ("hid.input_inject", "inject", "hardware.input.inject"),
        (
            "media.camera.capture",
            "capture_frame",
            "hardware.media.capture",
        ),
        (
            "media.camera.capture",
            "stream_open",
            "hardware.media.stream",
        ),
        (
            "input.global_inject",
            "inject",
            "hardware.input.global_inject",
        ),
        (
            "network.interface.configure",
            "configure",
            "hardware.network.configure",
        ),
        ("storage.volume.write", "erase", "hardware.storage.write"),
        ("ble.gatt", "write", "hardware.driver.raw_io"),
    ];
    for (capability_id, action_id, expected) in cases {
        assert_eq!(
            permission_risk(
                "hardware",
                "invoke",
                &json!({
                    "providerId": "test",
                    "deviceId": "test:controller",
                    "capabilityId": capability_id,
                    "actionId": action_id,
                    "args": { "payload": "large payload body" }
                })
            ),
            Some(expected.to_string()),
            "{capability_id}.{action_id} maps to {expected}"
        );
    }
}

#[test]
fn hardware_os_tools_have_expected_permission_policy() {
    assert_eq!(
        permission_risk("hardware", "os_status", &json!({})),
        None,
        "hardware os_status is read-only"
    );
    assert_eq!(
        permission_risk(
            "hardware",
            "permissions_request",
            &json!({ "permissionId": "camera", "providerId": "media_camera" })
        ),
        Some("hardware.os.permission".to_string())
    );
}

#[test]
fn hardware_permission_summary_names_target_without_raw_payload() {
    let summary = permission_summary(
        "hardware",
        "run_action",
        &json!({
            "deviceId": "serial:1a86:7523:/dev/ttyUSB0",
            "path": "/dev/ttyUSB0",
            "baudRate": 115200,
            "capabilityId": "esp.flash",
            "actionId": "flash",
            "providerId": "serial",
            "args": {
                "firmwarePath": "target/firmware.bin",
                "payload": "raw command bytes that should not appear",
                "reason": "do not leak this reason",
                "targetDescription": "do not leak this target",
                "eventLimit": 1,
                "events": [{ "type": "text", "text": "secret" }]
            }
        }),
    );
    assert!(summary.contains("deviceId=serial:1a86:7523:/dev/ttyUSB0"));
    assert!(summary.contains("path=/dev/ttyUSB0"));
    assert!(summary.contains("baudRate=115200"));
    assert!(summary.contains("providerId=serial"));
    assert!(summary.contains("firmwarePath=target/firmware.bin"));
    assert!(summary.contains("payloadBytes=40"));
    assert!(summary.contains("reasonBytes=23"));
    assert!(summary.contains("targetDescriptionBytes=23"));
    assert!(summary.contains("eventLimit=1"));
    assert!(summary.contains("eventCount=1"));
    assert!(!summary.contains("raw command bytes"));
    assert!(!summary.contains("do not leak"));
    assert!(!summary.contains("secret"));
}
