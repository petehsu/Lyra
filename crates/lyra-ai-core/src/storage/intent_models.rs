use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentAmbiguityFlag {
    pub code: String,
    pub severity: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserIntentEnvelope {
    pub intent_id: String,
    pub session_id: String,
    pub conversation_id: String,
    pub user_message_id: String,
    pub runtime_turn_id: String,
    pub kind: String,
    pub confidence: f64,
    pub mode_candidate: Option<String>,
    pub source_message_ref: Option<String>,
    pub ui_action_id: Option<String>,
    pub raw_text_ref: Option<String>,
    pub segment_refs: Vec<String>,
    pub inline_reference_ids: Vec<String>,
    pub constraints: Value,
    pub classification_evidence_refs: Vec<String>,
    pub ambiguity_flags: Vec<IntentAmbiguityFlag>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentTargetBinding {
    pub binding_id: String,
    pub intent_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub freshness_status: String,
    pub confidence: f64,
    pub status: String,
    pub evidence_refs: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDecisionRecord {
    pub decision_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: String,
    pub intent_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub summary: String,
    pub reason: Value,
    pub evidence_refs: Vec<String>,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentIntentSummary {
    pub intent_id: String,
    pub kind: String,
    pub confidence: f64,
    pub mode_candidate: Option<String>,
    pub target_bindings: Vec<IntentTargetBinding>,
    pub ambiguity_flags: Vec<IntentAmbiguityFlag>,
    pub recent_decisions: Vec<RuntimeDecisionRecord>,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateIntentEnvelopeInput {
    pub session_id: String,
    pub conversation_id: String,
    pub user_message_id: String,
    pub runtime_turn_id: String,
    pub kind: String,
    pub confidence: f64,
    pub mode_candidate: Option<String>,
    pub source_message_ref: Option<String>,
    pub ui_action_id: Option<String>,
    pub raw_text_ref: Option<String>,
    pub segment_refs: Vec<String>,
    pub inline_reference_ids: Vec<String>,
    pub constraints: Value,
    pub classification_evidence_refs: Vec<String>,
    pub ambiguity_flags: Vec<IntentAmbiguityFlag>,
}

#[derive(Clone, Debug)]
pub struct CreateIntentTargetBindingInput {
    pub intent_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub target_kind: String,
    pub target_id: String,
    pub freshness_status: String,
    pub confidence: f64,
    pub evidence_refs: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct CreateRuntimeDecisionRecordInput {
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: String,
    pub intent_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub summary: String,
    pub reason: Value,
    pub evidence_refs: Vec<String>,
}
