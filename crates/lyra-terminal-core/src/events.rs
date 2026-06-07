//! Runtime event emission for terminal sessions.

use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::memory;

pub(crate) type RustEventCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;

static RUST_EVENT_CALLBACK: Lazy<Mutex<Option<RustEventCallback>>> = Lazy::new(|| Mutex::new(None));

#[cfg_attr(not(feature = "node-api"), allow(dead_code))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeCommandCompletionEvent {
    terminal_session_id: String,
    command_id: String,
    command_text: Option<String>,
    status: String,
    exit_code: Option<i32>,
    signal: Option<String>,
    actor: Value,
    correlation: Value,
    output_text_range: Value,
    raw_output_range: Value,
    artifact_root_path: String,
    command_meta_path: String,
    command_output_text_path: String,
    command_raw_output_path: String,
    command_events_path: String,
    command_summary_path: String,
    completed_at: String,
}

#[cfg_attr(not(feature = "node-api"), allow(dead_code))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeEvent {
    pub(crate) kind: String,
    pub(crate) session_id: String,
    pub(crate) data: Option<String>,
    pub(crate) exit_code: Option<i32>,
    pub(crate) error: Option<String>,
    pub(crate) source: Option<String>,
    pub(crate) mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command: Option<NativeCommandCompletionEvent>,
}

fn native_command_completion(
    completion: memory::CommandCompletionProjection,
) -> NativeCommandCompletionEvent {
    NativeCommandCompletionEvent {
        terminal_session_id: completion.terminal_session_id,
        command_id: completion.command_id,
        command_text: completion.command_text,
        status: completion.status,
        exit_code: completion.exit_code,
        signal: completion.signal,
        actor: completion.actor,
        correlation: completion.correlation,
        output_text_range: completion.output_text_range,
        raw_output_range: completion.raw_output_range,
        artifact_root_path: completion.artifact_root_path,
        command_meta_path: completion.command_meta_path,
        command_output_text_path: completion.command_output_text_path,
        command_raw_output_path: completion.command_raw_output_path,
        command_events_path: completion.command_events_path,
        command_summary_path: completion.command_summary_path,
        completed_at: completion.completed_at,
    }
}

pub(crate) fn emit_event(event: NativeEvent) {
    if let Ok(guard) = RUST_EVENT_CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            if let Ok(payload) = serde_json::to_string(&event) {
                callback(payload);
            }
        }
    }
}

pub(crate) fn emit_command_completion(
    session_id: &str,
    source: &str,
    mode: &str,
    completion: memory::CommandCompletionProjection,
) {
    let command_id = completion.command_id.clone();
    emit_event(NativeEvent {
        kind: "commandCompleted".to_string(),
        session_id: session_id.to_string(),
        data: None,
        exit_code: completion.exit_code,
        error: None,
        source: Some(source.to_string()),
        mode: Some(mode.to_string()),
        command_id: Some(command_id),
        command: Some(native_command_completion(completion)),
    });
}

pub(crate) fn register_rust_event_callback(callback: RustEventCallback) {
    if let Ok(mut guard) = RUST_EVENT_CALLBACK.lock() {
        *guard = Some(callback);
    }
}

pub(crate) fn clear_rust_event_callback() {
    if let Ok(mut guard) = RUST_EVENT_CALLBACK.lock() {
        *guard = None;
    }
}
