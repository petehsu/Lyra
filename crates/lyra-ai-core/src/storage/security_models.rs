use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityDecisionRecord {
    pub decision_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub operation_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub resource_kind: String,
    pub resource_ref: String,
    pub decision: String,
    pub reason_codes: Vec<String>,
    pub risk_level: String,
    pub redaction_applied: bool,
    pub approval_ticket_id: Option<String>,
    pub evidence_refs: Vec<String>,
    pub status: String,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateSecurityDecisionRecordInput {
    pub session_id: String,
    pub turn_id: String,
    pub operation_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub resource_kind: String,
    pub resource_ref: String,
    pub decision: String,
    pub reason_codes: Vec<String>,
    pub risk_level: String,
    pub redaction_applied: bool,
    pub approval_ticket_id: Option<String>,
    pub evidence_refs: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretDetectionReport {
    pub report_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub resource_kind: String,
    pub resource_ref: String,
    pub status: String,
    pub findings: Vec<Value>,
    pub redacted_preview: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateSecretDetectionReportInput {
    pub session_id: String,
    pub turn_id: String,
    pub resource_kind: String,
    pub resource_ref: String,
    pub status: String,
    pub findings: Vec<Value>,
    pub redacted_preview: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactedProjectionRecord {
    pub projection_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub source_kind: String,
    pub source_ref: String,
    pub projection_kind: String,
    pub redaction_profile: String,
    pub content_hash: String,
    pub redacted_ref: String,
    pub decision_id: Option<String>,
    pub status: String,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateRedactedProjectionRecordInput {
    pub session_id: String,
    pub turn_id: String,
    pub source_kind: String,
    pub source_ref: String,
    pub projection_kind: String,
    pub redaction_profile: String,
    pub content_hash: String,
    pub redacted_ref: String,
    pub decision_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretRecord {
    pub secret_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub kind: String,
    pub provider: Option<String>,
    pub label: String,
    pub storage_ref: String,
    pub scope: Value,
    pub status: String,
    pub expires_at: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateSecretRecordInput {
    pub session_id: String,
    pub turn_id: String,
    pub kind: String,
    pub provider: Option<String>,
    pub label: String,
    pub storage_ref: String,
    pub scope: Value,
    pub expires_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretHandleRecord {
    pub handle_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub secret_id: String,
    pub lease_id: String,
    pub granted_to_tool_path: String,
    pub granted_for_operation_id: String,
    pub allowed_target: String,
    pub reveal_mode: String,
    pub status: String,
    pub expires_at: i64,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateSecretHandleInput {
    pub session_id: String,
    pub turn_id: String,
    pub secret_id: String,
    pub granted_to_tool_path: String,
    pub granted_for_operation_id: String,
    pub allowed_target: String,
    pub reveal_mode: String,
    pub expires_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretAccessAuditRecord {
    pub audit_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub secret_id: Option<String>,
    pub handle_id: Option<String>,
    pub operation_id: Option<String>,
    pub access_kind: String,
    pub target_ref: String,
    pub decision: String,
    pub reason_codes: Vec<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateSecretAccessAuditInput {
    pub session_id: String,
    pub turn_id: String,
    pub secret_id: Option<String>,
    pub handle_id: Option<String>,
    pub operation_id: Option<String>,
    pub access_kind: String,
    pub target_ref: String,
    pub decision: String,
    pub reason_codes: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExfiltrationDecisionRecord {
    pub exfiltration_decision_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub operation_id: Option<String>,
    pub target_kind: String,
    pub target_ref: String,
    pub contains_sensitive_data: bool,
    pub allowed: bool,
    pub required_action: String,
    pub reason_codes: Vec<String>,
    pub evidence_refs: Vec<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateExfiltrationDecisionInput {
    pub session_id: String,
    pub turn_id: String,
    pub operation_id: Option<String>,
    pub target_kind: String,
    pub target_ref: String,
    pub contains_sensitive_data: bool,
    pub allowed: bool,
    pub required_action: String,
    pub reason_codes: Vec<String>,
    pub evidence_refs: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleBridgeAuditRecord {
    pub bridge_audit_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub capsule_id: Option<String>,
    pub operation_id: Option<String>,
    pub decision: String,
    pub bridge_policy: Value,
    pub reason_codes: Vec<String>,
    pub approval_ticket_id: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateCapsuleBridgeAuditInput {
    pub session_id: String,
    pub turn_id: String,
    pub capsule_id: Option<String>,
    pub operation_id: Option<String>,
    pub decision: String,
    pub bridge_policy: Value,
    pub reason_codes: Vec<String>,
    pub approval_ticket_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSecuritySummary {
    pub snapshot_id: Option<String>,
    pub status: String,
    pub redaction_profile: String,
    pub recent_decisions: Vec<AgentSecurityDecisionSummary>,
    pub secret_findings: AgentSecretFindingSummary,
    pub active_secret_handles: i64,
    pub last_exfiltration_action: Option<String>,
    pub last_capsule_bridge_decision: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSecurityDecisionSummary {
    pub decision_id: String,
    pub resource_kind: String,
    pub resource_ref: String,
    pub decision: String,
    pub reason_codes: Vec<String>,
    pub risk_level: String,
    pub redaction_applied: bool,
    pub approval_ticket_id: Option<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSecretFindingSummary {
    pub total: i64,
    pub high_confidence: i64,
    pub last_report_id: Option<String>,
}
