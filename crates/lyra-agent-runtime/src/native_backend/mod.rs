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
    prompt_policy::{self, PromptAccounting, PromptPolicyInput},
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
pub(crate) const LYRA_TURN_FINISH_TOOL: &str = "lyra_turn_finish";

pub struct LyraAgentBackend;

mod actions;
mod activity;
mod clarifications;
mod context;
mod helpers;
mod memory;
mod memory_autonomy;
mod memory_store;
mod network;
mod permission_policy;
mod permissions;
mod projections;
mod provider;
mod provider_config;
mod rollback;
mod sessions;
mod state;
mod tools;
mod turns;
mod types;
mod workflows;

#[cfg(test)]
mod tests;

use self::{
    actions::*, activity::*, clarifications::*, context::*, helpers::*, memory::*,
    memory_autonomy::*, memory_store::*, network::*, permission_policy::*, permissions::*,
    projections::*, provider::*, provider_config::*, rollback::*, sessions::*, state::*, tools::*,
    turns::*, types::*, workflows::*,
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
            "agent.session.split" => fork_session(payload, "Split Session"),
            "agent.session.transfer" => fork_session(payload, "Transferred Session"),
            "agent.session.compact" => compact_session(payload),
            "agent.session.automation.update" => update_automation(payload),
            "agent.cli.follow.read" => read_cli_follow(payload),
            "agent.cli.follow.update" => update_cli_follow(payload),
            "agent.turn.send" | "agent.turn.start" | "agent.turn.resume" | "agent.turn.retry" => {
                send_turn(payload)
            }
            "agent.turn.cancel" => cancel_turn(payload),
            "agent.selfdev.start" => start_selfdev(payload),
            "agent.selfdev.status" => selfdev_status(payload),
            "agent.selfdev.sendTurn" => send_turn(payload),
            "agent.memory.snapshot" => memory_snapshot(payload),
            "agent.memory.audit" => memory_audit(payload),
            "agent.memory.trim.run" => trim_memory(payload),
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
            "agent.memory.shared.search" => shared_memory_search(payload),
            "agent.memory.shared.update" => shared_memory_update(payload),
            "agent.proactive.list" => proactive_list(payload),
            "agent.proactive.dismiss" => proactive_dismiss(payload),
            "agent.proactive.openSession" => proactive_open_session(payload),
            "agent.rollback.preview" => rollback_preview(payload),
            "agent.rollback.restore" => rollback_restore(payload),
            "agent.permission.respond" => respond_permission(payload),
            "agent.permissionPolicy.read" => read_permission_policy(),
            "agent.permissionPolicy.setMode" => set_permission_policy_mode(payload),
            "agent.clarification.respond" => respond_clarification(payload),
            "agent.config.read" => read_config(),
            "agent.config.update" => update_config(payload),
            "agent.provider.profile.save" => save_provider_profile(payload),
            "agent.provider.options.update" => update_provider_options(payload),
            "agent.models.list" => list_models(payload),
            "agent.models.switch" => switch_model(payload),
            "agent.models.refresh" => list_models(payload),
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
            "agent.subagent.run" => run_subagent(payload),
            "agent.btw.run" => run_btw(payload),
            "agent.goals.list"
            | "agent.goals.open"
            | "agent.goals.resume"
            | "agent.goals.show"
            | "agent.goals.create"
            | "agent.goals.update"
            | "agent.goals.checkpoint" => goals(method, payload),
            "agent.overnight.start" => start_overnight(payload),
            "agent.overnight.list" => list_overnight(),
            "agent.overnight.status" | "agent.overnight.log" | "agent.overnight.review" => {
                read_overnight(payload)
            }
            "agent.overnight.cancel" => cancel_overnight(payload),
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
