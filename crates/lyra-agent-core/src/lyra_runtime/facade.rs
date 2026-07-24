use std::sync::Arc;

use lyra_agent_runtime::{
    AgentRuntimeBackend, AgentRuntimeError, AgentRuntimeServices, EventCallback,
    HostCapabilityDispatcher as RuntimeHostCapabilityDispatcher,
    clear_host_capability_dispatcher as runtime_clear_host_capability_dispatcher,
    clear_runtime_event_callback,
    register_host_capability_dispatcher as runtime_register_host_capability_dispatcher,
    register_runtime_event_callback,
};
use serde_json::Value;
use thiserror::Error;

pub use lyra_agent_api::{
    AgentFollowState, AgentMessage, AgentRollbackChangedFile as RollbackChangedFile,
    AgentRollbackPreviewResponse as RollbackPreviewResponse,
    AgentRollbackRestoreResponse as RollbackRestoreResponse, AgentRuntimeEvent, AgentSessionKind,
    AgentSessionSnapshot, AgentSessionStatus as TurnStatus, AgentToolActivity as ToolActivity,
    AgentToolStatus as ToolActivityStatus,
};

pub type HostCapabilityDispatcher = RuntimeHostCapabilityDispatcher;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImageInput {
    pub media_type: String,
    pub data: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("session not found: {0}")]
    SessionNotFound(String),
    #[error("turn not running for session: {0}")]
    TurnNotRunning(String),
    #[error("provider failed: {0}")]
    Provider(String),
    #[error("serialization failed: {0}")]
    Serialization(String),
    #[error("runtime lock failed")]
    RuntimeLock,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClarificationAnswer {
    pub answer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_option: Option<String>,
}

fn map_runtime_error(error: AgentRuntimeError) -> AgentError {
    match error {
        AgentRuntimeError::Cancelled => AgentError::Provider("turn cancelled".to_string()),
        AgentRuntimeError::Serialization(message) => AgentError::Serialization(message),
        AgentRuntimeError::UnknownMethod(method) => {
            AgentError::BadRequest(format!("unknown agent runtime method: {method}"))
        }
        AgentRuntimeError::ProviderFailure { failure } => AgentError::Provider(failure.to_string()),
        AgentRuntimeError::ProviderProtocol { kind, detail } => {
            AgentError::Provider(format!("{kind}: {detail}"))
        }
        AgentRuntimeError::ProviderTransport { kind, detail } => {
            AgentError::Provider(format!("{kind}: {detail}"))
        }
        AgentRuntimeError::Core(message)
        | AgentRuntimeError::BackendUnavailable(message)
        | AgentRuntimeError::HostCapability(message) => AgentError::Provider(message),
    }
}

fn call_agent_method(method: &str, payload: String) -> Result<String, AgentError> {
    let payload: Value = serde_json::from_str(&payload)
        .map_err(|error| AgentError::Serialization(error.to_string()))?;
    let output = AgentRuntimeServices::default()
        .handle_agent_request(method, payload)
        .map_err(map_runtime_error)?;
    serde_json::to_string(&output).map_err(|error| AgentError::Serialization(error.to_string()))
}

macro_rules! json_facade {
    ($name:ident, $method:literal) => {
        pub fn $name(payload: String) -> Result<String, AgentError> {
            call_agent_method($method, payload)
        }
    };
}

pub fn register_rust_event_callback(callback: Arc<EventCallback>) {
    register_runtime_event_callback(callback);
}

pub fn clear_rust_event_callback() {
    clear_runtime_event_callback();
}

pub fn register_host_capability_dispatcher(dispatcher: Arc<HostCapabilityDispatcher>) {
    runtime_register_host_capability_dispatcher(dispatcher);
}

pub fn clear_host_capability_dispatcher() {
    runtime_clear_host_capability_dispatcher();
}

pub fn call_host_capability(method: &str, payload: Value) -> Result<Value, String> {
    lyra_agent_runtime::LyraAgentBackend.call_host_capability(method, payload)
}

pub fn ask_user_permission(
    _session_id: &str,
    _title: &str,
    _detail: &str,
) -> Result<bool, AgentError> {
    Err(AgentError::Provider(
        "permission requests are delivered through structured runtime events".to_string(),
    ))
}

pub fn ask_user_clarification(
    _session_id: &str,
    _question: &str,
    _options: Vec<Value>,
    _allow_custom_answer: bool,
    _detail: Option<String>,
) -> Result<ClarificationAnswer, AgentError> {
    Err(AgentError::Provider(
        "clarification requests are delivered through structured runtime events".to_string(),
    ))
}

json_facade!(create_session_json, "agent.session.create");
json_facade!(bind_project_session_json, "agent.session.bindProject");
json_facade!(read_session_json, "agent.session.read");
json_facade!(list_agent_sessions_json, "agent.session.list");
json_facade!(save_session_json, "agent.session.save");
json_facade!(unsave_session_json, "agent.session.unsave");
json_facade!(rename_session_json, "agent.session.rename");
json_facade!(archive_session_json, "agent.session.archive");
json_facade!(delete_session_json, "agent.session.delete");
json_facade!(send_turn_json, "agent.turn.send");
json_facade!(cancel_turn_json, "agent.turn.cancel");

json_facade!(agent_memory_snapshot_json, "agent.memory.snapshot");
json_facade!(agent_memory_audit_json, "agent.memory.audit");
json_facade!(agent_memory_recover_run_json, "agent.memory.recover.run");
json_facade!(
    agent_memory_shared_search_json,
    "agent.memory.shared.search"
);
json_facade!(
    agent_memory_shared_update_json,
    "agent.memory.shared.update"
);

json_facade!(preview_rollback_json, "agent.rollback.preview");
json_facade!(restore_rollback_json, "agent.rollback.restore");
json_facade!(respond_permission_json, "agent.permission.respond");
json_facade!(respond_clarification_json, "agent.clarification.respond");

json_facade!(read_agent_config_json, "agent.config.read");
json_facade!(update_agent_config_json, "agent.config.update");
json_facade!(
    save_agent_provider_profile_json,
    "agent.provider.profile.save"
);
json_facade!(
    update_agent_provider_options_json,
    "agent.provider.options.update"
);
json_facade!(list_agent_models_json, "agent.models.list");
json_facade!(switch_agent_model_json, "agent.models.switch");
json_facade!(refresh_agent_models_json, "agent.models.refresh");
json_facade!(update_agent_roles_json, "agent.roles.update");

json_facade!(run_improve_session_json, "agent.action.improve");
json_facade!(refactor_session_json, "agent.action.refactor");
json_facade!(trigger_poke_session_json, "agent.action.poke");
json_facade!(run_review_session_json, "agent.action.review");
json_facade!(run_judge_session_json, "agent.action.judge");
json_facade!(list_agent_accounts_json, "agent.accounts.list");
json_facade!(login_agent_account_json, "agent.accounts.login");
json_facade!(
    list_agent_login_providers_json,
    "agent.accounts.loginProviders"
);
json_facade!(start_agent_account_login_json, "agent.accounts.loginStart");
json_facade!(
    complete_agent_account_login_json,
    "agent.accounts.loginComplete"
);
json_facade!(switch_agent_account_json, "agent.accounts.switch");
json_facade!(remove_agent_account_json, "agent.accounts.remove");
