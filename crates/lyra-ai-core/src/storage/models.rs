use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use super::clarification_models::{AgentAssumptionSummary, AgentClarification};
use super::follow_models::AgentFollowSummary;
use super::intent_models::AgentIntentSummary;
use super::long_work_models::SessionTaskLedgerSummary;
use super::policy_models::AgentPolicySummary;
use super::recovery_models::AgentRecoverySummary;
use super::reference_models::AgentReferenceSummary;
use super::security_models::AgentSecuritySummary;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRequest {
    #[serde(default)]
    pub storage_root: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelDiscoveryState {
    pub status: String,
    pub last_checked_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub models: Vec<AiProviderModelEntry>,
}

impl Default for AiModelDiscoveryState {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            last_checked_at: None,
            error_message: None,
            models: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderModelEntry {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_images: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_tools: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_metadata: Option<Value>,
    pub source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderProfile {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub protocol_id: String,
    pub runtime_provider_id: String,
    pub runtime_supported: bool,
    pub secret_status: String,
    pub preset_id: Option<String>,
    pub connection_config: HashMap<String, String>,
    pub auth_config: HashMap<String, String>,
    pub configured_secret_fields: Vec<String>,
    pub headers: HashMap<String, String>,
    pub model: String,
    pub model_runtime_metadata: Option<Value>,
    pub custom_models: Vec<AiProviderModelEntry>,
    pub discovery_state: AiModelDiscoveryState,
    pub is_default: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
    pub collaboration_mode: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurn {
    pub id: String,
    pub session_id: String,
    pub profile_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collaboration_mode: Option<String>,
    pub permission_mode: String,
    pub execution_target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessageContentPart {
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_parts: Option<Vec<AgentMessageContentPart>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_content: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeEvent {
    pub session_id: String,
    pub turn_id: String,
    pub phase: String,
    pub payload: Value,
    pub timestamp: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionDetail {
    pub session: AgentSession,
    pub pending_interactions: Vec<Value>,
    pub turns: Vec<AgentTurn>,
    pub messages: Vec<AgentMessage>,
    pub runtime_events: Vec<AgentRuntimeEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub planning_summary: Option<AgentPlanningSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_coverage_summary: Option<AgentPlanCoverageSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_todo: Option<AgentExecutionTodoList>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_summary: Option<AgentExecutionSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_summary: Option<AgentVerificationSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_audit: Option<AgentCompletionAuditSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delivery_proof: Option<AgentDeliveryProofSummary>,
    #[serde(rename = "longWorkSummary", skip_serializing_if = "Option::is_none")]
    pub durable_work_summary: Option<SessionTaskLedgerSummary>,
    #[serde(rename = "followSummary", skip_serializing_if = "Option::is_none")]
    pub follow_summary: Option<AgentFollowSummary>,
    #[serde(rename = "recoverySummary", skip_serializing_if = "Option::is_none")]
    pub recovery_summary: Option<AgentRecoverySummary>,
    #[serde(rename = "intentSummary", skip_serializing_if = "Option::is_none")]
    pub intent_summary: Option<AgentIntentSummary>,
    #[serde(rename = "referenceSummary", skip_serializing_if = "Option::is_none")]
    pub reference_summary: Option<AgentReferenceSummary>,
    #[serde(rename = "assumptionSummary", skip_serializing_if = "Option::is_none")]
    pub assumption_summary: Option<AgentAssumptionSummary>,
    #[serde(
        rename = "clarificationSummary",
        skip_serializing_if = "Option::is_none"
    )]
    pub clarification_summary: Option<AgentClarification>,
    #[serde(rename = "policySummary", skip_serializing_if = "Option::is_none")]
    pub policy_summary: Option<AgentPolicySummary>,
    #[serde(rename = "securitySummary", skip_serializing_if = "Option::is_none")]
    pub security_summary: Option<AgentSecuritySummary>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanningSummary {
    pub plan_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    pub status: String,
    pub title: String,
    pub objective_summary: String,
    pub source: Value,
    pub active_version_id: String,
    pub panel_id: String,
    pub panel_status: String,
    pub version_number: i64,
    pub version: Value,
    pub annotations: Vec<AgentPlanReviewAnnotation>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanReviewAnnotation {
    pub annotation_id: String,
    pub panel_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_id: Option<String>,
    pub anchor: String,
    pub note: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedPlanRefs {
    pub plan_id: String,
    pub version_id: String,
    pub panel_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanCoverageSummary {
    pub coverage_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    pub plan_id: String,
    pub approved_version_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todo_list_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_run_id: Option<String>,
    pub status: String,
    pub covered_plan_step_ids: Vec<String>,
    pub missing_plan_step_ids: Vec<String>,
    pub extra_todo_item_ids: Vec<String>,
    pub risk_mismatches: Vec<Value>,
    pub verification_gaps: Vec<String>,
    pub missing_reference_ids: Vec<String>,
    pub mismatched_reference_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionTodoList {
    pub todo_list_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub title: String,
    pub source: Value,
    pub items: Vec<AgentTodoItem>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTodoItem {
    pub todo_item_id: String,
    pub todo_list_id: String,
    pub status: String,
    pub title: String,
    pub actions: Vec<String>,
    pub expected_tools: Vec<String>,
    pub risk_level: String,
    pub completion_criteria: Vec<String>,
    pub evidence_refs: Vec<String>,
    pub blockers: Value,
    pub source: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecutionSummary {
    pub execution_run_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    pub todo_list_id: String,
    pub status: String,
    pub step_count: i64,
    pub completed_step_count: i64,
    pub failed_step_count: i64,
    pub blocked_step_count: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTodoItemInput {
    pub title: String,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub expected_tools: Vec<String>,
    #[serde(default = "default_medium_risk")]
    pub risk_level: String,
    #[serde(default)]
    pub completion_criteria: Vec<String>,
    #[serde(default)]
    pub source: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedTodoRefs {
    pub todo_list_id: String,
    pub execution_run_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoUpdateRecord {
    pub todo_list_id: String,
    pub todo_item_id: Option<String>,
    pub execution_run_id: String,
    pub execution_step_id: String,
    pub status: String,
    pub step_status: String,
    pub title: Option<String>,
    pub evidence_refs: Vec<String>,
    pub artifact_refs: Vec<String>,
    pub blocker: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVerificationSummary {
    pub verification_plan_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_run_id: Option<String>,
    pub status: String,
    pub required_run_count: i64,
    pub passed_run_count: i64,
    pub failed_run_count: i64,
    pub blocked_run_count: i64,
    pub not_run_count: i64,
    pub runs: Vec<AgentVerificationRunSummary>,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVerificationRunSummary {
    pub verification_run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verification_plan_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    pub kind: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    pub evidence_refs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_reason: Option<String>,
    pub residual_risk: Value,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDeliveryProofSummary {
    pub delivery_proof_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_run_id: Option<String>,
    pub status: String,
    pub verification_run_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_audit_id: Option<String>,
    pub artifact_refs: Vec<String>,
    pub evidence_refs: Vec<String>,
    pub unresolved_risks: Value,
    pub summary: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCompletionAuditSummary {
    pub completion_audit_id: String,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_run_id: Option<String>,
    pub status: String,
    pub missing_todo_item_ids: Vec<String>,
    pub missing_evidence_refs: Vec<String>,
    pub failed_verification_run_ids: Vec<String>,
    pub blocked_verification_run_ids: Vec<String>,
    pub not_run_verification_run_ids: Vec<String>,
    pub pending_approval_ticket_ids: Vec<String>,
    pub residual_risks: Value,
    pub summary: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationPlanRecord {
    pub verification_plan_id: String,
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    pub execution_run_id: Option<String>,
    pub status: String,
    pub required: Vec<Value>,
    pub not_run: Vec<Value>,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandArtifactRefs {
    pub artifact_id: String,
    pub evidence_id: String,
    pub verification_plan_id: String,
    pub verification_run_id: String,
}

fn default_medium_risk() -> String {
    "medium".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ToolResultBlobRecord {
    pub result_ref: String,
    pub runtime_turn_id: String,
    pub op_id: String,
    pub tool_path: String,
    pub status: String,
    pub content_json: String,
    pub content_sha256: String,
    pub content_bytes: i64,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultBlobMeta {
    pub result_ref: String,
    pub content_sha256: String,
    pub content_bytes: i64,
    pub content_preview: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchArtifactRefs {
    pub artifact_id: String,
    pub evidence_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffArtifactBlobRecord {
    pub artifact_id: String,
    pub evidence_id: Option<String>,
    pub runtime_turn_id: Option<String>,
    pub status: String,
    pub title: String,
    pub content_ref: String,
    pub metadata: Value,
    pub content: String,
    pub content_sha256: String,
    pub content_bytes: i64,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct ApprovalTicketRecord {
    pub approval_ticket_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub status: String,
    pub approval_mode: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalTicketDetailRecord {
    pub approval_ticket_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub status: String,
    pub approval_mode: String,
    pub title: String,
    pub risk_summary: Value,
    pub impact_scope: Value,
    pub requested_action: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileBackupRef {
    pub backup_ref: String,
    pub path: String,
    pub existed: bool,
    pub content_sha256: Option<String>,
    pub content_bytes: i64,
    pub post_apply_sha256: Option<String>,
    pub post_apply_bytes: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileBackupRecord {
    pub backup_ref: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub approval_ticket_id: String,
    pub source_artifact_id: String,
    pub patch_ref: String,
    pub path: String,
    pub existed: bool,
    pub content_ref: Option<String>,
    pub content_sha256: Option<String>,
    pub content_bytes: i64,
    pub post_apply_sha256: Option<String>,
    pub post_apply_bytes: Option<i64>,
}
