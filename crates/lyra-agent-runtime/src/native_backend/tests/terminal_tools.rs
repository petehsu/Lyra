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
fn terminal_host_mapping_exists_for_every_terminal_tool() {
    let expected = [
        ("terminal_list", "terminal.list", "list"),
        ("terminal_create", "terminal.create", "create"),
        ("terminal_read", "terminal.read", "read"),
        ("terminal_screen", "terminal.screen", "screen"),
        ("terminal_wait", "terminal.wait", "wait"),
        ("terminal_write", "terminal.write", "write"),
        ("terminal_close", "terminal.close", "close"),
        ("terminal_events", "terminal.events.read", "events"),
        ("terminal_read_until", "terminal.waitUntil", "read_until"),
        ("terminal_run", "terminal.input.execute", "run"),
        ("terminal_input", "terminal.input.execute", "input"),
        ("terminal_keys", "terminal.input.execute", "keys"),
        ("terminal_resize", "terminal.resize", "resize"),
        ("terminal_signal", "terminal.processes.signal", "signal"),
        ("terminal_processes", "terminal.processes.read", "processes"),
        (
            "terminal_command_status",
            "terminal.command.status",
            "command_status",
        ),
        ("terminal_map", "terminal.map.read", "map"),
        ("terminal_act", "terminal.act.execute", "act"),
        (
            "terminal_attach_agent",
            "terminal.attachments.attach",
            "attach_agent",
        ),
        (
            "terminal_detach_agent",
            "terminal.attachments.detach",
            "detach_agent",
        ),
    ];

    for (name, method, action) in expected {
        let mapping = host_tool_mapping(
            name,
            json!({
                "sessionId": "terminal-1",
                "runtimeCancellation": {
                    "sessionId": "agent-1",
                    "turnId": "turn-1",
                    "toolCallId": "tool-1"
                }
            }),
        )
        .unwrap_or_else(|| panic!("{name} maps to host capability"));
        assert_eq!(mapping.0, method);
        assert_eq!(mapping.1, "terminal");
        assert_eq!(mapping.2, action);
        assert_eq!(mapping.3["action"].as_str(), Some(action));
        assert_eq!(
            mapping
                .3
                .pointer("/runtimeCancellation/toolCallId")
                .and_then(Value::as_str),
            Some("tool-1")
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
