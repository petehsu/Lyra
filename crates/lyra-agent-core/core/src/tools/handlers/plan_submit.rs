use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;
use lyra_protocol::config_types::ModeKind;
use lyra_protocol::items::PlanItem;
use lyra_protocol::items::TurnItem;
use lyra_protocol::plan_tool::PlanSubmitArgs;
use lyra_tools::PLAN_SUBMIT_TOOL_NAME;

pub struct PlanSubmitHandler;

impl ToolHandler for PlanSubmitHandler {
    type Output = FunctionToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError> {
        let ToolInvocation {
            session,
            turn,
            call_id: _,
            payload,
            ..
        } = invocation;

        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(format!(
                    "{PLAN_SUBMIT_TOOL_NAME} handler received unsupported payload"
                )));
            }
        };

        if turn.collaboration_mode.mode != ModeKind::Plan {
            return Err(FunctionCallError::RespondToModel(
                "plan_submit can only be used in Plan Mode".to_string(),
            ));
        }

        let args: PlanSubmitArgs = parse_arguments(&arguments)?;
        let plan_markdown = args.plan_markdown.trim();
        if plan_markdown.is_empty() {
            return Err(FunctionCallError::RespondToModel(
                "plan_submit requires non-empty plan_markdown".to_string(),
            ));
        }

        let item = TurnItem::Plan(PlanItem {
            id: format!("{}-plan-submit", turn.sub_id),
            text: plan_markdown.to_string(),
        });
        session.emit_turn_item_started(turn.as_ref(), &item).await;
        session.emit_turn_item_completed(turn.as_ref(), item).await;
        session.mark_plan_submitted(&turn.sub_id).await;

        Ok(FunctionToolOutput::from_text(
            "Plan submitted for user approval. Wait for approval before implementation."
                .to_string(),
            Some(true),
        ))
    }
}
