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
    answer_plan_question as answer_agent_plan_question, answer_question as answer_agent_question,
    archive_thread as archive_agent_thread, bind_session_project as bind_agent_session_project,
    create_session as create_agent_session, delete_session as delete_agent_session,
    ensure_thread as ensure_agent_thread, enter_plan_mode as enter_agent_plan_mode,
    fork_thread as fork_agent_thread, get_pending_interactions as get_agent_pending_interactions,
    get_plan as get_agent_plan, get_session as get_agent_session, get_thread as get_agent_thread,
    list_sessions as list_agent_sessions, list_threads as list_agent_threads,
    resolve_plan_approval as resolve_agent_plan_approval,
    resume_execution as resume_agent_execution, resume_thread as resume_agent_thread,
    rollback_thread as rollback_agent_thread, send_thread_turn as send_agent_thread_turn,
    send_turn as send_agent_turn, unarchive_thread as unarchive_agent_thread,
};
use crate::agent::types::{
    AgentAnswerPlanQuestionRequest, AgentAnswerQuestionRequest, AgentArchiveThreadRequest,
    AgentBindSessionProjectRequest, AgentCreateSessionRequest, AgentDeleteSessionRequest,
    AgentEnsureThreadRequest, AgentEnterPlanModeRequest, AgentForkThreadRequest,
    AgentGetPendingInteractionsRequest, AgentGetPlanRequest, AgentGetSessionRequest,
    AgentGetThreadRequest, AgentListSessionsRequest, AgentListThreadsRequest,
    AgentResolvePlanApprovalRequest, AgentResumeExecutionRequest, AgentResumeThreadRequest,
    AgentRollbackThreadRequest, AgentSendThreadTurnRequest, AgentSendTurnRequest,
    AgentUnarchiveThreadRequest, CommandApprovalSubmitRequest,
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

pub fn ensure_agent_thread_json(request_json: String) -> Result<String> {
    let request: AgentEnsureThreadRequest = parse_json(&request_json)?;
    to_json(&ensure_agent_thread(request)?)
}

pub fn get_agent_thread_json(request_json: String) -> Result<String> {
    let request: AgentGetThreadRequest = parse_json(&request_json)?;
    to_json(&get_agent_thread(request)?)
}

pub fn list_agent_threads_json(request_json: String) -> Result<String> {
    let request: AgentListThreadsRequest = parse_json(&request_json)?;
    to_json(&list_agent_threads(request)?)
}

pub fn fork_agent_thread_json(request_json: String) -> Result<String> {
    let request: AgentForkThreadRequest = parse_json(&request_json)?;
    to_json(&fork_agent_thread(request)?)
}

pub fn archive_agent_thread_json(request_json: String) -> Result<String> {
    let request: AgentArchiveThreadRequest = parse_json(&request_json)?;
    to_json(&archive_agent_thread(request)?)
}

pub fn unarchive_agent_thread_json(request_json: String) -> Result<String> {
    let request: AgentUnarchiveThreadRequest = parse_json(&request_json)?;
    to_json(&unarchive_agent_thread(request)?)
}

pub fn resume_agent_thread_json(request_json: String) -> Result<String> {
    let request: AgentResumeThreadRequest = parse_json(&request_json)?;
    to_json(&resume_agent_thread(request)?)
}

pub fn rollback_agent_thread_json(request_json: String) -> Result<String> {
    let request: AgentRollbackThreadRequest = parse_json(&request_json)?;
    to_json(&rollback_agent_thread(request)?)
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

pub fn send_agent_thread_turn_json(request_json: String) -> Result<String> {
    let request: AgentSendThreadTurnRequest = parse_json(&request_json)?;
    to_json(&send_agent_thread_turn(request)?)
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

pub fn answer_agent_question_json(request_json: String) -> Result<String> {
    let request: AgentAnswerQuestionRequest = parse_json(&request_json)?;
    to_json(&answer_agent_question(request)?)
}

pub fn answer_agent_plan_question_json(request_json: String) -> Result<String> {
    let request: AgentAnswerPlanQuestionRequest = parse_json(&request_json)?;
    to_json(&answer_agent_plan_question(request)?)
}

pub fn resolve_agent_plan_approval_json(request_json: String) -> Result<String> {
    let request: AgentResolvePlanApprovalRequest = parse_json(&request_json)?;
    to_json(&resolve_agent_plan_approval(request)?)
}

pub fn resume_agent_execution_json(request_json: String) -> Result<String> {
    let request: AgentResumeExecutionRequest = parse_json(&request_json)?;
    to_json(&resume_agent_execution(request)?)
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

pub fn submit_command_approval_json(request_json: String) -> Result<String> {
    let request: CommandApprovalSubmitRequest = parse_json(&request_json)?;
    to_json(&agent::service::submit_command_approval(request)?)
}

pub fn register_rust_event_callback(callback: Arc<dyn Fn(String) + Send + Sync + 'static>) {
    agent::register_rust_event_callback(callback);
}

pub fn clear_rust_event_callback() {
    agent::clear_rust_event_callback();
}

// --- MCP / External Tool Bridge ---

pub use crate::agent::persona_runtime::{set_persona_runtime_state, PersonaRuntimeState};
pub use crate::agent::tools::{
    clear_external_tools, register_external_tool, register_host_tools_bridge,
    set_browser_strategy_runtime_state, set_skill_prompts, unregister_external_tool,
    unregister_host_tool_set, unregister_mcp_server_tools, AgentToolError,
    BrowserStrategyRuntimeState, ExternalToolApprovalMode, ExternalToolExecutor,
    ExternalToolMetadata, ExternalToolSideEffectLevel, ExternalToolSideEffects,
    HostToolCallContext, HostToolDescriptor, RegisteredExternalTool, SkillPromptEntry,
    ToolExecutionMode,
};
pub use crate::provider::types::AgentToolDefinition;

#[derive(Clone, Debug)]
pub struct McpServerToolDescriptor {
    pub name: String,
    pub description: String,
    pub input_schema: Option<serde_json::Value>,
    pub output_schema: Option<serde_json::Value>,
    pub execution_mode: Option<ToolExecutionMode>,
    pub approval_mode: Option<ExternalToolApprovalMode>,
    pub side_effects: Option<ExternalToolSideEffects>,
}

/// Register all tools from an MCP server into the agent's dynamic tool set.
///
/// `server_id` is the unique MCP server identifier.
/// `tools` carries the MCP tool descriptors from introspection, including schemas and
/// side-effect hints when available.
/// `call_fn` is a callback that invokes the MCP tool and returns JSON output.
pub fn register_mcp_server_tools_bridge(
    server_id: &str,
    tools: Vec<McpServerToolDescriptor>,
    call_fn: std::sync::Arc<
        dyn Fn(&str, &str, &serde_json::Value) -> std::result::Result<serde_json::Value, String>
            + Send
            + Sync,
    >,
) {
    for tool in tools {
        let McpServerToolDescriptor {
            name,
            description,
            input_schema,
            output_schema,
            execution_mode,
            approval_mode,
            side_effects,
        } = tool;
        let tool_name = format!("mcp:{server_id}/{name}");
        let call_fn = call_fn.clone();
        let sid = server_id.to_string();
        let original_name = name.clone();
        register_external_tool(RegisteredExternalTool {
            definition: AgentToolDefinition {
                name: tool_name,
                description,
                input_schema: input_schema.unwrap_or_else(|| {
                    serde_json::json!({
                        "type": "object",
                        "additionalProperties": true,
                        "description": "Arguments to pass to the MCP tool"
                    })
                }),
            },
            metadata: ExternalToolMetadata {
                output_schema: output_schema
                    .unwrap_or_else(|| serde_json::json!({"type": "object"})),
                approval_mode: approval_mode.unwrap_or(ExternalToolApprovalMode::Ask),
                side_effects: side_effects.unwrap_or_default(),
            },
            execution_mode: execution_mode.unwrap_or(ToolExecutionMode::Serial),
            executor: std::sync::Arc::new(move |input, _context| {
                call_fn(&sid, &original_name, input).map_err(|e| AgentToolError {
                    code: "MCP_TOOL_ERROR".to_string(),
                    message: e.to_string(),
                    metadata: None,
                })
            }),
        });
    }
}
