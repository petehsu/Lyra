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
pub struct AgentSecuritySummary {
    pub snapshot_id: Option<String>,
    pub status: String,
    pub redaction_profile: String,
    pub recent_decisions: Vec<AgentSecurityDecisionSummary>,
    pub secret_findings: AgentSecretFindingSummary,
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
