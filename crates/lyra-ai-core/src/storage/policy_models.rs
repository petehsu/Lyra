use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectivePolicySnapshot {
    pub snapshot_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub project_root: Option<String>,
    pub project_id: Option<String>,
    pub source: String,
    pub status: String,
    pub manifest_path: Option<String>,
    pub manifest_hash: Option<String>,
    pub effective_json: Value,
    pub source_records: Vec<PolicySourceRecordRow>,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateEffectivePolicySnapshotInput {
    pub session_id: String,
    pub turn_id: String,
    pub project_root: Option<String>,
    pub project_id: Option<String>,
    pub source: String,
    pub status: String,
    pub manifest_path: Option<String>,
    pub manifest_hash: Option<String>,
    pub effective_json: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicySourceRecordRow {
    pub source_record_id: String,
    pub snapshot_id: String,
    pub layer: String,
    pub source_ref: String,
    pub status: String,
    pub hash: Option<String>,
    pub warnings: Vec<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreatePolicySourceRecordInput {
    pub session_id: String,
    pub snapshot_id: String,
    pub layer: String,
    pub source_ref: String,
    pub status: String,
    pub hash: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPolicySummary {
    pub snapshot_id: String,
    pub source: String,
    pub status: String,
    pub permission_default: String,
    pub allowed_modes: Vec<String>,
    pub default_execution_target: String,
    pub allowed_execution_targets: Vec<String>,
    pub tool_policy_summary: AgentPolicyToolSummary,
    pub manifest_path: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPolicyToolSummary {
    pub enabled_count: i64,
    pub disabled_count: i64,
    pub command_policy: String,
    pub network_policy: String,
}
