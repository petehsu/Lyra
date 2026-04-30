use crate::JsonSchema;
use crate::ResponsesApiTool;
use crate::ToolSpec;
use std::collections::BTreeMap;

pub const PLAN_SUBMIT_TOOL_NAME: &str = "plan_submit";

pub fn create_update_plan_tool() -> ToolSpec {
    let plan_item_properties = BTreeMap::from([
        ("step".to_string(), JsonSchema::string(/*description*/ None)),
        (
            "status".to_string(),
            JsonSchema::string(Some("One of: pending, in_progress, completed".to_string())),
        ),
    ]);

    let properties = BTreeMap::from([
        (
            "explanation".to_string(),
            JsonSchema::string(/*description*/ None),
        ),
        (
            "plan".to_string(),
            JsonSchema::array(
                JsonSchema::object(
                    plan_item_properties,
                    Some(vec!["step".to_string(), "status".to_string()]),
                    Some(false.into()),
                ),
                Some("The list of steps".to_string()),
            ),
        ),
    ]);

    ToolSpec::Function(ResponsesApiTool {
        name: "update_plan".to_string(),
        description: r#"Updates the task plan.
Provide an optional explanation and a list of plan items, each with a step and status.
At most one step can be in_progress at a time.
"#
        .to_string(),
        strict: false,
        defer_loading: None,
        parameters: JsonSchema::object(
            properties,
            Some(vec!["plan".to_string()]),
            Some(false.into()),
        ),
        output_schema: None,
    })
}

pub fn create_plan_submit_tool() -> ToolSpec {
    let properties = BTreeMap::from([
        (
            "summary".to_string(),
            JsonSchema::string(Some(
                "One sentence summary of the complete proposed plan.".to_string(),
            )),
        ),
        (
            "plan_markdown".to_string(),
            JsonSchema::string(Some(
                "The complete Markdown plan to submit for user approval.".to_string(),
            )),
        ),
    ]);

    ToolSpec::Function(ResponsesApiTool {
        name: PLAN_SUBMIT_TOOL_NAME.to_string(),
        description: r#"Submit the final Plan Mode proposal for user approval.
Use this only when the plan is decision complete. After calling it, wait for the user to approve, reject, or ask for more planning.
"#
        .to_string(),
        strict: false,
        defer_loading: None,
        parameters: JsonSchema::object(
            properties,
            Some(vec!["summary".to_string(), "plan_markdown".to_string()]),
            Some(false.into()),
        ),
        output_schema: None,
    })
}

#[cfg(test)]
#[path = "plan_tool_tests.rs"]
mod plan_tool_tests;
