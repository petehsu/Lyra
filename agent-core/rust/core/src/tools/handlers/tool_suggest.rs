use lyra_rmcp_client::ElicitationAction;
use lyra_tools::DiscoverableTool;
use lyra_tools::DiscoverableToolAction;
use lyra_tools::DiscoverableToolType;
use lyra_tools::TOOL_SUGGEST_TOOL_NAME;
use lyra_tools::ToolSuggestArgs;
use lyra_tools::ToolSuggestResult;
use lyra_tools::build_tool_suggestion_elicitation_request;
use lyra_tools::filter_tool_suggest_discoverable_tools_for_client;
use rmcp::model::RequestId;

use crate::connectors;
use crate::function_tool::FunctionCallError;
use crate::tools::context::FunctionToolOutput;
use crate::tools::context::ToolInvocation;
use crate::tools::context::ToolPayload;
use crate::tools::handlers::parse_arguments;
use crate::tools::registry::ToolHandler;
use crate::tools::registry::ToolKind;

const TOOL_SUGGEST_SERVER_NAME: &str = "tool_suggest";

pub struct ToolSuggestHandler;

impl ToolHandler for ToolSuggestHandler {
    type Output = FunctionToolOutput;

    fn kind(&self) -> ToolKind {
        ToolKind::Function
    }

    async fn handle(&self, invocation: ToolInvocation) -> Result<Self::Output, FunctionCallError> {
        let ToolInvocation {
            payload,
            session,
            turn,
            call_id,
            ..
        } = invocation;

        let arguments = match payload {
            ToolPayload::Function { arguments } => arguments,
            _ => {
                return Err(FunctionCallError::Fatal(format!(
                    "{TOOL_SUGGEST_TOOL_NAME} handler received unsupported payload"
                )));
            }
        };

        let args: ToolSuggestArgs = parse_arguments(&arguments)?;
        let suggest_reason = args.suggest_reason.trim();
        if suggest_reason.is_empty() {
            return Err(FunctionCallError::RespondToModel(
                "suggest_reason must not be empty".to_string(),
            ));
        }
        if args.action_type != DiscoverableToolAction::Install {
            return Err(FunctionCallError::RespondToModel(
                "tool suggestions currently support only action_type=\"install\"".to_string(),
            ));
        }
        if args.tool_type == DiscoverableToolType::Plugin
            && turn.app_server_client_name.as_deref() == Some("lyra-tui")
        {
            return Err(FunctionCallError::RespondToModel(
                "plugin tool suggestions are not available in lyra-tui yet".to_string(),
            ));
        }

        let discoverable_tools =
            connectors::list_tool_suggest_discoverable_tools_with_auth(&turn.config, None, &[])
                .await
                .map(|discoverable_tools| {
                    filter_tool_suggest_discoverable_tools_for_client(
                        discoverable_tools,
                        turn.app_server_client_name.as_deref(),
                    )
                })
                .map_err(|err| {
                    FunctionCallError::RespondToModel(format!(
                        "tool suggestions are unavailable right now: {err}"
                    ))
                })?;

        let tool = discoverable_tools
            .into_iter()
            .find(|tool| tool.tool_type() == args.tool_type && tool.id() == args.tool_id)
            .ok_or_else(|| {
                FunctionCallError::RespondToModel(format!(
                    "tool_id must match one of the discoverable tools exposed by {TOOL_SUGGEST_TOOL_NAME}"
                ))
            })?;

        let request_id = RequestId::String(format!("tool_suggestion_{call_id}").into());
        let params = build_tool_suggestion_elicitation_request(
            TOOL_SUGGEST_SERVER_NAME,
            session.conversation_id.to_string(),
            turn.sub_id.clone(),
            &args,
            suggest_reason,
            &tool,
        );
        let response = session
            .request_mcp_server_elicitation(turn.as_ref(), request_id, params)
            .await;
        let user_confirmed = response
            .as_ref()
            .is_some_and(|response| response.action == ElicitationAction::Accept);

        let completed = if user_confirmed {
            verify_tool_suggestion_completed(&session, &tool).await
        } else {
            false
        };

        let content = serde_json::to_string(&ToolSuggestResult {
            completed,
            user_confirmed,
            tool_type: args.tool_type,
            action_type: args.action_type,
            tool_id: tool.id().to_string(),
            tool_name: tool.name().to_string(),
            suggest_reason: suggest_reason.to_string(),
        })
        .map_err(|err| {
            FunctionCallError::Fatal(format!(
                "failed to serialize {TOOL_SUGGEST_TOOL_NAME} response: {err}"
            ))
        })?;

        Ok(FunctionToolOutput::from_text(content, Some(true)))
    }
}

async fn verify_tool_suggestion_completed(
    session: &crate::session::session::Session,
    tool: &DiscoverableTool,
) -> bool {
    match tool {
        DiscoverableTool::Connector(_) => false,
        DiscoverableTool::Plugin(plugin) => {
            session.reload_user_config_layer().await;
            let config = session.get_config().await;
            verified_plugin_suggestion_completed(
                plugin.id.as_str(),
                config.as_ref(),
                session.services.plugins_manager.as_ref(),
            )
        }
    }
}

fn verified_plugin_suggestion_completed(
    tool_id: &str,
    config: &crate::config::Config,
    plugins_manager: &crate::plugins::PluginsManager,
) -> bool {
    plugins_manager
        .list_marketplaces_for_config(config, &[])
        .ok()
        .into_iter()
        .flat_map(|outcome| outcome.marketplaces)
        .flat_map(|marketplace| marketplace.plugins.into_iter())
        .any(|plugin| plugin.id == tool_id && plugin.installed)
}

#[cfg(test)]
#[path = "tool_suggest_tests.rs"]
mod tests;
