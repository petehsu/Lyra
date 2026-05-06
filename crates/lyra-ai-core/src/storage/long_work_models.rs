use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLongWorkGoal {
    pub goal_id: String,
    pub session_id: String,
    pub status: String,
    pub objective_summary: String,
    pub completion_contract: Value,
    pub budget: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLongWorkTodoProgress {
    pub total: i64,
    pub completed: i64,
    pub blocked: i64,
    pub failed: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkSliceSummary {
    pub work_slice_id: String,
    pub status: String,
    pub todo_list_id: String,
    pub execution_run_id: String,
    pub checkpoint_ids: Vec<String>,
    pub blocker_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLongWorkSummary {
    pub long_work_run_id: String,
    pub goal_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_id: Option<String>,
    pub todo_list_id: String,
    pub execution_run_id: String,
    pub status: String,
    pub objective_summary: String,
    pub todo_progress: AgentLongWorkTodoProgress,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocker_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_slice: Option<AgentWorkSliceSummary>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub type SessionTaskLedgerSummary = AgentLongWorkSummary;

#[derive(Clone, Debug)]
pub struct CreateLongWorkRunInput {
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    pub user_message_id: Option<String>,
    pub plan_id: Option<String>,
    pub todo_list_id: String,
    pub execution_run_id: String,
    pub objective_summary: String,
    pub completion_contract: Value,
    pub budget: Value,
    pub checkpoint_ids: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct CreatedLongWorkRun {
    pub summary: AgentLongWorkSummary,
}

#[derive(Clone, Debug)]
pub struct LongWorkStatusUpdate {
    pub status: String,
    pub checkpoint_ids: Vec<String>,
    pub blocker_ids: Vec<String>,
}
