use async_trait::async_trait;
use lyra_agent_kernel::{
    KernelCancellation, KernelProvider, KernelSession, KernelTurnEvent, KernelTurnInput,
};

use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct TurnRunner {
    backend: BackendHandle,
}

impl Default for TurnRunner {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl TurnRunner {
    pub const NAME: &'static str = "turn_runner";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn send(&self, payload: serde_json::Value) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.turn.send", payload)
    }

    pub fn retry(&self, payload: serde_json::Value) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.turn.retry", payload)
    }

    pub fn run_prompt(
        &self,
        prompt: String,
        session_id: Option<String>,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        let provider = RuntimeKernelProvider {
            backend: self.backend.clone(),
        };
        let input = KernelTurnInput {
            session: KernelSession {
                id: session_id.unwrap_or_default(),
                working_dir: std::env::current_dir()
                    .map(|path| path.display().to_string())
                    .unwrap_or_default(),
            },
            turn_id: "cli-turn".to_string(),
            prompt,
            context: Vec::new(),
        };
        let events =
            futures::executor::block_on(provider.run_turn(input, KernelCancellation::default()));
        Ok(serde_json::json!({
            "status": if events.iter().any(|event| matches!(event, KernelTurnEvent::Failed { .. })) { "failed" } else { "started" },
            "kernelEvents": serialize_kernel_events(events),
        }))
    }

    pub fn cancel(&self, session_id: String) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call(
            "agent.turn.cancel",
            serde_json::json!({ "sessionId": session_id }),
        )
    }

    pub fn cancel_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.turn.cancel", payload)
    }
}

#[derive(Clone, Debug, Default)]
struct RuntimeKernelProvider {
    backend: BackendHandle,
}

#[async_trait]
impl KernelProvider for RuntimeKernelProvider {
    async fn run_turn(
        &self,
        input: KernelTurnInput,
        cancellation: KernelCancellation,
    ) -> Vec<KernelTurnEvent> {
        if cancellation.is_cancelled() {
            return vec![KernelTurnEvent::Failed {
                message: "turn cancelled before start".to_string(),
            }];
        }
        let mut payload = serde_json::Map::new();
        payload.insert("text".to_string(), serde_json::Value::String(input.prompt));
        if !input.session.id.is_empty() {
            payload.insert(
                "sessionId".to_string(),
                serde_json::Value::String(input.session.id),
            );
        }
        match self
            .backend
            .call("agent.turn.send", serde_json::Value::Object(payload))
        {
            Ok(_) => vec![KernelTurnEvent::Finished],
            Err(error) => vec![KernelTurnEvent::Failed {
                message: error.to_string(),
            }],
        }
    }
}

fn serialize_kernel_events(events: Vec<KernelTurnEvent>) -> Vec<serde_json::Value> {
    events
        .into_iter()
        .map(|event| match event {
            KernelTurnEvent::MessageDelta { delta } => {
                serde_json::json!({ "kind": "messageDelta", "delta": delta })
            }
            KernelTurnEvent::ToolCall(call) => serde_json::json!({
                "kind": "toolCall",
                "id": call.id,
                "name": call.name,
                "input": call.input,
            }),
            KernelTurnEvent::ToolResult(result) => serde_json::json!({
                "kind": "toolResult",
                "toolCallId": result.tool_call_id,
                "status": result.status,
                "output": result.output,
            }),
            KernelTurnEvent::Finished => serde_json::json!({ "kind": "finished" }),
            KernelTurnEvent::Failed { message } => {
                serde_json::json!({ "kind": "failed", "message": message })
            }
        })
        .collect()
}
