use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryEventKind {
    ServerReloading,
    ServerReloaded,
    TurnInterrupted,
    TurnRecovered,
    RecoveryContextCreated,
    PendingToolUnknownAfterRecovery,
}

impl RecoveryEventKind {
    pub fn as_storage_str(&self) -> &'static str {
        match self {
            Self::ServerReloading => "server_reloading",
            Self::ServerReloaded => "server_reloaded",
            Self::TurnInterrupted => "turn_interrupted",
            Self::TurnRecovered => "turn_recovered",
            Self::RecoveryContextCreated => "recovery_context_created",
            Self::PendingToolUnknownAfterRecovery => "pending_tool_unknown_after_recovery",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEvent {
    pub kind: RecoveryEventKind,
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    #[serde(default)]
    pub payload_json: Value,
}
