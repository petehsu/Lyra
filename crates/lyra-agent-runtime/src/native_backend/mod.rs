use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, OnceLock},
    thread,
    time::{Duration, Instant},
};

use tokio_util::sync::CancellationToken;

use chrono::{DateTime, SecondsFormat, Utc};
use glob::Pattern;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use url::Url;
use uuid::Uuid;

#[cfg(test)]
use crate::tool_activity_service::ToolActivityService;
use crate::{
    AgentRuntimeBackend, AgentRuntimeError, AgentRuntimeResult, EventCallback,
    HostCapabilityDispatcher, ProviderTransportKind,
    context_builder::{ContextBuilder, ProviderContextOptions},
    prompt_policy::{self, PersonaContext, PromptAccounting, PromptPolicyInput},
    recovering_mutex::RecoveringMutex as Mutex,
};

const DEFAULT_TOOL_CONTENT_CHARS: usize = 16_000;
const DEFAULT_FILE_READ_BYTES: usize = 96_000;
const MAX_FILE_READ_BYTES: usize = 1_000_000;
const DEFAULT_LIST_LIMIT: usize = 200;
const DEFAULT_SEARCH_LIMIT: usize = 80;
const MAX_SEARCH_FILES: usize = 10_000;
const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 30_000;
const MAX_COMMAND_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_COMMAND_OUTPUT_BYTES: usize = 20_000;
const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
/// Empty-string sentinel: the runtime must not hardcode a display-language
/// title.  The frontend renders its localized placeholder
/// (`aiPanel.defaultSessionTitle`) for null/empty titles.
pub(crate) const DEFAULT_SESSION_TITLE: &str = "";
/// Legacy Chinese default title — kept only for placeholder detection so
/// sessions created before the sentinel migration still get auto-titled.
pub(crate) const LEGACY_DEFAULT_SESSION_TITLE_ZH: &str = "新会话";
pub(crate) const LEGACY_DEFAULT_SESSION_TITLE: &str = "Lyra Agent";
pub struct LyraAgentBackend;

mod actions;
mod activity;
mod browser_loop_detector;
mod clarifications;
mod context;
pub(crate) mod context_window;
pub(crate) mod cut_store;
mod elevation;
pub mod file_citations;
mod helpers;
mod import_sync;
pub mod inline_images;
mod mcp_catalog;
mod memory;
mod memory_audit_export;
mod memory_autonomy;
mod memory_compress;
mod memory_derived_fields;
mod memory_embedding_config;
mod memory_event_trigger;
mod memory_job_budget;
mod memory_layer;
mod memory_layer_projection;
mod memory_retrieval_policy;
mod memory_stability_policy;
mod memory_store;
mod memory_sync;
mod network;
mod oma;
pub mod page_citations;
mod permission_policy;
mod permissions;
mod pinned_context;
mod plan_actions;
mod plan_store;
mod projections;
mod prompt_cache;
mod provider;
mod provider_config;
mod providers;
mod rollback;
mod secret_guard;
pub(crate) mod session_ledger;
mod session_resilience;
mod session_runtime;
mod session_store;
pub(crate) mod session_trim;
mod sessions;
mod skill_catalog;
mod state;
mod streaming_preview_state;
pub(crate) mod token_estimate;
mod tool_loop_detector;
pub(crate) mod tool_protocol;
pub(crate) mod tools;
mod transcript_citations;
mod turn_engine;
mod turn_tool_telemetry;
mod turns;
mod types;
mod usage_stats;
mod waiters;

#[cfg(test)]
mod tests;

pub(crate) use state::flush_state;

use self::{
    actions::*, activity::*, clarifications::*, context::*, elevation::*, file_citations::*,
    helpers::*, import_sync::*, inline_images::*, mcp_catalog::*, memory::*,
    memory_audit_export::*, memory_autonomy::*, memory_compress::*, memory_derived_fields::*,
    memory_event_trigger::*, memory_layer::*, memory_layer_projection::*,
    memory_retrieval_policy::*, memory_store::*, memory_sync::*, network::*, oma::*,
    page_citations::*, permission_policy::*, permissions::*, plan_actions::*, plan_store::*,
    projections::*, prompt_cache::*, provider::*, provider_config::*, rollback::*,
    session_ledger::*, session_resilience::*, session_store::*, session_trim::*, sessions::*,
    skill_catalog::*, state::*, token_estimate::*, tool_protocol::*, tools::*,
    transcript_citations::*, turn_tool_telemetry::*, turns::*, types::*, usage_stats::*,
};

fn open_sqlite_connection(path: &Path) -> AgentRuntimeResult<rusqlite::Connection> {
    let conn = rusqlite::Connection::open(path)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    conn.busy_timeout(SQLITE_BUSY_TIMEOUT)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    conn.pragma_update(None, "busy_timeout", 5_000_i64)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(conn)
}

impl AgentRuntimeBackend for LyraAgentBackend {
    fn call_agent_method(&self, method: &str, payload: Value) -> AgentRuntimeResult<Value> {
        match method {
            "agent.session.create" => create_session(payload),
            "agent.session.read" => read_session(payload),
            "agent.session.list" => list_sessions(payload),
            "agent.session.save" => set_saved(payload, true),
            "agent.session.unsave" => set_saved(payload, false),
            "agent.session.rename" => rename_session(payload),
            "agent.session.archive" => archive_session(payload),
            "agent.session.delete" => delete_session(payload),
            "agent.session.bindProject" => bind_project(payload),
            "agent.usage.read" => read_usage_stats(payload),

            "agent.cli.follow.read" => read_cli_follow(payload),
            "agent.cli.follow.update" => update_cli_follow(payload),
            "agent.turn.send" | "agent.turn.start" | "agent.turn.resume" => send_turn(payload),
            "agent.turn.cancel" => cancel_turn(payload),
            "agent.plan.list" => project_plan_list(payload),
            "agent.plan.read" => project_plan_read(payload),
            "agent.plan.delete" => project_plan_delete(payload),
            "agent.plan.revise" => project_plan_revise(payload),
            "agent.plan.review.respond" => plan_review_respond(payload),
            "agent.todo.read-project" => project_todo_read_for_project(payload),
            "agent.session.createTemporary" => create_temporary_session(payload),
            "agent.oma.setMode" => set_agent_mode(payload),
            "agent.oma.addAgent" => add_oma_agent(payload),
            "agent.oma.removeAgent" => remove_oma_agent(payload),
            "agent.oma.setActiveChannel" => set_oma_active_channel(payload),

            "agent.memory.snapshot" => memory_snapshot(payload),
            "agent.memory.audit" => memory_audit(payload),
            "agent.memory.recover.run" => recover_memory(payload),
            "agent.memory.longterm.create" => long_term_memory_create(payload),
            "agent.memory.longterm.search" => long_term_memory_search(payload),
            "agent.memory.longterm.update" => long_term_memory_update(payload),
            "agent.memory.longterm.forget" => long_term_memory_forget(payload),
            "agent.memory.longterm.list" => long_term_memory_list(payload),
            "agent.memory.longterm.link" => long_term_memory_link(payload),
            "agent.memory.longterm.rebuildIndex" => long_term_memory_rebuild_index(payload),
            "agent.memory.longterm.cleanupCandidates" => {
                long_term_memory_cleanup_candidates(payload)
            }
            "agent.memory.candidates.review" => memory_review_candidates(payload),
            "agent.memory.candidates.apply" => memory_apply_candidate(payload),
            "agent.memory.candidates.reject" => memory_reject_candidate(payload),
            "agent.memory.explainInjection" => memory_explain_injection(payload),
            "agent.memory.exportAudit" => memory_export_audit(payload),
            "agent.memory.exportLayerProjections" => memory_export_layer_projections(payload),
            "agent.memory.frozen.search" => frozen_memory_search(payload),
            "agent.memory.frozen.create" => frozen_memory_create(payload),
            "agent.memory.frozen.update" => frozen_memory_update(payload),
            "agent.memory.frozen.forget" => frozen_memory_forget(payload),
            "agent.memory.layers.describe" => memory_layers_describe(payload),
            "agent.memory.sync.reconcile" => memory_sync_reconcile(payload),
            "agent.memory.shared.search" => shared_memory_search(payload),
            "agent.memory.shared.update" => shared_memory_update(payload),
            "agent.proactive.list" => proactive_list(payload),
            "agent.proactive.dismiss" => proactive_dismiss(payload),
            "agent.proactive.openSession" => proactive_open_session(payload),
            "agent.rollback.preview" => rollback_preview(payload),
            "agent.rollback.restore" => rollback_restore(payload),
            "agent.message.resolve" => resolve_message_from_payload(&payload),
            "agent.permission.respond" => respond_permission(payload),
            "agent.permissionPolicy.read" => read_permission_policy(),
            "agent.permissionPolicy.setMode" => set_permission_policy_mode(payload),
            "agent.elevation.setSecret" => set_elevation_secret(payload),
            "agent.elevation.clear" => clear_elevation_secret(),
            "agent.elevation.validate" => validate_sudo_password(payload),
            "agent.clarification.respond" => respond_clarification(payload),
            "agent.config.read" => read_config(),
            "agent.config.update" => update_config(payload),
            "agent.provider.catalog.read" => providers::read_provider_catalog(),
            "agent.provider.profile.save" => save_provider_profile(payload),
            "agent.provider.options.update" => update_provider_options(payload),
            "agent.models.list" => list_models(payload),
            "agent.models.switch" => switch_model(payload),
            "agent.models.enable" => set_model_enabled(payload),
            "agent.models.delete" => delete_model(payload),
            "agent.models.refresh" => refresh_models(payload),
            "agent.skills.list" => skill_list(),
            "agent.skills.inspect" => skill_inspect(payload),
            "agent.skills.activate" => set_skill_active(payload, true),
            "agent.skills.deactivate" => set_skill_active(payload, false),
            "agent.skills.installFromLocal" => skill_install_from_local(payload),
            "agent.skills.installFromGit" => skill_install_from_git(payload),
            "agent.skills.installFromStore" => skill_install_from_store(payload),
            "agent.skills.uninstall" => skill_uninstall(payload),
            "agent.skills.refreshStore" => skill_refresh_store(payload),
            "agent.skills.updateStoreConfig" => skill_update_store_config(payload),
            "agent.mcp.list" => execute_mcp_state_change("mcp_server_list", &payload)
                .map_err(AgentRuntimeError::Core),
            "agent.mcp.upsert" => mcp_server_upsert(payload),
            "agent.mcp.remove" => mcp_server_remove(payload),
            "agent.mcp.connect" => execute_mcp_state_change("mcp_server_connect", &payload)
                .map_err(AgentRuntimeError::Core),
            "agent.mcp.disconnect" => execute_mcp_state_change("mcp_server_disconnect", &payload)
                .map_err(AgentRuntimeError::Core),
            "agent.mcp.reload" => execute_mcp_state_change("mcp_server_reload", &payload)
                .map_err(AgentRuntimeError::Core),
            "agent.mcp.discoverTools" => execute_mcp_state_change("mcp_tool_discover", &payload)
                .map_err(AgentRuntimeError::Core),
            "agent.mcp.inspectTool" => execute_mcp_state_change("mcp_tool_inspect", &payload)
                .map_err(AgentRuntimeError::Core),
            "agent.mcp.executeTool" => execute_mcp_state_change("mcp_tool_execute", &payload)
                .map_err(AgentRuntimeError::Core),
            "agent.import.listSources" => import_list_sources(),
            "agent.import.getPreferences" => import_get_preferences(),
            "agent.import.setPreferences" => import_set_preferences(payload),
            "agent.import.detect" => import_detect(payload),
            "agent.import.sync" => import_sync(payload),
            "agent.accounts.list" => list_accounts(),
            "agent.accounts.login" => login_account(payload),
            "agent.accounts.loginProviders" => login_providers(),
            "agent.accounts.loginStart" => start_account_login(payload),
            "agent.accounts.loginComplete" => complete_account_login(payload),
            "agent.accounts.switch" => switch_account(payload),
            "agent.accounts.remove" => remove_account(payload),
            "agent.action.improve" => action_turn(payload, "Improve the current work."),
            "agent.action.refactor" => action_turn(payload, "Refactor the current work."),
            "agent.action.review" => action_turn(payload, "Review the current work."),
            "agent.action.judge" => action_turn(payload, "Judge the current result."),
            "agent.action.poke" => poke_session(payload),

            _ => Err(AgentRuntimeError::UnknownMethod(method.to_string())),
        }
    }

    fn register_event_callback(&self, callback: Arc<EventCallback>) {
        set_event_callback(Some(callback));
    }

    fn clear_event_callback(&self) {
        set_event_callback(None);
    }

    fn register_host_capability_dispatcher(&self, dispatcher: Arc<HostCapabilityDispatcher>) {
        set_host_dispatcher(Some(dispatcher.clone()));
        if let Err(error) = migrate_legacy_provider_api_keys_to_secure_storage(dispatcher) {
            eprintln!("Failed to migrate legacy provider API keys to secure storage: {error}");
        }
    }

    fn clear_host_capability_dispatcher(&self) {
        set_host_dispatcher(None);
    }

    fn call_host_capability(&self, method: &str, payload: Value) -> Result<Value, String> {
        let dispatcher = host_dispatcher()
            .ok_or_else(|| "No host capability dispatcher registered".to_string())?;
        let timeout_ms =
            tools::requested_timeout_ms(&payload).unwrap_or(tools::DEFAULT_HOST_TOOL_TIMEOUT_MS);
        tools::invoke_host_capability_with_timeout(
            dispatcher,
            method.to_string(),
            payload,
            timeout_ms,
        )
    }
}
