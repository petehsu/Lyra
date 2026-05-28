use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::visibility::{EventRole, ModelContextPolicy, UiPolicy, Visibility};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSessionEvent {
    pub kind: String,
    pub role: EventRole,
    #[serde(default)]
    pub payload: Value,
    pub visibility: Visibility,
    pub model_context_policy: ModelContextPolicy,
    pub ui_policy: UiPolicy,
    #[serde(default)]
    pub runtime_turn_id: Option<String>,
    #[serde(default)]
    pub lineage_json: Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEventRecord {
    pub event_id: String,
    pub session_id: String,
    pub runtime_turn_id: Option<String>,
    pub kind: String,
    pub role: EventRole,
    pub payload_json: Value,
    pub visibility: Visibility,
    pub model_context_policy: ModelContextPolicy,
    pub ui_policy: UiPolicy,
    pub created_at_ms: i64,
    pub created_at_iso: String,
    pub lineage_json: Value,
}

impl NewSessionEvent {
    pub fn user_message(text: impl Into<String>) -> Self {
        Self {
            kind: "user_message".to_string(),
            role: EventRole::User,
            payload: serde_json::json!({ "text": text.into() }),
            visibility: Visibility::UserVisible,
            model_context_policy: ModelContextPolicy::Include,
            ui_policy: UiPolicy::ShowInTimeline,
            runtime_turn_id: None,
            lineage_json: serde_json::json!({}),
        }
    }

    pub fn assistant_message(text: impl Into<String>, runtime_turn_id: Option<String>) -> Self {
        Self {
            kind: "assistant_message".to_string(),
            role: EventRole::Assistant,
            payload: serde_json::json!({ "text": text.into() }),
            visibility: Visibility::UserVisible,
            model_context_policy: ModelContextPolicy::Include,
            ui_policy: UiPolicy::ShowInTimeline,
            runtime_turn_id,
            lineage_json: serde_json::json!({}),
        }
    }

    pub fn runtime_event(
        kind: impl Into<String>,
        runtime_turn_id: Option<String>,
        payload: Value,
    ) -> Self {
        Self {
            kind: kind.into(),
            role: EventRole::Runtime,
            payload,
            visibility: Visibility::Internal,
            model_context_policy: ModelContextPolicy::IncludeAsRuntimeState,
            ui_policy: UiPolicy::ShowAsStatus,
            runtime_turn_id,
            lineage_json: serde_json::json!({}),
        }
    }
}
