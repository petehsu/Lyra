use crate::JsonSchema;
use crate::ResponsesApiTool;
use crate::ToolSpec;
use serde_json::json;
use std::collections::BTreeMap;

pub const LYRA_PLAN_TOOL_NAME: &str = "lyra_plan";

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

pub fn create_lyra_plan_tool() -> ToolSpec {
    let option_props = BTreeMap::from([
        (
            "label".to_string(),
            JsonSchema::string(Some("User-facing label (1-5 words).".to_string())),
        ),
        (
            "description".to_string(),
            JsonSchema::string(Some(
                "One short sentence explaining impact/tradeoff if selected.".to_string(),
            )),
        ),
    ]);
    let question_props = BTreeMap::from([
        (
            "id".to_string(),
            JsonSchema::string(Some(
                "Stable identifier for mapping answers (snake_case).".to_string(),
            )),
        ),
        (
            "header".to_string(),
            JsonSchema::string(Some("Short header label shown in the UI.".to_string())),
        ),
        (
            "question".to_string(),
            JsonSchema::string(Some(
                "Single-sentence prompt shown to the user.".to_string(),
            )),
        ),
        (
            "options".to_string(),
            JsonSchema::array(
                JsonSchema::object(
                    option_props,
                    Some(vec!["label".to_string(), "description".to_string()]),
                    Some(false.into()),
                ),
                Some("Two or three mutually exclusive choices.".to_string()),
            ),
        ),
    ]);
    let questions_schema = JsonSchema::array(
        JsonSchema::object(
            question_props,
            Some(vec![
                "id".to_string(),
                "header".to_string(),
                "question".to_string(),
                "options".to_string(),
            ]),
            Some(false.into()),
        ),
        Some("Structured questions for action=\"ask\". Prefer one question.".to_string()),
    );

    let properties = BTreeMap::from([
        (
            "action".to_string(),
            JsonSchema::string_enum(
                vec![json!("draft"), json!("ask"), json!("submit")],
                Some("Plan operation to perform.".to_string()),
            ),
        ),
        (
            "summary".to_string(),
            JsonSchema::string(Some(
                "One sentence summary for action=\"submit\".".to_string(),
            )),
        ),
        (
            "markdown".to_string(),
            JsonSchema::string(Some(
                "Markdown draft or final plan. Required for action=\"submit\".".to_string(),
            )),
        ),
        ("questions".to_string(), questions_schema),
    ]);

    ToolSpec::Function(ResponsesApiTool {
        name: LYRA_PLAN_TOOL_NAME.to_string(),
        description: r#"Structured Plan Mode tool.
Use action="ask" to request user input, action="draft" to record draft planning state, and action="submit" to submit the complete approvable plan. Do not describe the final plan in a plain assistant message; submit it through this tool.
"#
        .to_string(),
        strict: false,
        defer_loading: None,
        parameters: JsonSchema::object(
            properties,
            Some(vec!["action".to_string()]),
            Some(false.into()),
        ),
        output_schema: None,
    })
}

#[cfg(test)]
#[path = "plan_tool_tests.rs"]
mod plan_tool_tests;
