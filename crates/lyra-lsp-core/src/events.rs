use std::sync::Mutex;

use once_cell::sync::Lazy;

use super::{LspRuntimeEvent, RustEventCallback};

static CALLBACK: Lazy<Mutex<Option<RustEventCallback>>> = Lazy::new(|| Mutex::new(None));

pub fn register_event_callback(callback: RustEventCallback) {
    if let Ok(mut guard) = CALLBACK.lock() {
        *guard = Some(callback);
    }
}

pub fn clear_event_callback() {
    if let Ok(mut guard) = CALLBACK.lock() {
        *guard = None;
    }
}

pub fn emit_event(event: LspRuntimeEvent) {
    if let Ok(guard) = CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            if let Ok(payload) = serde_json::to_string(&event) {
                callback(payload);
            }
        }
    }
}

pub fn acquire_event(
    server_id: &str,
    status: &str,
    message: Option<&str>,
    project_root: Option<&str>,
) -> LspRuntimeEvent {
    LspRuntimeEvent {
        kind: "acquire".to_string(),
        session_id: None,
        file_path: None,
        language_id: None,
        project_root: project_root.map(str::to_string),
        status: Some(status.to_string()),
        message: message.map(str::to_string),
        server_id: Some(server_id.to_string()),
        diagnostics: None,
        acquire_id: Some(server_id.to_string()),
        received_bytes: None,
        total_bytes: None,
    }
}

pub fn default_event(kind: &str) -> LspRuntimeEvent {
    LspRuntimeEvent {
        kind: kind.to_string(),
        session_id: None,
        file_path: None,
        language_id: None,
        project_root: None,
        status: None,
        message: None,
        server_id: None,
        diagnostics: None,
        acquire_id: None,
        received_bytes: None,
        total_bytes: None,
    }
}
