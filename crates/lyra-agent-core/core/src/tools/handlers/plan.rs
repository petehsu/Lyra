use crate::function_tool::FunctionCallError;
use crate::session::session::Session;
use crate::session::turn_context::TurnContext;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolOutput;
use crate::tools::context::ToolPayload;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;
use lyra_protocol::config_types::ModeKind;
use lyra_protocol::items::PlanItem;
use lyra_protocol::items::TurnItem;
use lyra_protocol::models::FunctionCallOutputPayload;
use lyra_protocol::models::ResponseInputItem;
use lyra_protocol::plan_tool::StepStatus;
use lyra_protocol::plan_tool::UpdatePlanArgs;
use lyra_protocol::protocol::EventMsg;
use serde_json::Value as JsonValue;

pub struct PlanHandler;

pub struct PlanToolOutput;

const PLAN_UPDATED_MESSAGE: &str = "Plan updated";

impl ToolOutput for PlanToolOutput {
    fn log_preview(&self) -> String {
        PLAN_UPDATED_MESSAGE.to_string()
    }

    fn success_for_logging(&self) -> bool {
        true
    }

    fn to_response_item(&self, call_id: &str, _payload: &ToolPayload) -> ResponseInputItem {
        let mut output = FunctionCallOutputPayload::from_text(PLAN_UPDATED_MESSAGE.to_string());
        output.success = Some(true);

        ResponseInputItem::FunctionCallOutput {
            call_id: call_id.to_string(),
            output,
        }
    }

    fn code_mode_result(&self, _payload: &ToolPayload) -> JsonValue {
        JsonValue::Object(serde_json::Map::new())
    }
}

impl ToolHandler for PlanHandler {
    type Output = PlanToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError> {
        let ToolInvocation {
            session,
            turn,
            call_id,
            payload,
            ..
        } = invocation;

        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::RespondToModel(
                    "update_plan handler received unsupported payload".to_string(),
                ));
            }
        };

        handle_update_plan(session.as_ref(), turn.as_ref(), arguments, call_id).await?;

        Ok(PlanToolOutput)
    }
}

/// This function doesn't do anything useful. However, it gives the model a structured way to record its plan that clients can read and render.
/// So it's the _inputs_ to this function that are useful to clients, not the outputs and neither are actually useful for the model other
/// than forcing it to come up and document a plan (TBD how that affects performance).
pub(crate) async fn handle_update_plan(
    session: &Session,
    turn_context: &TurnContext,
    arguments: String,
    _call_id: String,
) -> Result<String, FunctionCallError> {
    let args = parse_update_plan_arguments(&arguments)?;
    if turn_context.collaboration_mode.mode == ModeKind::Plan {
        emit_plan_mode_plan_item(session, turn_context, &args).await;
    }
    session
        .send_event(turn_context, EventMsg::PlanUpdate(args))
        .await;
    Ok("Plan updated".to_string())
}

fn parse_update_plan_arguments(arguments: &str) -> Result<UpdatePlanArgs, FunctionCallError> {
    serde_json::from_str::<UpdatePlanArgs>(arguments).map_err(|e| {
        FunctionCallError::RespondToModel(format!("failed to parse function arguments: {e}"))
    })
}

async fn emit_plan_mode_plan_item(
    session: &Session,
    turn_context: &TurnContext,
    args: &UpdatePlanArgs,
) {
    let text = render_plan_markdown(args);
    if text.trim().is_empty() {
        return;
    }
    let item = TurnItem::Plan(PlanItem {
        id: format!("{}-update-plan", turn_context.sub_id),
        text,
    });
    session.emit_turn_item_started(turn_context, &item).await;
    session.emit_turn_item_completed(turn_context, item).await;
}

fn render_plan_markdown(args: &UpdatePlanArgs) -> String {
    let mut lines = Vec::new();
    if let Some(explanation) = args
        .explanation
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(explanation.to_string());
        if !args.plan.is_empty() {
            lines.push(String::new());
        }
    }
    for item in &args.plan {
        let step = item.step.trim();
        if step.is_empty() {
            continue;
        }
        let marker = match item.status {
            StepStatus::Completed => "x",
            StepStatus::InProgress => "~",
            StepStatus::Pending => " ",
        };
        lines.push(format!("- [{marker}] {step}"));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use lyra_protocol::plan_tool::PlanItemArg;

    #[test]
    fn render_plan_markdown_preserves_explanation_and_statuses() {
        let args = UpdatePlanArgs {
            explanation: Some("Build a focused landing page.".to_string()),
            plan: vec![
                PlanItemArg {
                    step: "Inspect workspace".to_string(),
                    status: StepStatus::Completed,
                },
                PlanItemArg {
                    step: "Create React structure".to_string(),
                    status: StepStatus::InProgress,
                },
                PlanItemArg {
                    step: "Polish responsive styling".to_string(),
                    status: StepStatus::Pending,
                },
            ],
        };

        assert_eq!(
            render_plan_markdown(&args),
            "Build a focused landing page.\n\n- [x] Inspect workspace\n- [~] Create React structure\n- [ ] Polish responsive styling"
        );
    }
}
