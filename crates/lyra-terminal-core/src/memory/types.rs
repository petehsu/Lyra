use super::*;

pub struct MemoryContext {
    pub storage_root: String,
    pub session_id: String,
}

#[derive(Clone)]
pub struct SessionCreatedInput {
    pub storage_root: String,
    pub session_id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
    pub source: String,
    pub mode: String,
    pub command: Option<String>,
    pub persist: bool,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[derive(Clone)]
pub struct WriteInput {
    pub storage_root: String,
    pub session_id: String,
    pub data: Option<String>,
    pub text: Option<String>,
    pub keys: Option<Vec<String>>,
    pub append_newline: bool,
    pub source: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[derive(Clone)]
pub struct ResizeInput {
    pub storage_root: String,
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[derive(Clone)]
pub struct CloseInput {
    pub storage_root: String,
    pub session_id: String,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

pub struct TimelineReadInput {
    pub storage_root: String,
    pub session_id: String,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub kinds: Option<Vec<String>>,
    pub actors: Option<Vec<String>>,
    pub command_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub agent_session_id: Option<String>,
    pub seq_start: Option<u64>,
    pub seq_end: Option<u64>,
    pub time_start_ms: Option<i64>,
    pub time_end_ms: Option<i64>,
    pub audit: Option<bool>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

pub struct EventsReadInput {
    pub storage_root: String,
    pub session_id: String,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub kinds: Option<Vec<String>>,
    pub actors: Option<Vec<String>>,
    pub audit: Option<bool>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

pub struct CommandsReadInput {
    pub storage_root: String,
    pub session_id: String,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
    pub status: Option<String>,
    pub audit: Option<bool>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

pub struct OutputRangeReadInput {
    pub storage_root: String,
    pub session_id: String,
    pub start: u64,
    pub end: u64,
    pub raw: bool,
    pub audit: Option<bool>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

pub struct ArtifactsListInput {
    pub storage_root: String,
    pub session_id: String,
    pub audit: Option<bool>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[derive(Clone)]
pub struct PermissionEventInput {
    pub storage_root: String,
    pub session_id: String,
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

#[derive(Clone)]
pub struct HandoffEventInput {
    pub storage_root: String,
    pub session_id: String,
    pub handoff_id: Option<String>,
    pub from_actor_json: Option<String>,
    pub to_actor_json: Option<String>,
    pub reason: Option<String>,
    pub summary: Option<String>,
    pub status: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[derive(Clone)]
pub struct OutputPolicyMarkerInput {
    pub storage_root: String,
    pub session_id: String,
    pub start: u64,
    pub end: u64,
    pub policy: String,
    pub reason: Option<String>,
    pub encrypted_ref: Option<String>,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[derive(Clone)]
pub struct ProcessStartedInput {
    pub storage_root: String,
    pub session_id: String,
    pub process_id: Option<u32>,
    pub shell: String,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub mode: String,
    pub source: String,
    pub cols: u16,
    pub rows: u16,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

#[derive(Clone)]
pub struct ProcessSignalInput {
    pub storage_root: String,
    pub session_id: String,
    pub signal: String,
    pub reason: String,
    pub actor_json: Option<String>,
    pub correlation_json: Option<String>,
}

pub struct OutputProjection {
    pub cursor: u64,
    pub output: String,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandCompletionProjection {
    pub terminal_session_id: String,
    pub command_id: String,
    pub command_text: Option<String>,
    pub status: String,
    pub exit_code: Option<i32>,
    pub signal: Option<String>,
    pub actor: Value,
    pub correlation: Value,
    pub output_text_range: Value,
    pub raw_output_range: Value,
    pub artifact_root_path: String,
    pub command_meta_path: String,
    pub command_output_text_path: String,
    pub command_raw_output_path: String,
    pub command_events_path: String,
    pub command_summary_path: String,
    pub completed_at: String,
}

#[derive(Clone)]
pub(super) struct SessionPaths {
    pub(super) session_root_path: PathBuf,
    pub(super) events_path: PathBuf,
    pub(super) summary_path: PathBuf,
    pub(super) ui_timeline_path: PathBuf,
    pub(super) commands_path: PathBuf,
    pub(super) command_artifacts_root_path: PathBuf,
    pub(super) permissions_path: PathBuf,
    pub(super) processes_path: PathBuf,
    pub(super) attachments_path: PathBuf,
    pub(super) screen_diffs_path: PathBuf,
    pub(super) retention_manifest_path: PathBuf,
    pub(super) repair_log_path: PathBuf,
    pub(super) index_manifest_path: PathBuf,
    pub(super) index_sessions_path: PathBuf,
    pub(super) index_events_path: PathBuf,
    pub(super) index_commands_path: PathBuf,
    pub(super) index_output_artifacts_path: PathBuf,
    pub(super) index_permissions_path: PathBuf,
    pub(super) index_agent_terminal_links_path: PathBuf,
    pub(super) output_compaction_path: PathBuf,
    pub(super) output_redactions_path: PathBuf,
    pub(super) output_text_path: PathBuf,
    pub(super) raw_output_path: PathBuf,
    pub(super) output_summary_path: PathBuf,
    pub(super) line_index_path: PathBuf,
    pub(super) error_index_path: PathBuf,
}

pub(super) struct SessionState {
    pub(super) next_seq: u64,
    pub(super) next_command_seq: u64,
    pub(super) next_line_number: u64,
    pub(super) error_count: u64,
    pub(super) timeline_item_count: u64,
    pub(super) paths: SessionPaths,
    pub(super) active_command_id: Option<String>,
    pub(super) active_command_output_text_start: Option<u64>,
    pub(super) active_command_raw_start: Option<u64>,
    pub(super) active_process_id: Option<u32>,
    pub(super) pending_line_text: String,
    pub(super) pending_line_text_offset: u64,
    pub(super) latest_event_kind: Option<String>,
    pub(super) latest_output_preview: Option<String>,
    pub(super) latest_timeline_preview: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StoredEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) event_id: Option<String>,
    pub(super) terminal_session_id: String,
    pub(super) seq: u64,
    pub(super) kind: String,
    pub(super) actor: Value,
    pub(super) payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) correlation: Option<Value>,
}
