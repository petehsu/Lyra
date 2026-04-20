pub mod answer_quality;
pub mod assistant_output;
pub mod auto_compact;
pub mod command_approval_runtime;
pub mod context_collapse;
pub mod context_snip;
pub mod default_turn_runtime;
pub mod error_recovery;
pub mod exec_policy_runtime;
pub mod execution_state;
pub mod file_state_cache;
pub mod interaction_manager;
pub mod micro_compact;
pub mod persona_runtime;
pub mod plan_approval_runtime;
pub mod plan_helpers;
pub mod plan_turn_runtime;
pub mod prefetch;
pub mod project_scope;
pub mod prompt_pipeline;
pub mod prompt_repetition;
pub mod runtime_events;
pub mod runtime_optimization_state;
pub mod service;
pub mod session_management;
pub mod terminal_policy;
pub mod tool_budget;
pub mod tool_diagnostics;
pub mod tool_execution_flow;
pub mod tool_execution_utils;
pub mod tools;
pub mod turn_entry;
pub mod turn_gates;
pub mod turn_guardrails;
pub mod turn_progress_guard;
pub mod turn_runner;
pub mod turn_runtime_helpers;
pub mod turn_strategy;
pub mod types;
pub mod ui_prompt_context;

use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;

use crate::agent::types::AgentRuntimeEvent;

type RustEventCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;

static RUST_EVENT_CALLBACK: Lazy<Mutex<Option<RustEventCallback>>> = Lazy::new(|| Mutex::new(None));

pub fn register_rust_event_callback(callback: RustEventCallback) {
    if let Ok(mut guard) = RUST_EVENT_CALLBACK.lock() {
        *guard = Some(callback);
    }
}

pub fn clear_rust_event_callback() {
    if let Ok(mut guard) = RUST_EVENT_CALLBACK.lock() {
        *guard = None;
    }
}

pub fn emit_runtime_event(event: AgentRuntimeEvent) {
    if let Ok(guard) = RUST_EVENT_CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            if let Ok(payload_json) = serde_json::to_string(&event) {
                callback(payload_json);
            }
        }
    }
}
