use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStatus {
    Active,
    Idle,
    Running,
    AwaitingUser,
    Interrupted,
    Recovering,
    Failed,
    Archived,
    DeletedByUser,
}

impl SessionStatus {
    pub fn as_storage_str(&self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Idle => "idle",
            Self::Running => "running",
            Self::AwaitingUser => "awaiting_user",
            Self::Interrupted => "interrupted",
            Self::Recovering => "recovering",
            Self::Failed => "failed",
            Self::Archived => "archived",
            Self::DeletedByUser => "deleted_by_user",
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub provider_key: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub session_id: String,
    pub title: String,
    pub working_dir: Option<String>,
    pub provider_key: Option<String>,
    pub model: Option<String>,
    pub status: SessionStatus,
    pub schema_version: i64,
    pub created_at_ms: i64,
    pub created_at_iso: String,
    pub updated_at_ms: i64,
    pub updated_at_iso: String,
}
