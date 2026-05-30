#[derive(Clone, Debug, Default)]
pub struct RuntimeEventMapper;

impl RuntimeEventMapper {
    pub const NAME: &'static str = "event_mapper";

    pub fn map_kernel_event(
        &self,
        session_id: &str,
        turn_id: &str,
        event: lyra_agent_kernel::KernelTurnEvent,
    ) -> serde_json::Value {
        match event {
            lyra_agent_kernel::KernelTurnEvent::MessageDelta { delta } => serde_json::json!({
                "kind": "messageDelta",
                "sessionId": session_id,
                "turnId": turn_id,
                "delta": delta,
            }),
            lyra_agent_kernel::KernelTurnEvent::ToolCall(call) => serde_json::json!({
                "kind": "toolStarted",
                "sessionId": session_id,
                "turnId": turn_id,
                "tool": {
                    "id": call.id,
                    "name": call.name,
                    "input": call.input,
                },
            }),
            lyra_agent_kernel::KernelTurnEvent::ToolResult(result) => serde_json::json!({
                "kind": "toolFinished",
                "sessionId": session_id,
                "turnId": turn_id,
                "toolCallId": result.tool_call_id,
                "status": result.status,
                "output": result.output,
            }),
            lyra_agent_kernel::KernelTurnEvent::Finished => serde_json::json!({
                "kind": "turnFinished",
                "sessionId": session_id,
                "turnId": turn_id,
            }),
            lyra_agent_kernel::KernelTurnEvent::Failed { message } => serde_json::json!({
                "kind": "turnFailed",
                "sessionId": session_id,
                "turnId": turn_id,
                "message": message,
            }),
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
