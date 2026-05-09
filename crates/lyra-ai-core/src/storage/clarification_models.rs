use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionTicketOption {
    pub id: String,
    pub label: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionTicket {
    pub question_ticket_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: String,
    pub intent_id: Option<String>,
    pub status: String,
    pub blocking_level: String,
    pub title: String,
    pub question: String,
    pub why: String,
    pub target_summary: Option<String>,
    pub options: Vec<QuestionTicketOption>,
    pub allow_custom_answer: bool,
    pub selected_option_id: Option<String>,
    pub answer_text: Option<String>,
    pub related_ids: Vec<String>,
    pub target_bindings: Value,
    pub created_at: i64,
    pub updated_at: i64,
    pub answered_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssumptionRecord {
    pub assumption_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: String,
    pub intent_id: Option<String>,
    pub status: String,
    pub statement: String,
    pub basis: String,
    pub risk_level: String,
    pub reversible: bool,
    pub source_refs: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentQuestionTicket {
    pub question_ticket_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub status: String,
    pub blocking_level: String,
    pub title: String,
    pub question: String,
    pub why: String,
    pub target_summary: Option<String>,
    pub options: Vec<QuestionTicketOption>,
    pub allow_custom_answer: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentClarification {
    pub pending: Vec<AgentQuestionTicket>,
    pub recent_answered: Vec<QuestionTicket>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAssumptionSummary {
    pub active: Vec<AssumptionRecord>,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
pub struct CreateQuestionTicketInput {
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: String,
    pub intent_id: Option<String>,
    pub blocking_level: String,
    pub title: String,
    pub question: String,
    pub why: String,
    pub target_summary: Option<String>,
    pub options: Vec<QuestionTicketOption>,
    pub allow_custom_answer: bool,
    pub related_ids: Vec<String>,
    pub target_bindings: Value,
}

#[derive(Clone, Debug)]
pub struct CreateAssumptionRecordInput {
    pub session_id: String,
    pub runtime_turn_id: String,
    pub user_message_id: String,
    pub intent_id: Option<String>,
    pub statement: String,
    pub basis: String,
    pub risk_level: String,
    pub reversible: bool,
    pub source_refs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolveClarificationRequest {
    #[serde(flatten)]
    pub storage: crate::storage::StorageRequest,
    pub session_id: String,
    pub question_ticket_id: String,
    pub selected_option_id: Option<String>,
    pub custom_answer: Option<String>,
    pub answer_text: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolveClarificationResult {
    pub session_id: String,
    pub question_ticket_id: String,
    pub status: String,
    pub detail: crate::storage::AgentSessionDetail,
}
