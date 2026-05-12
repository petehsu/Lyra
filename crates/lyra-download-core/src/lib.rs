use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use chrono::{Local, Utc};
use once_cell::sync::Lazy;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest as Sha1Digest, Sha1};
use sha2::Sha256;
use tiny_http::{Header, Method, Response, Server, StatusCode};
use uuid::Uuid;

const UNKNOWN_END: u64 = u64::MAX;
const DEFAULT_MIN_SEGMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_NATIVE_SEGMENTS: usize = 32;
const TASKS_FILE_NAME: &str = "tasks.v1.json";
const SETTINGS_FILE_NAME: &str = "settings.v1.json";
const REMOTE_API_FILE_NAME: &str = "remote-api.v1.json";
const DEFAULT_MAX_RETRIES: u32 = 3;
const DEFAULT_RETRY_DELAY_MS: u64 = 1_500;
const DEFAULT_NATIVE_HTTP_CONNECTIONS: u32 = 4;
const MAX_ACTIVE_NATIVE_DOWNLOADS: usize = 3;

type RustEventCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;

static RUST_EVENT_CALLBACK: Lazy<Mutex<Option<RustEventCallback>>> = Lazy::new(|| Mutex::new(None));
static MANAGERS: Lazy<Mutex<HashMap<PathBuf, Arc<DownloadManager>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct NativeSegment {
    index: u32,
    start: u64,
    end_inclusive: u64,
}

unsafe extern "C" {
    fn lyra_download_scheme_code(url: *const std::ffi::c_char, len: usize) -> u8;

    fn lyra_download_plan_segments(
        total_bytes: u64,
        requested_connections: u32,
        min_segment_bytes: u64,
        out_segments: *mut NativeSegment,
        out_len: usize,
    ) -> usize;
}

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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredDownloadTasksFile {
    version: u8,
    tasks: Vec<DownloadTask>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteApiConfig {
    version: u8,
    token: String,
    host: String,
    port: u16,
}

struct DownloadManager {
    storage_root: PathBuf,
    tasks_file: PathBuf,
    settings_file: PathBuf,
    remote_config_file: PathBuf,
    state: Mutex<ManagerState>,
}

struct ManagerState {
    tasks: HashMap<String, DownloadTask>,
    settings: DownloadSettings,
    active: HashSet<String>,
    remote: RemoteState,
}

struct RemoteState {
    config: RemoteApiConfig,
    running: bool,
    shutdown: Option<Arc<std::sync::atomic::AtomicBool>>,
}

pub fn classify_download_protocol(url: &str) -> DownloadProtocol {
    let bytes = url.as_bytes();
    let code = unsafe { lyra_download_scheme_code(bytes.as_ptr().cast(), bytes.len()) };
    match code {
        1 => DownloadProtocol::Http,
        2 => DownloadProtocol::Https,
        3 => DownloadProtocol::Ftp,
        4 => DownloadProtocol::Ftps,
        5 => DownloadProtocol::Sftp,
        6 => DownloadProtocol::Webdav,
        7 => DownloadProtocol::Webdavs,
        8 => DownloadProtocol::Magnet,
        _ => DownloadProtocol::Unknown,
    }
}

fn plan_native_segments(
    total_bytes: u64,
    requested_connections: u32,
    min_segment_bytes: u64,
) -> Vec<NativeSegment> {
    let mut segments = vec![
        NativeSegment {
            index: 0,
            start: 0,
            end_inclusive: 0,
        };
        MAX_NATIVE_SEGMENTS
    ];
    let written = unsafe {
        lyra_download_plan_segments(
            total_bytes,
            requested_connections,
            min_segment_bytes,
            segments.as_mut_ptr(),
            segments.len(),
        )
    };
    segments.truncate(written.min(MAX_NATIVE_SEGMENTS));
    segments
}

pub fn plan_download(request: &DownloadPlanRequest) -> DownloadPlanResponse {
    let min_segment_bytes = request
        .min_segment_bytes
        .unwrap_or(DEFAULT_MIN_SEGMENT_BYTES);
    let native_segments = plan_native_segments(
        request.total_bytes,
        request.requested_connections,
        min_segment_bytes,
    );
    let segments = native_segments
        .into_iter()
        .map(|segment| {
            let known_end = segment.end_inclusive != UNKNOWN_END;
            let size_bytes = if known_end {
                Some(
                    segment
                        .end_inclusive
                        .saturating_sub(segment.start)
                        .saturating_add(1),
                )
            } else {
                None
            };
            let existing_bytes = request
                .existing_part_lengths
                .get(segment.index as usize)
                .copied()
                .unwrap_or(0)
                .min(size_bytes.unwrap_or(u64::MAX));
            let next_start = segment.start.saturating_add(existing_bytes);
            let complete = known_end && next_start > segment.end_inclusive;
            DownloadSegmentPlan {
                index: segment.index,
                start: segment.start,
                end_inclusive: if known_end {
                    Some(segment.end_inclusive)
                } else {
                    None
                },
                next_start,
                size_bytes,
                existing_bytes,
                complete,
            }
        })
        .collect::<Vec<_>>();

    DownloadPlanResponse {
        protocol: classify_download_protocol(&request.url),
        resumable: request.total_bytes > 0
            && segments.iter().any(|segment| segment.existing_bytes > 0),
        connections: segments.len() as u32,
        segments,
    }
}

pub fn plan_download_json(payload: &str) -> Result<String, String> {
    let request = serde_json::from_str::<DownloadPlanRequest>(payload)
        .map_err(|error| format!("invalid download plan request: {error}"))?;
    serde_json::to_string(&plan_download(&request))
        .map_err(|error| format!("failed to encode download plan: {error}"))
}

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

fn emit_event(event: &DownloadEvent) {
    let Ok(encoded) = serde_json::to_string(event) else {
        return;
    };
    if let Ok(guard) = RUST_EVENT_CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            callback(encoded);
        }
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn storage_root_from_payload(value: &Value) -> Result<PathBuf, String> {
    let root = value
        .get("storageRoot")
        .and_then(Value::as_str)
        .ok_or_else(|| "storageRoot is required".to_string())?
        .trim();
    if root.is_empty() {
        return Err("storageRoot is required".to_string());
    }
    Ok(PathBuf::from(root))
}

fn manager_for_storage_root(storage_root: PathBuf) -> Result<Arc<DownloadManager>, String> {
    let root = storage_root
        .canonicalize()
        .unwrap_or_else(|_| storage_root.clone());
    let mut managers = MANAGERS
        .lock()
        .map_err(|_| "download manager lock poisoned".to_string())?;
    if let Some(manager) = managers.get(&root) {
        return Ok(manager.clone());
    }
    let manager = Arc::new(DownloadManager::new(root.clone())?);
    managers.insert(root, manager.clone());
    Ok(manager)
}

fn with_manager<T>(
    payload: Value,
    operation: impl FnOnce(&Arc<DownloadManager>, Value) -> Result<T, String>,
) -> Result<T, String> {
    let storage_root = storage_root_from_payload(&payload)?;
    let manager = manager_for_storage_root(storage_root)?;
    operation(&manager, payload)
}

fn parse_payload<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, String> {
    serde_json::from_value(payload).map_err(|error| error.to_string())
}

fn to_json<T: Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|error| error.to_string())
}

pub fn list_downloads_json(payload: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, _| to_json(manager.snapshot()))
}

pub fn enqueue_download_json(payload: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, payload| {
        let request = parse_payload::<DownloadEnqueueRequest>(payload)?;
        manager.enqueue(request)?;
        to_json(manager.snapshot())
    })
}

pub fn import_external_browser_downloads_json(payload: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, _| {
        Err::<String, String>(if manager.snapshot().tasks.is_empty() {
            "No resumable Chrome, Edge, Brave, Chromium, or Firefox downloads were found."
                .to_string()
        } else {
            "External browser import is handled by the Electron shell.".to_string()
        })
    })
}

pub fn pause_download_json(payload: String) -> Result<String, String> {
    task_mutation(payload, |manager, task_id| manager.pause_task(&task_id))
}

pub fn resume_download_json(payload: String) -> Result<String, String> {
    task_mutation(payload, |manager, task_id| manager.resume_task(&task_id))
}

pub fn cancel_download_json(payload: String) -> Result<String, String> {
    task_mutation(payload, |manager, task_id| manager.cancel_task(&task_id))
}

pub fn retry_download_json(payload: String) -> Result<String, String> {
    task_mutation(payload, |manager, task_id| manager.retry_task(&task_id))
}

pub fn remove_download_json(payload: String) -> Result<(), String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, payload| {
        let request = parse_payload::<DownloadTaskRequest>(payload)?;
        manager.remove_task(&request.task_id);
        Ok(())
    })
}

pub fn set_download_priority_json(payload: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, payload| {
        let request = parse_payload::<DownloadPriorityRequest>(payload)?;
        to_json(manager.set_priority(&request.task_id, request.priority))
    })
}

pub fn pause_all_downloads_json(payload: String) -> Result<String, String> {
    batch_mutation(payload, |manager, ids| {
        for id in ids {
            manager.pause_task(&id);
        }
    })
}

pub fn resume_all_downloads_json(payload: String) -> Result<String, String> {
    batch_mutation(payload, |manager, ids| {
        for id in ids {
            manager.resume_task(&id);
        }
    })
}

pub fn cancel_all_downloads_json(payload: String) -> Result<String, String> {
    batch_mutation(payload, |manager, ids| {
        for id in ids {
            manager.cancel_task(&id);
        }
    })
}

pub fn read_download_settings_json(payload: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, _| to_json(manager.settings()))
}

pub fn update_download_settings_json(payload: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, payload| {
        let update = parse_payload::<DownloadSettingsUpdate>(payload)?;
        to_json(manager.update_settings(update)?)
    })
}

pub fn download_remote_status_json(payload: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, _| to_json(manager.remote_status()))
}

pub fn start_download_remote_json(payload: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, payload| {
        let request = parse_payload::<DownloadRemoteStartRequest>(payload)?;
        to_json(manager.start_remote(request)?)
    })
}

pub fn stop_download_remote_json(payload: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, _| to_json(manager.stop_remote()))
}

fn task_mutation(
    payload: String,
    operation: impl FnOnce(&Arc<DownloadManager>, String) -> Option<DownloadTask>,
) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, payload| {
        let request = parse_payload::<DownloadTaskRequest>(payload)?;
        to_json(operation(manager, request.task_id))
    })
}

fn batch_mutation(
    payload: String,
    operation: impl FnOnce(&Arc<DownloadManager>, Vec<String>),
) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    with_manager(payload, |manager, payload| {
        let request = parse_payload::<DownloadBatchRequest>(payload)?;
        let ids = manager.select_batch_ids(request.task_ids);
        operation(manager, ids);
        to_json(manager.snapshot())
    })
}

impl DownloadManager {
    fn new(storage_root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&storage_root).map_err(|error| error.to_string())?;
        let tasks_file = storage_root.join(TASKS_FILE_NAME);
        let settings_file = storage_root.join(SETTINGS_FILE_NAME);
        let remote_config_file = storage_root.join(REMOTE_API_FILE_NAME);
        let settings = read_settings(&settings_file)?;
        let tasks = read_tasks(&tasks_file)?
            .into_iter()
            .map(|task| restore_task(task).map(|task| (task.id.clone(), task)))
            .collect::<Result<HashMap<_, _>, _>>()?;
        let remote = RemoteState {
            config: read_remote_config(&remote_config_file)?,
            running: false,
            shutdown: None,
        };
        let manager = Self {
            storage_root,
            tasks_file,
            settings_file,
            remote_config_file,
            state: Mutex::new(ManagerState {
                tasks,
                settings,
                active: HashSet::new(),
                remote,
            }),
        };
        manager.persist_tasks()?;
        Ok(manager)
    }

    fn snapshot(&self) -> DownloadSnapshot {
        let state = self.state.lock().expect("download state");
        DownloadSnapshot {
            tasks: sort_tasks(state.tasks.values().cloned().collect()),
        }
    }

    fn settings(&self) -> DownloadSettings {
        self.state.lock().expect("download state").settings.clone()
    }

    fn update_settings(
        self: &Arc<Self>,
        update: DownloadSettingsUpdate,
    ) -> Result<DownloadSettings, String> {
        let settings = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "download state".to_string())?;
            if let Some(value) = update.speed_limit_bytes_per_second {
                state.settings.speed_limit_bytes_per_second = value;
            }
            if let Some(value) = update.schedule {
                state.settings.schedule = value;
            }
            if let Some(value) = update.proxy {
                state.settings.proxy = value;
            }
            if let Some(value) = update.post_processing {
                state.settings.post_processing = value;
            }
            if let Some(value) = update.bt {
                state.settings.bt = value;
            }
            if let Some(value) = update.default_headers {
                state.settings.default_headers = value;
            }
            if let Some(value) = update.default_cookie_header {
                state.settings.default_cookie_header = value;
            }
            if let Some(value) = update.save_rules {
                state.settings.save_rules = value;
            }
            state.settings.updated_at = now_iso();
            state.settings.clone()
        };
        write_json_atomic(&self.storage_root, &self.settings_file, &settings)?;
        self.apply_schedule();
        Ok(settings)
    }

    fn enqueue(self: &Arc<Self>, request: DownloadEnqueueRequest) -> Result<(), String> {
        let urls = parse_download_urls(&request);
        if urls.is_empty() {
            return Err("At least one URL is required.".to_string());
        }
        for url in urls {
            let task = self.create_task(&url, &request)?;
            self.set_task(task.clone())?;
            self.queue_task(task.id);
        }
        Ok(())
    }

    fn create_task(
        &self,
        url: &str,
        request: &DownloadEnqueueRequest,
    ) -> Result<DownloadTask, String> {
        let now = now_iso();
        let file_name = sanitize_file_name(&file_name_from_url(url));
        let settings = self.settings();
        let rule = resolve_save_rule(&settings, url, &file_name);
        let directory = request
            .partial_file_path
            .as_deref()
            .and_then(|value| Path::new(value).parent())
            .map(|path| path.to_string_lossy().to_string())
            .or_else(|| rule.as_ref().map(|rule| rule.directory.clone()))
            .unwrap_or_else(default_download_directory);
        let output_kind = if is_aria2_url(url) {
            DownloadTaskOutputKind::Directory
        } else {
            DownloadTaskOutputKind::File
        };
        let save_path = if output_kind == DownloadTaskOutputKind::Directory {
            unique_path(&directory, &file_name, &self.reserved_paths(None))
        } else if let Some(partial) = request.partial_file_path.as_deref() {
            partial.to_string()
        } else {
            unique_path(&directory, &file_name, &self.reserved_paths(None))
        };
        let backend = if is_aria2_url(url) {
            DownloadTaskBackend::Aria2
        } else if is_native_http_url(url) {
            DownloadTaskBackend::NativeHttp
        } else if is_curl_url(url) {
            DownloadTaskBackend::Curl
        } else {
            DownloadTaskBackend::Electron
        };
        let mut headers = settings.default_headers.clone();
        if let Some(extra) = request.headers.as_ref() {
            headers.extend(extra.clone());
        }
        if let Some(cookie) = request
            .cookie_header
            .as_ref()
            .filter(|value| !value.trim().is_empty())
            .or(settings.default_cookie_header.as_ref())
        {
            if !headers.keys().any(|key| key.eq_ignore_ascii_case("cookie")) {
                headers.insert("Cookie".to_string(), cookie.clone());
            }
        }
        Ok(DownloadTask {
            id: format!("download-{}", Uuid::new_v4()),
            url: url.to_string(),
            original_url: Some(url.to_string()),
            final_url: None,
            referrer: None,
            file_name: Path::new(&save_path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or(file_name),
            mime_type: None,
            request_headers: if headers.is_empty() {
                None
            } else {
                Some(headers)
            },
            proxy: request.proxy.clone(),
            save_path: save_path.clone(),
            directory: Path::new(&save_path)
                .parent()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or(directory),
            protocol: parse_protocol(url),
            source: request.source.clone().unwrap_or(DownloadTaskSource::Manual),
            backend: Some(backend.clone()),
            output_kind: Some(output_kind),
            source_tab_id: request.source_tab_id.clone(),
            source_title: request.source_title.clone(),
            state: DownloadTaskState::Queued,
            received_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_second: 0,
            estimated_remaining_ms: None,
            priority: DownloadPriority::Normal,
            connections_requested: if backend == DownloadTaskBackend::NativeHttp {
                DEFAULT_NATIVE_HTTP_CONNECTIONS
            } else {
                1
            },
            connections_active: 0,
            can_resume: false,
            created_at: now.clone(),
            updated_at: now,
            started_at: None,
            completed_at: None,
            error_message: None,
            checksum: request.checksum.clone(),
            retry_count: Some(0),
            max_retries: Some(request.max_retries.unwrap_or(DEFAULT_MAX_RETRIES)),
            retry_delay_ms: Some(request.retry_delay_ms.unwrap_or(DEFAULT_RETRY_DELAY_MS)),
            mirrors: request.mirrors.clone(),
            active_mirror_index: Some(0),
            bt: request.bt.clone(),
            schedule_paused: Some(false),
            post_processing_state: Some("idle".to_string()),
            post_processing_message: None,
            missing_archive_parts: None,
            tags: rule.map(|rule| rule.tags).unwrap_or_default(),
        })
    }

    fn queue_task(self: &Arc<Self>, task_id: String) {
        if self.schedule_pause_active() {
            return;
        }
        let should_start = {
            let mut state = self.state.lock().expect("download state");
            if state.active.contains(&task_id) {
                false
            } else if state.active.len() >= MAX_ACTIVE_NATIVE_DOWNLOADS {
                false
            } else {
                let Some(task) = state.tasks.get_mut(&task_id) else {
                    return;
                };
                if matches!(
                    task.state,
                    DownloadTaskState::Queued
                        | DownloadTaskState::Paused
                        | DownloadTaskState::Failed
                ) {
                    task.state = DownloadTaskState::Downloading;
                    task.started_at.get_or_insert_with(now_iso);
                    task.connections_active = 1;
                    task.can_resume = true;
                    task.schedule_paused = Some(false);
                    task.updated_at = now_iso();
                    state.active.insert(task_id.clone());
                    true
                } else {
                    false
                }
            }
        };
        if should_start {
            let _ = self.persist_tasks();
            if let Some(task) = self.task(&task_id) {
                emit_event(&DownloadEvent::TaskUpdated { task: task.clone() });
                let manager = Arc::clone(self);
                thread::spawn(move || manager.run_task(task_id));
            }
        }
    }

    fn run_task(self: Arc<Self>, task_id: String) {
        let task = match self.task(&task_id) {
            Some(task) => task,
            None => return,
        };
        let result = match task
            .backend
            .clone()
            .unwrap_or(DownloadTaskBackend::NativeHttp)
        {
            DownloadTaskBackend::NativeHttp | DownloadTaskBackend::Electron => self.run_http(task),
            DownloadTaskBackend::Curl | DownloadTaskBackend::Aria2 => {
                self.mark_engine_planned(task)
            }
        };
        if let Err(message) = result {
            self.fail_or_retry(&task_id, message);
        }
        self.finish_active(&task_id);
        self.drain_queue();
    }

    fn run_http(&self, task: DownloadTask) -> Result<(), String> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::limited(8))
            .build()
            .map_err(|error| error.to_string())?;
        if let Some(parent) = Path::new(&task.save_path).parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut request = client.get(&task.url);
        if let Some(headers) = task.request_headers.as_ref() {
            for (name, value) in headers {
                request = request.header(name, value);
            }
        }
        let mut response = request.send().map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!("server returned {}", response.status()));
        }
        let total = response.content_length().unwrap_or(0);
        let mut file = File::create(&task.save_path).map_err(|error| error.to_string())?;
        let mut received = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        let mut last_emit = Instant::now();
        let mut last_bytes = 0_u64;
        loop {
            if !self.is_active(&task.id) {
                return Ok(());
            }
            let read = response
                .read(&mut buffer)
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])
                .map_err(|error| error.to_string())?;
            received += read as u64;
            if last_emit.elapsed() >= Duration::from_millis(250) {
                let elapsed = last_emit.elapsed().as_secs_f64().max(0.001);
                let speed = ((received - last_bytes) as f64 / elapsed).round() as u64;
                self.update_progress(&task.id, received, total, speed);
                last_emit = Instant::now();
                last_bytes = received;
            }
        }
        self.update_progress(&task.id, received, total, 0);
        if !self.verify_checksum(&task.id)? {
            return Ok(());
        }
        self.patch_task(&task.id, |task| {
            task.state = DownloadTaskState::Completed;
            task.received_bytes = if total > 0 { total } else { received };
            task.total_bytes = total;
            task.speed_bytes_per_second = 0;
            task.estimated_remaining_ms = None;
            task.connections_active = 0;
            task.can_resume = false;
            task.completed_at = Some(now_iso());
            task.updated_at = now_iso();
            task.error_message = None;
        });
        Ok(())
    }

    fn mark_engine_planned(&self, task: DownloadTask) -> Result<(), String> {
        self.patch_task(&task.id, |task| {
            task.state = DownloadTaskState::Failed;
            task.connections_active = 0;
            task.speed_bytes_per_second = 0;
            task.can_resume = true;
            task.updated_at = now_iso();
            task.error_message =
                Some("This backend is now native-owned but its process engine is not available in this build.".to_string());
        });
        Ok(())
    }

    fn fail_or_retry(self: &Arc<Self>, task_id: &str, message: String) {
        let retry = self.build_retry_task(task_id);
        if let Some((task, delay)) = retry {
            let id = task.id.clone();
            let _ = self.set_task(task);
            let manager = Arc::clone(self);
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(delay));
                manager.queue_task(id);
            });
            return;
        }
        self.patch_task(task_id, |task| {
            task.state = DownloadTaskState::Failed;
            task.speed_bytes_per_second = 0;
            task.estimated_remaining_ms = None;
            task.connections_active = 0;
            task.can_resume = true;
            task.updated_at = now_iso();
            task.error_message = Some(message);
        });
    }

    fn build_retry_task(&self, task_id: &str) -> Option<(DownloadTask, u64)> {
        let task = self.task(task_id)?;
        let retry_count = task.retry_count.unwrap_or(0);
        let max_retries = task.max_retries.unwrap_or(DEFAULT_MAX_RETRIES);
        if retry_count >= max_retries {
            return None;
        }
        let mut candidates = vec![task.url.clone()];
        if let Some(mirrors) = task.mirrors.as_ref() {
            for mirror in mirrors {
                if !candidates.contains(mirror) {
                    candidates.push(mirror.clone());
                }
            }
        }
        if let Some(original) = task.original_url.as_ref() {
            if !candidates.contains(original) {
                candidates.push(original.clone());
            }
        }
        let current_index = candidates
            .iter()
            .position(|candidate| candidate == &task.url)
            .unwrap_or(0);
        let next_index = if candidates.len() <= 1 {
            0
        } else {
            (current_index + 1) % candidates.len()
        };
        let delay = task.retry_delay_ms.unwrap_or(DEFAULT_RETRY_DELAY_MS);
        Some((
            DownloadTask {
                url: candidates.get(next_index).cloned().unwrap_or(task.url),
                state: DownloadTaskState::Queued,
                retry_count: Some(retry_count + 1),
                active_mirror_index: Some(next_index as u32),
                received_bytes: 0,
                speed_bytes_per_second: 0,
                estimated_remaining_ms: None,
                connections_active: 0,
                can_resume: true,
                completed_at: None,
                error_message: None,
                updated_at: now_iso(),
                ..task
            },
            delay,
        ))
    }

    fn verify_checksum(&self, task_id: &str) -> Result<bool, String> {
        let Some(task) = self.task(task_id) else {
            return Ok(false);
        };
        let Some(checksum) = task.checksum.clone() else {
            return Ok(true);
        };
        let actual = compute_hash(&task.save_path, &checksum.algorithm)?;
        let verified = actual.eq_ignore_ascii_case(&checksum.expected);
        self.patch_task(task_id, |task| {
            task.checksum = Some(DownloadChecksum {
                actual: Some(actual.clone()),
                verified: Some(verified),
                ..checksum.clone()
            });
            if !verified {
                task.state = DownloadTaskState::Failed;
                task.error_message = Some(format!(
                    "{} checksum mismatch.",
                    checksum.algorithm.to_uppercase()
                ));
            }
            task.updated_at = now_iso();
        });
        Ok(verified)
    }

    fn pause_task(&self, task_id: &str) -> Option<DownloadTask> {
        self.finish_active(task_id);
        self.patch_task(task_id, |task| {
            if !matches!(
                task.state,
                DownloadTaskState::Completed
                    | DownloadTaskState::Failed
                    | DownloadTaskState::Canceled
            ) {
                task.state = DownloadTaskState::Paused;
                task.schedule_paused = Some(false);
                task.speed_bytes_per_second = 0;
                task.estimated_remaining_ms = None;
                task.connections_active = 0;
                task.can_resume = true;
                task.updated_at = now_iso();
            }
        })
    }

    fn resume_task(self: &Arc<Self>, task_id: &str) -> Option<DownloadTask> {
        let task = self.patch_task(task_id, |task| {
            if !matches!(
                task.state,
                DownloadTaskState::Completed
                    | DownloadTaskState::Downloading
                    | DownloadTaskState::Canceled
            ) {
                task.state = DownloadTaskState::Queued;
                task.schedule_paused = Some(false);
                task.updated_at = now_iso();
            }
        });
        if task.is_some() {
            self.queue_task(task_id.to_string());
        }
        self.task(task_id)
    }

    fn cancel_task(&self, task_id: &str) -> Option<DownloadTask> {
        self.finish_active(task_id);
        self.patch_task(task_id, |task| {
            if !matches!(
                task.state,
                DownloadTaskState::Completed
                    | DownloadTaskState::Failed
                    | DownloadTaskState::Canceled
            ) {
                task.state = DownloadTaskState::Canceled;
                task.schedule_paused = Some(false);
                task.speed_bytes_per_second = 0;
                task.estimated_remaining_ms = None;
                task.connections_active = 0;
                task.updated_at = now_iso();
                task.error_message = Some("Download canceled.".to_string());
            }
        })
    }

    fn retry_task(self: &Arc<Self>, task_id: &str) -> Option<DownloadTask> {
        let task = self.patch_task(task_id, |task| {
            task.state = DownloadTaskState::Queued;
            task.received_bytes = 0;
            task.retry_count = Some(0);
            task.speed_bytes_per_second = 0;
            task.estimated_remaining_ms = None;
            task.connections_active = 0;
            task.can_resume = true;
            task.completed_at = None;
            task.error_message = None;
            task.updated_at = now_iso();
        });
        if task.is_some() {
            self.queue_task(task_id.to_string());
        }
        self.task(task_id)
    }

    fn remove_task(&self, task_id: &str) {
        self.finish_active(task_id);
        let removed = {
            let mut state = self.state.lock().expect("download state");
            state.tasks.remove(task_id).is_some()
        };
        if removed {
            let _ = self.persist_tasks();
            emit_event(&DownloadEvent::TaskRemoved {
                task_id: task_id.to_string(),
            });
        }
    }

    fn set_priority(&self, task_id: &str, priority: DownloadPriority) -> Option<DownloadTask> {
        self.patch_task(task_id, |task| {
            task.priority = priority;
            task.updated_at = now_iso();
        })
    }

    fn select_batch_ids(&self, requested: Option<Vec<String>>) -> Vec<String> {
        let state = self.state.lock().expect("download state");
        match requested {
            Some(ids) => ids
                .into_iter()
                .filter(|id| state.tasks.contains_key(id))
                .collect(),
            None => state.tasks.keys().cloned().collect(),
        }
    }

    fn apply_schedule(self: &Arc<Self>) {
        if self.schedule_pause_active() {
            let ids = self.select_batch_ids(None);
            for id in ids {
                let was_downloading = self
                    .task(&id)
                    .map(|task| task.state == DownloadTaskState::Downloading)
                    .unwrap_or(false);
                if was_downloading {
                    self.finish_active(&id);
                    self.patch_task(&id, |task| {
                        task.state = DownloadTaskState::Paused;
                        task.schedule_paused = Some(true);
                        task.connections_active = 0;
                        task.speed_bytes_per_second = 0;
                        task.updated_at = now_iso();
                    });
                }
            }
            return;
        }
        let ids = self.select_batch_ids(None);
        for id in ids {
            let should_resume = self
                .task(&id)
                .map(|task| {
                    task.state == DownloadTaskState::Paused && task.schedule_paused == Some(true)
                })
                .unwrap_or(false);
            if should_resume {
                self.patch_task(&id, |task| {
                    task.state = DownloadTaskState::Queued;
                    task.schedule_paused = Some(false);
                    task.updated_at = now_iso();
                });
                self.queue_task(id);
            }
        }
        self.drain_queue();
    }

    fn drain_queue(self: &Arc<Self>) {
        if self.schedule_pause_active() {
            return;
        }
        let ids = {
            let state = self.state.lock().expect("download state");
            let queued = state
                .tasks
                .values()
                .filter(|task| task.state == DownloadTaskState::Queued)
                .cloned()
                .collect();
            sort_tasks_for_queue(queued)
                .into_iter()
                .map(|task| task.id)
                .collect::<Vec<_>>()
        };
        for id in ids {
            let active_len = self.state.lock().expect("download state").active.len();
            if active_len >= MAX_ACTIVE_NATIVE_DOWNLOADS {
                break;
            }
            self.queue_task(id);
        }
    }

    fn schedule_pause_active(&self) -> bool {
        let settings = self.settings();
        let Some(schedule) = settings.schedule else {
            return false;
        };
        schedule.enabled && schedule.outside_action == "pause" && !schedule_window_active(&schedule)
    }

    fn remote_status(&self) -> DownloadRemoteStatus {
        let state = self.state.lock().expect("download state");
        let config = &state.remote.config;
        DownloadRemoteStatus {
            running: state.remote.running,
            host: config.host.clone(),
            port: if state.remote.running {
                Some(config.port)
            } else {
                None
            },
            base_url: if state.remote.running {
                Some(format!("http://{}:{}", config.host, config.port))
            } else {
                None
            },
            token: config.token.clone(),
        }
    }

    fn start_remote(
        self: &Arc<Self>,
        request: DownloadRemoteStartRequest,
    ) -> Result<DownloadRemoteStatus, String> {
        let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (host, port, token) = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "download state".to_string())?;
            if let Some(host) = request.host.filter(|value| !value.trim().is_empty()) {
                state.remote.config.host = host;
            } else if request.allow_lan == Some(true) {
                state.remote.config.host = "0.0.0.0".to_string();
            }
            if let Some(port) = request.port {
                state.remote.config.port = port;
            }
            write_json_atomic(
                &self.storage_root,
                &self.remote_config_file,
                &state.remote.config,
            )?;
            state.remote.running = true;
            state.remote.shutdown = Some(shutdown.clone());
            (
                state.remote.config.host.clone(),
                state.remote.config.port,
                state.remote.config.token.clone(),
            )
        };
        let manager = Arc::clone(self);
        thread::spawn(move || {
            if let Ok(server) = Server::http(format!("{host}:{port}")) {
                while !shutdown.load(std::sync::atomic::Ordering::Relaxed) {
                    let Ok(Some(request)) = server.recv_timeout(Duration::from_millis(250)) else {
                        continue;
                    };
                    handle_remote_request(&manager, request, &token);
                }
            }
        });
        Ok(self.remote_status())
    }

    fn stop_remote(&self) -> DownloadRemoteStatus {
        if let Ok(mut state) = self.state.lock() {
            if let Some(flag) = state.remote.shutdown.take() {
                flag.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            state.remote.running = false;
        }
        self.remote_status()
    }

    fn reserved_paths(&self, except_id: Option<&str>) -> HashSet<String> {
        let state = self.state.lock().expect("download state");
        state
            .tasks
            .values()
            .filter(|task| except_id != Some(task.id.as_str()))
            .map(|task| task.save_path.clone())
            .collect()
    }

    fn task(&self, task_id: &str) -> Option<DownloadTask> {
        self.state
            .lock()
            .expect("download state")
            .tasks
            .get(task_id)
            .cloned()
    }

    fn is_active(&self, task_id: &str) -> bool {
        self.state
            .lock()
            .expect("download state")
            .active
            .contains(task_id)
    }

    fn finish_active(&self, task_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.active.remove(task_id);
        }
    }

    fn set_task(&self, task: DownloadTask) -> Result<DownloadTask, String> {
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "download state".to_string())?;
            state.tasks.insert(task.id.clone(), task.clone());
        }
        self.persist_tasks()?;
        emit_event(&DownloadEvent::TaskUpdated { task: task.clone() });
        Ok(task)
    }

    fn patch_task(
        &self,
        task_id: &str,
        updater: impl FnOnce(&mut DownloadTask),
    ) -> Option<DownloadTask> {
        let task = {
            let mut state = self.state.lock().ok()?;
            let task = state.tasks.get_mut(task_id)?;
            updater(task);
            task.clone()
        };
        let _ = self.persist_tasks();
        emit_event(&DownloadEvent::TaskUpdated { task: task.clone() });
        Some(task)
    }

    fn update_progress(&self, task_id: &str, received: u64, total: u64, speed: u64) {
        self.patch_task(task_id, |task| {
            task.state = DownloadTaskState::Downloading;
            task.received_bytes = received;
            task.total_bytes = total;
            task.speed_bytes_per_second = speed;
            task.estimated_remaining_ms = estimate_remaining_ms(received, total, speed);
            task.connections_active = 1;
            task.can_resume = true;
            task.updated_at = now_iso();
            task.error_message = None;
        });
    }

    fn persist_tasks(&self) -> Result<(), String> {
        let tasks = self.snapshot();
        write_json_atomic(
            &self.storage_root,
            &self.tasks_file,
            &StoredDownloadTasksFile {
                version: 1,
                tasks: tasks.tasks,
            },
        )
    }
}

fn read_tasks(path: &Path) -> Result<Vec<DownloadTask>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let parsed: StoredDownloadTasksFile =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    Ok(parsed.tasks)
}

fn read_settings(path: &Path) -> Result<DownloadSettings, String> {
    if !path.exists() {
        return Ok(default_settings());
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn default_settings() -> DownloadSettings {
    DownloadSettings {
        version: 1,
        speed_limit_bytes_per_second: None,
        schedule: None,
        proxy: DownloadProxySettings {
            mode: "system".to_string(),
            url: None,
        },
        post_processing: DownloadPostProcessingSettings {
            auto_extract: false,
            extract_directory: None,
            delete_archive_after_extract: false,
            detect_split_archives: true,
        },
        bt: DownloadBtSettings {
            dht_enabled: true,
            peer_exchange_enabled: true,
            local_peer_discovery_enabled: true,
            seed_time_minutes: 0,
            tracker_urls: Vec::new(),
            max_upload_bytes_per_second: None,
        },
        default_headers: HashMap::new(),
        default_cookie_header: None,
        save_rules: Vec::new(),
        updated_at: now_iso(),
    }
}

fn read_remote_config(path: &Path) -> Result<RemoteApiConfig, String> {
    if path.exists() {
        let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
        return serde_json::from_str(&raw).map_err(|error| error.to_string());
    }
    Ok(RemoteApiConfig {
        version: 1,
        token: Uuid::new_v4().simple().to_string(),
        host: "127.0.0.1".to_string(),
        port: 17373,
    })
}

fn write_json_atomic<T: Serialize>(root: &Path, path: &Path, value: &T) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let temp = path.with_extension("tmp");
    let encoded = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&temp, encoded).map_err(|error| error.to_string())?;
    fs::rename(temp, path).map_err(|error| error.to_string())
}

fn restore_task(mut task: DownloadTask) -> Result<DownloadTask, String> {
    let was_active = matches!(
        task.state,
        DownloadTaskState::Downloading | DownloadTaskState::Queued | DownloadTaskState::Paused
    );
    if matches!(
        task.state,
        DownloadTaskState::Downloading | DownloadTaskState::Queued
    ) {
        task.state = DownloadTaskState::Queued;
    }
    task.speed_bytes_per_second = 0;
    task.connections_active = 0;
    task.can_resume = if matches!(
        task.state,
        DownloadTaskState::Completed | DownloadTaskState::Canceled
    ) {
        false
    } else {
        was_active || task.can_resume
    };
    task.retry_count.get_or_insert(0);
    task.max_retries.get_or_insert(DEFAULT_MAX_RETRIES);
    task.retry_delay_ms.get_or_insert(DEFAULT_RETRY_DELAY_MS);
    task.backend.get_or_insert(DownloadTaskBackend::Electron);
    task.output_kind.get_or_insert(DownloadTaskOutputKind::File);
    task.active_mirror_index.get_or_insert(0);
    task.schedule_paused.get_or_insert(false);
    task.post_processing_state
        .get_or_insert_with(|| "idle".to_string());
    if was_active {
        task.error_message = None;
    }
    Ok(task)
}

fn sort_tasks(mut tasks: Vec<DownloadTask>) -> Vec<DownloadTask> {
    tasks.sort_by(|left, right| {
        left.created_at
            .cmp(&right.created_at)
            .then(left.id.cmp(&right.id))
    });
    tasks
}

fn sort_tasks_for_queue(mut tasks: Vec<DownloadTask>) -> Vec<DownloadTask> {
    tasks.sort_by(|left, right| {
        priority_rank(&left.priority)
            .cmp(&priority_rank(&right.priority))
            .then(left.created_at.cmp(&right.created_at))
            .then(left.id.cmp(&right.id))
    });
    tasks
}

fn priority_rank(priority: &DownloadPriority) -> u8 {
    match priority {
        DownloadPriority::High => 0,
        DownloadPriority::Normal => 1,
        DownloadPriority::Low => 2,
    }
}

fn parse_download_urls(request: &DownloadEnqueueRequest) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(values) = request.urls.as_ref() {
        urls.extend(values.iter().flat_map(|value| extract_urls(value)));
    }
    if let Some(text) = request.text.as_ref() {
        urls.extend(extract_urls(text));
    }
    urls.into_iter()
        .filter(|url| !url.trim().is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}

fn extract_urls(text: &str) -> Vec<String> {
    text.split(|ch: char| ch.is_whitespace() || ch == '"' || ch == '\'' || ch == '<' || ch == '>')
        .filter(|part| {
            let lower = part.to_ascii_lowercase();
            lower.starts_with("http://")
                || lower.starts_with("https://")
                || lower.starts_with("ftp://")
                || lower.starts_with("ftps://")
                || lower.starts_with("sftp://")
                || lower.starts_with("webdav://")
                || lower.starts_with("webdavs://")
                || lower.starts_with("magnet:")
        })
        .map(|part| part.trim_matches(|ch| ch == ',' || ch == ';').to_string())
        .collect()
}

fn sanitize_file_name(value: &str) -> String {
    let replaced = value
        .trim()
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'..='\u{1f}' => '_',
            _ => ch,
        })
        .collect::<String>();
    let trimmed = replaced.trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.chars().take(180).collect()
    }
}

fn file_name_from_url(url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        if parsed.scheme() == "magnet" {
            if let Some(display_name) = parsed
                .query_pairs()
                .find_map(|(key, value)| (key == "dn").then(|| value.to_string()))
            {
                return display_name;
            }
            return "magnet-download".to_string();
        }
        if let Some(segment) = parsed
            .path_segments()
            .and_then(|mut segments| segments.next_back())
            .filter(|segment| !segment.is_empty())
        {
            return urlencoding::decode(segment)
                .map(|value| value.to_string())
                .unwrap_or_else(|_| segment.to_string());
        }
    }
    "download".to_string()
}

fn parse_protocol(url: &str) -> String {
    url::Url::parse(url)
        .map(|parsed| parsed.scheme().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

fn is_native_http_url(url: &str) -> bool {
    matches!(
        url::Url::parse(url).map(|parsed| parsed.scheme().to_string()),
        Ok(protocol) if matches!(protocol.as_str(), "http" | "https" | "webdav" | "webdavs")
    )
}

fn is_curl_url(url: &str) -> bool {
    matches!(
        url::Url::parse(url).map(|parsed| parsed.scheme().to_string()),
        Ok(protocol) if matches!(protocol.as_str(), "ftp" | "ftps" | "sftp")
    )
}

fn is_aria2_url(url: &str) -> bool {
    url.to_ascii_lowercase().starts_with("magnet:")
}

fn resolve_save_rule(
    settings: &DownloadSettings,
    url: &str,
    file_name: &str,
) -> Option<DownloadSaveRule> {
    let protocol = parse_protocol(url);
    let host = url::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(ToString::to_string))
        .unwrap_or_default();
    let extension = Path::new(file_name)
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase());
    settings
        .save_rules
        .iter()
        .find(|rule| {
            rule.enabled
                && (rule.protocols.is_empty()
                    || rule.protocols.iter().any(|item| item == &protocol))
                && (rule.host_contains.is_empty()
                    || rule.host_contains.iter().any(|part| host.contains(part)))
                && (rule.extensions.is_empty()
                    || extension
                        .as_ref()
                        .map(|ext| rule.extensions.iter().any(|candidate| candidate == ext))
                        .unwrap_or(false))
        })
        .cloned()
}

fn default_download_directory() -> String {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(std::env::temp_dir)
        .to_string_lossy()
        .to_string()
}

fn unique_path(directory: &str, file_name: &str, reserved: &HashSet<String>) -> String {
    let mut candidate = Path::new(directory).join(file_name);
    if !candidate.exists() && !reserved.contains(&candidate.to_string_lossy().to_string()) {
        return candidate.to_string_lossy().to_string();
    }
    let stem = Path::new(file_name)
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "download".to_string());
    let extension = Path::new(file_name)
        .extension()
        .map(|value| format!(".{}", value.to_string_lossy()))
        .unwrap_or_default();
    for index in 1..10_000 {
        candidate = Path::new(directory).join(format!("{stem} ({index}){extension}"));
        if !candidate.exists() && !reserved.contains(&candidate.to_string_lossy().to_string()) {
            return candidate.to_string_lossy().to_string();
        }
    }
    candidate.to_string_lossy().to_string()
}

fn estimate_remaining_ms(received: u64, total: u64, speed: u64) -> Option<u64> {
    if total == 0 || speed == 0 || received >= total {
        None
    } else {
        Some(((total - received) * 1000) / speed)
    }
}

fn compute_hash(path: &str, algorithm: &str) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    match algorithm {
        "sha1" => {
            let mut hasher = Sha1::new();
            hasher.update(&bytes);
            Ok(format!("{:x}", hasher.finalize()))
        }
        "sha256" => {
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            Ok(format!("{:x}", hasher.finalize()))
        }
        "md5" => Err("md5 checksum is not available in the Rust runtime yet".to_string()),
        other => Err(format!("unsupported checksum algorithm: {other}")),
    }
}

fn schedule_window_active(schedule: &DownloadScheduleSettings) -> bool {
    let now = Local::now();
    let minute = now.hour() as u16 * 60 + now.minute() as u16;
    if schedule.start_minute_of_day == schedule.end_minute_of_day {
        return true;
    }
    if schedule.start_minute_of_day < schedule.end_minute_of_day {
        minute >= schedule.start_minute_of_day && minute < schedule.end_minute_of_day
    } else {
        minute >= schedule.start_minute_of_day || minute < schedule.end_minute_of_day
    }
}

trait TimelikeExt {
    fn hour(&self) -> u32;
    fn minute(&self) -> u32;
}

impl TimelikeExt for chrono::DateTime<Local> {
    fn hour(&self) -> u32 {
        chrono::Timelike::hour(self)
    }

    fn minute(&self) -> u32 {
        chrono::Timelike::minute(self)
    }
}

fn handle_remote_request(
    manager: &Arc<DownloadManager>,
    mut request: tiny_http::Request,
    token: &str,
) {
    let authorized = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("authorization"))
        .map(|header| header.value.as_str() == format!("Bearer {token}"))
        .unwrap_or(false);
    if !authorized {
        let _ = request.respond(Response::empty(StatusCode(401)));
        return;
    }
    let path = request.url().to_string();
    let method = request.method().clone();
    let response = match (method, path.as_str()) {
        (Method::Get, "/api/downloads") => json_response(&manager.snapshot()),
        (Method::Post, "/api/downloads") => {
            let mut body = String::new();
            let _ = request.as_reader().read_to_string(&mut body);
            let parsed = serde_json::from_str::<DownloadEnqueueRequest>(&body).unwrap_or_default();
            match manager.enqueue(parsed) {
                Ok(()) => json_response(&manager.snapshot()),
                Err(error) => text_response(StatusCode(400), error),
            }
        }
        (Method::Post, "/api/downloads/pause-all") => {
            for id in manager.select_batch_ids(None) {
                manager.pause_task(&id);
            }
            json_response(&manager.snapshot())
        }
        (Method::Post, "/api/downloads/resume-all") => {
            for id in manager.select_batch_ids(None) {
                manager.resume_task(&id);
            }
            json_response(&manager.snapshot())
        }
        (Method::Post, "/api/downloads/cancel-all") => {
            for id in manager.select_batch_ids(None) {
                manager.cancel_task(&id);
            }
            json_response(&manager.snapshot())
        }
        (Method::Post, _) => {
            if let Some((task_id, action)) = parse_remote_task_action(&path) {
                match action {
                    "pause" => json_response(&manager.pause_task(&task_id)),
                    "resume" => json_response(&manager.resume_task(&task_id)),
                    "cancel" => json_response(&manager.cancel_task(&task_id)),
                    "retry" => json_response(&manager.retry_task(&task_id)),
                    "remove" => {
                        manager.remove_task(&task_id);
                        json_response(&manager.snapshot())
                    }
                    _ => text_response(StatusCode(404), "not found".to_string()),
                }
            } else {
                text_response(StatusCode(404), "not found".to_string())
            }
        }
        _ => text_response(StatusCode(404), "not found".to_string()),
    };
    let _ = request.respond(response);
}

fn parse_remote_task_action(path: &str) -> Option<(String, &str)> {
    let rest = path.strip_prefix("/api/downloads/")?;
    let (task_id, action) = rest.rsplit_once('/')?;
    if task_id.is_empty() || action.is_empty() {
        return None;
    }
    Some((urlencoding::decode(task_id).ok()?.to_string(), action))
}

fn json_response<T: Serialize>(value: &T) -> Response<std::io::Cursor<Vec<u8>>> {
    let encoded = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    let mut response = Response::from_data(encoded);
    if let Ok(header) = Header::from_bytes("content-type", "application/json") {
        response.add_header(header);
    }
    response
}

fn text_response(status: StatusCode, value: String) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(value).with_status_code(status)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn classifies_supported_protocols_with_native_c_helper() {
        assert_eq!(
            classify_download_protocol("HTTPS://example.com/file.zip"),
            DownloadProtocol::Https
        );
        assert_eq!(
            classify_download_protocol("sftp://files.example.com/a.tar"),
            DownloadProtocol::Sftp
        );
        assert_eq!(
            classify_download_protocol("magnet:?xt=urn:btih:abc"),
            DownloadProtocol::Magnet
        );
        assert_eq!(
            classify_download_protocol("file:///tmp/a"),
            DownloadProtocol::Unknown
        );
    }

    #[test]
    fn plans_multi_connection_segments_with_resume_offsets() {
        let response = plan_download(&DownloadPlanRequest {
            url: "https://example.com/artifact.bin".to_string(),
            total_bytes: 10_000,
            requested_connections: 4,
            min_segment_bytes: Some(1),
            existing_part_lengths: vec![2500, 100, 3000, 0],
        });

        assert_eq!(response.protocol, DownloadProtocol::Https);
        assert_eq!(response.connections, 4);
        assert_eq!(response.segments[0].complete, true);
        assert_eq!(response.segments[1].next_start, 2600);
        assert_eq!(response.segments[2].complete, true);
        assert_eq!(response.resumable, true);
    }

    #[test]
    fn restores_active_tasks_to_queue() {
        let mut task = sample_task("active", DownloadTaskState::Downloading);
        task.error_message = Some("interrupted".to_string());
        let restored = restore_task(task).expect("restored");

        assert_eq!(restored.state, DownloadTaskState::Queued);
        assert_eq!(restored.connections_active, 0);
        assert_eq!(restored.can_resume, true);
        assert_eq!(restored.error_message, None);
    }

    #[test]
    fn queue_sort_orders_priority_then_creation_time() {
        let tasks = vec![
            sample_task_with_priority(
                "normal-new",
                "2026-05-04T00:00:03.000Z",
                DownloadPriority::Normal,
            ),
            sample_task_with_priority(
                "high-new",
                "2026-05-04T00:00:04.000Z",
                DownloadPriority::High,
            ),
            sample_task_with_priority("low-old", "2026-05-04T00:00:01.000Z", DownloadPriority::Low),
            sample_task_with_priority(
                "high-old",
                "2026-05-04T00:00:02.000Z",
                DownloadPriority::High,
            ),
        ];

        let ordered = sort_tasks_for_queue(tasks)
            .into_iter()
            .map(|task| task.id)
            .collect::<Vec<_>>();

        assert_eq!(
            ordered,
            vec!["high-old", "high-new", "normal-new", "low-old"]
        );
    }

    #[test]
    fn checksum_failure_marks_task_failed() {
        let temp = tempfile::tempdir().expect("tempdir");
        let file = temp.path().join("file.txt");
        fs::write(&file, "actual").expect("write");
        let manager = Arc::new(DownloadManager::new(temp.path().join("store")).expect("manager"));
        let mut task = sample_task("checksum", DownloadTaskState::Completed);
        task.save_path = file.to_string_lossy().to_string();
        task.checksum = Some(DownloadChecksum {
            algorithm: "sha256".to_string(),
            expected: "bad".to_string(),
            actual: None,
            verified: None,
        });
        manager.set_task(task).expect("set");

        assert_eq!(
            manager.verify_checksum("checksum").expect("checksum"),
            false
        );
        let updated = manager.task("checksum").expect("task");
        assert_eq!(updated.state, DownloadTaskState::Failed);
        assert_eq!(updated.checksum.unwrap().verified, Some(false));
    }

    #[test]
    fn emits_json_plan_for_napi_boundary() {
        let json = plan_download_json(
            r#"{"url":"webdavs://example.com/file.iso","totalBytes":0,"requestedConnections":8}"#,
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let parsed: DownloadPlanResponse =
            serde_json::from_str(&json).unwrap_or_else(|error| panic!("{error}"));

        assert_eq!(parsed.protocol, DownloadProtocol::Webdavs);
        assert_eq!(parsed.connections, 1);
        assert_eq!(parsed.segments[0].end_inclusive, None);
    }

    fn sample_task(id: &str, state: DownloadTaskState) -> DownloadTask {
        sample_task_with_priority(id, "2026-05-04T00:00:00.000Z", DownloadPriority::Normal)
            .with_state(state)
    }

    fn sample_task_with_priority(
        id: &str,
        created_at: &str,
        priority: DownloadPriority,
    ) -> DownloadTask {
        DownloadTask {
            id: id.to_string(),
            url: format!("https://example.com/{id}.zip"),
            original_url: None,
            final_url: None,
            referrer: None,
            file_name: format!("{id}.zip"),
            mime_type: None,
            request_headers: None,
            proxy: None,
            save_path: format!("/tmp/{id}.zip"),
            directory: "/tmp".to_string(),
            protocol: "https".to_string(),
            source: DownloadTaskSource::Manual,
            backend: Some(DownloadTaskBackend::NativeHttp),
            output_kind: Some(DownloadTaskOutputKind::File),
            source_tab_id: None,
            source_title: None,
            state: DownloadTaskState::Queued,
            received_bytes: 0,
            total_bytes: 100,
            speed_bytes_per_second: 0,
            estimated_remaining_ms: None,
            priority,
            connections_requested: 4,
            connections_active: 0,
            can_resume: true,
            created_at: created_at.to_string(),
            updated_at: created_at.to_string(),
            started_at: None,
            completed_at: None,
            error_message: None,
            checksum: None,
            retry_count: None,
            max_retries: None,
            retry_delay_ms: None,
            mirrors: None,
            active_mirror_index: None,
            bt: None,
            schedule_paused: None,
            post_processing_state: None,
            post_processing_message: None,
            missing_archive_parts: None,
            tags: Vec::new(),
        }
    }

    trait WithState {
        fn with_state(self, state: DownloadTaskState) -> Self;
    }

    impl WithState for DownloadTask {
        fn with_state(mut self, state: DownloadTaskState) -> Self {
            self.state = state;
            self
        }
    }
}
