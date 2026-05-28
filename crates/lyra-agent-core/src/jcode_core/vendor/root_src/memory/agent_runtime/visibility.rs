use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    UserVisible,
    ModelContextOnly,
    AuditOnly,
    Internal,
    DebugOnly,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ModelContextPolicy {
    Include,
    IncludeSummarized,
    Exclude,
    IncludeAsRuntimeState,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UiPolicy {
    ShowInTimeline,
    ShowAsStatus,
    ShowInDetailsOnly,
    HideFromUser,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EventRole {
    User,
    Assistant,
    Tool,
    Runtime,
    System,
}

pub trait StorageEnum {
    fn as_storage_str(&self) -> &'static str;
}

impl StorageEnum for Visibility {
    fn as_storage_str(&self) -> &'static str {
        match self {
            Self::UserVisible => "user_visible",
            Self::ModelContextOnly => "model_context_only",
            Self::AuditOnly => "audit_only",
            Self::Internal => "internal",
            Self::DebugOnly => "debug_only",
        }
    }
}

impl StorageEnum for ModelContextPolicy {
    fn as_storage_str(&self) -> &'static str {
        match self {
            Self::Include => "include",
            Self::IncludeSummarized => "include_summarized",
            Self::Exclude => "exclude",
            Self::IncludeAsRuntimeState => "include_as_runtime_state",
        }
    }
}

impl StorageEnum for UiPolicy {
    fn as_storage_str(&self) -> &'static str {
        match self {
            Self::ShowInTimeline => "show_in_timeline",
            Self::ShowAsStatus => "show_as_status",
            Self::ShowInDetailsOnly => "show_in_details_only",
            Self::HideFromUser => "hide_from_user",
        }
    }
}

impl StorageEnum for EventRole {
    fn as_storage_str(&self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Assistant => "assistant",
            Self::Tool => "tool",
            Self::Runtime => "runtime",
            Self::System => "system",
        }
    }
}

pub fn parse_storage_enum<T>(
    value: String,
) -> crate::memory::agent_runtime::schema::AgentMemoryResult<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(serde_json::Value::String(value)).map_err(Into::into)
}

pub fn is_timeline_visible(visibility: Visibility, ui_policy: UiPolicy) -> bool {
    matches!(visibility, Visibility::UserVisible) && matches!(ui_policy, UiPolicy::ShowInTimeline)
}

pub fn is_user_hidden(visibility: Visibility, ui_policy: UiPolicy) -> bool {
    matches!(
        visibility,
        Visibility::Internal | Visibility::DebugOnly | Visibility::AuditOnly
    ) || matches!(ui_policy, UiPolicy::HideFromUser)
}
