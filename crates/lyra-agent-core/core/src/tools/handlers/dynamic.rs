use crate::function_tool::FunctionCallError;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;
use lyra_protocol::dynamic_tools::DynamicToolCallRequest;
use lyra_protocol::dynamic_tools::DynamicToolResponse;
use lyra_protocol::dynamic_tools::DynamicToolSideEffects;
use lyra_protocol::dynamic_tools::DynamicToolSpec;
use lyra_protocol::models::FunctionCallOutputContentItem;
use lyra_protocol::protocol::DynamicToolCallResponseEvent;
use lyra_protocol::protocol::EventMsg;
use lyra_tools::ToolName;
use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;
use tokio::sync::oneshot;
use tracing::warn;

#[derive(Clone, Debug, Default)]
struct DynamicToolSafety {
    side_effects: Option<DynamicToolSideEffects>,
    approval_mode: Option<String>,
    host_method: Option<String>,
}

pub struct DynamicToolHandler {
    tools: HashMap<ToolName, DynamicToolSafety>,
}

impl DynamicToolHandler {
    pub fn new(tools: &[DynamicToolSpec]) -> Self {
        let tools = tools
            .iter()
            .map(|tool| {
                (
                    ToolName::new(tool.namespace.clone(), tool.name.clone()),
                    DynamicToolSafety {
                        side_effects: tool.side_effects.clone(),
                        approval_mode: tool.approval_mode.clone(),
                        host_method: tool.host_method.clone(),
                    },
                )
            })
            .collect();
        Self { tools }
    }

    fn is_read_only_tool(&self, tool_name: &ToolName) -> bool {
        self.tools
            .get(tool_name)
            .is_some_and(DynamicToolSafety::is_read_only)
    }

    fn host_method_for(&self, tool_name: &ToolName) -> Option<String> {
        self.tools
            .get(tool_name)
            .and_then(|tool| tool.host_method.clone())
    }
}

impl DynamicToolSafety {
    fn is_read_only(&self) -> bool {
        let Some(side_effects) = self.side_effects.as_ref() else {
            return false;
        };
        if side_effects
            .level
            .as_deref()
            .is_some_and(|level| !is_read_only_level(level))
        {
            return false;
        }
        if side_effects.mutates_workspace
            || side_effects.mutates_memory
            || side_effects.mutates_external_systems
            || side_effects.mutates_session_state
            || side_effects.opens_interactive_session
            || side_effects.reads_network
        {
            return false;
        }
        self.approval_mode
            .as_deref()
            .is_none_or(is_safe_approval_mode)
    }
}

fn is_read_only_level(level: &str) -> bool {
    matches!(
        level.trim().to_ascii_lowercase().as_str(),
        "read_only" | "read-only" | "readonly" | "none"
    )
}

fn is_safe_approval_mode(mode: &str) -> bool {
    matches!(
        mode.trim().to_ascii_lowercase().as_str(),
        "auto" | "none" | "never" | "read_only" | "read-only" | "readonly"
    )
}

impl ToolHandler for DynamicToolHandler {
    type Output = FunctionToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    async fn is_mutating(&self, invocation: &ToolInvocation) -> bool {
        !self.is_read_only_tool(&invocation.tool_name)
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError> {
        let ToolInvocation {
            session,
            turn,
            call_id,
            tool_name,
            payload,
            ..
        } = invocation;

        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "dynamic tool handler received unsupported payload".to_string(),
                ));
            }
        };

        let args: Value = parse_arguments(&arguments)?;
        let response = request_dynamic_tool(
            &session,
            turn.as_ref(),
            call_id,
            tool_name.namespace.clone(),
            tool_name.name.clone(),
            self.host_method_for(&tool_name),
            args,
        )
        .await
        .ok_or_else(|| {
            FunctionCallError::RespondToModel(
                "dynamic tool call was cancelled before receiving a response".to_string(),
            )
        })?;

        let DynamicToolResponse {
            content_items,
            success,
        } = response;
        let body = content_items
            .into_iter()
            .map(FunctionCallOutputContentItem::from)
            .collect::<Vec<_>>();
        Ok(FunctionToolOutput::from_content(body, Some(success)))
    }
}

async fn request_dynamic_tool(
    session: &Session,
    turn_context: &TurnContext,
    call_id: String,
    namespace: Option<String>,
    tool: String,
    host_method: Option<String>,
    arguments: Value,
) -> Option<DynamicToolResponse> {
    let turn_id = turn_context.sub_id.clone();
    let (tx_response, rx_response) = oneshot::channel();
    let event_id = call_id.clone();
    let prev_entry = {
        let mut active = session.active_turn.lock().await;
        match active.as_mut() {
            Some(at) => {
                let mut ts = at.turn_state.lock().await;
                ts.insert_pending_dynamic_tool(call_id.clone(), tx_response)
            }
            None => None,
        }
    };
    if prev_entry.is_some() {
        warn!("Overwriting existing pending dynamic tool call for call_id: {event_id}");
    }

    let started_at = Instant::now();
    let event = EventMsg::DynamicToolCallRequest(DynamicToolCallRequest {
        call_id: call_id.clone(),
        turn_id: turn_id.clone(),
        namespace,
        tool: tool.clone(),
        host_method: host_method.clone(),
        arguments: arguments.clone(),
    });
    session.send_event(turn_context, event).await;
    let response = rx_response.await.ok();

    let response_event = match &response {
        Some(response) => EventMsg::DynamicToolCallResponse(DynamicToolCallResponseEvent {
            call_id,
            turn_id,
            tool,
            arguments,
            content_items: response.content_items.clone(),
            success: response.success,
            error: None,
            duration: started_at.elapsed(),
        }),
        None => EventMsg::DynamicToolCallResponse(DynamicToolCallResponseEvent {
            call_id,
            turn_id,
            tool,
            arguments,
            content_items: Vec::new(),
            success: false,
            error: Some("dynamic tool call was cancelled before receiving a response".to_string()),
            duration: started_at.elapsed(),
        }),
    };
    session.send_event(turn_context, response_event).await;

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec(name: &str, side_effects: Option<DynamicToolSideEffects>) -> DynamicToolSpec {
        DynamicToolSpec {
            namespace: None,
            name: name.to_string(),
            host_method: None,
            description: "test".to_string(),
            input_schema: json!({ "type": "object", "properties": {} }),
            defer_loading: false,
            side_effects,
            approval_mode: None,
            risk: None,
            model_input_capabilities: None,
        }
    }

    fn read_only_effects() -> DynamicToolSideEffects {
        DynamicToolSideEffects {
            level: Some("read_only".to_string()),
            mutates_workspace: false,
            mutates_memory: false,
            mutates_external_systems: false,
            mutates_session_state: false,
            opens_interactive_session: false,
            reads_network: false,
        }
    }

    #[test]
    fn read_only_dynamic_tools_are_not_mutating() {
        let handler = DynamicToolHandler::new(&[spec("workbench.read", Some(read_only_effects()))]);

        assert!(handler.is_read_only_tool(&ToolName::plain("workbench.read")));
    }

    #[test]
    fn dynamic_tools_default_to_mutating_without_safe_metadata() {
        let mut network_effects = read_only_effects();
        network_effects.reads_network = true;
        let handler = DynamicToolHandler::new(&[
            spec("unknown", None),
            spec("network", Some(network_effects)),
        ]);

        assert!(!handler.is_read_only_tool(&ToolName::plain("unknown")));
        assert!(!handler.is_read_only_tool(&ToolName::plain("network")));
        assert!(!handler.is_read_only_tool(&ToolName::plain("missing")));
    }

    #[test]
    fn dynamic_tool_approval_mode_can_make_tool_mutating() {
        let mut tool = spec("manual", Some(read_only_effects()));
        tool.approval_mode = Some("on_request".to_string());
        let handler = DynamicToolHandler::new(&[tool]);

        assert!(!handler.is_read_only_tool(&ToolName::plain("manual")));
    }

    #[test]
    fn dynamic_tool_host_method_can_differ_from_model_name() {
        let mut tool = spec("read_open_document", Some(read_only_effects()));
        tool.host_method = Some("workbench.document.read".to_string());
        let handler = DynamicToolHandler::new(&[tool]);

        assert_eq!(
            handler.host_method_for(&ToolName::plain("read_open_document")),
            Some("workbench.document.read".to_string())
        );
    }
}
