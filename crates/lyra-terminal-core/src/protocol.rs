//! Terminal request/response/snapshot contract types.

#[cfg(feature = "node-api")]
use napi_derive::napi;
use serde::{Deserialize, Serialize};

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalLifecycleProjection {
    pub session_id: String,
    pub state: String,
    pub phase: String,
    pub reason: Option<String>,
    pub terminal_running: bool,
    pub command_id: Option<String>,
    pub command_status: Option<String>,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub source: Option<String>,
    pub mode: Option<String>,
    pub current_cwd: Option<String>,
    pub waiting: bool,
    pub background: bool,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalCreateRequest {
    pub session_id: Option<String>,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub env: Option<Vec<TerminalShellLaunchEnvPair>>,
    pub cols: u16,
    pub rows: u16,
    pub source: Option<String>,
    pub mode: Option<String>,
    pub command: Option<String>,
    pub persist: Option<bool>,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalShellLaunchEnvPair {
    pub key: String,
    pub value: String,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalShellLaunchPlanRequest {
    pub shell: String,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalShellLaunchPlanResponse {
    pub shell: String,
    pub args: Vec<String>,
    pub env: Vec<TerminalShellLaunchEnvPair>,
    pub integration_enabled: bool,
    pub integration_family: Option<String>,
    pub integration_script_asset: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalWriteRequest {
    pub session_id: String,
    pub data: Option<String>,
    pub text: Option<String>,
    pub keys: Option<Vec<String>>,
    pub append_newline: Option<bool>,
    pub source: Option<String>,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalReadRequest {
    pub session_id: String,
    pub cursor: Option<String>,
    pub max_bytes: Option<u32>,
    pub wait_ms: Option<u32>,
    pub storage_root: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReadResponse {
    pub session_id: String,
    pub cursor: String,
    pub output: String,
    pub running: bool,
    pub exit_code: Option<i32>,
    pub truncated: bool,
    pub source: String,
    pub mode: String,
    pub memory: Option<String>,
    pub reason: Option<String>,
    pub lifecycle: Option<TerminalLifecycleProjection>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalCloseRequest {
    pub session_id: String,
    pub storage_root: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalInputExecuteRequest {
    pub session_id: String,
    pub storage_root: Option<String>,
    pub action: String,
    pub command: Option<String>,
    pub text: Option<String>,
    pub keys: Option<Vec<String>>,
    pub append_newline: Option<bool>,
    pub bracketed_paste: Option<bool>,
    pub sensitive_refs: Option<Vec<String>>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
    pub signal: Option<String>,
    pub reason: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalContractEventRef {
    pub event_id: Option<String>,
    pub kind: String,
    pub seq: Option<f64>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputExecuteResponse {
    pub session_id: String,
    pub input_id: String,
    pub action: String,
    pub status: String,
    pub permission_id: Option<String>,
    pub events: Vec<TerminalContractEventRef>,
    pub memory: Option<String>,
    pub lifecycle: Option<TerminalLifecycleProjection>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalPermissionEvaluateRequest {
    pub session_id: String,
    pub storage_root: String,
    pub action: String,
    pub input_id: Option<String>,
    pub command_id: Option<String>,
    pub risk: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub detail: Option<String>,
    pub redacted_preview: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPermissionEvaluateResponse {
    pub session_id: String,
    pub permission_id: String,
    pub decision: String,
    pub risk: String,
    pub reason: Option<String>,
    pub memory: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalPermissionRespondRequest {
    pub session_id: String,
    pub storage_root: String,
    pub permission_id: String,
    pub decision: String,
    pub reason: Option<String>,
    pub expires_at: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalPermissionRespondResponse {
    pub session_id: String,
    pub permission_id: String,
    pub decision: String,
    pub expires_at: Option<String>,
    pub memory: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalPermissionEventRequest {
    pub session_id: String,
    pub storage_root: String,
    pub permission_id: String,
    pub action: Option<String>,
    pub risk: Option<String>,
    pub summary: Option<String>,
    pub title: Option<String>,
    pub detail: Option<String>,
    pub command_id: Option<String>,
    pub input_id: Option<String>,
    pub agent_session_id: Option<String>,
    pub runtime_turn_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub decision: Option<String>,
    pub reason: Option<String>,
    pub expires_at: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalHandoffEventRequest {
    pub session_id: String,
    pub storage_root: String,
    pub handoff_id: Option<String>,
    pub from_actor_json: Option<String>,
    pub to_actor_json: Option<String>,
    pub reason: Option<String>,
    pub summary: Option<String>,
    pub status: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalOutputPolicyMarkerRequest {
    pub session_id: String,
    pub storage_root: String,
    pub start: f64,
    pub end: f64,
    pub policy: String,
    pub reason: Option<String>,
    pub encrypted_ref: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalProcessesReadRequest {
    pub session_id: String,
    pub storage_root: String,
    pub pid: Option<u32>,
    pub include_tree: Option<bool>,
    pub include_command: Option<bool>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProcessSnapshot {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub foreground: Option<bool>,
    pub command_id: Option<String>,
    pub name: Option<String>,
    pub command_line: Option<String>,
    pub cwd: Option<String>,
    pub running: bool,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub children: Option<Vec<TerminalProcessSnapshot>>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProcessesReadResponse {
    pub session_id: String,
    pub pid: Option<u32>,
    pub foreground_pid: Option<u32>,
    pub running: bool,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub limited: Option<bool>,
    pub processes: Vec<TerminalProcessSnapshot>,
    pub memory: Option<String>,
    pub lifecycle: Option<TerminalLifecycleProjection>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalProcessSignalRequest {
    pub session_id: String,
    pub storage_root: String,
    pub pid: Option<u32>,
    pub signal: String,
    pub reason: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProcessSignalResponse {
    pub session_id: String,
    pub pid: Option<u32>,
    pub signal: String,
    pub status: String,
    pub input_id: Option<String>,
    pub permission_id: Option<String>,
    pub memory: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalNumberRange {
    pub start: f64,
    pub end: f64,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandSnapshot {
    pub command_id: String,
    pub session_id: String,
    pub command_text: Option<String>,
    pub normalized_command_text: Option<String>,
    pub status: String,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub submitted_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub duration_ms: Option<f64>,
    pub cwd_before: Option<String>,
    pub cwd_after: Option<String>,
    pub output_range: Option<TerminalNumberRange>,
    pub raw_output_range: Option<TerminalNumberRange>,
    pub screen_version_range: Option<TerminalNumberRange>,
    pub artifact_root_path: Option<String>,
    pub command_meta_path: Option<String>,
    pub command_output_text_path: Option<String>,
    pub command_raw_output_path: Option<String>,
    pub command_events_path: Option<String>,
    pub command_summary_path: Option<String>,
    pub confidence: Option<f64>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalCommandStatusRequest {
    pub session_id: String,
    pub storage_root: String,
    pub command_id: Option<String>,
    pub include_output_summary: Option<bool>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandStatusResponse {
    pub session_id: String,
    pub command_id: Option<String>,
    pub command: Option<TerminalCommandSnapshot>,
    pub memory: Option<String>,
    pub lifecycle: Option<TerminalLifecycleProjection>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalCommandWaitRequest {
    pub session_id: String,
    pub storage_root: String,
    pub command_id: Option<String>,
    pub status: Option<String>,
    pub timeout_ms: Option<u32>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandWaitResponse {
    pub session_id: String,
    pub command_id: Option<String>,
    pub status: String,
    pub reason: String,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub memory: Option<String>,
    pub lifecycle: Option<TerminalLifecycleProjection>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalCommandOutputReadRequest {
    pub session_id: String,
    pub storage_root: String,
    pub command_id: String,
    pub start: Option<f64>,
    pub end: Option<f64>,
    pub max_bytes: Option<u32>,
    pub raw: Option<bool>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandOutputReadResponse {
    pub session_id: String,
    pub command_id: String,
    pub raw: bool,
    pub encoding: String,
    pub requested_range: TerminalNumberRange,
    pub range: TerminalNumberRange,
    pub next_start: f64,
    pub byte_length: f64,
    pub total_bytes: f64,
    pub output: String,
    pub raw_bytes_hex: Option<String>,
    pub sha256: Option<String>,
    pub truncated: bool,
    pub memory: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSnapshot {
    pub session_id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub current_cwd: Option<String>,
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
    pub created_at: String,
    pub source: String,
    pub mode: String,
    pub command: Option<String>,
    pub persist: bool,
    pub running: bool,
    pub exit_code: Option<i32>,
}