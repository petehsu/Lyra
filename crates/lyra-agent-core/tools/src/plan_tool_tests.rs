use super::*;

#[test]
fn lyra_plan_tool_exposes_structured_plan_actions() {
    let ToolSpec::Function(tool) = create_lyra_plan_tool() else {
        panic!("lyra_plan should be a function tool");
    };

    assert_eq!(tool.name, LYRA_PLAN_TOOL_NAME);
    assert_eq!(
        tool.parameters.required.as_deref(),
        Some(&["action".to_string()][..])
    );

    let properties = tool
        .parameters
        .properties
        .as_ref()
        .expect("lyra_plan should use an object schema");
    assert!(properties.contains_key("action"));
    assert!(properties.contains_key("summary"));
    assert!(properties.contains_key("markdown"));
    assert!(properties.contains_key("questions"));
    assert!(!properties.contains_key(&format!("{}{}", "plan_", "markdown")));
}
