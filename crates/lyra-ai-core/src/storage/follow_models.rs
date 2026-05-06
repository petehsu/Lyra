use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFollowSummary {
    pub follow_session_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub long_work_run_id: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_target: Option<AgentFollowTargetSummary>,
    pub targets: Vec<AgentFollowTargetSummary>,
    pub recent_events: Vec<AgentFollowEventSummary>,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFollowTargetSummary {
    pub follow_target_id: String,
    pub kind: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_ref: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_uri: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_operation_id: Option<String>,
    pub artifact_refs: Vec<String>,
    pub evidence_refs: Vec<String>,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFollowEventSummary {
    pub follow_event_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_target_id: Option<String>,
    pub event_type: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct EnsureFollowSessionInput {
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    pub user_message_id: Option<String>,
    pub long_work_run_id: Option<String>,
    pub status: String,
    pub event_stream_ref: Option<String>,
}

#[derive(Clone, Debug)]
pub struct FollowTargetInput {
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    pub long_work_run_id: Option<String>,
    pub work_slice_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub resource_ref: Option<String>,
    pub workspace_uri: Option<String>,
    pub status: String,
    pub tool_operation_id: Option<String>,
    pub artifact_refs: Vec<String>,
    pub evidence_refs: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct FollowEventInput {
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    pub long_work_run_id: Option<String>,
    pub follow_target_id: Option<String>,
    pub tool_operation_id: Option<String>,
    pub work_slice_id: Option<String>,
    pub event_type: String,
    pub payload_ref: Option<String>,
    pub payload: Value,
}

#[derive(Clone, Debug)]
pub struct WorkspaceCommitInput {
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    pub long_work_run_id: Option<String>,
    pub follow_target_id: Option<String>,
    pub live_edit_id: Option<String>,
    pub path: String,
    pub base_revision_id: Option<String>,
    pub final_revision_id: Option<String>,
    pub tool_operation_id: Option<String>,
    pub method: String,
    pub diff_ref: Option<String>,
    pub status: String,
}
