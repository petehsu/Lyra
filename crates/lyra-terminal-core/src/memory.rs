use crate::screen::TerminalScreenState;
use crate::shell_integration::{ShellIntegrationEvent, ShellIntegrationEventKind};
use chrono::{SecondsFormat, Utc};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const INLINE_TOKEN_LIMIT: u64 = 6_000;
const OUTPUT_PREVIEW_CHARS: usize = 240;
const DEFAULT_TIMELINE_LIMIT: usize = 100;
const MAX_TIMELINE_LIMIT: usize = 500;
const DEFAULT_EVENTS_LIMIT: usize = 100;
const MAX_EVENTS_LIMIT: usize = 500;
const DEFAULT_COMMANDS_LIMIT: usize = 100;
const MAX_COMMANDS_LIMIT: usize = 500;
const MAX_OUTPUT_RANGE_BYTES: u64 = 1024 * 1024;

static ANSI_CSI_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").expect("valid CSI regex"));
static ANSI_OSC_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\x1b\][^\x07]*(?:\x07|\x1b\\)").expect("valid OSC regex"));
static MEMORY_STATES: Lazy<Mutex<HashMap<String, Arc<Mutex<SessionState>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

type MemoryResult<T> = std::result::Result<T, String>;

#[derive(Clone)]
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
struct SessionPaths {
    session_root_path: PathBuf,
    events_path: PathBuf,
    summary_path: PathBuf,
    ui_timeline_path: PathBuf,
    commands_path: PathBuf,
    command_artifacts_root_path: PathBuf,
    permissions_path: PathBuf,
    processes_path: PathBuf,
    attachments_path: PathBuf,
    screen_diffs_path: PathBuf,
    retention_manifest_path: PathBuf,
    repair_log_path: PathBuf,
    index_manifest_path: PathBuf,
    index_sessions_path: PathBuf,
    index_events_path: PathBuf,
    index_commands_path: PathBuf,
    index_output_artifacts_path: PathBuf,
    index_permissions_path: PathBuf,
    index_agent_terminal_links_path: PathBuf,
    output_compaction_path: PathBuf,
    output_redactions_path: PathBuf,
    output_text_path: PathBuf,
    raw_output_path: PathBuf,
    output_summary_path: PathBuf,
    line_index_path: PathBuf,
    error_index_path: PathBuf,
}

struct SessionState {
    next_seq: u64,
    next_command_seq: u64,
    next_line_number: u64,
    error_count: u64,
    timeline_item_count: u64,
    paths: SessionPaths,
    active_command_id: Option<String>,
    active_command_output_text_start: Option<u64>,
    active_command_raw_start: Option<u64>,
    active_process_id: Option<u32>,
    pending_line_text: String,
    pending_line_text_offset: u64,
    latest_event_kind: Option<String>,
    latest_output_preview: Option<String>,
    latest_timeline_preview: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    event_id: Option<String>,
    terminal_session_id: String,
    seq: u64,
    kind: String,
    actor: Value,
    payload: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    correlation: Option<Value>,
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn safe_segment(value: &str) -> String {
    let mut output = String::new();
    for character in value.trim().chars() {
        if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
            output.push(character);
        } else if !output.ends_with('_') {
            output.push('_');
        }
    }
    let trimmed = output.trim_matches('_');
    if trimmed.is_empty() {
        "terminal-session".to_string()
    } else {
        trimmed.chars().take(160).collect()
    }
}

fn state_key(storage_root: &str, session_id: &str) -> String {
    format!("{storage_root}\u{0}{session_id}")
}

fn paths_for_session(storage_root: &str, session_id: &str) -> SessionPaths {
    let session_root = Path::new(storage_root)
        .join("terminal-memory")
        .join("sessions")
        .join(safe_segment(session_id));
    let outputs = session_root.join("outputs");
    let indexes = session_root.join("indexes");
    SessionPaths {
        session_root_path: session_root.clone(),
        events_path: session_root.join("events.jsonl"),
        summary_path: session_root.join("summary.json"),
        ui_timeline_path: session_root.join("ui-timeline.jsonl"),
        commands_path: session_root.join("commands.jsonl"),
        command_artifacts_root_path: session_root.join("commands"),
        permissions_path: session_root.join("permissions.jsonl"),
        processes_path: session_root.join("processes.jsonl"),
        attachments_path: session_root.join("attachments.jsonl"),
        screen_diffs_path: session_root.join("screen-diffs.jsonl"),
        retention_manifest_path: session_root.join("retention.json"),
        repair_log_path: session_root.join("repairs.jsonl"),
        index_manifest_path: indexes.join("index.v2.manifest.json"),
        index_sessions_path: indexes.join("terminal_sessions.jsonl"),
        index_events_path: indexes.join("terminal_events.jsonl"),
        index_commands_path: indexes.join("terminal_commands.jsonl"),
        index_output_artifacts_path: indexes.join("terminal_output_artifacts.jsonl"),
        index_permissions_path: indexes.join("terminal_permissions.jsonl"),
        index_agent_terminal_links_path: indexes.join("agent_terminal_links.jsonl"),
        output_compaction_path: outputs.join("session-output.compaction.json"),
        output_redactions_path: outputs.join("session-output.redactions.jsonl"),
        output_text_path: outputs.join("session-output.txt"),
        raw_output_path: outputs.join("session-output.raw"),
        output_summary_path: outputs.join("session-output.summary.json"),
        line_index_path: outputs.join("session-output.lines.jsonl"),
        error_index_path: outputs.join("session-output.errors.jsonl"),
    }
}

fn ensure_file(path: &Path) -> MemoryResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn append_json_line(path: &Path, value: &Value) -> MemoryResult<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    serde_json::to_writer(&mut file, value).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

fn write_json_pretty(path: &Path, value: &Value) -> MemoryResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = File::create(path).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(&mut file, value).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

fn file_size(path: &Path) -> u64 {
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn read_jsonl(path: &Path) -> Vec<Value> {
    read_jsonl_with_repair_log(path, None)
}

fn append_repair_warning(
    repair_log_path: &Path,
    source_path: &Path,
    line_number: usize,
    error: &str,
) {
    let warning = json!({
        "repairWarningId": format!("terminal-repair-{}", Uuid::new_v4()),
        "sourcePath": source_path.to_string_lossy(),
        "lineNumber": line_number,
        "warning": "corrupt_jsonl_line_skipped",
        "error": error,
        "createdAt": now_iso()
    });
    let _ = append_json_line(repair_log_path, &warning);
}

fn read_jsonl_with_repair_log(path: &Path, repair_log_path: Option<&Path>) -> Vec<Value> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return Vec::new(),
    };
    BufReader::new(file)
        .lines()
        .enumerate()
        .filter_map(|(index, line_result)| {
            let line = match line_result {
                Ok(line) => line,
                Err(error) => {
                    if let Some(repair_log_path) = repair_log_path {
                        append_repair_warning(repair_log_path, path, index + 1, &error.to_string());
                    }
                    return None;
                }
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                None
            } else {
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(value) => Some(value),
                    Err(error) => {
                        if let Some(repair_log_path) = repair_log_path {
                            append_repair_warning(
                                repair_log_path,
                                path,
                                index + 1,
                                &error.to_string(),
                            );
                        }
                        None
                    }
                }
            }
        })
        .collect()
}

fn read_last_jsonl(path: &Path) -> Option<Value> {
    read_jsonl(path).into_iter().last()
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToString::to_string)
}

fn number_field(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn parse_json_object(input: Option<&str>) -> Value {
    input
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}

fn compact_object(value: Value) -> Value {
    let Some(object) = value.as_object() else {
        return json!({});
    };
    let mut compacted = Map::new();
    for (key, item) in object {
        if !item.is_null() {
            compacted.insert(key.clone(), item.clone());
        }
    }
    Value::Object(compacted)
}

fn merge_object(left: Value, right: Value) -> Value {
    let mut merged = Map::new();
    if let Some(object) = left.as_object() {
        for (key, item) in object {
            if !item.is_null() {
                merged.insert(key.clone(), item.clone());
            }
        }
    }
    if let Some(object) = right.as_object() {
        for (key, item) in object {
            if !item.is_null() {
                merged.insert(key.clone(), item.clone());
            }
        }
    }
    Value::Object(merged)
}

fn default_actor_for_source(source: Option<&str>) -> Value {
    match source {
        Some("agent") | Some("ai") => json!({ "kind": "agent" }),
        Some("system") => json!({ "kind": "terminal_kernel" }),
        _ => json!({ "kind": "human_user" }),
    }
}

fn actor_from_request(actor_json: Option<&str>, source: Option<&str>) -> Value {
    let actor = parse_json_object(actor_json);
    if actor.as_object().is_some_and(|object| !object.is_empty()) {
        actor
    } else {
        default_actor_for_source(source)
    }
}

fn actor_label(actor: &Value) -> String {
    if let Some(display_name) = string_field(actor, "displayName") {
        return display_name;
    }
    match string_field(actor, "kind").as_deref() {
        Some("human_user") => "Human",
        Some("agent") => "Agent",
        Some("subagent") => "Subagent",
        Some("terminal_kernel") => "Terminal",
        Some("process") => "Process",
        Some("permission") => "Permission",
        _ => "System",
    }
    .to_string()
}

fn estimate_tokens(byte_length: u64) -> u64 {
    byte_length.div_ceil(3)
}

fn strip_ansi(value: &str) -> String {
    let without_csi = ANSI_CSI_RE.replace_all(value, "");
    ANSI_OSC_RE
        .replace_all(&without_csi, "")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

fn preview_text(value: &str) -> String {
    let normalized = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() > OUTPUT_PREVIEW_CHARS {
        let prefix: String = normalized.chars().take(OUTPUT_PREVIEW_CHARS).collect();
        format!("{prefix}...")
    } else {
        normalized
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn classify_output_issue(line: &str) -> Option<&'static str> {
    static ERROR_WORD_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r"(?i)\b(error|failed|failure|fatal|exception|panic|traceback|segmentation fault)\b",
        )
        .expect("valid error regex")
    });
    static ERROR_CODE_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"(?i)\b(err_|e_[a-z0-9_]+)\b").expect("valid code regex"));
    let normalized = line.trim();
    if normalized.is_empty() {
        return None;
    }
    if ERROR_WORD_RE.is_match(normalized)
        || ERROR_CODE_RE.is_match(normalized)
        || normalized
            .get(..normalized.len().min(8))
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("npm ERR!"))
        || normalized
            .get(..normalized.len().min(6))
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("error:"))
        || normalized
            .get(..normalized.len().min(6))
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("error "))
    {
        Some("error")
    } else {
        None
    }
}

fn write_retention_manifest(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    if file_size(&paths.retention_manifest_path) > 0 {
        return Ok(());
    }
    write_json_pretty(
        &paths.retention_manifest_path,
        &json!({
            "schemaVersion": 1,
            "terminalSessionId": session_id,
            "createdAt": now_iso(),
            "policy": {
                "ttlDays": null,
                "compactionState": "uncompacted",
                "privacyFlags": [],
                "redactionPolicy": "none"
            },
            "artifacts": {
                "truth": "jsonl_and_text_artifacts",
                "indexes": "append_only_jsonl",
                "largeOutput": "stored_on_disk"
            }
        }),
    )
}

fn write_output_policy_manifests(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    if file_size(&paths.output_compaction_path) == 0 {
        write_json_pretty(
            &paths.output_compaction_path,
            &json!({
                "schemaVersion": 1,
                "terminalSessionId": session_id,
                "state": "uncompacted",
                "coordinateSpace": "original_output_byte_offsets",
                "guarantee": "line indexes and command ranges remain in original byte coordinates after compaction",
                "compactedArtifacts": [],
                "updatedAt": now_iso()
            }),
        )?;
    }
    ensure_file(&paths.output_redactions_path)
}

fn write_index_store_manifest(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    write_json_pretty(
        &paths.index_manifest_path,
        &json!({
            "schemaVersion": 2,
            "terminalSessionId": session_id,
            "updatedAt": now_iso(),
            "decision": {
                "truthStore": "jsonl_text_artifacts",
                "indexStore": "kernel_managed_jsonl_indexes",
                "sqliteTruthStore": false,
                "rationale": "append-only JSONL/text artifacts remain the durable truth; v2 indexes are derived and can be rebuilt from v1 files"
            },
            "migration": {
                "from": "v1_jsonl_text_artifacts",
                "lossless": true,
                "rebuildable": true
            },
            "indexes": {
                "terminal_sessions": paths.index_sessions_path.to_string_lossy(),
                "terminal_events": paths.index_events_path.to_string_lossy(),
                "terminal_commands": paths.index_commands_path.to_string_lossy(),
                "terminal_output_artifacts": paths.index_output_artifacts_path.to_string_lossy(),
                "terminal_permissions": paths.index_permissions_path.to_string_lossy(),
                "agent_terminal_links": paths.index_agent_terminal_links_path.to_string_lossy(),
                "command_artifacts_root": paths.command_artifacts_root_path.to_string_lossy()
            }
        }),
    )
}

fn rebuild_output_indexes_from_text(paths: &SessionPaths, session_id: &str) -> MemoryResult<()> {
    let output_size = file_size(&paths.output_text_path);
    if output_size == 0 || file_size(&paths.line_index_path) > 0 {
        return Ok(());
    }
    if output_size > 32 * 1024 * 1024 {
        append_repair_warning(
            &paths.repair_log_path,
            &paths.output_text_path,
            0,
            "output index rebuild skipped for large artifact; use terminal.output.readRange",
        );
        return Ok(());
    }
    File::create(&paths.line_index_path).map_err(|error| error.to_string())?;
    File::create(&paths.error_index_path).map_err(|error| error.to_string())?;

    let file = File::open(&paths.output_text_path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut text_offset = 0_u64;
    let mut line_number = 1_u64;
    let mut error_count = 0_u64;
    loop {
        line.clear();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            break;
        }
        let mut line_text = line.as_str();
        if let Some(stripped) = line_text.strip_suffix('\n') {
            line_text = stripped;
        }
        if let Some(stripped) = line_text.strip_suffix('\r') {
            line_text = stripped;
        }
        let text_preview = preview_text(line_text);
        let line_record = json!({
            "lineNumber": line_number,
            "terminalSessionId": session_id,
            "outputEventSeq": 0,
            "textOffset": text_offset,
            "byteLength": line_text.len(),
            "textPreview": text_preview,
            "sha256": sha256_hex(line_text.as_bytes()),
            "createdAt": now_iso(),
            "recovered": true
        });
        append_json_line(&paths.line_index_path, &line_record)?;
        if let Some(severity) = classify_output_issue(line_text) {
            error_count = error_count.saturating_add(1);
            append_json_line(
                &paths.error_index_path,
                &merge_object(
                    line_record,
                    json!({
                        "errorNumber": error_count,
                        "severity": severity
                    }),
                ),
            )?;
        }
        text_offset = text_offset.saturating_add(bytes_read as u64);
        line_number = line_number.saturating_add(1);
    }
    Ok(())
}

fn initialize_state(
    storage_root: &str,
    session_id: &str,
) -> MemoryResult<Arc<Mutex<SessionState>>> {
    let key = state_key(storage_root, session_id);
    if let Some(existing) = MEMORY_STATES
        .lock()
        .map_err(|_| "failed to lock terminal memory states".to_string())?
        .get(&key)
        .cloned()
    {
        return Ok(existing);
    }

    let paths = paths_for_session(storage_root, session_id);
    fs::create_dir_all(&paths.command_artifacts_root_path).map_err(|error| error.to_string())?;
    for path in [
        &paths.events_path,
        &paths.summary_path,
        &paths.ui_timeline_path,
        &paths.commands_path,
        &paths.permissions_path,
        &paths.processes_path,
        &paths.attachments_path,
        &paths.screen_diffs_path,
        &paths.retention_manifest_path,
        &paths.repair_log_path,
        &paths.index_manifest_path,
        &paths.index_sessions_path,
        &paths.index_events_path,
        &paths.index_commands_path,
        &paths.index_output_artifacts_path,
        &paths.index_permissions_path,
        &paths.index_agent_terminal_links_path,
        &paths.output_compaction_path,
        &paths.output_redactions_path,
        &paths.output_text_path,
        &paths.raw_output_path,
        &paths.output_summary_path,
        &paths.line_index_path,
        &paths.error_index_path,
    ] {
        ensure_file(path)?;
    }
    write_retention_manifest(session_id, &paths)?;
    write_output_policy_manifests(session_id, &paths)?;
    if file_size(&paths.index_manifest_path) == 0 || file_size(&paths.index_events_path) == 0 {
        rebuild_index_store_from_paths(session_id, &paths)?;
    }
    rebuild_output_indexes_from_text(&paths, session_id)?;

    let next_seq = read_jsonl_with_repair_log(&paths.events_path, Some(&paths.repair_log_path))
        .into_iter()
        .last()
        .and_then(|record| number_field(&record, "seq"))
        .map(|seq| seq.saturating_add(1))
        .unwrap_or(1);
    let command_records =
        read_jsonl_with_repair_log(&paths.commands_path, Some(&paths.repair_log_path));
    let next_command_seq = command_records
        .last()
        .and_then(|record| number_field(record, "commandSeq"))
        .map(|seq| seq.saturating_add(1))
        .unwrap_or_else(|| command_records.len() as u64 + 1);
    let next_line_number = read_last_jsonl(&paths.line_index_path)
        .and_then(|record| number_field(&record, "lineNumber"))
        .map(|line| line.saturating_add(1))
        .unwrap_or(1);
    let error_count = read_last_jsonl(&paths.error_index_path)
        .and_then(|record| number_field(&record, "errorNumber"))
        .unwrap_or(0);
    let last_timeline_item = read_last_jsonl(&paths.ui_timeline_path);
    let timeline_item_count = last_timeline_item
        .as_ref()
        .and_then(|record| number_field(record, "itemIndex"))
        .unwrap_or(0);
    let latest_timeline_preview = last_timeline_item
        .as_ref()
        .and_then(|record| string_field(record, "preview"));
    let latest_output_preview = fs::read_to_string(&paths.summary_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
        .and_then(|summary| {
            summary
                .get("memory")
                .and_then(|memory| string_field(memory, "latestOutputPreview"))
        })
        .or_else(|| {
            read_last_jsonl(&paths.line_index_path)
                .and_then(|line| string_field(&line, "textPreview"))
        });
    let mut active_command_id = None;
    let mut active_command_output_text_start = None;
    let mut active_command_raw_start = None;
    for command in &command_records {
        let command_id = string_field(command, "commandId");
        match string_field(command, "status").as_deref() {
            Some("running") => {
                active_command_id = command_id;
                active_command_output_text_start = command
                    .get("outputTextRange")
                    .and_then(|range| number_field(range, "start"));
                active_command_raw_start = command
                    .get("rawOutputRange")
                    .and_then(|range| number_field(range, "start"));
            }
            Some("completed") | Some("failed") => {
                if command_id.is_some() && command_id == active_command_id {
                    active_command_id = None;
                    active_command_output_text_start = None;
                    active_command_raw_start = None;
                }
            }
            _ => {}
        }
    }
    let active_process_id =
        read_jsonl_with_repair_log(&paths.processes_path, Some(&paths.repair_log_path))
            .into_iter()
            .filter(|record| string_field(record, "status").as_deref() == Some("running"))
            .filter_map(|record| number_field(&record, "processId"))
            .last()
            .and_then(|process_id| u32::try_from(process_id).ok());
    let pending_line_text_offset = file_size(&paths.output_text_path);

    let state = Arc::new(Mutex::new(SessionState {
        next_seq,
        next_command_seq,
        next_line_number,
        error_count,
        timeline_item_count,
        paths,
        active_command_id,
        active_command_output_text_start,
        active_command_raw_start,
        active_process_id,
        pending_line_text: String::new(),
        pending_line_text_offset,
        latest_event_kind: None,
        latest_output_preview,
        latest_timeline_preview,
    }));

    MEMORY_STATES
        .lock()
        .map_err(|_| "failed to lock terminal memory states".to_string())?
        .insert(key, Arc::clone(&state));
    Ok(state)
}

fn output_projection_recommendation(output_size: u64) -> &'static str {
    let estimated_tokens = estimate_tokens(output_size);
    if estimated_tokens <= INLINE_TOKEN_LIMIT {
        "inline"
    } else if output_size <= 32 * 1024 * 1024 {
        "cache"
    } else {
        "summary"
    }
}

fn artifact_record(label: &str, path: &Path, kind: &str, media_type: &str, role: &str) -> Value {
    json!({
        "artifactId": format!("terminal-artifact-{}", safe_segment(label)),
        "label": label,
        "path": path.to_string_lossy(),
        "kind": kind,
        "mediaType": media_type,
        "role": role,
        "byteLength": file_size(path),
        "exists": path.exists()
    })
}

fn artifact_records(state: &SessionState) -> Vec<Value> {
    vec![
        artifact_record(
            "summary.json",
            &state.paths.summary_path,
            "summary",
            "application/json",
            "session_summary",
        ),
        artifact_record(
            "session-output.summary.json",
            &state.paths.output_summary_path,
            "summary",
            "application/json",
            "output_summary",
        ),
        artifact_record(
            "session-output.txt",
            &state.paths.output_text_path,
            "output",
            "text/plain; charset=utf-8",
            "stripped_output",
        ),
        artifact_record(
            "session-output.raw",
            &state.paths.raw_output_path,
            "output",
            "application/octet-stream",
            "raw_output",
        ),
        artifact_record(
            "session-output.lines.jsonl",
            &state.paths.line_index_path,
            "index",
            "application/x-ndjson",
            "line_index",
        ),
        artifact_record(
            "session-output.errors.jsonl",
            &state.paths.error_index_path,
            "index",
            "application/x-ndjson",
            "error_index",
        ),
        artifact_record(
            "events.jsonl",
            &state.paths.events_path,
            "journal",
            "application/x-ndjson",
            "event_journal",
        ),
        artifact_record(
            "ui-timeline.jsonl",
            &state.paths.ui_timeline_path,
            "projection",
            "application/x-ndjson",
            "timeline_projection",
        ),
        artifact_record(
            "commands.jsonl",
            &state.paths.commands_path,
            "journal",
            "application/x-ndjson",
            "command_journal",
        ),
        artifact_record(
            "commands/",
            &state.paths.command_artifacts_root_path,
            "directory",
            "inode/directory",
            "command_artifacts_root",
        ),
        artifact_record(
            "permissions.jsonl",
            &state.paths.permissions_path,
            "journal",
            "application/x-ndjson",
            "permission_journal",
        ),
        artifact_record(
            "processes.jsonl",
            &state.paths.processes_path,
            "journal",
            "application/x-ndjson",
            "process_journal",
        ),
        artifact_record(
            "attachments.jsonl",
            &state.paths.attachments_path,
            "journal",
            "application/x-ndjson",
            "agent_terminal_links",
        ),
        artifact_record(
            "screen-diffs.jsonl",
            &state.paths.screen_diffs_path,
            "journal",
            "application/x-ndjson",
            "screen_diff_journal",
        ),
        artifact_record(
            "retention.json",
            &state.paths.retention_manifest_path,
            "manifest",
            "application/json",
            "retention_policy",
        ),
        artifact_record(
            "session-output.compaction.json",
            &state.paths.output_compaction_path,
            "manifest",
            "application/json",
            "output_compaction_policy",
        ),
        artifact_record(
            "session-output.redactions.jsonl",
            &state.paths.output_redactions_path,
            "journal",
            "application/x-ndjson",
            "output_redaction_policy",
        ),
        artifact_record(
            "indexes/index.v2.manifest.json",
            &state.paths.index_manifest_path,
            "manifest",
            "application/json",
            "index_store_manifest",
        ),
        artifact_record(
            "indexes/terminal_sessions.jsonl",
            &state.paths.index_sessions_path,
            "index",
            "application/x-ndjson",
            "terminal_sessions_index",
        ),
        artifact_record(
            "indexes/terminal_events.jsonl",
            &state.paths.index_events_path,
            "index",
            "application/x-ndjson",
            "terminal_events_index",
        ),
        artifact_record(
            "indexes/terminal_commands.jsonl",
            &state.paths.index_commands_path,
            "index",
            "application/x-ndjson",
            "terminal_commands_index",
        ),
        artifact_record(
            "indexes/terminal_output_artifacts.jsonl",
            &state.paths.index_output_artifacts_path,
            "index",
            "application/x-ndjson",
            "terminal_output_artifacts_index",
        ),
        artifact_record(
            "indexes/terminal_permissions.jsonl",
            &state.paths.index_permissions_path,
            "index",
            "application/x-ndjson",
            "terminal_permissions_index",
        ),
        artifact_record(
            "indexes/agent_terminal_links.jsonl",
            &state.paths.index_agent_terminal_links_path,
            "index",
            "application/x-ndjson",
            "agent_terminal_links_index",
        ),
        artifact_record(
            "repairs.jsonl",
            &state.paths.repair_log_path,
            "journal",
            "application/x-ndjson",
            "repair_warnings",
        ),
    ]
}

fn truncate_jsonl(path: &Path) -> MemoryResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    File::create(path)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn event_index_record(event: &Value) -> Value {
    let payload = event.get("payload").cloned().unwrap_or_else(|| json!({}));
    let correlation = event
        .get("correlation")
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "terminalSessionId": string_field(event, "terminalSessionId"),
        "seq": number_field(event, "seq"),
        "kind": string_field(event, "kind"),
        "eventId": string_field(event, "eventId"),
        "actorKind": event.get("actor").and_then(|actor| string_field(actor, "kind")),
        "commandId": string_field(&correlation, "commandId").or_else(|| string_field(&payload, "commandId")),
        "permissionId": string_field(&correlation, "permissionId").or_else(|| string_field(&payload, "permissionId")),
        "inputId": string_field(&correlation, "inputId").or_else(|| string_field(&payload, "inputId")),
        "agentSessionId": string_field(&correlation, "agentSessionId"),
        "runtimeTurnId": string_field(&correlation, "runtimeTurnId"),
        "toolCallId": string_field(&correlation, "toolCallId"),
        "createdAt": string_field(event, "createdAt"),
        "createdAtMs": event.get("createdAtMs").and_then(Value::as_i64)
    })
}

fn append_event_index(paths: &SessionPaths, event: &Value) -> MemoryResult<()> {
    append_json_line(&paths.index_events_path, &event_index_record(event))
}

fn command_index_record(command: &Value) -> Value {
    let correlation = command
        .get("correlation")
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "terminalSessionId": string_field(command, "terminalSessionId"),
        "commandSeq": number_field(command, "commandSeq"),
        "commandId": string_field(command, "commandId"),
        "status": string_field(command, "status"),
        "exitCode": command.get("exitCode").cloned().unwrap_or(Value::Null),
        "signal": command.get("signal").cloned().unwrap_or(Value::Null),
        "actorKind": command.get("actor").and_then(|actor| string_field(actor, "kind")),
        "agentSessionId": string_field(&correlation, "agentSessionId"),
        "runtimeTurnId": string_field(&correlation, "runtimeTurnId"),
        "toolCallId": string_field(&correlation, "toolCallId"),
        "permissionId": string_field(&correlation, "permissionId"),
        "outputTextRange": command.get("outputTextRange").cloned().unwrap_or(Value::Null),
        "rawOutputRange": command.get("rawOutputRange").cloned().unwrap_or(Value::Null),
        "artifactRootPath": string_field(command, "artifactRootPath"),
        "commandMetaPath": string_field(command, "commandMetaPath"),
        "commandOutputTextPath": string_field(command, "commandOutputTextPath"),
        "commandRawOutputPath": string_field(command, "commandRawOutputPath"),
        "commandEventsPath": string_field(command, "commandEventsPath"),
        "commandSummaryPath": string_field(command, "commandSummaryPath"),
        "recordedAt": string_field(command, "recordedAt")
    })
}

fn append_command_index(paths: &SessionPaths, command: &Value) -> MemoryResult<()> {
    append_json_line(&paths.index_commands_path, &command_index_record(command))
}

fn permission_index_record(record: &Value) -> Value {
    let correlation = record
        .get("correlation")
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "terminalSessionId": string_field(record, "terminalSessionId"),
        "permissionRecordSeq": number_field(record, "permissionRecordSeq"),
        "permissionId": string_field(record, "permissionId"),
        "status": string_field(record, "status"),
        "risk": string_field(record, "risk"),
        "action": string_field(record, "action"),
        "summary": string_field(record, "summary"),
        "commandId": string_field(record, "commandId").or_else(|| string_field(&correlation, "commandId")),
        "inputId": string_field(record, "inputId").or_else(|| string_field(&correlation, "inputId")),
        "agentSessionId": string_field(record, "agentSessionId").or_else(|| string_field(&correlation, "agentSessionId")),
        "runtimeTurnId": string_field(record, "runtimeTurnId").or_else(|| string_field(&correlation, "runtimeTurnId")),
        "toolCallId": string_field(record, "toolCallId").or_else(|| string_field(&correlation, "toolCallId")),
        "decision": string_field(record, "decision"),
        "recordedAt": string_field(record, "recordedAt")
    })
}

fn append_permission_index(paths: &SessionPaths, record: &Value) -> MemoryResult<()> {
    append_json_line(
        &paths.index_permissions_path,
        &permission_index_record(record),
    )
}

fn agent_link_index_record(record: &Value) -> Value {
    json!({
        "terminalSessionId": string_field(record, "terminalSessionId"),
        "linkId": string_field(record, "linkId"),
        "agentSessionId": string_field(record, "agentSessionId"),
        "status": string_field(record, "status"),
        "recordedAt": string_field(record, "recordedAt")
    })
}

fn append_agent_link_index(paths: &SessionPaths, record: &Value) -> MemoryResult<()> {
    append_json_line(
        &paths.index_agent_terminal_links_path,
        &agent_link_index_record(record),
    )
}

fn refresh_output_artifact_index(session_id: &str, state: &SessionState) -> MemoryResult<()> {
    truncate_jsonl(&state.paths.index_output_artifacts_path)?;
    for artifact in artifact_records(state) {
        append_json_line(
            &state.paths.index_output_artifacts_path,
            &json!({
                "terminalSessionId": session_id,
                "artifactId": string_field(&artifact, "artifactId"),
                "label": string_field(&artifact, "label"),
                "path": string_field(&artifact, "path"),
                "kind": string_field(&artifact, "kind"),
                "role": string_field(&artifact, "role"),
                "byteLength": number_field(&artifact, "byteLength"),
                "exists": artifact.get("exists").and_then(Value::as_bool),
                "indexedAt": now_iso()
            }),
        )?;
    }
    Ok(())
}

fn session_created_record(paths: &SessionPaths, session_id: &str) -> Option<Value> {
    read_jsonl_with_repair_log(&paths.events_path, Some(&paths.repair_log_path))
        .into_iter()
        .filter(|record| {
            string_field(record, "terminalSessionId").as_deref() == Some(session_id)
                && string_field(record, "kind").as_deref() == Some("session_created")
        })
        .last()
}

fn latest_process_status(paths: &SessionPaths) -> Option<Value> {
    read_jsonl_with_repair_log(&paths.processes_path, Some(&paths.repair_log_path))
        .into_iter()
        .last()
}

fn restoration_state_json() -> Value {
    json!({
        "metadataRestorable": true,
        "historyReadable": true,
        "screenReplayable": true,
        "ptyRestorable": false,
        "ptyRecreatable": true,
        "liveProcessRestorable": false,
        "liveProcessReconnectable": true,
        "reconnectRequiresLivePtyHost": true,
        "reason": "dead_live_pty_processes_cannot_be_restored; while_the_rust_pty_host_is_alive_the_session_can_be_reconnected; after_host_exit_app_exit_or_os_reboot_the_session_can_only_be_recreated_from_metadata_history_and_screen"
    })
}

fn refresh_session_index_from_paths(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    truncate_jsonl(&paths.index_sessions_path)?;
    let created = session_created_record(paths, session_id);
    let payload = created
        .as_ref()
        .and_then(|event| event.get("payload").cloned())
        .unwrap_or_else(|| json!({}));
    let process = latest_process_status(paths);
    append_json_line(
        &paths.index_sessions_path,
        &json!({
            "terminalSessionId": session_id,
            "title": string_field(&payload, "title").unwrap_or_else(|| session_id.to_string()),
            "cwd": string_field(&payload, "cwd"),
            "shell": string_field(&payload, "shell"),
            "mode": string_field(&payload, "mode"),
            "source": string_field(&payload, "source"),
            "persist": payload.get("persist").and_then(Value::as_bool).unwrap_or(false),
            "createdAt": created.as_ref().and_then(|event| string_field(event, "createdAt")),
            "updatedAt": now_iso(),
            "status": process.as_ref().and_then(|item| string_field(item, "status")).unwrap_or_else(|| "metadata_only".to_string()),
            "exitCode": process.as_ref().and_then(|item| item.get("exitCode").cloned()).unwrap_or(Value::Null),
            "sessionRootPath": paths.session_root_path.to_string_lossy(),
            "summaryPath": paths.summary_path.to_string_lossy(),
            "eventLogPath": paths.events_path.to_string_lossy(),
            "restoreState": restoration_state_json()
        }),
    )
}

fn rebuild_index_store_from_paths(session_id: &str, paths: &SessionPaths) -> MemoryResult<()> {
    for path in [
        &paths.index_sessions_path,
        &paths.index_events_path,
        &paths.index_commands_path,
        &paths.index_output_artifacts_path,
        &paths.index_permissions_path,
        &paths.index_agent_terminal_links_path,
    ] {
        truncate_jsonl(path)?;
    }

    refresh_session_index_from_paths(session_id, paths)?;
    for event in read_jsonl_with_repair_log(&paths.events_path, Some(&paths.repair_log_path)) {
        append_event_index(paths, &event)?;
    }
    for command in read_jsonl_with_repair_log(&paths.commands_path, Some(&paths.repair_log_path)) {
        append_json_line(&paths.index_commands_path, &command_index_record(&command))?;
    }
    for permission in
        read_jsonl_with_repair_log(&paths.permissions_path, Some(&paths.repair_log_path))
    {
        append_json_line(
            &paths.index_permissions_path,
            &permission_index_record(&permission),
        )?;
    }
    for link in read_jsonl_with_repair_log(&paths.attachments_path, Some(&paths.repair_log_path)) {
        append_json_line(
            &paths.index_agent_terminal_links_path,
            &agent_link_index_record(&link),
        )?;
    }
    write_index_store_manifest(session_id, paths)
}

fn command_summary_records(state: &SessionState, output_size: u64, raw_size: u64) -> Vec<Value> {
    let mut commands = Vec::<Value>::new();
    let mut index_by_id = HashMap::<String, usize>::new();
    for record in read_jsonl_with_repair_log(
        &state.paths.commands_path,
        Some(&state.paths.repair_log_path),
    ) {
        let Some(command_id) = string_field(&record, "commandId") else {
            continue;
        };
        let index = if let Some(index) = index_by_id.get(&command_id).copied() {
            index
        } else {
            let index = commands.len();
            index_by_id.insert(command_id.clone(), index);
            commands.push(json!({
                "commandId": command_id,
                "terminalSessionId": string_field(&record, "terminalSessionId"),
                "commandText": null,
                "normalizedCommandText": null,
                "status": null,
                "exitCode": null,
                "signal": null,
                "outputTextRange": null,
                "rawOutputRange": null,
                "artifactRootPath": null,
                "commandMetaPath": null,
                "commandOutputTextPath": null,
                "commandRawOutputPath": null,
                "commandEventsPath": null,
                "commandSummaryPath": null,
                "lastCommandSeq": null,
                "correlation": null
            }));
            index
        };
        if let Some(object) = commands[index].as_object_mut() {
            for key in [
                "commandText",
                "normalizedCommandText",
                "status",
                "exitCode",
                "signal",
                "outputTextRange",
                "rawOutputRange",
                "artifactRootPath",
                "commandMetaPath",
                "commandOutputTextPath",
                "commandRawOutputPath",
                "commandEventsPath",
                "commandSummaryPath",
                "commandSeq",
                "correlation",
            ] {
                if let Some(value) = record.get(key) {
                    let target_key = if key == "commandSeq" {
                        "lastCommandSeq"
                    } else {
                        key
                    };
                    if !value.is_null() {
                        object.insert(target_key.to_string(), value.clone());
                    }
                }
            }
        }
    }

    if let Some(active_command_id) = state.active_command_id.as_ref() {
        if let Some(index) = index_by_id.get(active_command_id).copied() {
            if let Some(object) = commands[index].as_object_mut() {
                let text_start = state
                    .active_command_output_text_start
                    .unwrap_or(output_size);
                let raw_start = state.active_command_raw_start.unwrap_or(raw_size);
                object.insert(
                    "outputTextRange".to_string(),
                    json!({ "start": text_start.min(output_size), "end": output_size }),
                );
                object.insert(
                    "rawOutputRange".to_string(),
                    json!({ "start": raw_start.min(raw_size), "end": raw_size }),
                );
            }
        }
    }

    let errors = read_jsonl_with_repair_log(
        &state.paths.error_index_path,
        Some(&state.paths.repair_log_path),
    );
    for command in &mut commands {
        let Some(command_id) = string_field(command, "commandId") else {
            continue;
        };
        let range = command
            .get("outputTextRange")
            .cloned()
            .unwrap_or(Value::Null);
        let start = number_field(&range, "start")
            .unwrap_or(output_size)
            .min(output_size);
        let end = number_field(&range, "end")
            .unwrap_or(start)
            .min(output_size);
        let output = read_byte_range(&state.paths.output_text_path, start, end)
            .ok()
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            .unwrap_or_default();
        let lines = output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        let last_error_lines = errors
            .iter()
            .filter(|error| {
                string_field(error, "commandId").as_deref() == Some(command_id.as_str())
                    || number_field(error, "textOffset")
                        .is_some_and(|offset| offset >= start && offset < end)
            })
            .filter_map(|error| string_field(error, "textPreview"))
            .rev()
            .take(5)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>();
        if let Some(object) = command.as_object_mut() {
            object.insert(
                "firstOutputPreview".to_string(),
                lines
                    .first()
                    .map(|line| Value::String(preview_text(line)))
                    .unwrap_or(Value::Null),
            );
            object.insert(
                "lastOutputPreview".to_string(),
                lines
                    .last()
                    .map(|line| Value::String(preview_text(line)))
                    .unwrap_or(Value::Null),
            );
            object.insert("lastErrorLines".to_string(), json!(last_error_lines));
            object.insert(
                "estimatedTokens".to_string(),
                json!(estimate_tokens(end.saturating_sub(start))),
            );
        }
    }
    commands
}

fn output_search_hints(state: &SessionState) -> Value {
    json!({
        "message": "Full terminal output is stored as Kernel-managed artifacts.",
        "textArtifactPath": state.paths.output_text_path.to_string_lossy(),
        "rawArtifactPath": state.paths.raw_output_path.to_string_lossy(),
        "lineIndexPath": state.paths.line_index_path.to_string_lossy(),
        "errorIndexPath": state.paths.error_index_path.to_string_lossy(),
        "outputCompactionPath": state.paths.output_compaction_path.to_string_lossy(),
        "outputRedactionsPath": state.paths.output_redactions_path.to_string_lossy(),
        "readRangeMethod": "terminal.output.readRange",
        "artifactListMethod": "terminal.artifacts.list"
    })
}

fn write_output_summary(
    session_id: &str,
    state: &SessionState,
    truncated: bool,
) -> MemoryResult<()> {
    let output_size = file_size(&state.paths.output_text_path);
    let raw_size = file_size(&state.paths.raw_output_path);
    let estimated_tokens = estimate_tokens(output_size);
    write_json_pretty(
        &state.paths.output_summary_path,
        &json!({
            "schemaVersion": 1,
            "terminalSessionId": session_id,
            "updatedAt": now_iso(),
            "outputByteRange": { "start": 0, "end": output_size },
            "rawOutputByteRange": { "start": 0, "end": raw_size },
            "estimatedTokens": estimated_tokens,
            "projectionRecommendation": output_projection_recommendation(output_size),
            "truncatedByProjection": truncated || estimated_tokens > INLINE_TOKEN_LIMIT,
            "lineCount": state.next_line_number.saturating_sub(1),
            "errorCount": state.error_count,
            "latestOutputPreview": state.latest_output_preview,
            "commands": command_summary_records(state, output_size, raw_size),
            "compaction": {
                "state": "uncompacted",
                "coordinateSpace": "original_output_byte_offsets",
                "manifestPath": state.paths.output_compaction_path.to_string_lossy()
            },
            "redaction": {
                "policy": "none",
                "redactionJournalPath": state.paths.output_redactions_path.to_string_lossy(),
                "supportsEncryptedPolicyMarkers": true
            },
            "searchHints": output_search_hints(state)
        }),
    )
}

fn metadata_from_state(state: &SessionState, truncated: bool) -> Value {
    let output_size = file_size(&state.paths.output_text_path);
    let estimated_tokens = estimate_tokens(output_size);
    let event_end = state.next_seq.saturating_sub(1);
    json!({
        "sessionRootPath": state.paths.session_root_path.to_string_lossy(),
        "eventLogPath": state.paths.events_path.to_string_lossy(),
        "summaryPath": state.paths.summary_path.to_string_lossy(),
        "uiTimelinePath": state.paths.ui_timeline_path.to_string_lossy(),
        "outputTextPath": state.paths.output_text_path.to_string_lossy(),
        "rawOutputPath": state.paths.raw_output_path.to_string_lossy(),
        "outputSummaryPath": state.paths.output_summary_path.to_string_lossy(),
        "lineIndexPath": state.paths.line_index_path.to_string_lossy(),
        "errorIndexPath": state.paths.error_index_path.to_string_lossy(),
        "commandsPath": state.paths.commands_path.to_string_lossy(),
        "commandArtifactsRootPath": state.paths.command_artifacts_root_path.to_string_lossy(),
        "permissionsPath": state.paths.permissions_path.to_string_lossy(),
        "processesPath": state.paths.processes_path.to_string_lossy(),
        "attachmentsPath": state.paths.attachments_path.to_string_lossy(),
        "screenDiffsPath": state.paths.screen_diffs_path.to_string_lossy(),
        "retentionManifestPath": state.paths.retention_manifest_path.to_string_lossy(),
        "repairLogPath": state.paths.repair_log_path.to_string_lossy(),
        "indexManifestPath": state.paths.index_manifest_path.to_string_lossy(),
        "terminalSessionsIndexPath": state.paths.index_sessions_path.to_string_lossy(),
        "terminalEventsIndexPath": state.paths.index_events_path.to_string_lossy(),
        "terminalCommandsIndexPath": state.paths.index_commands_path.to_string_lossy(),
        "terminalOutputArtifactsIndexPath": state.paths.index_output_artifacts_path.to_string_lossy(),
        "terminalPermissionsIndexPath": state.paths.index_permissions_path.to_string_lossy(),
        "agentTerminalLinksIndexPath": state.paths.index_agent_terminal_links_path.to_string_lossy(),
        "outputCompactionPath": state.paths.output_compaction_path.to_string_lossy(),
        "outputRedactionsPath": state.paths.output_redactions_path.to_string_lossy(),
        "restoration": restoration_state_json(),
        "eventSeqRange": if event_end > 0 {
            json!({ "start": 1, "end": event_end })
        } else {
            Value::Null
        },
        "outputByteRange": { "start": 0, "end": output_size },
        "estimatedTokens": estimated_tokens,
        "projectionRecommendation": output_projection_recommendation(output_size),
        "lineCount": state.next_line_number.saturating_sub(1),
        "errorCount": state.error_count,
        "latestOutputPreview": state.latest_output_preview,
        "truncatedByProjection": truncated || estimated_tokens > INLINE_TOKEN_LIMIT,
        "searchHints": output_search_hints(state)
    })
}

fn write_summary(session_id: &str, state: &SessionState, truncated: bool) -> MemoryResult<()> {
    write_output_summary(session_id, state, truncated)?;
    write_retention_manifest(session_id, &state.paths)?;
    write_output_policy_manifests(session_id, &state.paths)?;
    write_index_store_manifest(session_id, &state.paths)?;
    refresh_session_index_from_paths(session_id, &state.paths)?;
    refresh_output_artifact_index(session_id, state)?;
    let memory = metadata_from_state(state, truncated);
    let raw_output_bytes = file_size(&state.paths.raw_output_path);
    write_json_pretty(
        &state.paths.summary_path,
        &json!({
            "schemaVersion": 1,
            "terminalSessionId": session_id,
            "updatedAt": now_iso(),
            "latestEventKind": state.latest_event_kind,
            "timelineItemCount": state.timeline_item_count,
            "latestTimelinePreview": state.latest_timeline_preview,
            "activeCommandId": state.active_command_id,
            "rawOutputByteRange": { "start": 0, "end": raw_output_bytes },
            "memory": memory
        }),
    )
}

fn timeline_artifacts(state: &SessionState) -> Value {
    Value::Array(artifact_records(state))
}

fn timeline_text(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(preview_text)
        .filter(|text| !text.is_empty())
}

fn permission_chain_for_event(event: &StoredEvent, state: &SessionState) -> Vec<Value> {
    let correlation = event.correlation.clone().unwrap_or_else(|| json!({}));
    let payload = event.payload.clone();
    let permission_id = string_field(&correlation, "permissionId")
        .or_else(|| string_field(&payload, "permissionId"));
    let command_id =
        string_field(&correlation, "commandId").or_else(|| string_field(&payload, "commandId"));
    let input_id =
        string_field(&correlation, "inputId").or_else(|| string_field(&payload, "inputId"));
    let tool_call_id =
        string_field(&correlation, "toolCallId").or_else(|| string_field(&payload, "toolCallId"));
    let agent_session_id = string_field(&correlation, "agentSessionId")
        .or_else(|| string_field(&payload, "agentSessionId"));

    read_jsonl_with_repair_log(
        &state.paths.permissions_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .filter(|record| {
        permission_id
            .as_ref()
            .is_some_and(|value| string_field(record, "permissionId").as_ref() == Some(value))
            || command_id.as_ref().is_some_and(|value| {
                string_field(record, "commandId").as_ref() == Some(value)
                    || record
                        .get("correlation")
                        .and_then(|correlation| string_field(correlation, "commandId"))
                        .as_ref()
                        == Some(value)
            })
            || input_id.as_ref().is_some_and(|value| {
                string_field(record, "inputId").as_ref() == Some(value)
                    || record
                        .get("correlation")
                        .and_then(|correlation| string_field(correlation, "inputId"))
                        .as_ref()
                        == Some(value)
            })
            || tool_call_id.as_ref().is_some_and(|value| {
                string_field(record, "toolCallId").as_ref() == Some(value)
                    || record
                        .get("correlation")
                        .and_then(|correlation| string_field(correlation, "toolCallId"))
                        .as_ref()
                        == Some(value)
            })
            || (command_id.is_none()
                && input_id.is_none()
                && tool_call_id.is_none()
                && permission_id.is_none()
                && agent_session_id.as_ref().is_some_and(|value| {
                    string_field(record, "agentSessionId").as_ref() == Some(value)
                }))
    })
    .map(|record| {
        json!({
            "permissionRecordSeq": number_field(&record, "permissionRecordSeq"),
            "permissionId": string_field(&record, "permissionId"),
            "status": string_field(&record, "status"),
            "risk": string_field(&record, "risk"),
            "summary": string_field(&record, "summary"),
            "action": string_field(&record, "action"),
            "decision": string_field(&record, "decision"),
            "actor": record.get("actor").cloned().unwrap_or_else(|| json!({})),
            "correlation": record.get("correlation").cloned().unwrap_or_else(|| json!({})),
            "recordedAt": string_field(&record, "recordedAt")
        })
    })
    .collect()
}

fn command_audit_answer(event: &StoredEvent, chain: &[Value]) -> Option<String> {
    if !matches!(
        event.kind.as_str(),
        "command_submitted" | "command_started" | "command_completed" | "input_text"
    ) {
        return None;
    }
    let actor = actor_label(&event.actor);
    let latest_permission = chain.last();
    let status = latest_permission
        .and_then(|record| string_field(record, "status"))
        .unwrap_or_else(|| "no_permission_record".to_string());
    let permission_id = latest_permission
        .and_then(|record| string_field(record, "permissionId"))
        .unwrap_or_else(|| "none".to_string());
    Some(format!(
        "Command actor: {actor}; approval: {status}; permissionId: {permission_id}"
    ))
}

fn audit_projection_for_event(event: &StoredEvent, state: &SessionState) -> Value {
    let correlation = event.correlation.clone().unwrap_or_else(|| json!({}));
    let permission_chain = permission_chain_for_event(event, state);
    let answer = command_audit_answer(event, &permission_chain);
    let latest_permission = permission_chain.last().cloned().unwrap_or(Value::Null);
    json!({
        "actor": event.actor.clone(),
        "correlation": correlation,
        "permissionChain": permission_chain,
        "latestPermission": latest_permission,
        "answer": answer
    })
}

fn timeline_item_from_event(event: &StoredEvent, state: &SessionState) -> Value {
    let actor = &event.actor;
    let actor_kind = string_field(actor, "kind").unwrap_or_else(|| "system".to_string());
    let correlation = event.correlation.clone().unwrap_or_else(|| json!({}));
    let command_id = string_field(&correlation, "commandId");
    let agent_session_id = string_field(&correlation, "agentSessionId")
        .or_else(|| string_field(actor, "agentSessionId"));
    let runtime_turn_id = string_field(&correlation, "runtimeTurnId")
        .or_else(|| string_field(actor, "runtimeTurnId"));
    let tool_call_id =
        string_field(&correlation, "toolCallId").or_else(|| string_field(actor, "toolCallId"));
    let terminal_tool_name = string_field(&correlation, "terminalToolName");
    let payload = &event.payload;
    let mut base = Map::new();
    base.insert(
        "itemId".to_string(),
        Value::String(format!(
            "terminal-timeline-{}-{}",
            event.terminal_session_id, event.seq
        )),
    );
    base.insert(
        "terminalSessionId".to_string(),
        Value::String(event.terminal_session_id.clone()),
    );
    base.insert("seq".to_string(), json!(event.seq));
    base.insert("kind".to_string(), Value::String(event.kind.clone()));
    base.insert("actorKind".to_string(), Value::String(actor_kind));
    base.insert("actorLabel".to_string(), Value::String(actor_label(actor)));
    base.insert(
        "createdAt".to_string(),
        Value::String(event.created_at.clone().unwrap_or_else(now_iso)),
    );
    if let Some(value) = command_id {
        base.insert("commandId".to_string(), Value::String(value));
    }
    if let Some(value) = agent_session_id {
        base.insert("agentSessionId".to_string(), Value::String(value));
    }
    if let Some(value) = runtime_turn_id {
        base.insert("runtimeTurnId".to_string(), Value::String(value));
    }
    if let Some(value) = tool_call_id {
        base.insert("toolCallId".to_string(), Value::String(value));
    }
    if let Some(value) = terminal_tool_name.clone() {
        base.insert("terminalToolName".to_string(), Value::String(value));
    }
    if let Some(value) =
        string_field(&correlation, "permissionId").or_else(|| string_field(payload, "permissionId"))
    {
        base.insert("permissionId".to_string(), Value::String(value));
    }
    base.insert("actor".to_string(), actor.clone());
    base.insert("correlation".to_string(), correlation.clone());
    base.insert(
        "audit".to_string(),
        audit_projection_for_event(event, state),
    );
    base.insert("artifacts".to_string(), timeline_artifacts(state));

    let mut item = Value::Object(base);
    let object = item.as_object_mut().expect("timeline item object");
    match event.kind.as_str() {
        "session_created" => {
            object.insert(
                "title".to_string(),
                Value::String("Session created".to_string()),
            );
            object.insert(
                "subtitle".to_string(),
                Value::String(
                    string_field(payload, "title")
                        .unwrap_or_else(|| "Terminal session".to_string()),
                ),
            );
            let preview = ["cwd", "shell", "mode"]
                .iter()
                .filter_map(|key| string_field(payload, key))
                .collect::<Vec<_>>()
                .join(" - ");
            if !preview.is_empty() {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "input_text" => {
            object.insert(
                "title".to_string(),
                Value::String(
                    if payload
                        .get("appendNewline")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        "Command input"
                    } else {
                        "Terminal input"
                    }
                    .to_string(),
                ),
            );
            if let Some(value) = terminal_tool_name {
                object.insert("subtitle".to_string(), Value::String(value));
            }
            let preview = string_field(payload, "textPreview")
                .or_else(|| timeline_text(payload.get("text")))
                .or_else(|| timeline_text(payload.get("data")));
            if let Some(value) = preview {
                object.insert("preview".to_string(), Value::String(value));
            }
        }
        "input_keys" => {
            object.insert("title".to_string(), Value::String("Key input".to_string()));
            if let Some(keys) = payload.get("keys").and_then(Value::as_array) {
                object.insert(
                    "preview".to_string(),
                    Value::String(
                        keys.iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(", "),
                    ),
                );
            }
        }
        "input_resize" => {
            object.insert(
                "title".to_string(),
                Value::String("Terminal resized".to_string()),
            );
            if let (Some(cols), Some(rows)) =
                (number_field(payload, "cols"), number_field(payload, "rows"))
            {
                object.insert(
                    "preview".to_string(),
                    Value::String(format!("{cols}x{rows}")),
                );
            }
        }
        "command_submitted" => {
            object.insert(
                "title".to_string(),
                Value::String("Command submitted".to_string()),
            );
            if let Some(preview) = timeline_text(payload.get("commandText")) {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "command_started" => {
            object.insert(
                "title".to_string(),
                Value::String("Command started".to_string()),
            );
            if let Some(preview) = timeline_text(payload.get("commandText")) {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "command_completed" => {
            object.insert(
                "title".to_string(),
                Value::String("Command completed".to_string()),
            );
            if let Some(exit_code) = payload.get("exitCode").and_then(Value::as_i64) {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("exit {exit_code}")),
                );
            }
            if let Some(preview) = timeline_text(payload.get("commandText")) {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "process_started" => {
            object.insert(
                "title".to_string(),
                Value::String("Process started".to_string()),
            );
            if let Some(process_id) = number_field(payload, "processId") {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("pid {process_id}")),
                );
            }
            if let Some(preview) = string_field(payload, "command")
                .or_else(|| string_field(payload, "shell"))
                .map(|value| preview_text(&value))
            {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "process_signal_sent" => {
            object.insert(
                "title".to_string(),
                Value::String("Process signal sent".to_string()),
            );
            if let Some(signal) = string_field(payload, "signal") {
                object.insert("subtitle".to_string(), Value::String(signal));
            }
            if let Some(reason) = string_field(payload, "reason") {
                object.insert("preview".to_string(), Value::String(reason));
            }
        }
        "process_tree_snapshot" => {
            object.insert(
                "title".to_string(),
                Value::String("Process tree snapshot".to_string()),
            );
            if let Some(process_count) = number_field(payload, "processCount") {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("{process_count} process(es)")),
                );
            }
        }
        "output_chunk" => {
            object.insert(
                "title".to_string(),
                Value::String("Process output".to_string()),
            );
            if let Some(byte_length) = number_field(payload, "textByteLength")
                .or_else(|| number_field(payload, "rawByteLength"))
            {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("{byte_length} bytes")),
                );
            }
            if let Some(preview) = string_field(payload, "textPreview") {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "screen_diff" => {
            object.insert(
                "title".to_string(),
                Value::String("Screen updated".to_string()),
            );
            let mode = string_field(payload, "mode").unwrap_or_else(|| "unknown".to_string());
            if let Some(version) = number_field(payload, "screenVersion") {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("screen {version} - {mode}")),
                );
            }
            let preview = payload
                .get("dirtyRows")
                .and_then(Value::as_array)
                .map(|rows| {
                    rows.iter()
                        .filter_map(|row| string_field(row, "text"))
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .map(|text| preview_text(&text))
                .filter(|text| !text.is_empty());
            if let Some(preview) = preview {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "process_exited" => {
            object.insert(
                "title".to_string(),
                Value::String("Process exited".to_string()),
            );
            let exit_code = payload.get("exitCode").and_then(Value::as_i64);
            if let Some(value) = exit_code {
                object.insert(
                    "subtitle".to_string(),
                    Value::String(format!("exit {value}")),
                );
            }
            object.insert(
                "preview".to_string(),
                Value::String(
                    if exit_code == Some(0) {
                        "Completed successfully"
                    } else {
                        "Exited with non-zero status"
                    }
                    .to_string(),
                ),
            );
        }
        "terminal_error" => {
            object.insert(
                "title".to_string(),
                Value::String("Terminal error".to_string()),
            );
            if let Some(preview) = timeline_text(payload.get("error")) {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "session_closed" => {
            object.insert(
                "title".to_string(),
                Value::String("Session closed".to_string()),
            );
        }
        "agent_attached" => {
            object.insert(
                "title".to_string(),
                Value::String("Agent attached".to_string()),
            );
            if let Some(agent_session_id) = string_field(payload, "agentSessionId") {
                object.insert("preview".to_string(), Value::String(agent_session_id));
            }
        }
        "agent_detached" => {
            object.insert(
                "title".to_string(),
                Value::String("Agent detached".to_string()),
            );
            if let Some(agent_session_id) = string_field(payload, "agentSessionId") {
                object.insert("preview".to_string(), Value::String(agent_session_id));
            }
        }
        "permission_requested"
        | "permission_granted"
        | "permission_denied"
        | "permission_expired" => {
            object.insert(
                "title".to_string(),
                Value::String(event.kind.replace('_', " ")),
            );
            if let Some(preview) =
                string_field(payload, "summary").or_else(|| string_field(payload, "permissionId"))
            {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        "handoff_started" | "handoff_completed" | "audit_read" => {
            object.insert(
                "title".to_string(),
                Value::String(event.kind.replace('_', " ")),
            );
            if let Some(preview) =
                string_field(payload, "summary").or_else(|| string_field(payload, "reader"))
            {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
        other => {
            object.insert("title".to_string(), Value::String(other.replace('_', " ")));
            if let Some(preview) =
                string_field(payload, "textPreview").or_else(|| timeline_text(payload.get("error")))
            {
                object.insert("preview".to_string(), Value::String(preview));
            }
        }
    }
    item
}

fn append_timeline_item_for_event(
    event: &StoredEvent,
    state: &mut SessionState,
) -> MemoryResult<()> {
    let mut item = timeline_item_from_event(event, state);
    let item_index = state.timeline_item_count.saturating_add(1);
    state.timeline_item_count = item_index;
    if let Some(object) = item.as_object_mut() {
        object.insert("itemIndex".to_string(), json!(item_index));
        state.latest_timeline_preview =
            string_field(&item, "preview").or_else(|| string_field(&item, "title"));
    }
    append_json_line(&state.paths.ui_timeline_path, &item)
}

fn append_event(
    session_id: &str,
    state: &mut SessionState,
    kind: &str,
    actor: Value,
    payload: Value,
    correlation: Value,
    model_context_policy: &str,
    ui_policy: &str,
) -> MemoryResult<u64> {
    let seq = state.next_seq;
    state.next_seq = state.next_seq.saturating_add(1);
    let event = json!({
        "eventId": format!("terminal-event-{}", Uuid::new_v4()),
        "terminalSessionId": session_id,
        "seq": seq,
        "kind": kind,
        "actor": actor,
        "payload": payload,
        "createdAt": now_iso(),
        "createdAtMs": now_ms(),
        "correlation": compact_object(correlation.clone()),
        "visibility": "user_visible",
        "modelContextPolicy": model_context_policy,
        "uiPolicy": ui_policy,
        "auditPolicy": "full"
    });
    append_json_line(&state.paths.events_path, &event)?;
    append_event_index(&state.paths, &event)?;
    let stored = StoredEvent {
        event_id: string_field(&event, "eventId"),
        terminal_session_id: session_id.to_string(),
        seq,
        kind: kind.to_string(),
        actor,
        payload,
        created_at: string_field(&event, "createdAt"),
        correlation: Some(compact_object(correlation)),
    };
    append_timeline_item_for_event(&stored, state)?;
    state.latest_event_kind = Some(kind.to_string());
    write_summary(session_id, state, false)?;
    Ok(seq)
}

fn create_command_id() -> String {
    format!("terminal-command-{}", Uuid::new_v4())
}

fn append_command_record(state: &mut SessionState, record: Value) -> MemoryResult<()> {
    let command_seq = state.next_command_seq;
    state.next_command_seq = state.next_command_seq.saturating_add(1);
    let record = merge_object(
        record,
        json!({ "commandSeq": command_seq, "recordedAt": now_iso() }),
    );
    append_json_line(&state.paths.commands_path, &record)?;
    append_command_index(&state.paths, &record)
}

fn command_id_from_correlation(correlation: &Value) -> Option<String> {
    string_field(correlation, "commandId")
}

fn append_command_lifecycle_event(
    session_id: &str,
    state: &mut SessionState,
    kind: &str,
    command_id: &str,
    command_text: Option<&str>,
    actor: Value,
    correlation: Value,
    extra_payload: Value,
) -> MemoryResult<()> {
    let payload = merge_object(
        json!({
            "commandId": command_id,
            "commandText": command_text,
            "normalizedCommandText": command_text.map(str::trim)
        }),
        extra_payload,
    );
    append_event(
        session_id,
        state,
        kind,
        actor,
        payload,
        merge_object(correlation, json!({ "commandId": command_id })),
        "include_as_runtime_state",
        "show_in_timeline",
    )
    .map(|_| ())
}

fn record_known_command(
    session_id: &str,
    state: &mut SessionState,
    command_text: &str,
    actor: Value,
    correlation: Value,
    status: &str,
    exit_code: Option<i32>,
) -> MemoryResult<String> {
    let command_id = command_id_from_correlation(&correlation).unwrap_or_else(create_command_id);
    let output_text_start = file_size(&state.paths.output_text_path);
    let raw_output_start = file_size(&state.paths.raw_output_path);
    if status == "running" {
        state.active_command_id = Some(command_id.clone());
        state.active_command_output_text_start = Some(output_text_start);
        state.active_command_raw_start = Some(raw_output_start);
    }
    append_command_record(
        state,
        json!({
            "commandId": command_id,
            "terminalSessionId": session_id,
            "commandText": command_text,
            "normalizedCommandText": command_text.trim(),
            "actor": actor,
            "status": status,
            "exitCode": exit_code,
            "signal": null,
            "outputTextRange": { "start": output_text_start, "end": output_text_start },
            "rawOutputRange": { "start": raw_output_start, "end": raw_output_start },
            "correlation": merge_object(correlation.clone(), json!({ "commandId": command_id })),
            "confidence": 0.6
        }),
    )?;
    if status == "running" {
        append_command_lifecycle_event(
            session_id,
            state,
            "command_submitted",
            &command_id,
            Some(command_text),
            actor.clone(),
            correlation.clone(),
            json!({
                "outputTextRange": { "start": output_text_start, "end": output_text_start },
                "rawOutputRange": { "start": raw_output_start, "end": raw_output_start }
            }),
        )?;
        append_command_lifecycle_event(
            session_id,
            state,
            "command_started",
            &command_id,
            Some(command_text),
            actor,
            correlation,
            json!({
                "outputTextRange": { "start": output_text_start, "end": output_text_start },
                "rawOutputRange": { "start": raw_output_start, "end": raw_output_start }
            }),
        )?;
    }
    Ok(command_id)
}

fn command_text_from_write(input: &WriteInput) -> Option<String> {
    if !input.append_newline || input.keys.as_ref().is_some_and(|keys| !keys.is_empty()) {
        return None;
    }
    input
        .text
        .as_ref()
        .or(input.data.as_ref())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn append_output_line_record(
    session_id: &str,
    state: &mut SessionState,
    line_text: &str,
    text_offset: u64,
    output_event_seq: u64,
    created_at: &str,
) -> MemoryResult<()> {
    let line_number = state.next_line_number;
    state.next_line_number = state.next_line_number.saturating_add(1);
    let text_preview = preview_text(line_text);
    if !text_preview.is_empty() {
        state.latest_output_preview = Some(text_preview.clone());
    }
    let line_record = json!({
        "lineNumber": line_number,
        "terminalSessionId": session_id,
        "outputEventSeq": output_event_seq,
        "commandId": state.active_command_id,
        "textOffset": text_offset,
        "byteLength": line_text.len(),
        "textPreview": text_preview,
        "sha256": sha256_hex(line_text.as_bytes()),
        "createdAt": created_at
    });
    append_json_line(&state.paths.line_index_path, &line_record)?;
    if let Some(severity) = classify_output_issue(line_text) {
        state.error_count = state.error_count.saturating_add(1);
        append_json_line(
            &state.paths.error_index_path,
            &merge_object(
                line_record,
                json!({
                    "errorNumber": state.error_count,
                    "severity": severity
                }),
            ),
        )?;
    }
    Ok(())
}

fn index_output_text(
    session_id: &str,
    state: &mut SessionState,
    text: &str,
    text_start: u64,
    output_event_seq: u64,
    created_at: &str,
) -> MemoryResult<()> {
    let mut current_offset = text_start;
    let mut segment_start_offset = text_start;
    let mut segment = String::new();
    for character in text.chars() {
        let char_byte_length = character.len_utf8() as u64;
        if character == '\n' {
            let line_text = format!("{}{}", state.pending_line_text, segment);
            let line_offset = if state.pending_line_text.is_empty() {
                segment_start_offset
            } else {
                state.pending_line_text_offset
            };
            append_output_line_record(
                session_id,
                state,
                &line_text,
                line_offset,
                output_event_seq,
                created_at,
            )?;
            state.pending_line_text.clear();
            state.pending_line_text_offset = current_offset.saturating_add(char_byte_length);
            segment.clear();
            segment_start_offset = current_offset.saturating_add(char_byte_length);
        } else {
            segment.push(character);
        }
        current_offset = current_offset.saturating_add(char_byte_length);
    }
    if !segment.is_empty() {
        if state.pending_line_text.is_empty() {
            state.pending_line_text_offset = segment_start_offset;
        }
        state.pending_line_text.push_str(&segment);
        let preview = preview_text(&state.pending_line_text);
        if !preview.is_empty() {
            state.latest_output_preview = Some(preview);
        }
    }
    Ok(())
}

fn flush_pending_output_line(
    session_id: &str,
    state: &mut SessionState,
    output_event_seq: u64,
    created_at: &str,
) -> MemoryResult<()> {
    if state.pending_line_text.is_empty() {
        return Ok(());
    }
    let line_text = state.pending_line_text.clone();
    append_output_line_record(
        session_id,
        state,
        &line_text,
        state.pending_line_text_offset,
        output_event_seq,
        created_at,
    )?;
    state.pending_line_text.clear();
    state.pending_line_text_offset = file_size(&state.paths.output_text_path);
    Ok(())
}

fn stored_event_from_record(record: &Value) -> Option<StoredEvent> {
    let terminal_session_id = string_field(record, "terminalSessionId")?;
    let seq = number_field(record, "seq")?;
    let kind = string_field(record, "kind")?;
    Some(StoredEvent {
        event_id: string_field(record, "eventId"),
        terminal_session_id,
        seq,
        kind,
        actor: record
            .get("actor")
            .cloned()
            .unwrap_or_else(|| json!({ "kind": "system" })),
        payload: record.get("payload").cloned().unwrap_or_else(|| json!({})),
        created_at: string_field(record, "createdAt"),
        correlation: record.get("correlation").cloned(),
    })
}

fn rebuild_timeline_projection(session_id: &str, state: &mut SessionState) -> MemoryResult<()> {
    let mut events =
        read_jsonl_with_repair_log(&state.paths.events_path, Some(&state.paths.repair_log_path))
            .into_iter()
            .filter_map(|record| stored_event_from_record(&record))
            .filter(|event| event.terminal_session_id == session_id)
            .collect::<Vec<_>>();
    events.sort_by_key(|event| event.seq);
    state.timeline_item_count = 0;
    state.latest_timeline_preview = None;
    File::create(&state.paths.ui_timeline_path).map_err(|error| error.to_string())?;
    for event in events {
        append_timeline_item_for_event(&event, state)?;
    }
    Ok(())
}

fn timeline_summary(session_id: &str, state: &SessionState) -> Value {
    let memory = metadata_from_state(state, false);
    json!({
        "terminalSessionId": session_id,
        "itemCount": state.timeline_item_count,
        "eventCount": state.next_seq.saturating_sub(1),
        "lineCount": memory.get("lineCount").and_then(Value::as_u64).unwrap_or(0),
        "errorCount": memory.get("errorCount").and_then(Value::as_u64).unwrap_or(0),
        "estimatedTokens": memory.get("estimatedTokens").and_then(Value::as_u64).unwrap_or(0),
        "updatedAt": now_iso(),
        "latestEventKind": state.latest_event_kind,
        "latestItemPreview": state.latest_timeline_preview
    })
}

fn normalize_string_filter(values: Option<Vec<String>>) -> Vec<String> {
    values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect()
}

fn event_actor_kind(event: &Value) -> Option<String> {
    event
        .get("actor")
        .and_then(|actor| string_field(actor, "kind"))
}

fn optional_trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn read_events(input: EventsReadInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let limit = input
        .limit
        .map(|value| value.max(1) as usize)
        .unwrap_or(DEFAULT_EVENTS_LIMIT)
        .min(MAX_EVENTS_LIMIT);
    let cursor_seq = input
        .cursor
        .as_deref()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let kind_filter = normalize_string_filter(input.kinds);
    let actor_filter = normalize_string_filter(input.actors);

    let mut events =
        read_jsonl_with_repair_log(&guard.paths.events_path, Some(&guard.paths.repair_log_path))
            .into_iter()
            .filter(|event| {
                string_field(event, "terminalSessionId")
                    .is_some_and(|session_id| session_id == input.session_id)
            })
            .filter(|event| number_field(event, "seq").unwrap_or(0) > cursor_seq)
            .filter(|event| {
                kind_filter.is_empty()
                    || string_field(event, "kind").is_some_and(|kind| kind_filter.contains(&kind))
            })
            .filter(|event| {
                actor_filter.is_empty()
                    || event_actor_kind(event).is_some_and(|actor| actor_filter.contains(&actor))
            })
            .collect::<Vec<_>>();
    events.sort_by_key(|event| number_field(event, "seq").unwrap_or(0));

    let has_more = events.len() > limit;
    let selected = events.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = selected
        .last()
        .and_then(|event| number_field(event, "seq"))
        .unwrap_or(cursor_seq)
        .to_string();
    let memory = metadata_from_state(&guard, false);
    let response = json!({
        "sessionId": input.session_id,
        "cursor": cursor_seq.to_string(),
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "memory": memory,
        "items": selected
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.events.read",
            json!({
                "cursor": cursor_seq.to_string(),
                "nextCursor": next_cursor,
                "limit": limit,
                "kinds": kind_filter,
                "actors": actor_filter
            }),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}

pub fn read_commands(input: CommandsReadInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let limit = input
        .limit
        .map(|value| value.max(1) as usize)
        .unwrap_or(DEFAULT_COMMANDS_LIMIT)
        .min(MAX_COMMANDS_LIMIT);
    let cursor_seq = input
        .cursor
        .as_deref()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);
    let status_filter = input
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| *value != "all")
        .map(ToString::to_string);

    let mut commands = read_jsonl_with_repair_log(
        &guard.paths.commands_path,
        Some(&guard.paths.repair_log_path),
    )
    .into_iter()
    .enumerate()
    .filter_map(|(index, mut command)| {
        if !string_field(&command, "terminalSessionId")
            .is_some_and(|session_id| session_id == input.session_id)
        {
            return None;
        }
        let command_seq = number_field(&command, "commandSeq").unwrap_or_else(|| index as u64 + 1);
        if command_seq <= cursor_seq {
            return None;
        }
        if status_filter
            .as_ref()
            .is_some_and(|status| string_field(&command, "status").as_ref() != Some(status))
        {
            return None;
        }
        if let Some(object) = command.as_object_mut() {
            object.insert("commandSeq".to_string(), json!(command_seq));
        }
        Some(command)
    })
    .collect::<Vec<_>>();
    commands.sort_by_key(|command| number_field(command, "commandSeq").unwrap_or(0));

    let has_more = commands.len() > limit;
    let selected = commands.into_iter().take(limit).collect::<Vec<_>>();
    let next_cursor = selected
        .last()
        .and_then(|command| number_field(command, "commandSeq"))
        .unwrap_or(cursor_seq)
        .to_string();
    let memory = metadata_from_state(&guard, false);
    let response = json!({
        "sessionId": input.session_id,
        "cursor": cursor_seq.to_string(),
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "memory": memory,
        "items": selected
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.commands.read",
            json!({
                "cursor": cursor_seq.to_string(),
                "nextCursor": next_cursor,
                "limit": limit,
                "status": status_filter
            }),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}

fn read_byte_range(path: &Path, start: u64, end: u64) -> MemoryResult<Vec<u8>> {
    let length = end.saturating_sub(start);
    if length == 0 {
        return Ok(Vec::new());
    }
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(start))
        .map_err(|error| error.to_string())?;
    let mut buffer = Vec::with_capacity(length.min(usize::MAX as u64) as usize);
    file.take(length)
        .read_to_end(&mut buffer)
        .map_err(|error| error.to_string())?;
    Ok(buffer)
}

pub fn read_output_range(input: OutputRangeReadInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let path = if input.raw {
        &guard.paths.raw_output_path
    } else {
        &guard.paths.output_text_path
    };
    let total_bytes = file_size(path);
    let start = input.start.min(total_bytes);
    let requested_end = input.end.min(total_bytes).max(start);
    let end = start
        .saturating_add(MAX_OUTPUT_RANGE_BYTES)
        .min(requested_end);
    let bytes = read_byte_range(path, start, end)?;
    let output = String::from_utf8_lossy(&bytes).to_string();
    let truncated = end < requested_end;
    let memory = metadata_from_state(&guard, truncated);
    let response = json!({
        "sessionId": input.session_id,
        "raw": input.raw,
        "encoding": if input.raw { "utf8-lossy" } else { "utf8" },
        "requestedRange": { "start": input.start, "end": input.end },
        "range": { "start": start, "end": end },
        "nextStart": end,
        "byteLength": bytes.len(),
        "totalBytes": total_bytes,
        "output": output,
        "rawBytesHex": if input.raw { Value::String(hex_encode(&bytes)) } else { Value::Null },
        "sha256": sha256_hex(&bytes),
        "truncated": truncated,
        "memory": memory
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.output.readRange",
            json!({
                "raw": input.raw,
                "requestedRange": { "start": input.start, "end": input.end },
                "range": { "start": start, "end": end },
                "truncated": truncated
            }),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}

pub fn list_artifacts(input: ArtifactsListInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let memory = metadata_from_state(&guard, false);
    let response = json!({
        "sessionId": input.session_id,
        "memory": memory,
        "items": artifact_records(&guard)
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.artifacts.list",
            json!({}),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}

fn metadata_json(storage_root: &str, session_id: &str, truncated: bool) -> MemoryResult<Value> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let memory = metadata_from_state(&guard, truncated);
    write_summary(
        session_id,
        &guard,
        memory
            .get("truncatedByProjection")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    )?;
    Ok(memory)
}

pub fn metadata_for_session(
    storage_root: &str,
    session_id: &str,
    truncated: bool,
) -> MemoryResult<String> {
    serde_json::to_string(&metadata_json(storage_root, session_id, truncated)?)
        .map_err(|error| error.to_string())
}

pub fn output_text_size(storage_root: &str, session_id: &str) -> MemoryResult<u64> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    Ok(file_size(&guard.paths.output_text_path))
}

fn is_utf8_continuation_byte(byte: u8) -> bool {
    byte & 0b1100_0000 == 0b1000_0000
}

fn clamp_to_utf8_boundary(path: &Path, cursor: u64, total_bytes: u64) -> u64 {
    let mut start = cursor.min(total_bytes);
    while start > 0 && start < total_bytes {
        let byte = read_byte_range(path, start, start.saturating_add(1))
            .ok()
            .and_then(|bytes| bytes.first().copied());
        if !byte.is_some_and(is_utf8_continuation_byte) {
            break;
        }
        start = start.saturating_sub(1);
    }
    start
}

pub fn read_output_projection(
    storage_root: &str,
    session_id: &str,
    cursor: u64,
    max_bytes: usize,
) -> MemoryResult<OutputProjection> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let path = &guard.paths.output_text_path;
    let total_bytes = file_size(path);
    let start = clamp_to_utf8_boundary(path, cursor, total_bytes);
    let requested_len = max_bytes.max(1) as u64;
    let read_end = start
        .saturating_add(requested_len)
        .saturating_add(4)
        .min(total_bytes);
    let bytes = read_byte_range(path, start, read_end)?;
    let mut valid_len = bytes.len().min(max_bytes.max(1));
    while valid_len > 0 && std::str::from_utf8(&bytes[..valid_len]).is_err() {
        valid_len -= 1;
    }
    if valid_len == 0 && !bytes.is_empty() {
        valid_len = bytes
            .iter()
            .enumerate()
            .skip(1)
            .find_map(|(index, byte)| {
                if is_utf8_continuation_byte(*byte) {
                    None
                } else {
                    Some(index)
                }
            })
            .unwrap_or(bytes.len());
        while valid_len > 0 && std::str::from_utf8(&bytes[..valid_len]).is_err() {
            valid_len -= 1;
        }
    }
    let output =
        String::from_utf8(bytes[..valid_len].to_vec()).map_err(|error| error.to_string())?;
    let end = start.saturating_add(valid_len as u64);

    Ok(OutputProjection {
        cursor: end,
        output,
        truncated: end < total_bytes,
    })
}

fn last_exit_code_from_paths(paths: &SessionPaths, session_id: &str) -> Option<i32> {
    read_jsonl_with_repair_log(&paths.events_path, Some(&paths.repair_log_path))
        .into_iter()
        .filter(|event| {
            string_field(event, "terminalSessionId").as_deref() == Some(session_id)
                && string_field(event, "kind").as_deref() == Some("process_exited")
        })
        .last()
        .and_then(|event| {
            event
                .get("payload")
                .and_then(|payload| payload.get("exitCode"))
                .and_then(Value::as_i64)
        })
        .and_then(|value| i32::try_from(value).ok())
}

pub fn last_exit_code(storage_root: &str, session_id: &str) -> MemoryResult<Option<i32>> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    Ok(last_exit_code_from_paths(&guard.paths, session_id))
}

pub fn stored_session_metadata(storage_root: &str, session_id: &str) -> MemoryResult<Value> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let created = session_created_record(&guard.paths, session_id);
    let payload = created
        .as_ref()
        .and_then(|event| event.get("payload").cloned())
        .unwrap_or_else(|| json!({}));
    Ok(json!({
        "sessionId": session_id,
        "title": string_field(&payload, "title").unwrap_or_else(|| session_id.to_string()),
        "cwd": string_field(&payload, "cwd"),
        "shell": string_field(&payload, "shell").unwrap_or_else(|| "unknown".to_string()),
        "cols": number_field(&payload, "cols").unwrap_or(80).min(u16::MAX as u64),
        "rows": number_field(&payload, "rows").unwrap_or(24).min(u16::MAX as u64),
        "createdAt": created.as_ref().and_then(|event| string_field(event, "createdAt")).unwrap_or_else(now_iso),
        "source": string_field(&payload, "source").unwrap_or_else(|| "system".to_string()),
        "mode": string_field(&payload, "mode").unwrap_or_else(|| "shell".to_string()),
        "command": string_field(&payload, "command"),
        "persist": payload.get("persist").and_then(Value::as_bool).unwrap_or(true),
        "running": false,
        "exitCode": last_exit_code_from_paths(&guard.paths, session_id).map(Value::from).unwrap_or(Value::Null),
        "restoration": restoration_state_json()
    }))
}

pub fn read_stored_sessions(storage_root: &str) -> MemoryResult<String> {
    let sessions_root = Path::new(storage_root)
        .join("terminal-memory")
        .join("sessions");
    let mut items = Vec::new();
    let entries = match fs::read_dir(&sessions_root) {
        Ok(entries) => entries,
        Err(_) => {
            let response = json!({
                "storageRoot": storage_root,
                "sessionsRoot": sessions_root.to_string_lossy(),
                "items": items
            });
            return serde_json::to_string(&response).map_err(|error| error.to_string());
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let fallback_id = entry.file_name().to_string_lossy().to_string();
        let session_id = fs::read_to_string(path.join("summary.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .and_then(|summary| string_field(&summary, "terminalSessionId"))
            .unwrap_or(fallback_id);
        if let Ok(metadata) = stored_session_metadata(storage_root, &session_id) {
            items.push(metadata);
        }
    }
    items.sort_by(|left, right| {
        string_field(left, "createdAt")
            .unwrap_or_default()
            .cmp(&string_field(right, "createdAt").unwrap_or_default())
    });
    let response = json!({
        "storageRoot": storage_root,
        "sessionsRoot": sessions_root.to_string_lossy(),
        "items": items
    });
    serde_json::to_string(&response).map_err(|error| error.to_string())
}

pub fn replay_screen_snapshot(
    storage_root: &str,
    session_id: &str,
    include_scrollback: bool,
    max_rows: Option<u32>,
    max_bytes: Option<u32>,
) -> MemoryResult<crate::screen::TerminalScreenSnapshot> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let created = session_created_record(&guard.paths, session_id);
    let payload = created
        .as_ref()
        .and_then(|event| event.get("payload").cloned())
        .unwrap_or_else(|| json!({}));
    let rows = number_field(&payload, "rows")
        .and_then(|value| u16::try_from(value).ok())
        .unwrap_or(24)
        .max(1);
    let cols = number_field(&payload, "cols")
        .and_then(|value| u16::try_from(value).ok())
        .unwrap_or(80)
        .max(1);
    let mut screen = TerminalScreenState::new(rows, cols);
    let mut events =
        read_jsonl_with_repair_log(&guard.paths.events_path, Some(&guard.paths.repair_log_path))
            .into_iter()
            .filter(|event| string_field(event, "terminalSessionId").as_deref() == Some(session_id))
            .collect::<Vec<_>>();
    events.sort_by_key(|event| number_field(event, "seq").unwrap_or(0));
    for event in events {
        let payload = event.get("payload").cloned().unwrap_or_else(|| json!({}));
        match string_field(&event, "kind").as_deref() {
            Some("input_resize") => {
                let rows = number_field(&payload, "rows")
                    .and_then(|value| u16::try_from(value).ok())
                    .unwrap_or(rows);
                let cols = number_field(&payload, "cols")
                    .and_then(|value| u16::try_from(value).ok())
                    .unwrap_or(cols);
                screen.resize(rows, cols);
            }
            Some("output_chunk") => {
                let raw_offset = number_field(&payload, "rawOffset").unwrap_or(0);
                let raw_len = number_field(&payload, "rawByteLength").unwrap_or(0);
                let raw_end = raw_offset.saturating_add(raw_len);
                let bytes = read_byte_range(&guard.paths.raw_output_path, raw_offset, raw_end)?;
                screen.feed(&bytes);
            }
            _ => {}
        }
    }
    Ok(screen.snapshot(include_scrollback, max_rows, max_bytes))
}

fn process_name(shell: &str) -> String {
    Path::new(shell)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| shell.to_string())
}

fn append_process_record(
    session_id: &str,
    state: &SessionState,
    process_id: Option<u32>,
    status: &str,
    payload: Value,
) -> MemoryResult<()> {
    append_json_line(
        &state.paths.processes_path,
        &merge_object(
            json!({
                "processRecordId": format!("terminal-process-record-{}", Uuid::new_v4()),
                "terminalSessionId": session_id,
                "processId": process_id,
                "status": status,
                "recordedAt": now_iso()
            }),
            payload,
        ),
    )
}

fn append_process_tree_snapshot(
    session_id: &str,
    state: &mut SessionState,
    process_id: Option<u32>,
    process_name: &str,
    correlation: Value,
) -> MemoryResult<()> {
    append_event(
        session_id,
        state,
        "process_tree_snapshot",
        json!({ "kind": "terminal_kernel" }),
        json!({
            "processCount": if process_id.is_some() { 1 } else { 0 },
            "rootProcess": {
                "processId": process_id,
                "processName": process_name,
                "status": "running"
            }
        }),
        correlation,
        "include_as_runtime_state",
        "show_as_status",
    )
    .map(|_| ())
}

fn append_agent_link_event(
    session_id: &str,
    state: &mut SessionState,
    kind: &str,
    actor: &Value,
    correlation: &Value,
) -> MemoryResult<()> {
    let Some(agent_session_id) = string_field(actor, "agentSessionId")
        .or_else(|| string_field(correlation, "agentSessionId"))
    else {
        return Ok(());
    };
    let link_id = format!(
        "agent-terminal-link-{}-{}",
        safe_segment(&agent_session_id),
        safe_segment(session_id)
    );
    let link_record = json!({
        "linkRecordId": format!("terminal-link-record-{}", Uuid::new_v4()),
        "linkId": link_id,
        "terminalSessionId": session_id,
        "agentSessionId": agent_session_id.clone(),
        "status": if kind == "agent_attached" { "attached" } else { "detached" },
        "actor": actor,
        "correlation": correlation,
        "recordedAt": now_iso()
    });
    append_json_line(&state.paths.attachments_path, &link_record)?;
    append_agent_link_index(&state.paths, &link_record)?;
    append_event(
        session_id,
        state,
        kind,
        json!({ "kind": "terminal_kernel" }),
        json!({
            "linkId": link_id,
            "agentSessionId": agent_session_id
        }),
        correlation.clone(),
        "include_as_runtime_state",
        "show_as_status",
    )
    .map(|_| ())
}

fn permission_status_for_kind(kind: &str) -> &'static str {
    match kind {
        "permission_requested" => "pending",
        "permission_granted" => "granted",
        "permission_denied" => "denied",
        "permission_expired" => "expired",
        _ => "unknown",
    }
}

fn permission_actor_source(kind: &str, input: &PermissionEventInput) -> &'static str {
    if kind == "permission_expired" {
        "system"
    } else if kind == "permission_requested" && input.agent_session_id.is_some() {
        "agent"
    } else if kind == "permission_requested" {
        "system"
    } else {
        "user"
    }
}

fn permission_correlation(input: &PermissionEventInput) -> Value {
    merge_object(
        parse_json_object(input.correlation_json.as_deref()),
        json!({
            "permissionId": input.permission_id.clone(),
            "commandId": input.command_id.clone(),
            "inputId": input.input_id.clone(),
            "agentSessionId": input.agent_session_id.clone(),
            "runtimeTurnId": input.runtime_turn_id.clone(),
            "toolCallId": input.tool_call_id.clone()
        }),
    )
}

fn append_permission_record(
    session_id: &str,
    state: &SessionState,
    actor: &Value,
    correlation: &Value,
    payload: &Value,
) -> MemoryResult<()> {
    let permission_record_seq = read_last_jsonl(&state.paths.permissions_path)
        .and_then(|record| number_field(&record, "permissionRecordSeq"))
        .map(|seq| seq.saturating_add(1))
        .unwrap_or(1);
    let record = merge_object(
        json!({
            "permissionRecordSeq": permission_record_seq,
            "permissionRecordId": format!("terminal-permission-record-{}", Uuid::new_v4()),
            "terminalSessionId": session_id,
            "actor": actor,
            "correlation": correlation,
            "recordedAt": now_iso()
        }),
        payload.clone(),
    );
    append_json_line(&state.paths.permissions_path, &record)?;
    append_permission_index(&state.paths, &record)
}

fn record_permission_event(kind: &str, input: PermissionEventInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let status = permission_status_for_kind(kind);
    let actor = actor_from_request(
        input.actor_json.as_deref(),
        Some(permission_actor_source(kind, &input)),
    );
    let correlation = permission_correlation(&input);
    let payload = json!({
        "permissionId": input.permission_id.clone(),
        "status": status,
        "action": input.action.clone(),
        "risk": input.risk.clone(),
        "summary": input.summary.clone(),
        "title": input.title.clone(),
        "detail": input.detail.clone(),
        "commandId": input.command_id.clone(),
        "inputId": input.input_id.clone(),
        "agentSessionId": input.agent_session_id.clone(),
        "runtimeTurnId": input.runtime_turn_id.clone(),
        "toolCallId": input.tool_call_id.clone(),
        "decision": input.decision.clone(),
        "reason": input.reason.clone(),
        "expiresAt": input.expires_at.clone()
    });
    append_permission_record(&input.session_id, &guard, &actor, &correlation, &payload)?;
    append_event(
        &input.session_id,
        &mut guard,
        kind,
        actor,
        payload,
        correlation,
        "include_as_runtime_state",
        "show_in_timeline",
    )?;
    Ok(())
}

pub fn record_permission_requested(input: PermissionEventInput) -> MemoryResult<()> {
    record_permission_event("permission_requested", input)
}

pub fn record_permission_granted(input: PermissionEventInput) -> MemoryResult<()> {
    record_permission_event("permission_granted", input)
}

pub fn record_permission_denied(input: PermissionEventInput) -> MemoryResult<()> {
    record_permission_event("permission_denied", input)
}

pub fn record_permission_expired(input: PermissionEventInput) -> MemoryResult<()> {
    record_permission_event("permission_expired", input)
}

pub fn record_handoff_started(input: HandoffEventInput) -> MemoryResult<()> {
    record_handoff_event("handoff_started", input)
}

pub fn record_handoff_completed(input: HandoffEventInput) -> MemoryResult<()> {
    record_handoff_event("handoff_completed", input)
}

fn record_handoff_event(kind: &str, input: HandoffEventInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let handoff_id = input
        .handoff_id
        .clone()
        .unwrap_or_else(|| format!("terminal-handoff-{}", Uuid::new_v4()));
    let actor = actor_from_request(input.actor_json.as_deref(), Some("system"));
    let correlation = merge_object(
        parse_json_object(input.correlation_json.as_deref()),
        json!({ "handoffId": handoff_id }),
    );
    append_event(
        &input.session_id,
        &mut guard,
        kind,
        actor,
        json!({
            "handoffId": handoff_id,
            "fromActor": parse_json_object(input.from_actor_json.as_deref()),
            "toActor": parse_json_object(input.to_actor_json.as_deref()),
            "reason": input.reason.clone(),
            "summary": input.summary.clone(),
            "status": input.status.clone()
        }),
        correlation,
        "include_as_runtime_state",
        "show_in_timeline",
    )?;
    Ok(())
}

pub fn mark_output_policy(input: OutputPolicyMarkerInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let policy = match input.policy.trim() {
        "redacted" | "encrypted" => input.policy.trim().to_string(),
        other if other.is_empty() => "redacted".to_string(),
        other => other.to_string(),
    };
    let start = input.start.min(input.end);
    let end = input.end.max(start);
    let actor = actor_from_request(input.actor_json.as_deref(), Some("system"));
    let correlation = parse_json_object(input.correlation_json.as_deref());
    let marker = json!({
        "markerId": format!("terminal-output-policy-{}", Uuid::new_v4()),
        "terminalSessionId": input.session_id.clone(),
        "range": { "start": start, "end": end },
        "policy": policy,
        "redacted": policy == "redacted",
        "encrypted": policy == "encrypted",
        "encryptedRef": input.encrypted_ref.clone(),
        "reason": input.reason.clone(),
        "actor": actor.clone(),
        "correlation": correlation.clone(),
        "coordinateSpace": "original_output_byte_offsets",
        "recordedAt": now_iso()
    });
    append_json_line(&guard.paths.output_redactions_path, &marker)?;
    append_event(
        &input.session_id,
        &mut guard,
        "output_policy_marked",
        actor,
        marker,
        correlation,
        "artifact_reference_only",
        "show_in_details_only",
    )?;
    Ok(())
}

fn record_audit_read(
    storage_root: &str,
    session_id: &str,
    read_kind: &str,
    detail: Value,
    actor_json: Option<&str>,
    correlation_json: Option<&str>,
) -> MemoryResult<()> {
    let state = initialize_state(storage_root, session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(actor_json, Some("system"));
    let correlation = merge_object(
        parse_json_object(correlation_json),
        json!({ "auditReadKind": read_kind }),
    );
    append_event(
        session_id,
        &mut guard,
        "audit_read",
        actor,
        merge_object(
            json!({
                "reader": read_kind,
                "summary": format!("Terminal memory read: {read_kind}")
            }),
            detail,
        ),
        correlation,
        "exclude",
        "show_in_details_only",
    )?;
    Ok(())
}

pub fn record_session_created(input: SessionCreatedInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), Some(&input.source));
    let correlation = merge_object(
        parse_json_object(input.correlation_json.as_deref()),
        json!({ "cwd": input.cwd }),
    );
    append_event(
        &input.session_id,
        &mut guard,
        "session_created",
        actor.clone(),
        json!({
            "title": input.title,
            "cwd": input.cwd,
            "shell": input.shell,
            "mode": input.mode,
            "command": input.command.clone(),
            "source": input.source,
            "rows": input.rows,
            "cols": input.cols,
            "persist": input.persist
        }),
        correlation.clone(),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    append_agent_link_event(
        &input.session_id,
        &mut guard,
        "agent_attached",
        &actor,
        &correlation,
    )?;
    if let Some(command) = input
        .command
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        record_known_command(
            &input.session_id,
            &mut guard,
            command,
            actor,
            correlation,
            "running",
            None,
        )?;
        write_summary(&input.session_id, &guard, false)?;
    }
    Ok(())
}

pub fn record_process_started(input: ProcessStartedInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    guard.active_process_id = input.process_id;
    let actor = actor_from_request(input.actor_json.as_deref(), Some("system"));
    let correlation = parse_json_object(input.correlation_json.as_deref());
    let name = process_name(&input.shell);
    let payload = json!({
        "processId": input.process_id,
        "processName": name,
        "shell": input.shell,
        "cwd": input.cwd,
        "command": input.command,
        "mode": input.mode,
        "source": input.source,
        "cols": input.cols,
        "rows": input.rows
    });
    append_process_record(
        &input.session_id,
        &guard,
        input.process_id,
        "running",
        payload.clone(),
    )?;
    append_event(
        &input.session_id,
        &mut guard,
        "process_started",
        actor,
        payload,
        correlation.clone(),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    append_process_tree_snapshot(
        &input.session_id,
        &mut guard,
        input.process_id,
        &name,
        correlation,
    )?;
    Ok(())
}

pub fn record_process_signal_sent(input: ProcessSignalInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), Some("user"));
    let process_id = guard.active_process_id;
    let payload = json!({
        "processId": process_id,
        "signal": input.signal,
        "reason": input.reason
    });
    append_process_record(
        &input.session_id,
        &guard,
        process_id,
        "signal_sent",
        payload.clone(),
    )?;
    append_event(
        &input.session_id,
        &mut guard,
        "process_signal_sent",
        actor,
        payload,
        parse_json_object(input.correlation_json.as_deref()),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    Ok(())
}

pub fn record_write(input: WriteInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), input.source.as_deref());
    let command_text = command_text_from_write(&input);
    let requested_correlation = parse_json_object(input.correlation_json.as_deref());
    let command_id = command_text
        .as_ref()
        .map(|_| {
            command_id_from_correlation(&requested_correlation).unwrap_or_else(create_command_id)
        })
        .or_else(|| command_id_from_correlation(&requested_correlation));
    let correlation = merge_object(
        requested_correlation,
        command_id
            .as_ref()
            .map(|value| json!({ "commandId": value }))
            .unwrap_or_else(|| json!({})),
    );
    let text_for_preview = input
        .text
        .as_deref()
        .or(input.data.as_deref())
        .map(ToString::to_string)
        .or_else(|| input.keys.as_ref().map(|keys| keys.join(", ")))
        .unwrap_or_default();
    let kind = if input.keys.as_ref().is_some_and(|keys| !keys.is_empty()) {
        "input_keys"
    } else {
        "input_text"
    };
    append_event(
        &input.session_id,
        &mut guard,
        kind,
        actor.clone(),
        json!({
            "data": input.data,
            "text": input.text,
            "keys": input.keys,
            "appendNewline": input.append_newline,
            "textPreview": preview_text(&text_for_preview),
            "byteLength": text_for_preview.len()
        }),
        correlation.clone(),
        "artifact_reference_only",
        "show_in_timeline",
    )?;
    if let Some(command_text) = command_text {
        record_known_command(
            &input.session_id,
            &mut guard,
            &command_text,
            actor,
            correlation,
            "running",
            None,
        )?;
        write_summary(&input.session_id, &guard, false)?;
    }
    Ok(())
}

pub fn record_resize(input: ResizeInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), Some("user"));
    append_event(
        &input.session_id,
        &mut guard,
        "input_resize",
        actor,
        json!({ "cols": input.cols, "rows": input.rows }),
        parse_json_object(input.correlation_json.as_deref()),
        "exclude",
        "show_as_status",
    )?;
    Ok(())
}

pub fn record_close(input: CloseInput) -> MemoryResult<()> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = actor_from_request(input.actor_json.as_deref(), Some("user"));
    let correlation = parse_json_object(input.correlation_json.as_deref());
    append_event(
        &input.session_id,
        &mut guard,
        "session_closed",
        actor.clone(),
        json!({}),
        correlation.clone(),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    append_agent_link_event(
        &input.session_id,
        &mut guard,
        "agent_detached",
        &actor,
        &correlation,
    )?;
    Ok(())
}

pub fn record_output(context: &MemoryContext, raw: &[u8]) -> MemoryResult<()> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let raw_start = file_size(&guard.paths.raw_output_path);
    let text_start = file_size(&guard.paths.output_text_path);
    let raw_text = String::from_utf8_lossy(raw).to_string();
    let text = strip_ansi(&raw_text);
    {
        let mut raw_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&guard.paths.raw_output_path)
            .map_err(|error| error.to_string())?;
        raw_file.write_all(raw).map_err(|error| error.to_string())?;
    }
    {
        let mut text_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&guard.paths.output_text_path)
            .map_err(|error| error.to_string())?;
        text_file
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    let raw_byte_length = raw.len() as u64;
    let text_byte_length = text.len() as u64;
    let command_id = guard.active_command_id.clone();
    let output_artifact_id = "session-output";
    let seq = guard.next_seq;
    guard.next_seq = guard.next_seq.saturating_add(1);
    let created_at = now_iso();
    let correlation = command_id
        .as_ref()
        .map(|value| json!({ "commandId": value, "outputArtifactId": output_artifact_id }))
        .unwrap_or_else(|| json!({ "outputArtifactId": output_artifact_id }));
    let event = json!({
        "eventId": format!("terminal-event-{}", Uuid::new_v4()),
        "terminalSessionId": context.session_id,
        "seq": seq,
        "kind": "output_chunk",
        "actor": { "kind": "process" },
        "payload": {
            "rawOffset": raw_start,
            "rawByteLength": raw_byte_length,
            "textOffset": text_start,
            "textByteLength": text_byte_length,
            "commandId": command_id,
            "outputArtifactId": output_artifact_id,
            "textPreview": preview_text(&text),
            "sha256": sha256_hex(raw)
        },
        "createdAt": created_at,
        "createdAtMs": now_ms(),
        "correlation": correlation,
        "visibility": "user_visible",
        "modelContextPolicy": "artifact_reference_only",
        "uiPolicy": "show_in_terminal_only",
        "auditPolicy": "full"
    });
    append_json_line(&guard.paths.events_path, &event)?;
    append_event_index(&guard.paths, &event)?;
    let stored =
        stored_event_from_record(&event).ok_or_else(|| "invalid output event".to_string())?;
    append_timeline_item_for_event(&stored, &mut guard)?;
    index_output_text(
        &context.session_id,
        &mut guard,
        &text,
        text_start,
        seq,
        &created_at,
    )?;
    guard.latest_event_kind = Some("output_chunk".to_string());
    write_summary(&context.session_id, &guard, false)?;
    Ok(())
}

fn budget_screen_diff_payload(payload: Value, artifact_path: &Path, seq: u64) -> Value {
    let serialized_len = serde_json::to_vec(&payload)
        .map(|bytes| bytes.len())
        .unwrap_or(0);
    let rows = payload
        .get("dirtyRows")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let ranges = payload
        .get("dirtyRowRanges")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if rows.is_empty() && ranges.is_empty() {
        return payload;
    }
    if rows.len() <= 20 && ranges.len() <= 40 && serialized_len <= 4 * 1024 {
        return payload;
    }
    let mut budgeted = payload.clone();
    if let Some(object) = budgeted.as_object_mut() {
        object.insert("dirtyRowCount".to_string(), json!(rows.len()));
        object.insert("dirtyRowRangeCount".to_string(), json!(ranges.len()));
        object.insert(
            "dirtyRows".to_string(),
            Value::Array(rows.iter().take(20).cloned().collect()),
        );
        object.insert(
            "dirtyRowRanges".to_string(),
            Value::Array(ranges.iter().take(40).cloned().collect()),
        );
        object.insert("truncated".to_string(), Value::Bool(true));
        object.insert(
            "fullDiffArtifact".to_string(),
            json!({
                "label": "screen-diffs.jsonl",
                "path": artifact_path.to_string_lossy(),
                "seq": seq
            }),
        );
    }
    budgeted
}

pub fn record_screen_diff(context: &MemoryContext, payload: Value) -> MemoryResult<()> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let seq = guard.next_seq;
    append_json_line(
        &guard.paths.screen_diffs_path,
        &json!({
            "terminalSessionId": context.session_id,
            "seq": seq,
            "kind": "screen_diff",
            "payload": payload.clone(),
            "createdAt": now_iso()
        }),
    )?;
    let event_payload = budget_screen_diff_payload(payload, &guard.paths.screen_diffs_path, seq);
    append_event(
        &context.session_id,
        &mut guard,
        "screen_diff",
        json!({ "kind": "terminal_kernel" }),
        event_payload,
        json!({}),
        "include_as_runtime_state",
        "show_in_terminal_only",
    )?;
    Ok(())
}

fn command_text_for_id(state: &SessionState, command_id: &str) -> Option<String> {
    read_jsonl_with_repair_log(
        &state.paths.commands_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .filter(|record| string_field(record, "commandId").as_deref() == Some(command_id))
    .find_map(|record| string_field(&record, "commandText"))
}

fn latest_command_record_for_id(state: &SessionState, command_id: &str) -> Option<Value> {
    read_jsonl_with_repair_log(
        &state.paths.commands_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .rev()
    .find(|record| string_field(record, "commandId").as_deref() == Some(command_id))
}

fn latest_command_status_for_id(state: &SessionState, command_id: &str) -> Option<String> {
    latest_command_record_for_id(state, command_id)
        .and_then(|record| string_field(&record, "status"))
}

fn command_range_start(record: Option<&Value>, field: &str, fallback: u64) -> u64 {
    record
        .and_then(|value| value.get(field))
        .and_then(|range| number_field(range, "start"))
        .unwrap_or(fallback)
        .min(fallback)
}

struct CommandArtifactPaths {
    root: PathBuf,
    meta: PathBuf,
    output_text: PathBuf,
    raw_output: PathBuf,
    events: PathBuf,
    summary: PathBuf,
}

fn command_artifact_paths(state: &SessionState, command_id: &str) -> CommandArtifactPaths {
    let root = state
        .paths
        .command_artifacts_root_path
        .join(safe_segment(command_id));
    CommandArtifactPaths {
        meta: root.join("meta.json"),
        output_text: root.join("output.txt"),
        raw_output: root.join("output.raw"),
        events: root.join("events.jsonl"),
        summary: root.join("summary.json"),
        root,
    }
}

fn command_artifact_metadata(paths: &CommandArtifactPaths) -> Value {
    json!({
        "artifactRootPath": paths.root.to_string_lossy(),
        "commandMetaPath": paths.meta.to_string_lossy(),
        "commandOutputTextPath": paths.output_text.to_string_lossy(),
        "commandRawOutputPath": paths.raw_output.to_string_lossy(),
        "commandEventsPath": paths.events.to_string_lossy(),
        "commandSummaryPath": paths.summary.to_string_lossy()
    })
}

fn event_command_id(event: &Value) -> Option<String> {
    event
        .get("correlation")
        .and_then(|correlation| string_field(correlation, "commandId"))
        .or_else(|| {
            event
                .get("payload")
                .and_then(|payload| string_field(payload, "commandId"))
        })
}

fn write_command_events_artifact(
    state: &SessionState,
    command_id: &str,
    path: &Path,
) -> MemoryResult<(u64, Option<u64>, Option<u64>)> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = File::create(path).map_err(|error| error.to_string())?;
    let mut count = 0_u64;
    let mut first_seq = None;
    let mut last_seq = None;
    for event in
        read_jsonl_with_repair_log(&state.paths.events_path, Some(&state.paths.repair_log_path))
            .into_iter()
            .filter(|event| event_command_id(event).as_deref() == Some(command_id))
    {
        let seq = number_field(&event, "seq");
        if first_seq.is_none() {
            first_seq = seq;
        }
        last_seq = seq.or(last_seq);
        serde_json::to_writer(&mut file, &event).map_err(|error| error.to_string())?;
        file.write_all(b"\n").map_err(|error| error.to_string())?;
        count = count.saturating_add(1);
    }
    Ok((count, first_seq, last_seq))
}

fn output_lines_for_range(state: &SessionState, start: u64, end: u64) -> Vec<Value> {
    read_jsonl_with_repair_log(
        &state.paths.line_index_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .filter(|line| {
        number_field(line, "textOffset").is_some_and(|offset| offset >= start && offset < end)
    })
    .collect()
}

fn error_lines_for_range(
    state: &SessionState,
    command_id: &str,
    start: u64,
    end: u64,
) -> Vec<Value> {
    read_jsonl_with_repair_log(
        &state.paths.error_index_path,
        Some(&state.paths.repair_log_path),
    )
    .into_iter()
    .filter(|error| {
        string_field(error, "commandId").as_deref() == Some(command_id)
            || number_field(error, "textOffset")
                .is_some_and(|offset| offset >= start && offset < end)
    })
    .collect()
}

#[allow(clippy::too_many_arguments)]
fn write_command_artifacts(
    session_id: &str,
    state: &SessionState,
    command_id: &str,
    command_text: Option<&str>,
    status: &str,
    exit_code: Option<i32>,
    signal: Option<&str>,
    actor: &Value,
    correlation: &Value,
    output_text_start: u64,
    output_text_end: u64,
    raw_output_start: u64,
    raw_output_end: u64,
    completed_at: &str,
) -> MemoryResult<CommandCompletionProjection> {
    let paths = command_artifact_paths(state, command_id);
    fs::create_dir_all(&paths.root).map_err(|error| error.to_string())?;

    let output_bytes = read_byte_range(
        &state.paths.output_text_path,
        output_text_start,
        output_text_end,
    )?;
    let raw_bytes = read_byte_range(
        &state.paths.raw_output_path,
        raw_output_start,
        raw_output_end,
    )?;
    fs::write(&paths.output_text, &output_bytes).map_err(|error| error.to_string())?;
    fs::write(&paths.raw_output, &raw_bytes).map_err(|error| error.to_string())?;

    let (event_count, first_event_seq, last_event_seq) =
        write_command_events_artifact(state, command_id, &paths.events)?;
    let output_text = String::from_utf8_lossy(&output_bytes).to_string();
    let output_lines = output_lines_for_range(state, output_text_start, output_text_end);
    let error_lines = error_lines_for_range(state, command_id, output_text_start, output_text_end);
    let non_empty_lines = output_text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let first_output_preview = non_empty_lines.first().map(|line| preview_text(line));
    let last_output_preview = non_empty_lines.last().map(|line| preview_text(line));
    let metadata = command_artifact_metadata(&paths);
    let output_text_range = json!({ "start": output_text_start, "end": output_text_end });
    let raw_output_range = json!({ "start": raw_output_start, "end": raw_output_end });

    let meta = merge_object(
        json!({
            "schemaVersion": 1,
            "terminalSessionId": session_id,
            "commandId": command_id,
            "commandText": command_text,
            "normalizedCommandText": command_text.map(str::trim),
            "status": status,
            "exitCode": exit_code,
            "signal": signal,
            "actor": actor,
            "correlation": correlation,
            "outputTextRange": output_text_range.clone(),
            "rawOutputRange": raw_output_range.clone(),
            "completedAt": completed_at,
            "updatedAt": now_iso()
        }),
        metadata.clone(),
    );
    write_json_pretty(&paths.meta, &meta)?;
    write_json_pretty(
        &paths.summary,
        &merge_object(
            json!({
                "schemaVersion": 1,
                "terminalSessionId": session_id,
                "commandId": command_id,
                "status": status,
                "exitCode": exit_code,
                "signal": signal,
                "outputByteLength": output_bytes.len(),
                "rawByteLength": raw_bytes.len(),
                "estimatedTokens": estimate_tokens(output_bytes.len() as u64),
                "firstOutputPreview": first_output_preview,
                "lastOutputPreview": last_output_preview,
                "lineCount": output_lines.len(),
                "errorCount": error_lines.len(),
                "lastErrorLines": error_lines
                    .iter()
                    .filter_map(|line| string_field(line, "textPreview"))
                    .rev()
                    .take(5)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>(),
                "eventCount": event_count,
                "eventSeqRange": match (first_event_seq, last_event_seq) {
                    (Some(start), Some(end)) => json!({ "start": start, "end": end }),
                    _ => Value::Null
                },
                "completedAt": completed_at
            }),
            metadata.clone(),
        ),
    )?;

    Ok(CommandCompletionProjection {
        terminal_session_id: session_id.to_string(),
        command_id: command_id.to_string(),
        command_text: command_text.map(ToString::to_string),
        status: status.to_string(),
        exit_code,
        signal: signal.map(ToString::to_string),
        actor: actor.clone(),
        correlation: correlation.clone(),
        output_text_range,
        raw_output_range,
        artifact_root_path: paths.root.to_string_lossy().to_string(),
        command_meta_path: paths.meta.to_string_lossy().to_string(),
        command_output_text_path: paths.output_text.to_string_lossy().to_string(),
        command_raw_output_path: paths.raw_output.to_string_lossy().to_string(),
        command_events_path: paths.events.to_string_lossy().to_string(),
        command_summary_path: paths.summary.to_string_lossy().to_string(),
        completed_at: completed_at.to_string(),
    })
}

fn complete_command_from_shell_event(
    session_id: &str,
    state: &mut SessionState,
    command_id: String,
    command_text: Option<String>,
    exit_code: Option<i32>,
    signal: Option<String>,
    actor: Value,
    correlation: Value,
) -> MemoryResult<Option<CommandCompletionProjection>> {
    if latest_command_status_for_id(state, &command_id)
        .as_deref()
        .is_some_and(|status| status != "running" && status != "pending")
    {
        return Ok(None);
    }

    let latest = latest_command_record_for_id(state, &command_id);
    let output_text_end = file_size(&state.paths.output_text_path);
    let raw_output_end = file_size(&state.paths.raw_output_path);
    let output_text_start = if state.active_command_id.as_deref() == Some(command_id.as_str()) {
        state
            .active_command_output_text_start
            .unwrap_or(output_text_end)
            .min(output_text_end)
    } else {
        command_range_start(latest.as_ref(), "outputTextRange", output_text_end)
    };
    let raw_output_start = if state.active_command_id.as_deref() == Some(command_id.as_str()) {
        state
            .active_command_raw_start
            .unwrap_or(raw_output_end)
            .min(raw_output_end)
    } else {
        command_range_start(latest.as_ref(), "rawOutputRange", raw_output_end)
    };
    let command_text = command_text
        .or_else(|| command_text_for_id(state, &command_id))
        .or_else(|| {
            latest
                .as_ref()
                .and_then(|record| string_field(record, "commandText"))
        });
    let base_correlation = latest
        .as_ref()
        .and_then(|record| record.get("correlation"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let correlation = merge_object(
        merge_object(base_correlation, correlation),
        json!({ "commandId": command_id.clone(), "boundarySource": "shell_integration" }),
    );
    let status = if signal.is_some() {
        "cancelled"
    } else if exit_code.unwrap_or(0) == 0 {
        "completed"
    } else {
        "failed"
    };
    let artifact_paths = command_artifact_paths(state, &command_id);
    let artifact_metadata = command_artifact_metadata(&artifact_paths);
    let completed_at = now_iso();
    append_command_record(
        state,
        merge_object(
            json!({
                "commandId": command_id.clone(),
                "terminalSessionId": session_id,
                "commandText": command_text.clone(),
                "normalizedCommandText": command_text.as_deref().map(str::trim),
                "status": status,
                "exitCode": exit_code,
                "signal": signal.clone(),
                "outputTextRange": { "start": output_text_start, "end": output_text_end },
                "rawOutputRange": { "start": raw_output_start, "end": raw_output_end },
                "completedAt": completed_at.clone(),
                "correlation": correlation.clone(),
                "confidence": 1.0
            }),
            artifact_metadata.clone(),
        ),
    )?;
    append_command_lifecycle_event(
        session_id,
        state,
        "command_completed",
        &command_id,
        command_text.as_deref(),
        actor.clone(),
        correlation.clone(),
        merge_object(
            json!({
                "status": status,
                "exitCode": exit_code,
                "outputTextRange": { "start": output_text_start, "end": output_text_end },
                "rawOutputRange": { "start": raw_output_start, "end": raw_output_end },
                "boundarySource": "shell_integration"
            }),
            artifact_metadata.clone(),
        ),
    )?;
    let completion = write_command_artifacts(
        session_id,
        state,
        &command_id,
        command_text.as_deref(),
        status,
        exit_code,
        signal.as_deref(),
        &actor,
        &correlation,
        output_text_start,
        output_text_end,
        raw_output_start,
        raw_output_end,
        &completed_at,
    )?;
    if state.active_command_id.as_deref() == Some(command_id.as_str()) {
        state.active_command_id = None;
        state.active_command_output_text_start = None;
        state.active_command_raw_start = None;
    }
    Ok(Some(completion))
}

pub fn active_command_text(storage_root: &str, session_id: &str) -> MemoryResult<Option<String>> {
    let state = initialize_state(storage_root, session_id)?;
    let guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let Some(command_id) = guard.active_command_id.as_deref() else {
        return Ok(None);
    };
    Ok(command_text_for_id(&guard, command_id).or_else(|| Some(command_id.to_string())))
}

pub fn record_shell_integration_event(
    context: &MemoryContext,
    event: &ShellIntegrationEvent,
) -> MemoryResult<Option<CommandCompletionProjection>> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let actor = json!({ "kind": "terminal_kernel" });
    let command_id = event
        .command_id
        .clone()
        .or_else(|| guard.active_command_id.clone());
    let correlation = command_id
        .as_ref()
        .map(|value| json!({ "commandId": value }))
        .unwrap_or_else(|| json!({}));
    let mut completion = None;

    match event.kind {
        ShellIntegrationEventKind::CommandStart => {
            let command_id = command_id.unwrap_or_else(create_command_id);
            let command_text = event
                .command
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if command_text.is_none()
                && guard.active_command_id.as_deref() != Some(command_id.as_str())
            {
                append_event(
                    &context.session_id,
                    &mut guard,
                    "shell_integration",
                    actor,
                    json!({
                        "eventKind": format!("{:?}", event.kind),
                        "commandId": event.command_id.clone(),
                        "command": event.command.clone(),
                        "cwd": event.cwd.clone(),
                        "exitCode": event.exit_code,
                        "signal": event.signal.clone(),
                        "confidence": event.confidence,
                        "ignored": true,
                        "ignoredReason": "empty_command"
                    }),
                    correlation,
                    "include_as_runtime_state",
                    "show_in_terminal_only",
                )?;
                write_summary(&context.session_id, &guard, false)?;
                return Ok(None);
            }
            let start_correlation = merge_object(
                correlation.clone(),
                json!({ "commandId": command_id.clone(), "boundarySource": "shell_integration" }),
            );
            if latest_command_status_for_id(&guard, &command_id).is_none() {
                record_known_command(
                    &context.session_id,
                    &mut guard,
                    command_text.unwrap_or(command_id.as_str()),
                    actor.clone(),
                    start_correlation,
                    "running",
                    None,
                )?;
            } else if guard.active_command_id.as_deref() != Some(command_id.as_str()) {
                guard.active_command_id = Some(command_id.clone());
                let output_text_start = file_size(&guard.paths.output_text_path);
                let raw_output_start = file_size(&guard.paths.raw_output_path);
                guard.active_command_output_text_start = Some(output_text_start);
                guard.active_command_raw_start = Some(raw_output_start);
                append_command_lifecycle_event(
                    &context.session_id,
                    &mut guard,
                    "command_started",
                    &command_id,
                    event.command.as_deref(),
                    actor.clone(),
                    start_correlation,
                    json!({
                        "outputTextRange": { "start": output_text_start, "end": output_text_start },
                        "rawOutputRange": { "start": raw_output_start, "end": raw_output_start }
                    }),
                )?;
            }
        }
        ShellIntegrationEventKind::CommandEnd => {
            if let Some(command_id) = command_id {
                completion = complete_command_from_shell_event(
                    &context.session_id,
                    &mut guard,
                    command_id,
                    event.command.clone(),
                    event.exit_code,
                    event.signal.clone(),
                    actor.clone(),
                    correlation.clone(),
                )?;
            }
        }
        ShellIntegrationEventKind::CwdChanged
        | ShellIntegrationEventKind::PromptStart
        | ShellIntegrationEventKind::PromptEnd
        | ShellIntegrationEventKind::PromptReady
        | ShellIntegrationEventKind::CommandId
        | ShellIntegrationEventKind::Unknown => {}
    }

    append_event(
        &context.session_id,
        &mut guard,
        "shell_integration",
        actor,
        json!({
            "eventKind": format!("{:?}", event.kind),
            "commandId": event.command_id.clone(),
            "command": event.command.clone(),
            "cwd": event.cwd.clone(),
            "exitCode": event.exit_code,
            "signal": event.signal.clone(),
            "confidence": event.confidence
        }),
        correlation,
        "include_as_runtime_state",
        "show_in_terminal_only",
    )?;
    write_summary(&context.session_id, &guard, false)?;
    Ok(completion)
}

pub fn record_exit(
    context: &MemoryContext,
    exit_code: i32,
) -> MemoryResult<Option<CommandCompletionProjection>> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let command_id = guard.active_command_id.clone();
    let latest = command_id
        .as_ref()
        .and_then(|command_id| latest_command_record_for_id(&guard, command_id));
    let command_text = command_id
        .as_ref()
        .and_then(|command_id| command_text_for_id(&guard, command_id))
        .or_else(|| {
            latest
                .as_ref()
                .and_then(|record| string_field(record, "commandText"))
        });
    let output_text_end = file_size(&guard.paths.output_text_path);
    let raw_output_end = file_size(&guard.paths.raw_output_path);
    let output_text_start = guard
        .active_command_output_text_start
        .unwrap_or(output_text_end)
        .min(output_text_end);
    let raw_output_start = guard
        .active_command_raw_start
        .unwrap_or(raw_output_end)
        .min(raw_output_end);
    let seq = guard.next_seq;
    guard.next_seq = guard.next_seq.saturating_add(1);
    let created_at = now_iso();
    let base_correlation = latest
        .as_ref()
        .and_then(|record| record.get("correlation"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let correlation = merge_object(
        base_correlation,
        command_id
            .as_ref()
            .map(|value| json!({ "commandId": value }))
            .unwrap_or_else(|| json!({})),
    );
    let event = json!({
        "eventId": format!("terminal-event-{}", Uuid::new_v4()),
        "terminalSessionId": context.session_id,
        "seq": seq,
        "kind": "process_exited",
        "actor": { "kind": "process" },
        "correlation": correlation.clone(),
        "payload": { "exitCode": exit_code },
        "createdAt": created_at,
        "createdAtMs": now_ms(),
        "visibility": "user_visible",
        "modelContextPolicy": "include_as_runtime_state",
        "uiPolicy": "show_as_status",
        "auditPolicy": "full"
    });
    append_json_line(&guard.paths.events_path, &event)?;
    append_event_index(&guard.paths, &event)?;
    let stored =
        stored_event_from_record(&event).ok_or_else(|| "invalid exit event".to_string())?;
    append_timeline_item_for_event(&stored, &mut guard)?;
    guard.latest_event_kind = Some("process_exited".to_string());
    flush_pending_output_line(&context.session_id, &mut guard, seq, &created_at)?;
    append_process_record(
        &context.session_id,
        &guard,
        guard.active_process_id,
        if exit_code == 0 { "exited" } else { "failed" },
        json!({
            "exitCode": exit_code,
            "exitedAt": created_at
        }),
    )?;
    guard.active_process_id = None;
    let mut completion = None;
    if let Some(command_id) = command_id {
        let status = if exit_code == 0 {
            "completed"
        } else {
            "failed"
        };
        let artifact_paths = command_artifact_paths(&guard, &command_id);
        let artifact_metadata = command_artifact_metadata(&artifact_paths);
        let completed_at = now_iso();
        append_command_record(
            &mut guard,
            merge_object(
                json!({
                    "commandId": command_id.clone(),
                    "terminalSessionId": context.session_id,
                    "commandText": command_text.clone(),
                    "normalizedCommandText": command_text.as_deref().map(str::trim),
                    "status": status,
                    "exitCode": exit_code,
                    "signal": null,
                    "outputTextRange": { "start": output_text_start, "end": output_text_end },
                    "rawOutputRange": { "start": raw_output_start, "end": raw_output_end },
                    "completedAt": completed_at.clone(),
                    "correlation": correlation.clone(),
                    "confidence": 0.6
                }),
                artifact_metadata.clone(),
            ),
        )?;
        append_command_lifecycle_event(
            &context.session_id,
            &mut guard,
            "command_completed",
            &command_id,
            command_text.as_deref(),
            json!({ "kind": "process" }),
            correlation.clone(),
            merge_object(
                json!({
                    "status": status,
                    "exitCode": exit_code,
                    "outputTextRange": { "start": output_text_start, "end": output_text_end },
                    "rawOutputRange": { "start": raw_output_start, "end": raw_output_end }
                }),
                artifact_metadata.clone(),
            ),
        )?;
        completion = Some(write_command_artifacts(
            &context.session_id,
            &guard,
            &command_id,
            command_text.as_deref(),
            status,
            Some(exit_code),
            None,
            &json!({ "kind": "process" }),
            &correlation,
            output_text_start,
            output_text_end,
            raw_output_start,
            raw_output_end,
            &completed_at,
        )?);
        guard.active_command_id = None;
        guard.active_command_output_text_start = None;
        guard.active_command_raw_start = None;
    }
    write_summary(&context.session_id, &guard, false)?;
    Ok(completion)
}

pub fn record_error(context: &MemoryContext, error: &str) -> MemoryResult<()> {
    let state = initialize_state(&context.storage_root, &context.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    append_event(
        &context.session_id,
        &mut guard,
        "terminal_error",
        json!({ "kind": "terminal_kernel" }),
        json!({ "error": error }),
        json!({}),
        "include_as_runtime_state",
        "show_as_status",
    )?;
    Ok(())
}

pub fn read_timeline(input: TimelineReadInput) -> MemoryResult<String> {
    let state = initialize_state(&input.storage_root, &input.session_id)?;
    let mut guard = state
        .lock()
        .map_err(|_| "failed to lock terminal memory state".to_string())?;
    let event_end = guard.next_seq.saturating_sub(1);
    let last_timeline_seq = read_last_jsonl(&guard.paths.ui_timeline_path)
        .and_then(|record| number_field(&record, "seq"))
        .unwrap_or(0);
    if event_end > 0 && (guard.timeline_item_count == 0 || last_timeline_seq < event_end) {
        rebuild_timeline_projection(&input.session_id, &mut guard)?;
    }

    let limit = input
        .limit
        .map(|value| value.max(1) as usize)
        .unwrap_or(DEFAULT_TIMELINE_LIMIT)
        .min(MAX_TIMELINE_LIMIT);
    let cursor_seq = input
        .cursor
        .as_deref()
        .and_then(|value| value.trim().parse::<u64>().ok());
    let kind_filter = input
        .kinds
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let actor_filter = input
        .actors
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let command_id_filter = optional_trimmed(input.command_id);
    let tool_call_id_filter = optional_trimmed(input.tool_call_id);
    let agent_session_id_filter = optional_trimmed(input.agent_session_id);
    let mut all_items = read_jsonl_with_repair_log(
        &guard.paths.ui_timeline_path,
        Some(&guard.paths.repair_log_path),
    )
    .into_iter()
    .filter(|item| {
        kind_filter.is_empty()
            || string_field(item, "kind").is_some_and(|kind| kind_filter.contains(&kind))
    })
    .filter(|item| {
        actor_filter.is_empty()
            || string_field(item, "actorKind").is_some_and(|actor| actor_filter.contains(&actor))
    })
    .filter(|item| {
        command_id_filter
            .as_ref()
            .is_none_or(|value| string_field(item, "commandId").as_ref() == Some(value))
    })
    .filter(|item| {
        tool_call_id_filter
            .as_ref()
            .is_none_or(|value| string_field(item, "toolCallId").as_ref() == Some(value))
    })
    .filter(|item| {
        agent_session_id_filter
            .as_ref()
            .is_none_or(|value| string_field(item, "agentSessionId").as_ref() == Some(value))
    })
    .filter(|item| cursor_seq.is_none_or(|cursor| number_field(item, "seq").unwrap_or(0) < cursor))
    .filter(|item| {
        input
            .seq_start
            .is_none_or(|start| number_field(item, "seq").unwrap_or(0) >= start)
    })
    .filter(|item| {
        input
            .seq_end
            .is_none_or(|end| number_field(item, "seq").unwrap_or(0) <= end)
    })
    .filter(|item| {
        input.time_start_ms.is_none_or(|start| {
            item.get("createdAtMs")
                .and_then(Value::as_i64)
                .or_else(|| {
                    string_field(item, "createdAt")
                        .and_then(|created_at| {
                            chrono::DateTime::parse_from_rfc3339(&created_at).ok()
                        })
                        .map(|created_at| created_at.timestamp_millis())
                })
                .unwrap_or(0)
                >= start
        })
    })
    .filter(|item| {
        input.time_end_ms.is_none_or(|end| {
            item.get("createdAtMs")
                .and_then(Value::as_i64)
                .or_else(|| {
                    string_field(item, "createdAt")
                        .and_then(|created_at| {
                            chrono::DateTime::parse_from_rfc3339(&created_at).ok()
                        })
                        .map(|created_at| created_at.timestamp_millis())
                })
                .unwrap_or(0)
                <= end
        })
    })
    .collect::<Vec<_>>();
    all_items.sort_by_key(|item| number_field(item, "seq").unwrap_or(0));
    let selected_start = all_items.len().saturating_sub(limit);
    let has_more = selected_start > 0;
    let mut selected = all_items.split_off(selected_start);
    for item in &mut selected {
        if let Some(object) = item.as_object_mut() {
            object.remove("itemIndex");
        }
    }
    let next_cursor = if has_more {
        selected
            .first()
            .and_then(|item| number_field(item, "seq"))
            .map(|seq| seq.to_string())
    } else {
        None
    };
    let memory = metadata_from_state(&guard, false);
    let response = json!({
        "sessionId": input.session_id,
        "cursor": input.cursor,
        "nextCursor": next_cursor,
        "hasMore": has_more,
        "summary": timeline_summary(&input.session_id, &guard),
        "memory": memory,
        "items": selected
    });
    let response_text = serde_json::to_string(&response).map_err(|error| error.to_string())?;
    drop(guard);
    if input.audit.unwrap_or(false) {
        let _ = record_audit_read(
            &input.storage_root,
            &input.session_id,
            "terminal.memory.readTimeline",
            json!({
                "cursor": input.cursor,
                "nextCursor": next_cursor,
                "limit": limit,
                "kinds": kind_filter,
                "actors": actor_filter,
                "commandId": command_id_filter,
                "toolCallId": tool_call_id_filter,
                "agentSessionId": agent_session_id_filter,
                "seqStart": input.seq_start,
                "seqEnd": input.seq_end,
                "timeStartMs": input.time_start_ms,
                "timeEndMs": input.time_end_ms
            }),
            input.actor_json.as_deref(),
            input.correlation_json.as_deref(),
        );
    }
    Ok(response_text)
}

#[cfg(test)]
mod tests {
    use super::{
        list_artifacts, mark_output_policy, metadata_for_session, read_commands, read_events,
        read_output_projection, read_output_range, read_stored_sessions, read_timeline,
        record_close, record_exit, record_handoff_completed, record_handoff_started, record_output,
        record_permission_granted, record_permission_requested, record_process_started,
        record_resize, record_session_created, record_shell_integration_event, record_write,
        replay_screen_snapshot, ArtifactsListInput, CloseInput, CommandsReadInput, EventsReadInput,
        HandoffEventInput, MemoryContext, OutputPolicyMarkerInput, OutputRangeReadInput,
        PermissionEventInput, ProcessStartedInput, ResizeInput, SessionCreatedInput,
        TimelineReadInput, WriteInput,
    };
    use crate::shell_integration::{ShellIntegrationEvent, ShellIntegrationEventKind};
    use serde_json::{json, Value};
    use std::fs;
    use std::io::Write as _;

    fn temp_root(name: &str) -> String {
        let root = std::env::temp_dir().join(format!(
            "lyra-terminal-memory-rust-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root.to_string_lossy().to_string()
    }

    fn create_input(root: &str, session_id: &str) -> SessionCreatedInput {
        SessionCreatedInput {
            storage_root: root.to_string(),
            session_id: session_id.to_string(),
            title: "Terminal".to_string(),
            cwd: Some("/workspace".to_string()),
            shell: "/bin/zsh".to_string(),
            cols: 80,
            rows: 24,
            source: "user".to_string(),
            mode: "shell".to_string(),
            command: None,
            persist: true,
            actor_json: None,
            correlation_json: None,
        }
    }

    fn jsonl(path: &str) -> Vec<Value> {
        fs::read_to_string(path)
            .expect("read jsonl")
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| serde_json::from_str(line).expect("parse json"))
            .collect()
    }

    #[test]
    fn terminal_memory_records_output_indexes_and_timeline() {
        let root = temp_root("output");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        let context = MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        };
        record_output(&context, b"hello\r\n").expect("record output");
        record_output(&context, "\x1b[31mred\x1b[0m\nError: boom".as_bytes())
            .expect("record output");
        record_exit(&context, 1).expect("record exit");

        let memory: Value = serde_json::from_str(
            &metadata_for_session(&root, &session_id, false).expect("metadata"),
        )
        .expect("parse metadata");
        assert_eq!(
            fs::read_to_string(memory["rawOutputPath"].as_str().expect("raw path"))
                .expect("raw output"),
            "hello\r\n\x1b[31mred\x1b[0m\nError: boom"
        );
        assert_eq!(
            fs::read_to_string(memory["outputTextPath"].as_str().expect("text path"))
                .expect("text output"),
            "hello\nred\nError: boom"
        );
        assert_eq!(memory["lineCount"], 3);
        assert_eq!(memory["errorCount"], 1);
        assert_eq!(memory["latestOutputPreview"], "Error: boom");

        let events = jsonl(memory["eventLogPath"].as_str().expect("event path"));
        let kinds = events
            .iter()
            .map(|event| event["kind"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();
        assert_eq!(
            kinds,
            vec![
                "session_created",
                "output_chunk",
                "output_chunk",
                "process_exited"
            ]
        );
        assert_eq!(events[1]["payload"]["rawOffset"], 0);
        assert_eq!(events[2]["payload"]["textPreview"], "red Error: boom");

        let lines = jsonl(memory["lineIndexPath"].as_str().expect("line path"));
        assert_eq!(lines[2]["outputEventSeq"], 4);
        let errors = jsonl(memory["errorIndexPath"].as_str().expect("error path"));
        assert_eq!(errors.len(), 1);

        let timeline: Value = serde_json::from_str(
            &read_timeline(TimelineReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: None,
                limit: Some(10),
                kinds: None,
                actors: None,
                command_id: None,
                tool_call_id: None,
                agent_session_id: None,
                seq_start: None,
                seq_end: None,
                time_start_ms: None,
                time_end_ms: None,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("timeline"),
        )
        .expect("parse timeline");
        assert_eq!(timeline["items"].as_array().expect("items").len(), 4);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn terminal_memory_records_agent_command_correlation() {
        let root = temp_root("agent");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        record_write(WriteInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            data: None,
            text: Some("npm test".to_string()),
            keys: None,
            append_newline: true,
            source: Some("agent".to_string()),
            actor_json: Some(
                json!({
                    "kind": "agent",
                    "agentSessionId": "agent-1",
                    "runtimeTurnId": "turn-1",
                    "toolCallId": "tool-1"
                })
                .to_string(),
            ),
            correlation_json: Some(
                json!({
                    "agentSessionId": "agent-1",
                    "runtimeTurnId": "turn-1",
                    "toolCallId": "tool-1",
                    "terminalToolName": "terminal.write",
                    "commandId": "command-1"
                })
                .to_string(),
            ),
        })
        .expect("record write");
        record_close(CloseInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
            correlation_json: Some(
                json!({ "agentSessionId": "agent-1", "terminalToolName": "terminal.close" })
                    .to_string(),
            ),
        })
        .expect("record close");

        let memory: Value = serde_json::from_str(
            &metadata_for_session(&root, &session_id, false).expect("metadata"),
        )
        .expect("parse metadata");
        let events = jsonl(memory["eventLogPath"].as_str().expect("event path"));
        assert_eq!(events[1]["kind"], "input_text");
        assert_eq!(events[1]["actor"]["kind"], "agent");
        assert_eq!(events[1]["correlation"]["commandId"], "command-1");
        assert_eq!(events[2]["kind"], "command_submitted");
        assert_eq!(events[3]["kind"], "command_started");
        assert!(events.iter().any(|event| event["kind"] == "session_closed"));
        assert!(events.iter().any(|event| event["kind"] == "agent_detached"));
        let commands = jsonl(memory["commandsPath"].as_str().expect("commands path"));
        assert_eq!(commands[0]["commandText"], "npm test");
        assert_eq!(commands[0]["status"], "running");
        let attachments = jsonl(
            memory["attachmentsPath"]
                .as_str()
                .expect("attachments path"),
        );
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0]["status"], "detached");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn terminal_events_read_paginates_and_filters() {
        let root = temp_root("events-read");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        record_write(WriteInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            data: None,
            text: Some("cargo test".to_string()),
            keys: None,
            append_newline: true,
            source: Some("agent".to_string()),
            actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
            correlation_json: Some(
                json!({ "agentSessionId": "agent-1", "terminalToolName": "terminal.write" })
                    .to_string(),
            ),
        })
        .expect("record write");
        let context = MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        };
        record_output(&context, b"ok\n").expect("record output");
        record_resize(ResizeInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cols: 100,
            rows: 30,
            actor_json: None,
            correlation_json: None,
        })
        .expect("record resize");
        record_exit(&context, 0).expect("record exit");

        let first_page: Value = serde_json::from_str(
            &read_events(EventsReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: None,
                limit: Some(2),
                kinds: None,
                actors: None,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("events"),
        )
        .expect("parse events");
        let first_items = first_page["items"].as_array().expect("items");
        assert_eq!(first_page["cursor"], "0");
        assert_eq!(first_page["nextCursor"], "2");
        assert_eq!(first_page["hasMore"], true);
        assert_eq!(first_items.len(), 2);
        assert_eq!(first_items[0]["kind"], "session_created");
        assert_eq!(first_items[1]["kind"], "input_text");

        let second_page: Value = serde_json::from_str(
            &read_events(EventsReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: Some("2".to_string()),
                limit: Some(10),
                kinds: None,
                actors: None,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("events"),
        )
        .expect("parse events");
        let second_items = second_page["items"].as_array().expect("items");
        assert_eq!(second_page["nextCursor"], "8");
        assert_eq!(second_page["hasMore"], false);
        assert_eq!(
            second_items
                .iter()
                .map(|item| item["kind"].as_str().unwrap_or_default())
                .collect::<Vec<_>>(),
            vec![
                "command_submitted",
                "command_started",
                "output_chunk",
                "input_resize",
                "process_exited",
                "command_completed"
            ]
        );

        let output_events: Value = serde_json::from_str(
            &read_events(EventsReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: Some("not-a-cursor".to_string()),
                limit: Some(10),
                kinds: Some(vec!["output_chunk".to_string()]),
                actors: Some(vec!["process".to_string()]),
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("events"),
        )
        .expect("parse events");
        let output_items = output_events["items"].as_array().expect("items");
        assert_eq!(output_events["cursor"], "0");
        assert_eq!(output_items.len(), 1);
        assert_eq!(output_items[0]["kind"], "output_chunk");
        assert_eq!(output_items[0]["actor"]["kind"], "process");

        let agent_events: Value = serde_json::from_str(
            &read_events(EventsReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: None,
                limit: Some(10),
                kinds: None,
                actors: Some(vec!["agent".to_string()]),
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("events"),
        )
        .expect("parse events");
        let agent_items = agent_events["items"].as_array().expect("items");
        assert_eq!(agent_items.len(), 3);
        assert_eq!(agent_items[0]["kind"], "input_text");
        assert_eq!(agent_items[1]["kind"], "command_submitted");
        assert_eq!(agent_items[2]["kind"], "command_started");
        assert_eq!(
            agent_items[0]["correlation"]["terminalToolName"],
            "terminal.write"
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn terminal_commands_read_paginates_and_filters_status() {
        let root = temp_root("commands-read");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        record_write(WriteInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            data: None,
            text: Some("cargo test".to_string()),
            keys: None,
            append_newline: true,
            source: Some("agent".to_string()),
            actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
            correlation_json: Some(
                json!({
                    "agentSessionId": "agent-1",
                    "terminalToolName": "terminal.write",
                    "commandId": "command-1"
                })
                .to_string(),
            ),
        })
        .expect("record write");
        record_exit(
            &MemoryContext {
                storage_root: root.clone(),
                session_id: session_id.clone(),
            },
            0,
        )
        .expect("record exit");

        let first_page: Value = serde_json::from_str(
            &read_commands(CommandsReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: None,
                limit: Some(1),
                status: None,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("commands"),
        )
        .expect("parse commands");
        let first_items = first_page["items"].as_array().expect("items");
        assert_eq!(first_page["cursor"], "0");
        assert_eq!(first_page["nextCursor"], "1");
        assert_eq!(first_page["hasMore"], true);
        assert_eq!(first_items.len(), 1);
        assert_eq!(first_items[0]["commandSeq"], 1);
        assert_eq!(first_items[0]["status"], "running");
        assert_eq!(first_items[0]["commandId"], "command-1");

        let second_page: Value = serde_json::from_str(
            &read_commands(CommandsReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: Some("1".to_string()),
                limit: Some(10),
                status: None,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("commands"),
        )
        .expect("parse commands");
        let second_items = second_page["items"].as_array().expect("items");
        assert_eq!(second_page["nextCursor"], "2");
        assert_eq!(second_page["hasMore"], false);
        assert_eq!(second_items.len(), 1);
        assert_eq!(second_items[0]["status"], "completed");
        assert_eq!(second_items[0]["exitCode"], 0);

        let completed_only: Value = serde_json::from_str(
            &read_commands(CommandsReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: Some("not-a-cursor".to_string()),
                limit: Some(10),
                status: Some("completed".to_string()),
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("commands"),
        )
        .expect("parse commands");
        let completed_items = completed_only["items"].as_array().expect("items");
        assert_eq!(completed_only["cursor"], "0");
        assert_eq!(completed_items.len(), 1);
        assert_eq!(completed_items[0]["commandSeq"], 2);
        assert_eq!(completed_items[0]["commandId"], "command-1");

        let command_timeline: Value = serde_json::from_str(
            &read_timeline(TimelineReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: None,
                limit: Some(10),
                kinds: None,
                actors: None,
                command_id: Some("command-1".to_string()),
                tool_call_id: None,
                agent_session_id: Some("agent-1".to_string()),
                seq_start: Some(2),
                seq_end: None,
                time_start_ms: None,
                time_end_ms: None,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("timeline"),
        )
        .expect("parse timeline");
        let timeline_items = command_timeline["items"].as_array().expect("items");
        assert_eq!(
            timeline_items
                .iter()
                .map(|item| item["kind"].as_str().unwrap_or_default())
                .collect::<Vec<_>>(),
            vec![
                "input_text",
                "command_submitted",
                "command_started",
                "process_exited",
                "command_completed"
            ]
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn shell_integration_command_end_completes_active_command() {
        let root = temp_root("shell-command-end");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        record_write(WriteInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            data: None,
            text: Some("printf done".to_string()),
            keys: None,
            append_newline: true,
            source: Some("agent".to_string()),
            actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
            correlation_json: Some(
                json!({
                    "agentSessionId": "agent-1",
                    "terminalToolName": "terminal.write",
                    "commandId": "command-shell-1"
                })
                .to_string(),
            ),
        })
        .expect("record write");
        let context = MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        };
        record_output(&context, b"done\n").expect("record output");
        record_shell_integration_event(
            &context,
            &ShellIntegrationEvent {
                kind: ShellIntegrationEventKind::CommandEnd,
                raw: "133;D;0".to_string(),
                command_id: None,
                command: None,
                cwd: None,
                exit_code: Some(0),
                signal: None,
                confidence: 1.0,
            },
        )
        .expect("record shell command end");

        let commands: Value = serde_json::from_str(
            &read_commands(CommandsReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: None,
                limit: Some(10),
                status: Some("completed".to_string()),
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("commands"),
        )
        .expect("parse commands");
        let items = commands["items"].as_array().expect("items");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["commandId"], "command-shell-1");
        assert_eq!(items[0]["exitCode"], 0);
        assert_eq!(items[0]["outputTextRange"]["end"], 5);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn command_completion_writes_command_artifact_files_without_breaking_session_output() {
        let root = temp_root("command-artifacts");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        record_write(WriteInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            data: None,
            text: Some("printf one".to_string()),
            keys: None,
            append_newline: true,
            source: Some("agent".to_string()),
            actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
            correlation_json: Some(
                json!({
                    "agentSessionId": "agent-1",
                    "runtimeTurnId": "turn-1",
                    "toolCallId": "tool-1",
                    "terminalToolName": "terminal.write",
                    "commandId": "command-1"
                })
                .to_string(),
            ),
        })
        .expect("record write");
        let context = MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        };
        record_output(&context, b"one\n").expect("record output");
        let completion = record_shell_integration_event(
            &context,
            &ShellIntegrationEvent {
                kind: ShellIntegrationEventKind::CommandEnd,
                raw: "133;D;0".to_string(),
                command_id: None,
                command: None,
                cwd: None,
                exit_code: Some(0),
                signal: None,
                confidence: 1.0,
            },
        )
        .expect("record shell command end")
        .expect("completion projection");

        assert_eq!(completion.command_id, "command-1");
        assert_eq!(completion.status, "completed");
        assert_eq!(completion.exit_code, Some(0));
        assert_eq!(completion.correlation["agentSessionId"], "agent-1");
        assert_eq!(
            fs::read_to_string(&completion.command_output_text_path).expect("command text"),
            "one\n"
        );
        assert_eq!(
            fs::read(&completion.command_raw_output_path).expect("command raw"),
            b"one\n"
        );
        let command_events = jsonl(&completion.command_events_path);
        assert!(command_events
            .iter()
            .any(|event| event["kind"] == "output_chunk"));
        assert!(command_events
            .iter()
            .any(|event| event["kind"] == "command_completed"));

        let meta: Value = serde_json::from_str(
            &fs::read_to_string(&completion.command_meta_path).expect("read command meta"),
        )
        .expect("parse command meta");
        assert_eq!(meta["commandId"], "command-1");
        assert_eq!(
            meta["commandOutputTextPath"],
            completion.command_output_text_path
        );

        let summary: Value = serde_json::from_str(
            &fs::read_to_string(&completion.command_summary_path).expect("read command summary"),
        )
        .expect("parse command summary");
        assert_eq!(summary["firstOutputPreview"], "one");
        assert_eq!(summary["eventCount"], command_events.len() as u64);

        let memory: Value = serde_json::from_str(
            &metadata_for_session(&root, &session_id, false).expect("metadata"),
        )
        .expect("parse metadata");
        assert!(memory["commandArtifactsRootPath"]
            .as_str()
            .expect("command artifact root")
            .ends_with("/commands"));
        assert_eq!(
            fs::read_to_string(memory["outputTextPath"].as_str().expect("session output"))
                .expect("session output"),
            "one\n"
        );
        let commands = jsonl(memory["commandsPath"].as_str().expect("commands path"));
        let completed = commands
            .iter()
            .find(|command| command["status"] == "completed")
            .expect("completed command");
        assert_eq!(
            completed["commandOutputTextPath"],
            completion.command_output_text_path
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn empty_shell_command_start_does_not_create_command_or_artifact() {
        let root = temp_root("empty-command");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        let context = MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        };
        let completion = record_shell_integration_event(
            &context,
            &ShellIntegrationEvent {
                kind: ShellIntegrationEventKind::CommandStart,
                raw: "133;C;command=".to_string(),
                command_id: None,
                command: Some("   ".to_string()),
                cwd: None,
                exit_code: None,
                signal: None,
                confidence: 1.0,
            },
        )
        .expect("record empty command");
        assert!(completion.is_none());

        let memory: Value = serde_json::from_str(
            &metadata_for_session(&root, &session_id, false).expect("metadata"),
        )
        .expect("parse metadata");
        let commands = jsonl(memory["commandsPath"].as_str().expect("commands path"));
        assert!(commands.is_empty());
        let command_root = memory["commandArtifactsRootPath"]
            .as_str()
            .expect("command artifacts root");
        let child_count = fs::read_dir(command_root)
            .expect("read command root")
            .count();
        assert_eq!(child_count, 0);
        let events = jsonl(memory["eventLogPath"].as_str().expect("events path"));
        assert!(events.iter().any(|event| {
            event["kind"] == "shell_integration"
                && event["payload"]["ignoredReason"] == "empty_command"
        }));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn terminal_output_read_range_reads_text_and_raw_artifacts() {
        let root = temp_root("output-range");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        let context = MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        };
        record_output(&context, b"hello\n").expect("record output");
        record_output(&context, "\x1b[31mred\x1b[0m\n".as_bytes()).expect("record output");

        let text_range: Value = serde_json::from_str(
            &read_output_range(OutputRangeReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                start: 6,
                end: 9,
                raw: false,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("text range"),
        )
        .expect("parse text range");
        assert_eq!(text_range["raw"], false);
        assert_eq!(text_range["encoding"], "utf8");
        assert_eq!(text_range["output"], "red");
        assert_eq!(text_range["range"]["start"], 6);
        assert_eq!(text_range["range"]["end"], 9);
        assert_eq!(text_range["nextStart"], 9);
        assert_eq!(text_range["totalBytes"], 10);
        assert_eq!(text_range["truncated"], false);
        assert_eq!(
            text_range["memory"]["outputTextPath"]
                .as_str()
                .expect("output path")
                .ends_with("session-output.txt"),
            true
        );

        let raw_range: Value = serde_json::from_str(
            &read_output_range(OutputRangeReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                start: 6,
                end: 14,
                raw: true,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("raw range"),
        )
        .expect("parse raw range");
        assert_eq!(raw_range["raw"], true);
        assert_eq!(raw_range["encoding"], "utf8-lossy");
        assert_eq!(raw_range["output"], "\x1b[31mred");
        assert_eq!(raw_range["range"]["start"], 6);
        assert_eq!(raw_range["range"]["end"], 14);
        assert_eq!(raw_range["byteLength"], 8);

        let empty_range: Value = serde_json::from_str(
            &read_output_range(OutputRangeReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                start: 100,
                end: 50,
                raw: false,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("empty range"),
        )
        .expect("parse empty range");
        assert_eq!(empty_range["output"], "");
        assert_eq!(empty_range["range"]["start"], 10);
        assert_eq!(empty_range["range"]["end"], 10);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn terminal_artifacts_processes_and_command_ranges_are_kernel_managed() {
        let root = temp_root("artifacts-process");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        record_process_started(ProcessStartedInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            process_id: Some(4242),
            shell: "/bin/zsh".to_string(),
            cwd: Some("/workspace".to_string()),
            command: None,
            mode: "shell".to_string(),
            source: "user".to_string(),
            cols: 80,
            rows: 24,
            actor_json: None,
            correlation_json: None,
        })
        .expect("record process");
        record_write(WriteInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            data: None,
            text: Some("echo hi".to_string()),
            keys: None,
            append_newline: true,
            source: Some("agent".to_string()),
            actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
            correlation_json: Some(
                json!({
                    "agentSessionId": "agent-1",
                    "terminalToolName": "terminal.write",
                    "commandId": "command-1"
                })
                .to_string(),
            ),
        })
        .expect("record write");
        let context = MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        };
        record_output(&context, b"hi\n").expect("record output");
        record_exit(&context, 0).expect("record exit");

        let artifacts: Value = serde_json::from_str(
            &list_artifacts(ArtifactsListInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("artifacts"),
        )
        .expect("parse artifacts");
        let artifact_labels = artifacts["items"]
            .as_array()
            .expect("items")
            .iter()
            .map(|item| item["label"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();
        assert!(artifact_labels.contains(&"session-output.summary.json"));
        assert!(artifact_labels.contains(&"processes.jsonl"));
        assert!(artifact_labels.contains(&"screen-diffs.jsonl"));
        assert!(artifact_labels.contains(&"retention.json"));

        let memory = &artifacts["memory"];
        let output_summary: Value = serde_json::from_str(
            &fs::read_to_string(memory["outputSummaryPath"].as_str().expect("summary path"))
                .expect("read output summary"),
        )
        .expect("parse output summary");
        assert_eq!(output_summary["projectionRecommendation"], "inline");
        assert_eq!(output_summary["commands"][0]["commandId"], "command-1");
        assert_eq!(output_summary["commands"][0]["outputTextRange"]["start"], 0);
        assert_eq!(output_summary["commands"][0]["outputTextRange"]["end"], 3);
        assert_eq!(output_summary["commands"][0]["firstOutputPreview"], "hi");
        assert_eq!(output_summary["commands"][0]["lastOutputPreview"], "hi");
        assert_eq!(output_summary["commands"][0]["lastErrorLines"], json!([]));
        assert_eq!(output_summary["commands"][0]["estimatedTokens"], 1);
        let lines = jsonl(memory["lineIndexPath"].as_str().expect("line path"));
        assert_eq!(lines[0]["commandId"], "command-1");

        let processes = jsonl(memory["processesPath"].as_str().expect("processes path"));
        assert_eq!(processes[0]["status"], "running");
        assert_eq!(processes[1]["status"], "exited");

        let events = jsonl(memory["eventLogPath"].as_str().expect("events path"));
        let kinds = events
            .iter()
            .map(|event| event["kind"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();
        assert!(kinds.contains(&"process_started"));
        assert!(kinds.contains(&"process_tree_snapshot"));
        assert!(kinds.contains(&"command_completed"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn terminal_memory_skips_corrupt_jsonl_lines_and_records_repair_warning() {
        let root = temp_root("corrupt-events");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        let memory: Value = serde_json::from_str(
            &metadata_for_session(&root, &session_id, false).expect("metadata"),
        )
        .expect("parse metadata");
        let event_path = memory["eventLogPath"].as_str().expect("event path");
        let mut events_file = fs::OpenOptions::new()
            .append(true)
            .open(event_path)
            .expect("open events");
        writeln!(events_file, "{{ this is not json").expect("write corrupt line");

        let events: Value = serde_json::from_str(
            &read_events(EventsReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: None,
                limit: Some(10),
                kinds: None,
                actors: None,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("events"),
        )
        .expect("parse events");
        assert_eq!(events["items"].as_array().expect("items").len(), 1);
        let repairs = jsonl(memory["repairLogPath"].as_str().expect("repair path"));
        assert_eq!(repairs[0]["warning"], "corrupt_jsonl_line_skipped");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn output_projection_reads_large_artifact_by_range_and_clamps_utf8_cursor() {
        let root = temp_root("large-projection");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        let memory: Value = serde_json::from_str(
            &metadata_for_session(&root, &session_id, false).expect("metadata"),
        )
        .expect("parse metadata");
        let output_path = memory["outputTextPath"].as_str().expect("output path");
        let mut large = "éclair\n".repeat(1024);
        large.push_str(&"x".repeat(2 * 1024 * 1024));
        fs::write(output_path, large).expect("write large output");

        let first =
            read_output_projection(&root, &session_id, 0, 8).expect("read first projection");
        assert_eq!(first.output, "éclair\n");
        assert_eq!(first.cursor, 8);
        assert!(first.truncated);

        let clamped =
            read_output_projection(&root, &session_id, 1, 8).expect("read clamped projection");
        assert_eq!(clamped.output, "éclair\n");
        assert_eq!(clamped.cursor, 8);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn output_projection_reads_100mb_fixture_without_loading_full_file() {
        let root = temp_root("large-100mb");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        let paths = super::paths_for_session(&root, &session_id);
        fs::create_dir_all(paths.output_text_path.parent().expect("output parent"))
            .expect("create output dir");
        let file = fs::File::create(&paths.output_text_path).expect("create sparse output");
        file.set_len(100 * 1024 * 1024).expect("set sparse length");

        let projection =
            read_output_projection(&root, &session_id, 0, 16).expect("read projection");
        assert_eq!(projection.output.len(), 16);
        assert_eq!(projection.cursor, 16);
        assert!(projection.truncated);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn terminal_memory_rebuilds_output_indexes_from_text_artifact() {
        let root = temp_root("rebuild-output-indexes");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        let paths = super::paths_for_session(&root, &session_id);
        fs::create_dir_all(paths.output_text_path.parent().expect("output parent"))
            .expect("create output dir");
        fs::write(&paths.output_text_path, "first\nError: recovered\nlast").expect("write output");

        let memory: Value = serde_json::from_str(
            &metadata_for_session(&root, &session_id, false).expect("metadata"),
        )
        .expect("parse metadata");
        assert_eq!(memory["lineCount"], 3);
        assert_eq!(memory["errorCount"], 1);
        assert_eq!(memory["latestOutputPreview"], "last");
        let lines = jsonl(memory["lineIndexPath"].as_str().expect("line path"));
        assert_eq!(lines[0]["recovered"], true);
        assert_eq!(lines[1]["textPreview"], "Error: recovered");
        let errors = jsonl(memory["errorIndexPath"].as_str().expect("error path"));
        assert_eq!(errors.len(), 1);
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn permission_events_link_to_commands_and_audit_projection_answers_approval() {
        let root = temp_root("permission-audit");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        let permission = PermissionEventInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            permission_id: "permission-1".to_string(),
            action: Some("terminal.write".to_string()),
            risk: Some("shell".to_string()),
            summary: Some("Run npm test".to_string()),
            title: Some("Run shell command".to_string()),
            detail: Some("terminal.write text=npm test".to_string()),
            command_id: Some("command-1".to_string()),
            input_id: Some("input-1".to_string()),
            agent_session_id: Some("agent-1".to_string()),
            runtime_turn_id: Some("turn-1".to_string()),
            tool_call_id: Some("tool-1".to_string()),
            decision: None,
            reason: None,
            expires_at: None,
            actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
            correlation_json: Some(
                json!({
                    "agentSessionId": "agent-1",
                    "runtimeTurnId": "turn-1",
                    "toolCallId": "tool-1",
                    "commandId": "command-1",
                    "inputId": "input-1"
                })
                .to_string(),
            ),
        };
        record_permission_requested(permission.clone()).expect("permission requested");
        record_permission_granted(PermissionEventInput {
            decision: Some("allowed".to_string()),
            actor_json: Some(json!({ "kind": "human_user", "displayName": "Pete" }).to_string()),
            ..permission
        })
        .expect("permission granted");
        record_write(WriteInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            data: None,
            text: Some("npm test".to_string()),
            keys: None,
            append_newline: true,
            source: Some("agent".to_string()),
            actor_json: Some(json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string()),
            correlation_json: Some(
                json!({
                    "agentSessionId": "agent-1",
                    "runtimeTurnId": "turn-1",
                    "toolCallId": "tool-1",
                    "terminalToolName": "terminal.write",
                    "commandId": "command-1",
                    "inputId": "input-1",
                    "permissionId": "permission-1"
                })
                .to_string(),
            ),
        })
        .expect("record write");

        let memory: Value = serde_json::from_str(
            &metadata_for_session(&root, &session_id, false).expect("metadata"),
        )
        .expect("parse metadata");
        let permissions = jsonl(
            memory["permissionsPath"]
                .as_str()
                .expect("permissions path"),
        );
        assert_eq!(permissions.len(), 2);
        assert_eq!(permissions[0]["status"], "pending");
        assert_eq!(permissions[1]["status"], "granted");
        assert_eq!(permissions[1]["commandId"], "command-1");

        let timeline: Value = serde_json::from_str(
            &read_timeline(TimelineReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: None,
                limit: Some(20),
                kinds: None,
                actors: None,
                command_id: Some("command-1".to_string()),
                tool_call_id: Some("tool-1".to_string()),
                agent_session_id: Some("agent-1".to_string()),
                seq_start: None,
                seq_end: None,
                time_start_ms: None,
                time_end_ms: None,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("timeline"),
        )
        .expect("parse timeline");
        let input_item = timeline["items"]
            .as_array()
            .expect("items")
            .iter()
            .find(|item| item["kind"] == "input_text")
            .expect("input item");
        assert_eq!(
            input_item["audit"]["permissionChain"]
                .as_array()
                .expect("permission chain")
                .len(),
            2
        );
        assert_eq!(input_item["audit"]["latestPermission"]["status"], "granted");
        assert!(input_item["audit"]["answer"]
            .as_str()
            .expect("answer")
            .contains("approval: granted"));
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn audit_read_handoff_policy_indexes_and_screen_replay_are_recoverable() {
        let root = temp_root("recovery-audit-policy");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(SessionCreatedInput {
            cols: 12,
            rows: 3,
            ..create_input(&root, &session_id)
        })
        .expect("record create");
        let context = MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        };
        record_output(&context, b"hello\n").expect("record output");
        record_resize(ResizeInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            cols: 20,
            rows: 4,
            actor_json: None,
            correlation_json: None,
        })
        .expect("record resize");
        record_output(&context, b"after").expect("record output");
        record_handoff_started(HandoffEventInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            handoff_id: Some("handoff-1".to_string()),
            from_actor_json: Some(
                json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string(),
            ),
            to_actor_json: Some(json!({ "kind": "human_user" }).to_string()),
            reason: Some("user_takeover".to_string()),
            summary: Some("Agent handed terminal control to user".to_string()),
            status: Some("started".to_string()),
            actor_json: None,
            correlation_json: Some(json!({ "agentSessionId": "agent-1" }).to_string()),
        })
        .expect("handoff started");
        record_handoff_completed(HandoffEventInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            handoff_id: Some("handoff-1".to_string()),
            from_actor_json: Some(
                json!({ "kind": "agent", "agentSessionId": "agent-1" }).to_string(),
            ),
            to_actor_json: Some(json!({ "kind": "human_user" }).to_string()),
            reason: Some("user_takeover".to_string()),
            summary: Some("User accepted terminal control".to_string()),
            status: Some("completed".to_string()),
            actor_json: None,
            correlation_json: Some(json!({ "agentSessionId": "agent-1" }).to_string()),
        })
        .expect("handoff completed");
        mark_output_policy(OutputPolicyMarkerInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            start: 0,
            end: 5,
            policy: "encrypted".to_string(),
            reason: Some("secret".to_string()),
            encrypted_ref: Some("vault://terminal/secret".to_string()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("mark output policy");

        let _ = read_output_range(OutputRangeReadInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            start: 0,
            end: 5,
            raw: false,
            audit: Some(true),
            actor_json: Some(json!({ "kind": "human_user", "displayName": "Auditor" }).to_string()),
            correlation_json: Some(json!({ "investigationId": "audit-1" }).to_string()),
        })
        .expect("audit read");

        let memory: Value = serde_json::from_str(
            &metadata_for_session(&root, &session_id, false).expect("metadata"),
        )
        .expect("parse metadata");
        let events = jsonl(memory["eventLogPath"].as_str().expect("events path"));
        let kinds = events
            .iter()
            .map(|event| event["kind"].as_str().unwrap_or_default())
            .collect::<Vec<_>>();
        assert!(kinds.contains(&"handoff_started"));
        assert!(kinds.contains(&"handoff_completed"));
        assert!(kinds.contains(&"audit_read"));
        assert!(kinds.contains(&"output_policy_marked"));

        let redactions = jsonl(
            memory["outputRedactionsPath"]
                .as_str()
                .expect("redactions path"),
        );
        assert_eq!(redactions[0]["encrypted"], true);
        assert_eq!(redactions[0]["range"]["start"], 0);

        let compaction: Value = serde_json::from_str(
            &fs::read_to_string(
                memory["outputCompactionPath"]
                    .as_str()
                    .expect("compaction path"),
            )
            .expect("read compaction"),
        )
        .expect("parse compaction");
        assert_eq!(
            compaction["coordinateSpace"],
            "original_output_byte_offsets"
        );

        let screen = replay_screen_snapshot(&root, &session_id, false, Some(10), Some(1024))
            .expect("replay screen");
        assert!(screen.visible_text.contains("after"));
        assert_eq!(screen.rows, 4);
        assert_eq!(screen.cols, 20);

        let stored: Value =
            serde_json::from_str(&read_stored_sessions(&root).expect("stored sessions"))
                .expect("parse stored");
        let stored_items = stored["items"].as_array().expect("stored items");
        assert_eq!(stored_items.len(), 1);
        assert_eq!(stored_items[0]["restoration"]["ptyRestorable"], false);
        assert_eq!(stored_items[0]["restoration"]["ptyRecreatable"], true);
        assert_eq!(
            stored_items[0]["restoration"]["liveProcessRestorable"],
            false
        );
        assert_eq!(
            stored_items[0]["restoration"]["liveProcessReconnectable"],
            true
        );
        assert_eq!(
            stored_items[0]["restoration"]["reconnectRequiresLivePtyHost"],
            true
        );

        let index_manifest_path = memory["indexManifestPath"]
            .as_str()
            .expect("index manifest path");
        let index_manifest: Value = serde_json::from_str(
            &fs::read_to_string(index_manifest_path).expect("read index manifest"),
        )
        .expect("parse index manifest");
        assert_eq!(
            index_manifest["decision"]["truthStore"],
            "jsonl_text_artifacts"
        );
        let session_index = jsonl(
            memory["terminalSessionsIndexPath"]
                .as_str()
                .expect("session index path"),
        );
        assert_eq!(session_index[0]["restoreState"]["ptyRestorable"], false);
        assert_eq!(session_index[0]["restoreState"]["ptyRecreatable"], true);
        assert_eq!(
            session_index[0]["restoreState"]["liveProcessRestorable"],
            false
        );
        assert_eq!(
            session_index[0]["restoreState"]["liveProcessReconnectable"],
            true
        );
        assert_eq!(
            session_index[0]["restoreState"]["reconnectRequiresLivePtyHost"],
            true
        );
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn replay_from_events_rebuilds_timeline_output_indexes_and_v2_indexes() {
        let root = temp_root("replay-rebuild");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        record_session_created(create_input(&root, &session_id)).expect("record create");
        let context = MemoryContext {
            storage_root: root.clone(),
            session_id: session_id.clone(),
        };
        record_output(&context, b"first\nError: second\n").expect("record output");
        record_exit(&context, 1).expect("record exit");

        let paths = super::paths_for_session(&root, &session_id);
        let original_events = jsonl(paths.events_path.to_str().expect("event path"));
        fs::remove_file(&paths.ui_timeline_path).expect("remove timeline");
        fs::remove_file(&paths.line_index_path).expect("remove line index");
        fs::remove_file(&paths.error_index_path).expect("remove error index");
        fs::remove_file(&paths.index_manifest_path).expect("remove index manifest");
        fs::remove_file(&paths.index_events_path).expect("remove event index");

        super::rebuild_output_indexes_from_text(&paths, &session_id)
            .expect("rebuild output indexes");
        super::rebuild_index_store_from_paths(&session_id, &paths).expect("rebuild v2 indexes");
        let timeline: Value = serde_json::from_str(
            &read_timeline(TimelineReadInput {
                storage_root: root.clone(),
                session_id: session_id.clone(),
                cursor: None,
                limit: Some(20),
                kinds: None,
                actors: None,
                command_id: None,
                tool_call_id: None,
                agent_session_id: None,
                seq_start: None,
                seq_end: None,
                time_start_ms: None,
                time_end_ms: None,
                audit: None,
                actor_json: None,
                correlation_json: None,
            })
            .expect("timeline"),
        )
        .expect("parse timeline");
        assert_eq!(
            timeline["items"].as_array().expect("items").len(),
            original_events.len()
        );
        let lines = jsonl(paths.line_index_path.to_str().expect("line index path"));
        assert_eq!(lines.len(), 2);
        let errors = jsonl(paths.error_index_path.to_str().expect("error index path"));
        assert_eq!(errors.len(), 1);
        let event_index = jsonl(paths.index_events_path.to_str().expect("event index path"));
        assert_eq!(event_index.len(), original_events.len());
        fs::remove_dir_all(root).ok();
    }
}
