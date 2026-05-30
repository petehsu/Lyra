use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use async_trait::async_trait;
use lyra_agent_api::{AgentMessage, AgentSessionId, AgentToolStatus, AgentTurnId};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KernelSession {
    pub id: AgentSessionId,
    pub working_dir: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct KernelTurnInput {
    pub session: KernelSession,
    pub turn_id: AgentTurnId,
    pub prompt: String,
    pub context: Vec<AgentMessage>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct KernelToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct KernelToolResult {
    pub tool_call_id: String,
    pub status: AgentToolStatus,
    pub output: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum KernelTurnEvent {
    MessageDelta { delta: String },
    ToolCall(KernelToolCall),
    ToolResult(KernelToolResult),
    Finished,
    Failed { message: String },
}

#[derive(Clone, Debug, Default)]
pub struct KernelCancellation {
    cancelled: Arc<AtomicBool>,
}

impl KernelCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[async_trait]
pub trait KernelProvider: Send + Sync {
    async fn run_turn(
        &self,
        input: KernelTurnInput,
        cancellation: KernelCancellation,
    ) -> Vec<KernelTurnEvent>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_token_records_cancel() {
        let token = KernelCancellation::default();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
    }
}
