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
    let block_props = BTreeMap::from([
        (
            "id".to_string(),
            JsonSchema::string(Some(
                "Stable block id. Keep the same id when revising the same plan block.".to_string(),
            )),
        ),
        (
            "kind".to_string(),
            JsonSchema::string(Some(
                "Block kind, for example assumption, step, interface, risk, test, or acceptanceCriterion.".to_string(),
            )),
        ),
        (
            "title".to_string(),
            JsonSchema::string(Some("Short block title.".to_string())),
        ),
        (
            "body".to_string(),
            JsonSchema::string(Some(
                "Detailed professional planning content for this block.".to_string(),
            )),
        ),
    ]);
    let block_schema = JsonSchema::object(
        block_props,
        Some(vec![
            "id".to_string(),
            "kind".to_string(),
            "title".to_string(),
            "body".to_string(),
        ]),
        Some(false.into()),
    );
    let block_array =
        |description: &str| JsonSchema::array(block_schema.clone(), Some(description.to_string()));
    let plan_props = BTreeMap::from([
        (
            "planId".to_string(),
            JsonSchema::string(Some(
                "Stable id for this plan artifact and later approval payloads.".to_string(),
            )),
        ),
        (
            "status".to_string(),
            JsonSchema::string_enum(
                vec![
                    json!("draft"),
                    json!("proposed"),
                    json!("approved"),
                    json!("rejected"),
                ],
                Some(
                    "Artifact status. draft/propose calls may send any value; Lyra normalizes it."
                        .to_string(),
                ),
            ),
        ),
        (
            "title".to_string(),
            JsonSchema::string(Some("Concise plan title.".to_string())),
        ),
        (
            "summary".to_string(),
            JsonSchema::string(Some("Short executive summary.".to_string())),
        ),
        (
            "objective".to_string(),
            JsonSchema::string(Some(
                "Concrete objective the implementation must achieve.".to_string(),
            )),
        ),
        (
            "assumptions".to_string(),
            block_array("Assumptions that shape the plan."),
        ),
        (
            "steps".to_string(),
            block_array("Ordered implementation or investigation steps."),
        ),
        (
            "interfaces".to_string(),
            block_array("APIs, data contracts, UI surfaces, files, or module boundaries affected."),
        ),
        (
            "risks".to_string(),
            block_array("Important risks, tradeoffs, and mitigations."),
        ),
        (
            "tests".to_string(),
            block_array("Verification plan and targeted tests."),
        ),
        (
            "acceptanceCriteria".to_string(),
            block_array("User-visible acceptance criteria."),
        ),
    ]);
    let plan_schema = JsonSchema::object(
        plan_props,
        Some(vec![
            "planId".to_string(),
            "status".to_string(),
            "title".to_string(),
            "summary".to_string(),
            "objective".to_string(),
            "assumptions".to_string(),
            "steps".to_string(),
            "interfaces".to_string(),
            "risks".to_string(),
            "tests".to_string(),
            "acceptanceCriteria".to_string(),
        ]),
        Some(false.into()),
    );

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
                vec![json!("ask"), json!("draft"), json!("propose")],
                Some("Plan operation to perform.".to_string()),
            ),
        ),
        ("plan".to_string(), {
            let mut schema = plan_schema;
            schema.description = Some(
                "Structured plan artifact. Required for action=\"draft\" and action=\"propose\"."
                    .to_string(),
            );
            schema
        }),
        ("questions".to_string(), questions_schema),
    ]);

    ToolSpec::Function(ResponsesApiTool {
        name: LYRA_PLAN_TOOL_NAME.to_string(),
        description: r#"Structured Plan Mode tool.
Use action="ask" to request user input, action="draft" to record a visible non-approvable structured draft, and action="propose" to submit the complete approvable structured plan. Do not describe the official plan in a plain assistant message; propose it through this tool.
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
