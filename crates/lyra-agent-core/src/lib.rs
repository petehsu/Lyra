#![allow(
    unknown_lints,
    clippy::collapsible_match,
    clippy::manual_checked_ops,
    clippy::unnecessary_sort_by,
    clippy::useless_conversion
)]

#[path = "jcode_core/vendor/root_src/agent/mod.rs"]
mod agent;
#[path = "jcode_core/vendor/root_src/ambient/mod.rs"]
mod ambient;
#[path = "jcode_core/vendor/root_src/ambient_runner.rs"]
mod ambient_runner;
#[path = "jcode_core/vendor/root_src/ambient_scheduler.rs"]
mod ambient_scheduler;
#[path = "jcode_core/vendor/root_src/auth/mod.rs"]
mod auth;
#[path = "jcode_core/vendor/root_src/background/mod.rs"]
mod background;
#[path = "jcode_core/vendor/root_src/build.rs"]
mod build;
#[path = "jcode_core/vendor/root_src/bus.rs"]
mod bus;
#[path = "jcode_core/vendor/root_src/cache_tracker.rs"]
mod cache_tracker;
#[path = "jcode_core/vendor/root_src/channel.rs"]
mod channel;
mod cli;
#[path = "jcode_core/vendor/root_src/compaction.rs"]
mod compaction;
#[path = "jcode_core/vendor/root_src/config/mod.rs"]
mod config;
#[path = "jcode_core/vendor/root_src/copilot_usage.rs"]
mod copilot_usage;
#[path = "jcode_core/vendor/root_src/embedding_stub.rs"]
mod embedding;
#[path = "jcode_core/vendor/root_src/env.rs"]
mod env;
#[path = "jcode_core/vendor/root_src/gateway/mod.rs"]
mod gateway;
mod git_runtime;
#[path = "jcode_core/vendor/root_src/gmail.rs"]
mod gmail;
#[path = "jcode_core/vendor/root_src/goal.rs"]
mod goal;
#[path = "jcode_core/vendor/root_src/id.rs"]
mod id;
#[path = "jcode_core/vendor/root_src/import.rs"]
mod import;
mod jcode_core;
mod jcode_gui_actions;
#[path = "jcode_core/vendor/root_src/logging.rs"]
mod logging;
#[path = "jcode_core/vendor/root_src/login_qr.rs"]
mod login_qr;
#[path = "jcode_core/vendor/root_src/mcp/mod.rs"]
mod mcp;
#[path = "jcode_core/vendor/root_src/memory/mod.rs"]
mod memory;
#[path = "jcode_core/vendor/root_src/memory_agent.rs"]
mod memory_agent;
#[path = "jcode_core/vendor/root_src/memory_graph.rs"]
mod memory_graph;
#[path = "jcode_core/vendor/root_src/memory_log.rs"]
mod memory_log;
#[path = "jcode_core/vendor/root_src/memory_types.rs"]
mod memory_types;
#[path = "jcode_core/vendor/root_src/message/mod.rs"]
mod message;
#[path = "jcode_core/vendor/root_src/network_retry.rs"]
mod network_retry;
#[path = "jcode_core/vendor/root_src/notifications.rs"]
mod notifications;
#[path = "jcode_core/vendor/root_src/overnight.rs"]
mod overnight;
#[path = "jcode_core/vendor/root_src/perf.rs"]
mod perf;
#[path = "jcode_core/vendor/root_src/plan.rs"]
mod plan;
#[path = "jcode_core/vendor/root_src/platform.rs"]
mod platform;
#[path = "jcode_core/vendor/root_src/process_memory.rs"]
mod process_memory;
mod process_title;
mod profile_provider;
#[path = "jcode_core/vendor/root_src/prompt/mod.rs"]
mod prompt;
#[path = "jcode_core/vendor/root_src/protocol.rs"]
mod protocol;
#[path = "jcode_core/vendor/root_src/provider/mod.rs"]
mod provider;
#[path = "jcode_core/vendor/root_src/provider_catalog.rs"]
mod provider_catalog;
#[path = "jcode_core/vendor/root_src/registry.rs"]
mod registry;
#[path = "jcode_core/vendor/root_src/restart_snapshot.rs"]
mod restart_snapshot;
mod runtime;
#[path = "jcode_core/vendor/root_src/runtime_memory_log.rs"]
mod runtime_memory_log;
#[path = "jcode_core/vendor/root_src/safety.rs"]
mod safety;
#[path = "jcode_core/vendor/root_src/server/mod.rs"]
mod server;
#[path = "jcode_core/vendor/root_src/session/mod.rs"]
mod session;
#[path = "jcode_core/vendor/root_src/setup_hints/mod.rs"]
mod setup_hints;
#[path = "jcode_core/vendor/root_src/side_panel.rs"]
mod side_panel;
#[path = "jcode_core/vendor/root_src/sidecar.rs"]
mod sidecar;
#[path = "jcode_core/vendor/root_src/skill.rs"]
mod skill;
#[path = "jcode_core/vendor/root_src/soft_interrupt_store.rs"]
mod soft_interrupt_store;
#[path = "jcode_core/vendor/root_src/startup_profile.rs"]
mod startup_profile;
#[path = "jcode_core/vendor/root_src/stdin_detect.rs"]
mod stdin_detect;
#[path = "jcode_core/vendor/root_src/storage/mod.rs"]
mod storage;
#[path = "jcode_core/vendor/root_src/telegram.rs"]
mod telegram;
#[path = "jcode_core/vendor/root_src/terminal_launch.rs"]
mod terminal_launch;
#[path = "jcode_core/vendor/root_src/todo.rs"]
mod todo;
#[path = "jcode_core/vendor/root_src/tool/mod.rs"]
mod tool;
mod tool_types;
#[path = "jcode_core/vendor/root_src/transport/mod.rs"]
mod transport;
mod tui;
#[path = "jcode_core/vendor/root_src/update.rs"]
mod update;
#[path = "jcode_core/vendor/root_src/usage/mod.rs"]
mod usage;
#[path = "jcode_core/vendor/root_src/util.rs"]
mod util;

mod lyra_runtime;
mod rollback;

pub use git_runtime::{
    GitChangedFile, GitChangedFileStatus, GitDiffResponse, GitDiffScope, GitMutationResponse,
    GitStatusSnapshot, GitStatusSummary, git_diff_json, git_discard_json, git_stage_json,
    git_status_json, git_unstage_json,
};
pub use lyra_runtime::{
    AgentError, AgentFollowState, AgentImageInput, AgentMessage, AgentRuntimeEvent,
    AgentSessionKind, AgentSessionSnapshot, ClarificationAnswer, HostCapabilityDispatcher,
    RollbackChangedFile, RollbackPreviewResponse, RollbackRestoreResponse, ToolActivity,
    ToolActivityStatus, TurnStatus, agent_memory_audit_json, agent_memory_recover_run_json,
    agent_memory_shared_search_json, agent_memory_shared_update_json, agent_memory_snapshot_json,
    agent_memory_trim_run_json, archive_session_json, ask_user_clarification, ask_user_permission,
    bind_project_session_json, call_host_capability,
    cancel_jcode_overnight_json as cancel_agent_overnight_json, cancel_turn_json,
    clear_host_capability_dispatcher, clear_rust_event_callback,
    compact_jcode_session_json as compact_agent_session_json,
    complete_jcode_account_login_json as complete_agent_account_login_json, create_session_json,
    delete_session_json, list_jcode_accounts_json as list_agent_accounts_json,
    list_jcode_goals_json as list_agent_goals_json,
    list_jcode_login_providers_json as list_agent_login_providers_json,
    list_jcode_models_json as list_agent_models_json,
    list_jcode_overnight_json as list_agent_overnight_json,
    list_jcode_sessions_json as list_agent_sessions_json,
    log_jcode_overnight_json as log_agent_overnight_json,
    login_jcode_account_json as login_agent_account_json,
    open_jcode_goals_json as open_agent_goals_json, preview_rollback_json,
    read_jcode_config_json as read_agent_config_json, read_session_json, refactor_session_json,
    refresh_jcode_models_json as refresh_agent_models_json, register_host_capability_dispatcher,
    register_rust_event_callback, remove_jcode_account_json as remove_agent_account_json,
    rename_session_json, respond_clarification_json, respond_permission_json,
    restore_rollback_json, resume_jcode_goal_json as resume_agent_goal_json,
    review_jcode_overnight_json as review_agent_overnight_json, run_improve_session_json,
    run_jcode_btw_json as run_agent_btw_json, run_jcode_subagent_json as run_agent_subagent_json,
    run_judge_session_json, run_review_session_json,
    save_jcode_provider_profile_json as save_agent_provider_profile_json, save_session_json,
    selfdev_status_json, send_selfdev_turn_json, send_turn_json,
    show_jcode_goal_json as show_agent_goal_json,
    split_jcode_session_json as split_agent_session_json,
    start_jcode_account_login_json as start_agent_account_login_json,
    start_jcode_overnight_json as start_agent_overnight_json, start_selfdev_session_json,
    status_jcode_overnight_json as status_agent_overnight_json,
    switch_jcode_account_json as switch_agent_account_json,
    switch_jcode_model_json as switch_agent_model_json,
    transfer_jcode_session_json as transfer_agent_session_json, trigger_poke_session_json,
    unsave_session_json, update_jcode_agent_roles_json as update_agent_roles_json,
    update_jcode_config_json as update_agent_config_json,
    update_jcode_provider_options_json as update_agent_provider_options_json,
    update_jcode_session_automation_json as update_agent_session_automation_json,
};
