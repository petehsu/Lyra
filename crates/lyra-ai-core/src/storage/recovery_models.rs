use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageCheckpointSummary {
    pub anchor_id: String,
    pub session_id: String,
    pub user_message_id: String,
    pub runtime_turn_id: String,
    pub checkpoint_id: String,
    pub conversation_snapshot_id: String,
    pub workspace_snapshot_id: String,
    pub status: String,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRollbackPreviewSummary {
    pub rollback_id: String,
    pub session_id: String,
    pub target_user_message_id: String,
    pub status: String,
    pub impact_level: String,
    pub requires_confirmation: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_id: Option<String>,
    pub summary: String,
    pub message_count: usize,
    pub workspace_change_count: usize,
    pub external_side_effect_count: usize,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecoverySummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_anchor: Option<AgentMessageCheckpointSummary>,
    pub rollback_previews: Vec<AgentRollbackPreviewSummary>,
    pub rollback_ready_message_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_rollback_preview: Option<AgentRollbackPreviewSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_execution: Option<AgentRollbackExecutionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reopened_message_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRollbackConversationChange {
    pub message_id: String,
    pub role: String,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRollbackWorkspaceChange {
    pub path: String,
    pub status: String,
    pub side_effect_id: String,
    pub rollback_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_hash: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRollbackExternalSideEffect {
    pub side_effect_id: String,
    pub kind: String,
    pub target_ref: String,
    pub rollback_status: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreviewMessageRollbackResult {
    pub session_id: String,
    pub rollback_id: String,
    pub target_user_message_id: String,
    pub status: String,
    pub impact_level: String,
    pub requires_confirmation: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_id: Option<String>,
    pub summary: String,
    pub workspace_changes: Vec<AgentRollbackWorkspaceChange>,
    pub conversation_changes: Vec<AgentRollbackConversationChange>,
    pub external_side_effects: Vec<AgentRollbackExternalSideEffect>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecuteMessageRollbackResult {
    pub session_id: String,
    pub rollback_id: String,
    pub status: String,
    pub impact_level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restored_workspace_snapshot_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restored_conversation_snapshot_id: Option<String>,
    pub superseded_message_ids: Vec<String>,
    pub unresolved_side_effect_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reopened_user_message_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_id: Option<String>,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRollbackExecutionSummary {
    pub rollback_id: String,
    pub status: String,
    pub impact_level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reopened_user_message_id: Option<String>,
    pub superseded_message_count: usize,
    pub unresolved_side_effect_count: usize,
    pub detail: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateRecoveryAnchorInput {
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: String,
    pub checkpoint_id: String,
    pub workspace_root: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SideEffectRecordInput {
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: Option<String>,
    pub tool_operation_id: Option<String>,
    pub kind: String,
    pub target_ref: String,
    pub rollback_status: String,
    pub evidence_ref: Option<String>,
    pub follow_target_id: Option<String>,
    pub artifact_refs: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct RestoreWorkspaceChange {
    pub path: String,
    pub expected_hash: Option<String>,
}

#[derive(Clone, Debug)]
pub struct RestoreWorkspaceResult {
    pub restored_workspace_snapshot_id: Option<String>,
    pub restored_paths: Vec<String>,
}
