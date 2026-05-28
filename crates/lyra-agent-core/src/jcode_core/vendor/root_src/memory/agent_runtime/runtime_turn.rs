use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeTurnState {
    Queued,
    AssemblingContext,
    CallingModel,
    StreamingModel,
    WaitingForTool,
    WaitingForUser,
    RecoveringAfterReload,
    RecoveringAfterCrash,
    Interrupted,
    Completed,
    FailedRecoverable,
    FailedTerminal,
    CancelledByUser,
}

impl RuntimeTurnState {
    pub fn as_storage_str(&self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::AssemblingContext => "assembling_context",
            Self::CallingModel => "calling_model",
            Self::StreamingModel => "streaming_model",
            Self::WaitingForTool => "waiting_for_tool",
            Self::WaitingForUser => "waiting_for_user",
            Self::RecoveringAfterReload => "recovering_after_reload",
            Self::RecoveringAfterCrash => "recovering_after_crash",
            Self::Interrupted => "interrupted",
            Self::Completed => "completed",
            Self::FailedRecoverable => "failed_recoverable",
            Self::FailedTerminal => "failed_terminal",
            Self::CancelledByUser => "cancelled_by_user",
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Completed | Self::FailedTerminal | Self::CancelledByUser
        )
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolResultStatus {
    Running,
    Success,
    SuccessPartial,
    FailedRetryable,
    FailedTerminal,
    TimedOutPartial,
    Cancelled,
    UnknownAfterRecovery,
}

impl ToolResultStatus {
    pub fn as_storage_str(&self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Success => "success",
            Self::SuccessPartial => "success_partial",
            Self::FailedRetryable => "failed_retryable",
            Self::FailedTerminal => "failed_terminal",
            Self::TimedOutPartial => "timed_out_partial",
            Self::Cancelled => "cancelled",
            Self::UnknownAfterRecovery => "unknown_after_recovery",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTurnRecord {
    pub runtime_turn_id: String,
    pub session_id: String,
    pub parent_runtime_turn_id: Option<String>,
    pub user_message_id: Option<String>,
    pub state: RuntimeTurnState,
    pub started_at_ms: i64,
    pub started_at_iso: String,
    pub updated_at_ms: i64,
    pub updated_at_iso: String,
    pub completed_at_ms: Option<i64>,
    pub completed_at_iso: Option<String>,
    pub failure_kind: Option<String>,
    pub failure_detail_ref: Option<String>,
    pub latest_user_intent_ref: Option<String>,
    pub active_task_ref: Option<String>,
    pub provider_request_ref: Option<String>,
    pub context_snapshot_ref: Option<String>,
    pub completion_audit_ref: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypedToolResult {
    pub tool_call_id: String,
    pub tool_result_id: String,
    pub runtime_turn_id: String,
    pub name: String,
    pub status: ToolResultStatus,
    #[serde(default)]
    pub input_json: Value,
    #[serde(default)]
    pub output_json: Value,
    #[serde(default)]
    pub recommended_next_actions: Vec<String>,
}
