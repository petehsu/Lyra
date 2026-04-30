use super::*;

#[test]
fn plan_submit_tool_requires_summary_and_plan_markdown() {
    let ToolSpec::Function(tool) = create_plan_submit_tool() else {
        panic!("plan_submit should be a function tool");
    };

    assert_eq!(tool.name, PLAN_SUBMIT_TOOL_NAME);
    assert_eq!(
        tool.parameters.required.as_deref(),
        Some(&["summary".to_string(), "plan_markdown".to_string()][..])
    );

    let properties = tool
        .parameters
        .properties
        .as_ref()
        .expect("plan_submit should use an object schema");
    assert!(properties.contains_key("summary"));
    assert!(properties.contains_key("plan_markdown"));
}
