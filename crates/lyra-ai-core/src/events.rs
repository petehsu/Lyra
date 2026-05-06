use serde::Serialize;
use serde_json::Value;
use std::sync::{Arc, OnceLock, RwLock};
use uuid::Uuid;

pub type AiEventCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;

static EVENT_CALLBACK: OnceLock<RwLock<Option<AiEventCallback>>> = OnceLock::new();

fn callback_slot() -> &'static RwLock<Option<AiEventCallback>> {
    EVENT_CALLBACK.get_or_init(|| RwLock::new(None))
}

pub fn register_rust_event_callback(callback: AiEventCallback) {
    if let Ok(mut slot) = callback_slot().write() {
        *slot = Some(callback);
    }
}

pub fn clear_rust_event_callback() {
    if let Ok(mut slot) = callback_slot().write() {
        *slot = None;
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStreamEvent {
    pub schema_version: String,
    pub event_id: String,
    pub sequence: i64,
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,
    pub event_type: String,
    pub payload: Value,
    pub created_at: String,
}

impl RuntimeStreamEvent {
    pub fn new(
        sequence: i64,
        session_id: String,
        runtime_turn_id: Option<String>,
        event_type: impl Into<String>,
        payload: Value,
        created_at: String,
    ) -> Self {
        Self {
            schema_version: "v1".to_string(),
            event_id: format!("evt_{}", Uuid::new_v4()),
            sequence,
            session_id,
            runtime_turn_id,
            event_type: event_type.into(),
            payload,
            created_at,
        }
    }
}

pub fn emit_event(event: &RuntimeStreamEvent) {
    let callback = callback_slot()
        .read()
        .ok()
        .and_then(|slot| slot.as_ref().cloned());
    let Some(callback) = callback else {
        return;
    };
    if let Ok(payload) = serde_json::to_string(event) {
        callback(payload);
    }
}
