use super::*;

const TERMINAL_TOOLS: &[&str] = &[
    "terminal_list",
    "terminal_read",
    // terminal_write is not model-visible; it exists so write_stdin's
    // permission checks (terminal_action_requires_policy("write")) resolve.
    "terminal_write",
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
fn terminal_tool_fs_targets_are_removed_but_action_specs_remain() {
    let registry = tool_fs::runtime_registry();
    for (method, action) in [("terminal.list", "list"), ("terminal.read", "read")] {
        let path = format!("/tools/terminal/{action}");
        assert!(registry.inspect_path(&path).is_err(), "{path} was removed");
        let spec = terminal_action_spec(action)
            .unwrap_or_else(|| panic!("{action} has a terminal action spec"));
        assert_eq!(spec.host_method, method);
    }
}

#[test]
fn terminal_permission_policy_covers_every_terminal_action() {
    for action in ["list", "read"] {
        assert_eq!(
            permission_risk("terminal", action, &json!({ "sessionId": "terminal-1" })),
            None,
            "{action} is read-only"
        );
    }

    assert_eq!(
        permission_risk("terminal", "write", &json!({ "sessionId": "terminal-1" })),
        Some("shell".to_string())
    );
}

#[test]
fn terminal_permission_summary_uses_semantic_fields_not_raw_input_bytes() {
    let summary = permission_summary(
        "terminal",
        "write",
        &json!({
            "sessionId": "terminal-1",
            "text": "secret-token-123",
            "appendNewline": true
        }),
    );

    assert!(summary.contains("terminal.write"));
    assert!(summary.contains("sessionId=terminal-1"));
    assert!(summary.contains("textBytes=16"));
    assert!(!summary.contains("secret-token-123"));
}
