use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

use crate::request_user_input::RequestUserInputQuestion;

// Types for the TODO tool arguments matching lyra-vscode/todo-mcp/src/main.rs
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct PlanItemArg {
    pub step: String,
    pub status: StepStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS)]
#[serde(deny_unknown_fields)]
pub struct UpdatePlanArgs {
    /// Arguments for the `update_plan` todo/checklist tool (not plan mode).
    #[serde(default)]
    pub explanation: Option<String>,
    pub plan: Vec<PlanItemArg>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LyraPlanAction {
    Draft,
    Ask,
    Submit,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct LyraPlanArgs {
    /// Planning operation to perform.
    pub action: LyraPlanAction,
    /// Short human-readable summary for submitted plans.
    #[serde(default)]
    pub summary: Option<String>,
    /// Markdown draft or final plan content.
    #[serde(default)]
    pub markdown: Option<String>,
    /// Structured questions for `action = "ask"`.
    #[serde(default)]
    pub questions: Option<Vec<RequestUserInputQuestion>>,
}
