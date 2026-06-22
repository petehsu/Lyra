use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

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
    HostCapabilityDispatcher,
    context_builder::{ContextBuilder, ProviderContextOptions},
    design_tools,
    prompt_policy::{self, PersonaContext, PromptAccounting, PromptPolicyInput},
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
pub(crate) const DEFAULT_SESSION_TITLE: &str = "新会话";
pub(crate) const LEGACY_DEFAULT_SESSION_TITLE: &str = "Lyra Agent";
pub struct LyraAgentBackend;

mod actions;
mod activity;
mod browser_loop_detector;
mod clarifications;
mod context;
pub(crate) mod context_window;
pub(crate) mod cut_store;
pub mod file_citations;
mod helpers;
pub mod inline_images;
mod memory;
mod memory_audit_export;
mod memory_autonomy;
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
mod memory_token_checkpoint;
mod network;
pub mod page_citations;
mod permission_policy;
mod permissions;
mod pinned_context;
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
mod state;
mod streaming_preview_state;
pub(crate) mod token_estimate;
pub(crate) mod tool_protocol;
mod tools;
mod transcript_citations;
mod turn_tool_telemetry;
mod turns;
mod types;

#[cfg(test)]
mod tests;

use self::{
    actions::*, activity::*, clarifications::*, context::*, file_citations::*, helpers::*,
    inline_images::*, memory::*, memory_audit_export::*, memory_autonomy::*,
    memory_derived_fields::*, memory_event_trigger::*, memory_layer::*, memory_layer_projection::*,
    memory_retrieval_policy::*, memory_store::*, memory_sync::*, memory_token_checkpoint::*,
    network::*, page_citations::*, permission_policy::*, permissions::*, projections::*,
    prompt_cache::*, provider::*, provider_config::*, rollback::*, session_ledger::*,
    session_resilience::*, session_store::*, session_trim::*, sessions::*, state::*,
    token_estimate::*, tool_protocol::*, tools::*, transcript_citations::*, turn_tool_telemetry::*,
    turns::*, types::*,
};

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

            "agent.cli.follow.read" => read_cli_follow(payload),
            "agent.cli.follow.update" => update_cli_follow(payload),
            "agent.turn.send" | "agent.turn.start" | "agent.turn.resume" => send_turn(payload),
            "agent.turn.cancel" => cancel_turn(payload),

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
            "agent.roles.update" => update_roles(payload),
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
        if let Ok(mut state) = state().lock() {
            state.event_callback = Some(callback);
        }
    }

    fn clear_event_callback(&self) {
        if let Ok(mut state) = state().lock() {
            state.event_callback = None;
        }
    }

    fn register_host_capability_dispatcher(&self, dispatcher: Arc<HostCapabilityDispatcher>) {
        if let Ok(mut state) = state().lock() {
            state.host_dispatcher = Some(dispatcher);
        }
    }

    fn clear_host_capability_dispatcher(&self) {
        if let Ok(mut state) = state().lock() {
            state.host_dispatcher = None;
        }
    }

    fn call_host_capability(&self, method: &str, payload: Value) -> Result<Value, String> {
        let dispatcher = state()
            .lock()
            .ok()
            .and_then(|state| state.host_dispatcher.clone())
            .ok_or_else(|| "No host capability dispatcher registered".to_string())?;
        let payload = serde_json::to_string(&payload)
            .map_err(|error| format!("Failed to serialize host capability payload: {error}"))?;
        let output = dispatcher(method.to_string(), payload)?;
        serde_json::from_str(&output)
            .map_err(|error| format!("Failed to deserialize host capability output: {error}"))
    }
}
