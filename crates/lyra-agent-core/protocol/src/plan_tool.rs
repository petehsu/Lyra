use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

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
#[ts(rename_all = "snake_case")]
pub enum PlanArtifactStatus {
    Draft,
    Proposed,
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PlanArtifactBlock {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PlanArtifact {
    pub plan_id: String,
    pub status: PlanArtifactStatus,
    pub title: String,
    pub summary: String,
    pub objective: String,
    #[serde(default)]
    pub assumptions: Vec<PlanArtifactBlock>,
    #[serde(default)]
    pub steps: Vec<PlanArtifactBlock>,
    #[serde(default)]
    pub interfaces: Vec<PlanArtifactBlock>,
    #[serde(default)]
    pub risks: Vec<PlanArtifactBlock>,
    #[serde(default)]
    pub tests: Vec<PlanArtifactBlock>,
    #[serde(default)]
    pub acceptance_criteria: Vec<PlanArtifactBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, TS, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct PlanAnnotation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub block_id: Option<String>,
    pub anchor: String,
    pub comment: String,
}
