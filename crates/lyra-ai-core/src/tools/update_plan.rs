use super::{
    object_schema, string_array_schema, string_schema, AgentTool, JsonSchema, ToolContext,
};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Default)]
pub struct UpdatePlanTool;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePlanInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub objective_summary: Option<String>,
    pub steps: Vec<UpdatePlanStepInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdatePlanStepInput {
    #[serde(default)]
    pub id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub expected_tools: Vec<String>,
    #[serde(default)]
    pub risk_level: Option<String>,
    #[serde(default)]
    pub completion_criteria: Vec<String>,
}

impl JsonSchema for UpdatePlanInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                ("title", string_schema("Short plan title.")),
                (
                    "objectiveSummary",
                    string_schema("One-sentence objective summary."),
                ),
                (
                    "steps",
                    json!({
                        "type": "array",
                        "description": "Ordered execution plan steps.",
                        "items": UpdatePlanStepInput::json_schema()
                    }),
                ),
            ],
            &["steps"],
        )
    }
}

impl JsonSchema for UpdatePlanStepInput {
    fn json_schema() -> Value {
        object_schema(
            vec![
                ("id", string_schema("Stable step id.")),
                ("title", string_schema("Step title.")),
                (
                    "status",
                    string_schema("pending, in_progress, completed, or blocked."),
                ),
                ("actions", string_array_schema("Concrete actions.")),
                ("expectedTools", string_array_schema("Expected tool paths.")),
                ("riskLevel", string_schema("low, medium, or high.")),
                (
                    "completionCriteria",
                    string_array_schema("Evidence required to complete the step."),
                ),
            ],
            &["title"],
        )
    }
}

impl AgentTool for UpdatePlanTool {
    const NAME: &'static str = "update_plan";
    type Input = UpdatePlanInput;
    type Output = Value;

    fn description() -> &'static str {
        "Create or update a structured execution plan and associated todo steps."
    }

    fn run(&self, input: Self::Input, _ctx: &ToolContext) -> Result<Self::Output> {
        Ok(json!({
            "title": input.title.unwrap_or_else(|| "Execution plan".to_string()),
            "stepCount": input.steps.len()
        }))
    }
}
