mod agent;
mod auth;
mod catalog;
mod discovery;
mod error;
mod memory;
mod paths;
mod profile;
mod provider;
mod secrets;
mod storage;

#[cfg(test)]
mod tests;

use napi::Result;
use serde::Deserialize;
use std::sync::Arc;

use crate::agent::service::{
    bind_session_project as bind_agent_session_project, create_session as create_agent_session,
    delete_session as delete_agent_session, get_session as get_agent_session,
    get_pending_interactions as get_agent_pending_interactions, list_sessions as list_agent_sessions,
    send_turn as send_agent_turn, answer_plan_question as answer_agent_plan_question,
    answer_question as answer_agent_question, enter_plan_mode as enter_agent_plan_mode,
    get_plan as get_agent_plan, resolve_plan_approval as resolve_agent_plan_approval,
};
use crate::agent::types::{
    AgentBindSessionProjectRequest, AgentCreateSessionRequest, AgentDeleteSessionRequest,
    AgentGetPendingInteractionsRequest, AgentGetSessionRequest, AgentListSessionsRequest,
    AgentSendTurnRequest, AgentAnswerPlanQuestionRequest, AgentAnswerQuestionRequest,
    AgentEnterPlanModeRequest, AgentGetPlanRequest, AgentResolvePlanApprovalRequest,
    CommandApprovalSubmitRequest,
};
use crate::error::{parse_json, to_json};
use crate::memory::{
    get_config as get_memory_config, run_scheduler_tick as run_memory_scheduler_tick,
    update_config as update_memory_config, GetAiMemoryConfigRequest, UpdateAiMemoryConfigRequest,
};
use crate::profile::service::{
    delete_profile, discover_models, read_preset_catalog_items, read_profiles,
    read_provider_catalog_items, set_default_profile, upsert_profile, validate_profile,
};
use crate::profile::types::{
    DeleteAiProfileRequest, DiscoverAiModelsRequest, SetDefaultAiProfileRequest,
    UpsertAiProfileRequest, ValidateAiProfileRequest,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageRootRequest {
    storage_root: String,
}

pub fn read_ai_profiles_json(request_json: String) -> Result<String> {
    let request: StorageRootRequest = parse_json(&request_json)?;
    to_json(&read_profiles(&request.storage_root)?)
}

pub fn read_ai_provider_catalog_json(_request_json: String) -> Result<String> {
    to_json(&read_provider_catalog_items())
}

pub fn read_ai_preset_catalog_json(_request_json: String) -> Result<String> {
    to_json(&read_preset_catalog_items())
}

pub fn upsert_ai_profile_json(request_json: String) -> Result<String> {
    let request: UpsertAiProfileRequest = parse_json(&request_json)?;
    to_json(&upsert_profile(request)?)
}

pub fn delete_ai_profile_json(request_json: String) -> Result<()> {
    let request: DeleteAiProfileRequest = parse_json(&request_json)?;
    delete_profile(request)
}

pub fn set_default_ai_profile_json(request_json: String) -> Result<String> {
    let request: SetDefaultAiProfileRequest = parse_json(&request_json)?;
    to_json(&set_default_profile(request)?)
}

pub fn validate_ai_profile_json(request_json: String) -> Result<String> {
    let request: ValidateAiProfileRequest = parse_json(&request_json)?;
    to_json(&validate_profile(request)?)
}

pub fn discover_ai_models_json(request_json: String) -> Result<String> {
    let request: DiscoverAiModelsRequest = parse_json(&request_json)?;
    to_json(&discover_models(request)?)
}

pub fn refresh_ai_models_json(request_json: String) -> Result<String> {
    let mut request: DiscoverAiModelsRequest = parse_json(&request_json)?;
    request.force_refresh = Some(true);
    to_json(&discover_models(request)?)
}

pub fn list_agent_sessions_json(request_json: String) -> Result<String> {
    let request: AgentListSessionsRequest = parse_json(&request_json)?;
    to_json(&list_agent_sessions(request)?)
}

pub fn create_agent_session_json(request_json: String) -> Result<String> {
    let request: AgentCreateSessionRequest = parse_json(&request_json)?;
    to_json(&create_agent_session(request)?)
}

pub fn get_agent_session_json(request_json: String) -> Result<String> {
    let request: AgentGetSessionRequest = parse_json(&request_json)?;
    to_json(&get_agent_session(request)?)
}

pub fn bind_agent_session_project_json(request_json: String) -> Result<String> {
    let request: AgentBindSessionProjectRequest = parse_json(&request_json)?;
    to_json(&bind_agent_session_project(request)?)
}

pub fn delete_agent_session_json(request_json: String) -> Result<()> {
    let request: AgentDeleteSessionRequest = parse_json(&request_json)?;
    delete_agent_session(request)
}

pub fn send_agent_turn_json(request_json: String) -> Result<String> {
    let request: AgentSendTurnRequest = parse_json(&request_json)?;
    to_json(&send_agent_turn(request)?)
}

pub fn enter_agent_plan_mode_json(request_json: String) -> Result<String> {
    let request: AgentEnterPlanModeRequest = parse_json(&request_json)?;
    to_json(&enter_agent_plan_mode(request)?)
}

pub fn get_agent_plan_json(request_json: String) -> Result<String> {
    let request: AgentGetPlanRequest = parse_json(&request_json)?;
    to_json(&get_agent_plan(request)?)
}

pub fn get_agent_pending_interactions_json(request_json: String) -> Result<String> {
    let request: AgentGetPendingInteractionsRequest = parse_json(&request_json)?;
    to_json(&get_agent_pending_interactions(request)?)
}

pub fn answer_agent_question_json(request_json: String) -> Result<()> {
    let request: AgentAnswerQuestionRequest = parse_json(&request_json)?;
    answer_agent_question(request)
}

pub fn answer_agent_plan_question_json(request_json: String) -> Result<()> {
    let request: AgentAnswerPlanQuestionRequest = parse_json(&request_json)?;
    answer_agent_plan_question(request)
}

pub fn resolve_agent_plan_approval_json(request_json: String) -> Result<String> {
    let request: AgentResolvePlanApprovalRequest = parse_json(&request_json)?;
    to_json(&resolve_agent_plan_approval(request)?)
}

pub fn get_ai_memory_config_json(request_json: String) -> Result<String> {
    let request: GetAiMemoryConfigRequest = parse_json(&request_json)?;
    to_json(&get_memory_config(request)?)
}

pub fn update_ai_memory_config_json(request_json: String) -> Result<String> {
    let request: UpdateAiMemoryConfigRequest = parse_json(&request_json)?;
    to_json(&update_memory_config(request)?)
}

pub fn run_ai_memory_scheduler_tick(storage_root: &str) -> Result<usize> {
    run_memory_scheduler_tick(storage_root)
}

pub fn submit_command_approval_json(request_json: String) -> Result<()> {
    let request: CommandApprovalSubmitRequest = parse_json(&request_json)?;
    agent::service::submit_command_approval(request)
}

pub fn register_rust_event_callback(callback: Arc<dyn Fn(String) + Send + Sync + 'static>) {
    agent::register_rust_event_callback(callback);
}

pub fn clear_rust_event_callback() {
    agent::clear_rust_event_callback();
}

// --- MCP / External Tool Bridge ---

pub use crate::agent::tools::{
    clear_external_tools, register_external_tool, set_skill_prompts, unregister_external_tool,
    unregister_mcp_server_tools, AgentToolError, ExternalToolExecutor, RegisteredExternalTool,
    SkillPromptEntry,
};
pub use crate::provider::types::AgentToolDefinition;

/// Register all tools from an MCP server into the agent's dynamic tool set.
///
/// `server_id` is the unique MCP server identifier.
/// `tools` is a list of `(name, description)` pairs from introspection.
/// `call_fn` is a callback that invokes the MCP tool and returns JSON output.
pub fn register_mcp_server_tools_bridge(
    server_id: &str,
    tools: Vec<(String, String)>,
    call_fn: std::sync::Arc<
        dyn Fn(&str, &str, &serde_json::Value) -> std::result::Result<serde_json::Value, String>
            + Send
            + Sync,
    >,
) {
    for (name, description) in tools {
        let tool_name = format!("mcp:{server_id}/{name}");
        let call_fn = call_fn.clone();
        let sid = server_id.to_string();
        let original_name = name.clone();
        register_external_tool(RegisteredExternalTool {
            definition: AgentToolDefinition {
                name: tool_name,
                description,
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "arguments": {
                            "type": "object",
                            "description": "Arguments to pass to the MCP tool"
                        }
                    }
                }),
            },
            executor: std::sync::Arc::new(move |input| {
                call_fn(&sid, &original_name, input).map_err(|e| AgentToolError {
                    code: "MCP_TOOL_ERROR".to_string(),
                    message: e.to_string(),
                    metadata: None,
                })
            }),
        });
    }
}
