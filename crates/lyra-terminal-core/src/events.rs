//! Runtime event emission for terminal sessions.

use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

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
    pub(crate) cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) current_cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command: Option<NativeCommandCompletionEvent>,
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
    command_id: &str,
    exit_code: Option<i32>,
) {
    emit_event(NativeEvent {
        kind: "commandCompleted".to_string(),
        session_id: session_id.to_string(),
        data: None,
        exit_code,
        error: None,
        source: Some(source.to_string()),
        mode: Some(mode.to_string()),
        cwd: None,
        current_cwd: None,
        command_id: Some(command_id.to_string()),
        command: Some(NativeCommandCompletionEvent {
            terminal_session_id: session_id.to_string(),
            command_id: command_id.to_string(),
            command_text: None,
            status: exit_code.map(|code| if code == 0 { "completed" } else { "failed" }).unwrap_or("unknown").to_string(),
            exit_code,
            signal: None,
            completed_at: crate::session_runtime::now_iso_like(),
        }),
    });
}

pub(crate) fn emit_cwd_changed(session_id: &str, source: &str, mode: &str, cwd: &str) {
    emit_event(NativeEvent {
        kind: "cwdChanged".to_string(),
        session_id: session_id.to_string(),
        data: None,
        exit_code: None,
        error: None,
        source: Some(source.to_string()),
        mode: Some(mode.to_string()),
        cwd: Some(cwd.to_string()),
        current_cwd: Some(cwd.to_string()),
        command_id: None,
        command: None,
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