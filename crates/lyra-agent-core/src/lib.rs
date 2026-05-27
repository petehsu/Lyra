#![allow(
    unknown_lints,
    clippy::collapsible_match,
    clippy::manual_checked_ops,
    clippy::unnecessary_sort_by,
    clippy::useless_conversion
)]

#[path = "jcode_core/vendor/root_src/agent/mod.rs"]
pub mod agent;
#[path = "jcode_core/vendor/root_src/ambient/mod.rs"]
pub mod ambient;
#[path = "jcode_core/vendor/root_src/ambient_runner.rs"]
pub mod ambient_runner;
#[path = "jcode_core/vendor/root_src/ambient_scheduler.rs"]
pub mod ambient_scheduler;
#[path = "jcode_core/vendor/root_src/auth/mod.rs"]
pub mod auth;
#[path = "jcode_core/vendor/root_src/background/mod.rs"]
pub mod background;
#[path = "jcode_core/vendor/root_src/build.rs"]
pub mod build;
#[path = "jcode_core/vendor/root_src/bus.rs"]
pub mod bus;
#[path = "jcode_core/vendor/root_src/cache_tracker.rs"]
pub mod cache_tracker;
#[path = "jcode_core/vendor/root_src/channel.rs"]
pub mod channel;
pub mod cli;
#[path = "jcode_core/vendor/root_src/compaction.rs"]
pub mod compaction;
#[path = "jcode_core/vendor/root_src/config/mod.rs"]
pub mod config;
#[path = "jcode_core/vendor/root_src/copilot_usage.rs"]
pub mod copilot_usage;
#[path = "jcode_core/vendor/root_src/embedding_stub.rs"]
pub mod embedding;
#[path = "jcode_core/vendor/root_src/env.rs"]
pub mod env;
#[path = "jcode_core/vendor/root_src/gateway/mod.rs"]
pub mod gateway;
mod git_runtime;
#[path = "jcode_core/vendor/root_src/gmail.rs"]
pub mod gmail;
#[path = "jcode_core/vendor/root_src/goal.rs"]
pub mod goal;
#[path = "jcode_core/vendor/root_src/id.rs"]
pub mod id;
#[path = "jcode_core/vendor/root_src/import.rs"]
pub mod import;
pub mod jcode_core;
mod jcode_gui_actions;
#[path = "jcode_core/vendor/root_src/logging.rs"]
pub mod logging;
#[path = "jcode_core/vendor/root_src/login_qr.rs"]
pub mod login_qr;
#[path = "jcode_core/vendor/root_src/mcp/mod.rs"]
pub mod mcp;
#[path = "jcode_core/vendor/root_src/memory/mod.rs"]
pub mod memory;
#[path = "jcode_core/vendor/root_src/memory_agent.rs"]
pub mod memory_agent;
#[path = "jcode_core/vendor/root_src/memory_graph.rs"]
pub mod memory_graph;
#[path = "jcode_core/vendor/root_src/memory_log.rs"]
pub mod memory_log;
#[path = "jcode_core/vendor/root_src/memory_types.rs"]
pub mod memory_types;
#[path = "jcode_core/vendor/root_src/message/mod.rs"]
pub mod message;
#[path = "jcode_core/vendor/root_src/network_retry.rs"]
pub mod network_retry;
#[path = "jcode_core/vendor/root_src/notifications.rs"]
pub mod notifications;
#[path = "jcode_core/vendor/root_src/overnight.rs"]
pub mod overnight;
#[path = "jcode_core/vendor/root_src/perf.rs"]
pub mod perf;
#[path = "jcode_core/vendor/root_src/plan.rs"]
pub mod plan;
#[path = "jcode_core/vendor/root_src/platform.rs"]
pub mod platform;
#[path = "jcode_core/vendor/root_src/process_memory.rs"]
pub mod process_memory;
pub mod process_title;
pub mod profile_provider;
#[path = "jcode_core/vendor/root_src/prompt/mod.rs"]
pub mod prompt;
#[path = "jcode_core/vendor/root_src/protocol.rs"]
pub mod protocol;
#[path = "jcode_core/vendor/root_src/provider/mod.rs"]
pub mod provider;
#[path = "jcode_core/vendor/root_src/provider_catalog.rs"]
pub mod provider_catalog;
#[path = "jcode_core/vendor/root_src/registry.rs"]
pub mod registry;
#[path = "jcode_core/vendor/root_src/restart_snapshot.rs"]
pub mod restart_snapshot;
pub mod runtime;
#[path = "jcode_core/vendor/root_src/runtime_memory_log.rs"]
pub mod runtime_memory_log;
#[path = "jcode_core/vendor/root_src/safety.rs"]
pub mod safety;
#[path = "jcode_core/vendor/root_src/server/mod.rs"]
pub mod server;
#[path = "jcode_core/vendor/root_src/session/mod.rs"]
pub mod session;
#[path = "jcode_core/vendor/root_src/setup_hints/mod.rs"]
pub mod setup_hints;
#[path = "jcode_core/vendor/root_src/side_panel.rs"]
pub mod side_panel;
#[path = "jcode_core/vendor/root_src/sidecar.rs"]
pub mod sidecar;
#[path = "jcode_core/vendor/root_src/skill.rs"]
pub mod skill;
#[path = "jcode_core/vendor/root_src/soft_interrupt_store.rs"]
pub mod soft_interrupt_store;
#[path = "jcode_core/vendor/root_src/startup_profile.rs"]
pub mod startup_profile;
#[path = "jcode_core/vendor/root_src/stdin_detect.rs"]
pub mod stdin_detect;
#[path = "jcode_core/vendor/root_src/storage/mod.rs"]
pub mod storage;
#[path = "jcode_core/vendor/root_src/telegram.rs"]
pub mod telegram;
#[path = "jcode_core/vendor/root_src/terminal_launch.rs"]
pub mod terminal_launch;
#[path = "jcode_core/vendor/root_src/todo.rs"]
pub mod todo;
#[path = "jcode_core/vendor/root_src/tool/mod.rs"]
pub mod tool;
pub mod tool_types;
#[path = "jcode_core/vendor/root_src/transport/mod.rs"]
pub mod transport;
pub mod tui;
#[path = "jcode_core/vendor/root_src/update.rs"]
pub mod update;
#[path = "jcode_core/vendor/root_src/usage/mod.rs"]
pub mod usage;
#[path = "jcode_core/vendor/root_src/util.rs"]
pub mod util;

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
    ToolActivityStatus, TurnStatus, archive_session_json, ask_user_clarification,
    ask_user_permission, bind_project_session_json, call_host_capability,
    cancel_jcode_overnight_json, cancel_turn_json, clear_host_capability_dispatcher,
    clear_rust_event_callback, compact_jcode_session_json, complete_jcode_account_login_json,
    create_session_json, delete_session_json, list_jcode_accounts_json, list_jcode_goals_json,
    list_jcode_login_providers_json, list_jcode_models_json, list_jcode_overnight_json,
    list_jcode_sessions_json, log_jcode_overnight_json, login_jcode_account_json,
    open_jcode_goals_json, preview_rollback_json, read_jcode_config_json, read_session_json,
    refactor_session_json, refresh_jcode_models_json, register_host_capability_dispatcher,
    register_rust_event_callback, remove_jcode_account_json, rename_session_json,
    respond_clarification_json, respond_permission_json, restore_rollback_json,
    resume_jcode_goal_json, review_jcode_overnight_json, run_improve_session_json,
    run_jcode_btw_json, run_jcode_subagent_json, run_judge_session_json, run_review_session_json,
    save_jcode_provider_profile_json, save_session_json, selfdev_status_json,
    send_selfdev_turn_json, send_turn_json, show_jcode_goal_json, split_jcode_session_json,
    start_jcode_account_login_json, start_jcode_overnight_json, start_selfdev_session_json,
    status_jcode_overnight_json, switch_jcode_account_json, switch_jcode_model_json,
    transfer_jcode_session_json, trigger_poke_session_json, unsave_session_json,
    update_jcode_agent_roles_json, update_jcode_config_json, update_jcode_provider_options_json,
    update_jcode_session_automation_json,
};
pub use message::{
    ContentBlock, Message, Role, StreamEvent, ToolCall, ToolDefinition,
    messages_with_dynamic_system_context,
};
pub use provider::{EventStream, Provider};
pub use runtime::{
    BackgroundToolSignal, GracefulShutdownSignal, InterruptSignal, SoftInterruptMessage,
    SoftInterruptQueue, SoftInterruptSource, StreamError,
};
pub use session::{SessionStatus, StoredMessage};
pub use tool::{StdinInputRequest, Tool, ToolContext, ToolExecutionMode};
pub use tool_types::{ToolImage, ToolOutput};
