pub mod auto_compact;
pub mod context_collapse;
pub mod context_snip;
pub mod error_recovery;
pub mod file_state_cache;
pub mod interaction_manager;
pub mod micro_compact;
pub mod prefetch;
pub mod prompt_pipeline;
pub mod prompt_repetition;
pub mod service;
pub mod terminal_policy;
pub mod tool_budget;
pub mod tools;
pub mod turn_strategy;
pub mod types;

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
