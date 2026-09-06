use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadTaskState {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Canceled,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadTaskSource {
    Browser,
    Manual,
    Retry,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadPriority {
    Low,
    Normal,
    High,
}

// Curl/Electron variants are no longer produced but must stay so tasks
// persisted by older builds still deserialize.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadTaskBackend {
    Electron,
    NativeHttp,
    Curl,
    Aria2,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadTaskOutputKind {
    File,
    Directory,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProxySettings {
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadBtSettings {
    pub dht_enabled: bool,
    pub peer_exchange_enabled: bool,
    pub local_peer_discovery_enabled: bool,
    pub seed_time_minutes: u32,
    pub tracker_urls: Vec<String>,
    pub max_upload_bytes_per_second: Option<u64>,
}

pub(crate) fn default_max_concurrent_downloads() -> u32 {
    3
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettings {
    pub version: u8,
    pub speed_limit_bytes_per_second: Option<u64>,
    pub proxy: DownloadProxySettings,
    pub bt: DownloadBtSettings,
    pub default_headers: HashMap<String, String>,
    pub default_cookie_header: Option<String>,
    #[serde(default = "default_max_concurrent_downloads")]
    pub max_concurrent_downloads: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_directory: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_url: Option<String>,
    pub file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_headers: Option<HashMap<String, String>>,
    pub save_path: String,
    pub directory: String,
    pub protocol: String,
    pub source: DownloadTaskSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<DownloadTaskBackend>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_kind: Option<DownloadTaskOutputKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_tab_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_title: Option<String>,
    pub state: DownloadTaskState,
    pub received_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_second: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_remaining_ms: Option<u64>,
    pub priority: DownloadPriority,
    pub connections_requested: u32,
    pub connections_active: u32,
    pub can_resume: bool,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_delay_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSnapshot {
    pub tasks: Vec<DownloadTask>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum DownloadEvent {
    Snapshot { snapshot: DownloadSnapshot },
    TaskUpdated { task: DownloadTask },
    TaskRemoved { task_id: String },
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEnqueueRequest {
    pub text: Option<String>,
    pub urls: Option<Vec<String>>,
    pub partial_file_path: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub cookie_header: Option<String>,
    #[serde(default)]
    pub source: Option<DownloadTaskSource>,
    #[serde(default)]
    pub source_tab_id: Option<String>,
    #[serde(default)]
    pub source_title: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTaskRequest {
    pub task_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPriorityRequest {
    pub task_id: String,
    pub priority: DownloadPriority,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadBatchRequest {
    pub task_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettingsUpdate {
    pub speed_limit_bytes_per_second: Option<Option<u64>>,
    pub proxy: Option<DownloadProxySettings>,
    pub bt: Option<DownloadBtSettings>,
    pub default_headers: Option<HashMap<String, String>>,
    pub default_cookie_header: Option<Option<String>>,
    pub max_concurrent_downloads: Option<u32>,
    pub default_directory: Option<Option<String>>,
}