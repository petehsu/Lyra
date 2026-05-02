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
use lyra_protocol::plan_tool::LyraPlanAction;
use lyra_protocol::plan_tool::LyraPlanArgs;
use lyra_protocol::protocol::SessionSource;
use lyra_protocol::request_user_input::RequestUserInputArgs;
use lyra_tools::LYRA_PLAN_TOOL_NAME;
use lyra_tools::normalize_request_user_input_args;

pub struct LyraPlanHandler;

impl ToolHandler for LyraPlanHandler {
    type Output = FunctionToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
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
                return Err(FunctionCallError::RespondToModel(format!(
                    "{LYRA_PLAN_TOOL_NAME} handler received unsupported payload"
                )));
            }
        };

        if turn.collaboration_mode.mode != ModeKind::Plan {
            return Err(FunctionCallError::RespondToModel(
                "plan tools can only be used in Plan Mode".to_string(),
            ));
        }

        if tool_name.name.as_str() != LYRA_PLAN_TOOL_NAME {
            return Err(FunctionCallError::Fatal(format!(
                "unexpected plan tool handler dispatch for {}",
                tool_name.display()
            )));
        }

        handle_lyra_plan(session, turn, call_id, arguments).await
    }
}

async fn handle_lyra_plan(
    session: std::sync::Arc<crate::session::session::Session>,
    turn: std::sync::Arc<crate::session::turn_context::TurnContext>,
    call_id: String,
    arguments: String,
) -> Result<FunctionToolOutput, FunctionCallError> {
    let args: LyraPlanArgs = parse_arguments(&arguments)?;
    match args.action {
        LyraPlanAction::Submit => {
            let markdown = args.markdown.unwrap_or_default();
            let summary = args.summary.unwrap_or_else(|| {
                markdown
                    .lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty())
                    .unwrap_or("Proposed plan")
                    .to_string()
            });
            submit_plan(session, turn, summary, markdown, LYRA_PLAN_TOOL_NAME).await
        }
        LyraPlanAction::Draft => {
            let markdown = args.markdown.unwrap_or_default();
            if markdown.trim().is_empty() {
                return Err(FunctionCallError::RespondToModel(
                    "lyra_plan action=\"draft\" requires non-empty markdown".to_string(),
                ));
            }
            Ok(FunctionToolOutput::from_text(
                "Plan draft recorded. Continue planning, ask structured questions if needed, or submit the final plan with lyra_plan action=\"submit\".".to_string(),
                Some(true),
            ))
        }
        LyraPlanAction::Ask => {
            if matches!(turn.session_source, SessionSource::SubAgent(_)) {
                return Err(FunctionCallError::RespondToModel(
                    "lyra_plan action=\"ask\" can only be used by the root thread".to_string(),
                ));
            }
            let questions = args.questions.unwrap_or_default();
            if questions.is_empty() {
                return Err(FunctionCallError::RespondToModel(
                    "lyra_plan action=\"ask\" requires one to three questions".to_string(),
                ));
            }
            let request = normalize_request_user_input_args(RequestUserInputArgs { questions })
                .map_err(FunctionCallError::RespondToModel)?;
            let response = session
                .request_user_input(turn.as_ref(), call_id, request)
                .await
                .ok_or_else(|| {
                    FunctionCallError::RespondToModel(
                        "lyra_plan action=\"ask\" was cancelled before receiving a response"
                            .to_string(),
                    )
                })?;
            let content = serde_json::to_string(&response).map_err(|err| {
                FunctionCallError::Fatal(format!(
                    "failed to serialize lyra_plan ask response: {err}"
                ))
            })?;
            Ok(FunctionToolOutput::from_text(content, Some(true)))
        }
    }
}

async fn submit_plan(
    session: std::sync::Arc<crate::session::session::Session>,
    turn: std::sync::Arc<crate::session::turn_context::TurnContext>,
    _summary: String,
    markdown: String,
    tool_name: &str,
) -> Result<FunctionToolOutput, FunctionCallError> {
    let markdown = markdown.trim();
    if markdown.is_empty() {
        return Err(FunctionCallError::RespondToModel(format!(
            "{tool_name} requires non-empty plan markdown"
        )));
    }

    let item = TurnItem::Plan(PlanItem {
        id: format!("{}-{tool_name}", turn.sub_id),
        text: markdown.to_string(),
    });
    session.emit_turn_item_started(turn.as_ref(), &item).await;
    session.emit_turn_item_completed(turn.as_ref(), item).await;

    Ok(FunctionToolOutput::from_text(
        "Plan submitted to the host UI for user approval.".to_string(),
        Some(true),
    ))
}
