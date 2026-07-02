#[derive(Clone, Debug, Default)]
pub struct RuntimeEventMapper;

impl RuntimeEventMapper {
    pub const NAME: &'static str = "event_mapper";

    pub fn map_kernel_event(
        &self,
        session_id: &str,
        turn_id: &str,
        event: lyra_agent_kernel::KernelTurnEvent,
    ) -> crate::agent_event::AgentEvent {
        use crate::agent_event::AgentEvent;
        match event {
            lyra_agent_kernel::KernelTurnEvent::MessageDelta { delta } => {
                AgentEvent::MessageDelta {
                    session_id: session_id.to_string(),
                    message_id: String::new(),
                    block_id: None,
                    replace: None,
                    delta,
                }
            }
            lyra_agent_kernel::KernelTurnEvent::ToolCall(call) => AgentEvent::ToolStarted {
                session_id: session_id.to_string(),
                message_id: None,
                tool: serde_json::json!({
                    "id": call.id,
                    "name": call.name,
                    "input": call.input,
                }),
            },
            lyra_agent_kernel::KernelTurnEvent::ToolResult(result) => AgentEvent::ToolFinished {
                session_id: session_id.to_string(),
                message_id: None,
                tool: serde_json::json!({
                    "toolCallId": result.tool_call_id,
                    "status": result.status,
                    "output": result.output,
                }),
            },
            lyra_agent_kernel::KernelTurnEvent::Finished => AgentEvent::TurnFinished {
                session_id: session_id.to_string(),
                turn_id: turn_id.to_string(),
                status: "ok".to_string(),
            },
            lyra_agent_kernel::KernelTurnEvent::Failed { message } => AgentEvent::TurnFailed {
                session_id: session_id.to_string(),
                turn_id: turn_id.to_string(),
                message,
                failure_kind: None,
            },
        }
    }

    pub fn normalize_kind(&self, event: &serde_json::Value) -> Option<String> {
        event
            .get("kind")
            .and_then(serde_json::Value::as_str)
            .map(|kind| match kind {
                "messageAppended" => "messageCommitted",
                "memorySnapshot" => "memoryUpdated",
                "browserTargetUpdated" => "browserActivityChanged",
                "permissionRequired" => "permissionRequested",
                "clarificationRequired" => "clarificationRequested",
                other => other,
            })
            .map(str::to_string)
    }
}
