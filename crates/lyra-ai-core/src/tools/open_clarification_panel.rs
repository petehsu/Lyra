use super::{bool_schema, object_schema, string_schema, AgentTool, JsonSchema, ToolContext};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Default)]
pub struct OpenClarificationPanelTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenClarificationPanelInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub presentation: Option<String>,
    #[serde(default)]
    pub blocks_execution: Option<bool>,
    #[serde(default)]
    pub blocked_operation_ids: Vec<String>,
    pub questions: Vec<OpenClarificationQuestionInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenClarificationQuestionInput {
    #[serde(default)]
    pub title: Option<String>,
    pub question: String,
    pub why_it_matters: String,
    #[serde(default)]
    pub question_type: Option<String>,
    #[serde(default)]
    pub reason_code: Option<String>,
    #[serde(default)]
    pub target_summary: Option<String>,
    pub options: Vec<OpenClarificationOptionInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenClarificationOptionInput {
    pub id: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub recommended: Option<bool>,
}

impl JsonSchema for OpenClarificationPanelInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                (
                    "title",
                    string_schema("Panel title shown to the requester."),
                ),
                (
                    "description",
                    string_schema("Short explanation of why execution is blocked or degraded."),
                ),
                (
                    "presentation",
                    string_schema("modal, side_panel, or inline_card."),
                ),
                (
                    "blocksExecution",
                    bool_schema("Whether affected execution must pause until answered."),
                ),
                (
                    "blockedOperationIds",
                    json!({
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Tool or runtime operation ids blocked by this panel."
                    }),
                ),
                (
                    "questions",
                    json!({
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 3,
                        "items": OpenClarificationQuestionInput::json_schema(),
                        "description": "One to three focused questions."
                    }),
                ),
            ],
            &["questions"],
        )
    }
}

impl JsonSchema for OpenClarificationQuestionInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                ("title", string_schema("Short question title.")),
                ("question", string_schema("Specific question to answer.")),
                (
                    "whyItMatters",
                    string_schema("Why this answer affects the result, safety, scope, or acceptance."),
                ),
                (
                    "questionType",
                    string_schema("goal, scope, acceptance, environment, permission, risk, data, design, dependency, recovery, or preference."),
                ),
                (
                    "reasonCode",
                    string_schema("Stable runtime reason code for audit."),
                ),
                (
                    "targetSummary",
                    string_schema("Affected target, operation, file, VM, plan, or todo summary."),
                ),
                (
                    "options",
                    json!({
                        "type": "array",
                        "minItems": 4,
                        "maxItems": 4,
                        "items": OpenClarificationOptionInput::json_schema(),
                        "description": "Exactly A/B/C/D options."
                    }),
                ),
            ],
            &["question", "whyItMatters", "options"],
        )
    }
}

impl JsonSchema for OpenClarificationOptionInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                ("id", string_schema("A, B, C, or D.")),
                ("label", string_schema("Short option label.")),
                (
                    "description",
                    string_schema("Concrete consequence of choosing this option."),
                ),
                (
                    "recommended",
                    bool_schema("True when Lyra recommends this option."),
                ),
            ],
            &["id", "label", "description"],
        )
    }
}

impl AgentTool for OpenClarificationPanelTool {
    const NAME: &'static str = "open_clarification_panel";
    type Input = OpenClarificationPanelInput;
    type Output = Value;

    fn description() -> &'static str {
        "Open a structured Clarification Panel with one to three QuestionTickets. Use this instead of asking in normal chat text when execution depends on missing information."
    }

    fn run(&self, _input: Self::Input, _ctx: &ToolContext) -> Result<Self::Output> {
        Ok(json!({ "status": "runtime_handled" }))
    }
}
