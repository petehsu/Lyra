use super::*;

const TERMINAL_TOOLS: &[&str] = &[
    "terminal_list",
    "terminal_create",
    "terminal_read",
    "terminal_screen",
    "terminal_wait",
    "terminal_write",
    "terminal_close",
    "terminal_events",
    "terminal_read_until",
    "terminal_run",
    "terminal_input",
    "terminal_keys",
    "terminal_resize",
    "terminal_signal",
    "terminal_processes",
    "terminal_command_status",
    "terminal_map",
    "terminal_act",
    "terminal_attach_agent",
    "terminal_detach_agent",
];

#[test]
fn terminal_schema_registry_exposes_complete_agent_surface() {
    let spec_names = terminal_tool_names().collect::<Vec<_>>();
    assert_eq!(spec_names, TERMINAL_TOOLS);
    assert_eq!(terminal_tool_specs().len(), TERMINAL_TOOLS.len());

    let service = ToolActivityService::default();
    let descriptors = service.model_tool_descriptors();
    let names = descriptors
        .iter()
        .map(|descriptor| descriptor.name.as_str())
        .collect::<Vec<_>>();

    for name in TERMINAL_TOOLS {
        assert!(names.contains(name), "{name} exposed by registry");
        let descriptor = descriptors
            .iter()
            .find(|descriptor| descriptor.name == *name)
            .expect("descriptor");
        assert_eq!(descriptor.schema["type"].as_str(), Some("object"));
        assert!(
            descriptor.schema["properties"].is_object(),
            "{name} has object properties"
        );
    }
}

#[test]
fn terminal_tool_fs_targets_exist_for_every_terminal_action() {
    let expected = [
        ("terminal.list", "list"),
        ("terminal.create", "create"),
        ("terminal.read", "read"),
        ("terminal.screen", "screen"),
        ("terminal.wait", "wait"),
        ("terminal.write", "write"),
        ("terminal.close", "close"),
        ("terminal.events.read", "events"),
        ("terminal.waitUntil", "read_until"),
        ("terminal.input.execute", "run"),
        ("terminal.input.execute", "input"),
        ("terminal.input.execute", "keys"),
        ("terminal.resize", "resize"),
        ("terminal.processes.signal", "signal"),
        ("terminal.processes.read", "processes"),
        ("terminal.command.status", "command_status"),
        ("terminal.map.read", "map"),
        ("terminal.act.execute", "act"),
        ("terminal.attachments.attach", "attach_agent"),
        ("terminal.attachments.detach", "detach_agent"),
    ];

    let registry = tool_fs::runtime_registry();
    for (method, action) in expected {
        let path = format!("/tools/terminal/{action}");
        let manifest = registry
            .inspect_path(&path)
            .unwrap_or_else(|_| panic!("{path} has a manifest"));
        assert_eq!(manifest.domain, "terminal");
        assert_eq!(manifest.operation, action);
        let spec = terminal_action_spec(action)
            .unwrap_or_else(|| panic!("{action} has a terminal action spec"));
        assert_eq!(spec.host_method, method);
        assert!(
            matches!(
                tool_fs::runtime_target_for_manifest(&manifest),
                Some(tool_fs::RuntimeToolTarget::HostAdapter {
                    display_name: "terminal",
                    action: resolved_action,
                    ..
                }) if resolved_action == action
            ),
            "{path} resolves to terminal host adapter"
        );
    }
}

#[test]
fn terminal_permission_policy_covers_every_terminal_action() {
    for action in [
        "list",
        "create",
        "read",
        "screen",
        "wait",
        "events",
        "read_until",
        "processes",
        "command_status",
        "map",
    ] {
        assert_eq!(
            permission_risk("terminal", action, &json!({ "sessionId": "terminal-1" })),
            None,
            "{action} is read-only"
        );
    }

    assert_eq!(
        permission_risk("terminal", "create", &json!({ "command": "npm test" })),
        Some("shell".to_string())
    );
    assert_eq!(
        permission_risk("terminal", "run", &json!({ "command": "npm test" })),
        Some("shell".to_string())
    );

    for action in [
        "input",
        "keys",
        "resize",
        "signal",
        "act",
        "attach_agent",
        "detach_agent",
    ] {
        assert_eq!(
            permission_risk("terminal", action, &json!({ "sessionId": "terminal-1" })),
            Some("dangerous".to_string()),
            "{action} requires policy"
        );
    }

    assert_eq!(
        permission_risk("terminal", "close", &json!({ "sessionId": "terminal-1" })),
        Some("shell".to_string())
    );
}

#[test]
fn terminal_permission_summary_uses_semantic_fields_not_raw_input_bytes() {
    let summary = permission_summary(
        "terminal",
        "input",
        &json!({
            "sessionId": "terminal-1",
            "text": "secret-token-123",
            "appendNewline": true
        }),
    );

    assert!(summary.contains("terminal.input"));
    assert!(summary.contains("sessionId=terminal-1"));
    assert!(summary.contains("textBytes=16"));
    assert!(!summary.contains("secret-token-123"));
}
