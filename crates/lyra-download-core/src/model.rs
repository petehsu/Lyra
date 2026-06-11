use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadProtocol {
    Http,
    Https,
    Ftp,
    Ftps,
    Sftp,
    Webdav,
    Webdavs,
    Magnet,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPlanRequest {
    pub url: String,
    pub total_bytes: u64,
    pub requested_connections: u32,
    #[serde(default)]
    pub min_segment_bytes: Option<u64>,
    #[serde(default)]
    pub existing_part_lengths: Vec<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSegmentPlan {
    pub index: u32,
    pub start: u64,
    pub end_inclusive: Option<u64>,
    pub next_start: u64,
    pub size_bytes: Option<u64>,
    pub existing_bytes: u64,
    pub complete: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPlanResponse {
    pub protocol: DownloadProtocol,
    pub resumable: bool,
    pub connections: u32,
    pub segments: Vec<DownloadSegmentPlan>,
}

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
pub struct DownloadChecksum {
    pub algorithm: String,
    pub expected: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified: Option<bool>,
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
pub struct DownloadSaveRule {
    pub id: String,
    pub enabled: bool,
    pub name: String,
    pub directory: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extensions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub host_contains: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub protocols: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadScheduleSettings {
    pub enabled: bool,
    pub start_minute_of_day: u16,
    pub end_minute_of_day: u16,
    pub outside_action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outside_speed_limit_bytes_per_second: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadPostProcessingSettings {
    pub auto_extract: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extract_directory: Option<String>,
    pub delete_archive_after_extract: bool,
    pub detect_split_archives: bool,
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

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadBtTaskOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_file_indexes: Option<Vec<u32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tracker_urls: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettings {
    pub version: u8,
    pub speed_limit_bytes_per_second: Option<u64>,
    pub schedule: Option<DownloadScheduleSettings>,
    pub proxy: DownloadProxySettings,
    pub post_processing: DownloadPostProcessingSettings,
    pub bt: DownloadBtSettings,
    pub default_headers: HashMap<String, String>,
    pub default_cookie_header: Option<String>,
    pub save_rules: Vec<DownloadSaveRule>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadTask {
    pub id: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub referrer: Option<String>,
    pub file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub proxy: Option<DownloadProxySettings>,
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
    pub checksum: Option<DownloadChecksum>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_delay_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mirrors: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_mirror_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bt: Option<DownloadBtTaskOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_paused: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_processing_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_processing_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub missing_archive_parts: Option<Vec<String>>,
    pub tags: Vec<String>,
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
    pub proxy: Option<DownloadProxySettings>,
    pub checksum: Option<DownloadChecksum>,
    pub max_retries: Option<u32>,
    pub retry_delay_ms: Option<u64>,
    pub mirrors: Option<Vec<String>>,
    pub bt: Option<DownloadBtTaskOptions>,
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
    pub schedule: Option<Option<DownloadScheduleSettings>>,
    pub proxy: Option<DownloadProxySettings>,
    pub post_processing: Option<DownloadPostProcessingSettings>,
    pub bt: Option<DownloadBtSettings>,
    pub default_headers: Option<HashMap<String, String>>,
    pub default_cookie_header: Option<Option<String>>,
    pub save_rules: Option<Vec<DownloadSaveRule>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRemoteStatus {
    pub running: bool,
    pub host: String,
    pub port: Option<u16>,
    pub base_url: Option<String>,
    pub token: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRemoteStartRequest {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub allow_lan: Option<bool>,
}
