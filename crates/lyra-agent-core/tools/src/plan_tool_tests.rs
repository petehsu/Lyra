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
    assert!(properties.contains_key("plan"));
    assert!(properties.contains_key("questions"));
    assert!(!properties.contains_key("summary"));
    assert!(!properties.contains_key("markdown"));
    assert!(!properties.contains_key(&format!("{}{}", "plan_", "markdown")));

    let action_values = properties
        .get("action")
        .and_then(|schema| schema.enum_values.as_ref())
        .expect("action should be an enum");
    assert!(action_values.contains(&serde_json::json!("ask")));
    assert!(action_values.contains(&serde_json::json!("draft")));
    assert!(action_values.contains(&serde_json::json!("propose")));
    assert!(!action_values.contains(&serde_json::json!("submit")));

    let plan_properties = properties
        .get("plan")
        .and_then(|schema| schema.properties.as_ref())
        .expect("plan should be an object schema");
    assert!(plan_properties.contains_key("planId"));
    assert!(plan_properties.contains_key("acceptanceCriteria"));
}
