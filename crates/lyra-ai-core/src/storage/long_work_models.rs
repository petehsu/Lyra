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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sequence: Option<i64>,
    pub todo_list_id: String,
    pub execution_run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stop_cause: Option<String>,
    pub checkpoint_ids: Vec<String>,
    pub blocker_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress_delta: Option<Value>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentLongWorkContinuationSummary {
    pub continuation_id: String,
    pub status: String,
    pub recommended_action: String,
    pub previous_slice_id: String,
    pub next_slice_sequence: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_summary: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPrematureStopSummary {
    pub report_id: String,
    pub is_premature_stop: bool,
    pub signals: Vec<String>,
    pub open_todo_item_ids: Vec<String>,
    pub missing_evidence: Vec<String>,
    pub recommended_action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suppressed_message_id: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStuckSummary {
    pub stuck_report_id: String,
    pub repeated_failure_count: i64,
    pub no_progress_slice_count: i64,
    pub suspected_cause: String,
    pub recommended_action: String,
    pub evidence_refs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_summary: Option<String>,
    pub created_at: i64,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub continuation: Option<AgentLongWorkContinuationSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub premature_stop: Option<AgentPrematureStopSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stuck: Option<AgentStuckSummary>,
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

#[derive(Clone, Debug)]
pub struct LongWorkCompletionCandidateInput {
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    pub candidate_text: String,
    pub stop_cause: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LongWorkCandidateEvaluation {
    pub summary: Option<AgentLongWorkSummary>,
    pub suppressed: bool,
    pub blocked: bool,
    pub stuck: bool,
    pub report_id: Option<String>,
    pub continuation_id: Option<String>,
    pub stuck_report_id: Option<String>,
    pub event_payload: Value,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct ResumeLongWorkContinuationInput {
    pub session_id: String,
    pub continuation_id: String,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct RecoverLongWorkContinuationInput {
    pub session_id: String,
}
