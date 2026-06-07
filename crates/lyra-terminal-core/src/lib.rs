use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(feature = "node-api")]
use napi::bindgen_prelude::*;
#[cfg(feature = "node-api")]
use napi_derive::napi;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use shell::{
    configure_shell_command, configure_shell_environment, make_shell_candidates, shell_exists,
};
use shell_integration::ShellIntegrationEventKind;

pub mod attachments;
pub mod command_tracker;
pub mod input_controller;
mod memory;
mod memory_writer;
pub mod permissions;
pub mod process_model;
mod protocol;
mod screen;
pub mod sensitive_input;
mod shell;
pub mod shell_integration;
pub mod signals;
pub mod terminal_agents;
pub mod tui_act;
pub mod tui_map;

pub use attachments::{
    TerminalAttachmentAttachRequest, TerminalAttachmentAttachResponse,
    TerminalAttachmentDetachRequest, TerminalAttachmentDetachResponse,
    TerminalAttachmentListRequest, TerminalAttachmentListResponse, TerminalAttachmentPauseRequest,
    TerminalAttachmentResumeRequest, TerminalAttachmentSnapshot, TerminalAttachmentWriteRequest,
    TerminalAttachmentWriteResponse,
};
pub use screen::{
    TerminalScreenCell, TerminalScreenCursorPosition, TerminalScreenInputModes, TerminalScreenLink,
    TerminalScreenRegion, TerminalScreenSnapshot, TerminalScreenState, TerminalScreenStyle,
    TerminalScreenVisibleRow,
};
pub use protocol::*;
use memory_writer::{TerminalMemoryTask, TerminalMemoryWriter};
pub use terminal_agents::{
    TerminalAgentLaunchRequest, TerminalAgentLaunchResponse, TerminalAgentRelation,
};
pub use tui_act::{TuiActPlan, TuiActTarget};

#[cfg(not(feature = "node-api"))]
type Result<T> = std::result::Result<T, Error>;

#[cfg(not(feature = "node-api"))]
#[derive(Debug, Clone)]
pub struct Error {
    reason: String,
}

#[cfg(not(feature = "node-api"))]
#[derive(Debug, Clone, Copy)]
pub enum Status {
    InvalidArg,
}

#[cfg(not(feature = "node-api"))]
impl Error {
    pub fn new(_status: Status, reason: String) -> Self {
        Self { reason }
    }
}

#[cfg(not(feature = "node-api"))]
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.reason)
    }
}

#[cfg(not(feature = "node-api"))]
impl std::error::Error for Error {}

const DEFAULT_READ_MAX_BYTES: usize = 8 * 1024;
const DEFAULT_READ_WAIT_MS: u64 = 750;
const MAX_SESSION_BUFFER_BYTES: usize = 256 * 1024;
pub(crate) const MEMORY_WORKER_OUTPUT_BATCH_BYTES: usize = 64 * 1024;

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
static SESSIONS: Lazy<Mutex<HashMap<String, Arc<SessionRuntime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static OBSERVED_SESSIONS: Lazy<Mutex<HashMap<String, Arc<ObservedSessionRuntime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RUST_EVENT_CALLBACK: Lazy<Mutex<Option<RustEventCallback>>> = Lazy::new(|| Mutex::new(None));
static LIVE_ANSI_CSI_RE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"\x1b\[[0-?]*[ -/]*[@-~]").expect("valid CSI regex"));
static LIVE_ANSI_OSC_RE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"\x1b\][^\x07]*(?:\x07|\x1b\\)").expect("valid OSC regex"));

type RustEventCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;
type SessionStateHandle = Arc<(Mutex<SessionOutputState>, Condvar)>;

#[cfg_attr(not(feature = "node-api"), allow(dead_code))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeCommandCompletionEvent {
    terminal_session_id: String,
    command_id: String,
    command_text: Option<String>,
    status: String,
    exit_code: Option<i32>,
    signal: Option<String>,
    actor: Value,
    correlation: Value,
    output_text_range: Value,
    raw_output_range: Value,
    artifact_root_path: String,
    command_meta_path: String,
    command_output_text_path: String,
    command_raw_output_path: String,
    command_events_path: String,
    command_summary_path: String,
    completed_at: String,
}

#[cfg_attr(not(feature = "node-api"), allow(dead_code))]
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeEvent {
    kind: String,
    session_id: String,
    data: Option<String>,
    exit_code: Option<i32>,
    error: Option<String>,
    source: Option<String>,
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    command: Option<NativeCommandCompletionEvent>,
}

struct SessionRuntime {
    session_id: String,
    title: String,
    cwd: Option<String>,
    shell: String,
    cols: u16,
    rows: u16,
    created_at: String,
    source: String,
    mode: String,
    command: Option<String>,
    persist: bool,
    storage_root: Option<String>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    state: SessionStateHandle,
    screen: Arc<Mutex<screen::TerminalScreenState>>,
    memory_writer: Option<TerminalMemoryWriter>,
}

struct ObservedSessionRuntime {
    session_id: String,
    title: String,
    cwd: Option<String>,
    shell: String,
    created_at: String,
    source: String,
    mode: String,
    command: Option<String>,
    persist: bool,
    storage_root: String,
    dimensions: Arc<Mutex<(u16, u16)>>,
    state: SessionStateHandle,
    screen: Arc<Mutex<screen::TerminalScreenState>>,
    shell_parser: Arc<Mutex<shell_integration::ShellIntegrationParser>>,
}

#[derive(Default)]
struct SessionOutputState {
    buffer: Vec<u8>,
    retained_start: u64,
    total_bytes: u64,
    text_buffer: Vec<u8>,
    text_retained_start: u64,
    total_text_bytes: u64,
    text_decoder: Utf8StreamDecoder,
    running: bool,
    exit_code: Option<i32>,
}

#[derive(Default)]
struct Utf8StreamDecoder {
    pending: Vec<u8>,
}

impl Utf8StreamDecoder {
    fn decode(&mut self, chunk: &[u8]) -> String {
        if self.pending.is_empty() {
            return decode_utf8_prefix(chunk, &mut self.pending);
        }
        let mut bytes = Vec::with_capacity(self.pending.len() + chunk.len());
        bytes.extend_from_slice(&self.pending);
        bytes.extend_from_slice(chunk);
        self.pending.clear();
        decode_utf8_prefix(&bytes, &mut self.pending)
    }

    fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            return String::new();
        }
        let text = String::from_utf8_lossy(&self.pending).to_string();
        self.pending.clear();
        text
    }
}

fn decode_utf8_prefix(bytes: &[u8], pending: &mut Vec<u8>) -> String {
    let mut output = String::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        match std::str::from_utf8(&bytes[cursor..]) {
            Ok(valid) => {
                output.push_str(valid);
                break;
            }
            Err(error) => {
                let valid_end = cursor + error.valid_up_to();
                if valid_end > cursor {
                    output.push_str(
                        std::str::from_utf8(&bytes[cursor..valid_end])
                            .expect("valid prefix from UTF-8 error"),
                    );
                }
                match error.error_len() {
                    Some(invalid_len) => {
                        output.push('\u{FFFD}');
                        cursor = valid_end + invalid_len;
                    }
                    None => {
                        pending.extend_from_slice(&bytes[valid_end..]);
                        break;
                    }
                }
            }
        }
    }
    output
}



fn now_iso_like() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|v| v.as_millis())
        .unwrap_or(0);
    format!("{millis}")
}

fn next_session_id() -> String {
    let value = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("terminal-session-{value}")
}

fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn number_to_byte_offset(value: f64) -> u64 {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    value.floor().min(u64::MAX as f64) as u64
}

fn optional_number_to_u64(value: Option<f64>) -> Option<u64> {
    value.map(number_to_byte_offset)
}

fn optional_number_to_i64(value: Option<f64>) -> Option<i64> {
    value.and_then(|value| {
        if !value.is_finite() {
            None
        } else if value <= i64::MIN as f64 {
            Some(i64::MIN)
        } else if value >= i64::MAX as f64 {
            Some(i64::MAX)
        } else {
            Some(value.floor() as i64)
        }
    })
}

fn normalize_source(source: Option<&str>) -> String {
    source
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("user")
        .to_string()
}

fn normalize_mode(request: &TerminalCreateRequest) -> String {
    request
        .mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .or_else(|| {
            request
                .command
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|_| "command".to_string())
        })
        .unwrap_or_else(|| "shell".to_string())
}

fn normalize_observer_mode(mode: Option<&str>, command: Option<&str>) -> String {
    mode.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
        .or_else(|| {
            command
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|_| "command".to_string())
        })
        .unwrap_or_else(|| "shell".to_string())
}

fn normalize_persist(request: &TerminalCreateRequest, source: &str) -> bool {
    request.persist.unwrap_or(source != "ai")
}

fn normalize_observer_persist(persist: Option<bool>, source: &str) -> bool {
    persist.unwrap_or(source != "ai")
}

fn emit_event(event: NativeEvent) {
    if let Ok(guard) = RUST_EVENT_CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            if let Ok(payload) = serde_json::to_string(&event) {
                callback(payload);
            }
        }
    }
}

fn native_command_completion(
    completion: memory::CommandCompletionProjection,
) -> NativeCommandCompletionEvent {
    NativeCommandCompletionEvent {
        terminal_session_id: completion.terminal_session_id,
        command_id: completion.command_id,
        command_text: completion.command_text,
        status: completion.status,
        exit_code: completion.exit_code,
        signal: completion.signal,
        actor: completion.actor,
        correlation: completion.correlation,
        output_text_range: completion.output_text_range,
        raw_output_range: completion.raw_output_range,
        artifact_root_path: completion.artifact_root_path,
        command_meta_path: completion.command_meta_path,
        command_output_text_path: completion.command_output_text_path,
        command_raw_output_path: completion.command_raw_output_path,
        command_events_path: completion.command_events_path,
        command_summary_path: completion.command_summary_path,
        completed_at: completion.completed_at,
    }
}

pub(crate) fn emit_command_completion(
    session_id: &str,
    source: &str,
    mode: &str,
    completion: memory::CommandCompletionProjection,
) {
    let command_id = completion.command_id.clone();
    emit_event(NativeEvent {
        kind: "commandCompleted".to_string(),
        session_id: session_id.to_string(),
        data: None,
        exit_code: completion.exit_code,
        error: None,
        source: Some(source.to_string()),
        mode: Some(mode.to_string()),
        command_id: Some(command_id),
        command: Some(native_command_completion(completion)),
    });
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

fn output_state(runtime: &SessionRuntime) -> Result<std::sync::MutexGuard<'_, SessionOutputState>> {
    runtime
        .state
        .0
        .lock()
        .map_err(|_| to_error("failed to lock session state"))
}

fn snapshot_from_runtime(runtime: &SessionRuntime) -> Result<TerminalSessionSnapshot> {
    let state = output_state(runtime)?;
    Ok(TerminalSessionSnapshot {
        session_id: runtime.session_id.clone(),
        title: runtime.title.clone(),
        cwd: runtime.cwd.clone(),
        shell: runtime.shell.clone(),
        cols: runtime.cols,
        rows: runtime.rows,
        created_at: runtime.created_at.clone(),
        source: runtime.source.clone(),
        mode: runtime.mode.clone(),
        command: runtime.command.clone(),
        persist: runtime.persist,
        running: state.running,
        exit_code: state.exit_code,
    })
}

fn snapshot_from_observed_runtime(
    runtime: &ObservedSessionRuntime,
) -> Result<TerminalSessionSnapshot> {
    let (cols, rows) = runtime
        .dimensions
        .lock()
        .map(|guard| *guard)
        .map_err(|_| to_error("failed to lock observed terminal dimensions"))?;
    let (lock, _) = &*runtime.state;
    let state = lock
        .lock()
        .map_err(|_| to_error("failed to lock observed terminal state"))?;
    Ok(TerminalSessionSnapshot {
        session_id: runtime.session_id.clone(),
        title: runtime.title.clone(),
        cwd: runtime.cwd.clone(),
        shell: runtime.shell.clone(),
        cols,
        rows,
        created_at: runtime.created_at.clone(),
        source: runtime.source.clone(),
        mode: runtime.mode.clone(),
        command: runtime.command.clone(),
        persist: runtime.persist,
        running: state.running,
        exit_code: state.exit_code,
    })
}

fn append_output(state_handle: &SessionStateHandle, data: &[u8]) {
    let (lock, condvar) = &**state_handle;
    if let Ok(mut state) = lock.lock() {
        state.buffer.extend_from_slice(data);
        state.total_bytes = state.total_bytes.saturating_add(data.len() as u64);
        if state.buffer.len() > MAX_SESSION_BUFFER_BYTES {
            let excess = state.buffer.len() - MAX_SESSION_BUFFER_BYTES;
            state.buffer.drain(0..excess);
            state.retained_start = state.retained_start.saturating_add(excess as u64);
        }
        let decoded = state.text_decoder.decode(data);
        let text = strip_live_terminal_control_sequences(&decoded);
        state.text_buffer.extend_from_slice(text.as_bytes());
        state.total_text_bytes = state.total_text_bytes.saturating_add(text.len() as u64);
        if state.text_buffer.len() > MAX_SESSION_BUFFER_BYTES {
            let excess = state.text_buffer.len() - MAX_SESSION_BUFFER_BYTES;
            state.text_buffer.drain(0..excess);
            state.text_retained_start = state.text_retained_start.saturating_add(excess as u64);
        }
        condvar.notify_all();
    }
}

fn strip_live_terminal_control_sequences(text: &str) -> String {
    let without_osc = LIVE_ANSI_OSC_RE.replace_all(text, "");
    LIVE_ANSI_CSI_RE.replace_all(&without_osc, "").to_string()
}

fn live_output_projection(
    state: &SessionOutputState,
    requested_cursor: u64,
    max_bytes: usize,
) -> (u64, String, bool) {
    let available_start = requested_cursor.max(state.text_retained_start);
    let start_offset = available_start
        .saturating_sub(state.text_retained_start)
        .min(state.text_buffer.len() as u64) as usize;
    let end_offset = (start_offset + max_bytes).min(state.text_buffer.len());
    let output = String::from_utf8_lossy(&state.text_buffer[start_offset..end_offset]).to_string();
    let cursor = state.text_retained_start.saturating_add(end_offset as u64);
    let truncated = requested_cursor < state.text_retained_start || cursor < state.total_text_bytes;
    (cursor, output, truncated)
}


fn mark_session_exit(state_handle: &SessionStateHandle, exit_code: i32) {
    let (lock, condvar) = &**state_handle;
    if let Ok(mut state) = lock.lock() {
        state.running = false;
        state.exit_code = Some(exit_code);
        condvar.notify_all();
    }
}

fn run_close_session(session_id: &str) {
    let runtime = if let Ok(mut sessions) = SESSIONS.lock() {
        sessions.remove(session_id)
    } else {
        None
    };

    if let Some(runtime) = runtime {
        if let Ok(state) = output_state(&runtime) {
            if !state.running {
                return;
            }
        }
        if let Ok(mut writer) = runtime.writer.lock() {
            let _ = writer.write_all(&[3_u8]);
            let _ = writer.flush();
        }
        let child = Arc::clone(&runtime.child);
        thread::spawn(move || {
            if let Ok(mut child_guard) = child.lock() {
                let _ = child_guard.kill();
            }
        });
    }
}

fn parse_exit_code(status: portable_pty::ExitStatus) -> i32 {
    if status.success() {
        0
    } else {
        1
    }
}

fn spawn_io_threads(
    session_id: String,
    runtime: Arc<SessionRuntime>,
    mut reader: Box<dyn Read + Send>,
) {
    let session_id_for_reader = session_id.clone();
    let source_for_reader = runtime.source.clone();
    let mode_for_reader = runtime.mode.clone();
    let state_for_reader = Arc::clone(&runtime.state);
    let screen_for_reader = Arc::clone(&runtime.screen);
    let memory_writer_for_reader = runtime.memory_writer.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut shell_parser = shell_integration::ShellIntegrationParser::new();
        let mut event_decoder = Utf8StreamDecoder::default();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let data = event_decoder.finish();
                    if !data.is_empty() {
                        emit_event(NativeEvent {
                            kind: "data".to_string(),
                            session_id: session_id_for_reader.clone(),
                            data: Some(data),
                            exit_code: None,
                            error: None,
                            source: Some(source_for_reader.clone()),
                            mode: Some(mode_for_reader.clone()),
                            command_id: None,
                            command: None,
                        });
                    }
                    break;
                }
                Ok(size) => {
                    let chunk = &buffer[..size];
                    let shell_events = if memory_writer_for_reader.is_some() {
                        shell_parser.feed(chunk)
                    } else {
                        Vec::new()
                    };
                    append_output(&state_for_reader, chunk);
                    let data = event_decoder.decode(chunk);
                    if !data.is_empty() {
                        emit_event(NativeEvent {
                            kind: "data".to_string(),
                            session_id: session_id_for_reader.clone(),
                            data: Some(data),
                            exit_code: None,
                            error: None,
                            source: Some(source_for_reader.clone()),
                            mode: Some(mode_for_reader.clone()),
                            command_id: None,
                            command: None,
                        });
                    }
                    let screen_diff_payload = screen_for_reader
                        .lock()
                        .ok()
                        .map(|mut screen| screen.feed(chunk))
                        .map(|diff| screen::screen_diff_payload(&diff));
                    if let Some(writer) = memory_writer_for_reader.as_ref() {
                        for event in shell_events
                            .iter()
                            .filter(|event| event.kind != ShellIntegrationEventKind::CommandEnd)
                        {
                            writer.enqueue(TerminalMemoryTask::ShellEvent((*event).clone()));
                        }
                        writer.enqueue(TerminalMemoryTask::Output(chunk.to_vec()));
                        for event in shell_events
                            .iter()
                            .filter(|event| event.kind == ShellIntegrationEventKind::CommandEnd)
                        {
                            writer.enqueue(TerminalMemoryTask::ShellEvent((*event).clone()));
                        }
                        if let Some(payload) = screen_diff_payload {
                            writer.enqueue(TerminalMemoryTask::ScreenDiff(payload));
                        }
                    }
                }
                Err(error) => {
                    if error.kind() == std::io::ErrorKind::Interrupted {
                        continue;
                    }
                    if let Some(writer) = memory_writer_for_reader.as_ref() {
                        writer.enqueue(TerminalMemoryTask::Error(error.to_string()));
                    }
                    emit_event(NativeEvent {
                        kind: "error".to_string(),
                        session_id: session_id_for_reader.clone(),
                        data: None,
                        exit_code: None,
                        error: Some(error.to_string()),
                        source: Some(source_for_reader.clone()),
                        mode: Some(mode_for_reader.clone()),
                        command_id: None,
                        command: None,
                    });
                    break;
                }
            }
        }
    });

    let source_for_exit = runtime.source.clone();
    let mode_for_exit = runtime.mode.clone();
    let state_for_exit = Arc::clone(&runtime.state);
    let memory_writer_for_exit = runtime.memory_writer.clone();
    thread::spawn(move || {
        let exit_code = if let Ok(mut child) = runtime.child.lock() {
            child.wait().ok().map(parse_exit_code).unwrap_or(1)
        } else {
            1
        };

        if let Some(writer) = memory_writer_for_exit.as_ref() {
            writer.enqueue(TerminalMemoryTask::Exit(exit_code));
        }
        mark_session_exit(&state_for_exit, exit_code);

        emit_event(NativeEvent {
            kind: "exit".to_string(),
            session_id,
            data: None,
            exit_code: Some(exit_code),
            error: None,
            source: Some(source_for_exit),
            mode: Some(mode_for_exit),
            command_id: None,
            command: None,
        });
    });
}

fn apply_shell_cwd(command: &mut CommandBuilder, cwd: Option<&str>) {
    if let Some(cwd) = cwd {
        let cwd_trimmed = cwd.trim();
        if !cwd_trimmed.is_empty() {
            command.cwd(cwd_trimmed);
        }
    }
}

fn apply_requested_env(command: &mut CommandBuilder, env: Option<&[TerminalShellLaunchEnvPair]>) {
    let Some(env) = env else {
        return;
    };
    for pair in env {
        let key = pair.key.trim();
        if key.is_empty() || key.contains('=') || key.contains('\0') || pair.value.contains('\0') {
            continue;
        }
        command.env(key, &pair.value);
    }
}

fn default_terminal_cwd() -> Option<String> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE")
            .ok()
            .or_else(|| {
                let drive = std::env::var("HOMEDRIVE").ok()?;
                let path = std::env::var("HOMEPATH").ok()?;
                Some(format!("{drive}{path}"))
            })
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }
}

fn normalize_terminal_cwd(cwd: Option<&str>) -> Option<String> {
    cwd.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(default_terminal_cwd)
}

fn configure_command_mode(command: &mut CommandBuilder, shell: &str, raw_command: &str) {
    configure_shell_environment(command, shell);
    if cfg!(windows) {
        command.arg("/C");
        command.arg(raw_command);
        return;
    }
    command.arg("-lc");
    command.arg(raw_command);
}

fn compose_write_payload(request: &TerminalWriteRequest) -> Result<String> {
    let mut payload = String::new();
    if let Some(data) = request.data.as_deref() {
        payload.push_str(data);
    } else if let Some(text) = request.text.as_deref() {
        payload.push_str(text);
    }
    if request.append_newline.unwrap_or(false) {
        payload.push('\n');
    }
    if let Some(keys) = request.keys.as_ref() {
        for key in keys {
            let bytes = input_controller::expand_key_stroke(&input_controller::KeyStroke {
                key: key.clone(),
                repeat: 1,
                delay_ms: None,
            })
            .map_err(to_error)?;
            payload.push_str(&String::from_utf8_lossy(&bytes));
        }
    }

    if payload.is_empty() {
        return Err(to_error("terminal write requires data, text, or keys"));
    }
    Ok(payload)
}

fn create_runtime(request: TerminalCreateRequest) -> Result<TerminalSessionSnapshot> {
    let session_id = request
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(next_session_id);

    if let Ok(sessions) = SESSIONS.lock() {
        if let Some(runtime) = sessions.get(&session_id) {
            return snapshot_from_runtime(runtime);
        }
    }

    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_else(|| session_id.clone());
    let rows = request.rows.max(1);
    let cols = request.cols.max(1);
    let source = normalize_source(request.source.as_deref());
    let mode = normalize_mode(&request);
    let persist = normalize_persist(&request, &source);
    let storage_root = request
        .storage_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let command_text = request
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let cwd = normalize_terminal_cwd(request.cwd.as_deref());

    if mode != "shell" && mode != "command" {
        return Err(to_error(format!("unsupported terminal mode: {mode}")));
    }
    if mode == "command" && command_text.is_none() {
        return Err(to_error("command is required when mode=command"));
    }

    let pty_system = native_pty_system();
    let shell_candidates = make_shell_candidates(request.shell.as_deref());
    let mut spawn_error = String::from("no shell available");

    for shell in shell_candidates {
        if !shell_exists(&shell) {
            continue;
        }

        let pair = match pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(v) => v,
            Err(error) => {
                spawn_error = error.to_string();
                continue;
            }
        };

        let mut builder = CommandBuilder::new(shell.clone());
        apply_shell_cwd(&mut builder, cwd.as_deref());
        if mode == "shell" {
            configure_shell_environment(&mut builder, &shell);
            configure_shell_command(&mut builder, &shell);
        } else if let Some(command) = command_text.as_deref() {
            configure_command_mode(&mut builder, &shell, command);
        }
        apply_requested_env(&mut builder, request.env.as_deref());

        let child = match pair.slave.spawn_command(builder) {
            Ok(v) => v,
            Err(error) => {
                spawn_error = error.to_string();
                continue;
            }
        };
        let process_id = child.process_id();

        let writer = pair
            .master
            .try_clone_writer()
            .map_err(|error| to_error(format!("failed to clone pty writer: {error}")))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| to_error(format!("failed to clone pty reader: {error}")))?;

        let state = Arc::new((
            Mutex::new(SessionOutputState {
                running: true,
                ..SessionOutputState::default()
            }),
            Condvar::new(),
        ));
        let memory_writer = storage_root.as_ref().map(|root| {
            TerminalMemoryWriter::new(
                root.clone(),
                session_id.clone(),
                source.clone(),
                mode.clone(),
            )
        });

        let runtime = Arc::new(SessionRuntime {
            session_id: session_id.clone(),
            title: title.clone(),
            cwd: cwd.clone(),
            shell: shell.clone(),
            cols,
            rows,
            created_at: now_iso_like(),
            source: source.clone(),
            mode: mode.clone(),
            command: command_text.clone(),
            persist,
            storage_root: storage_root.clone(),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
            state,
            screen: Arc::new(Mutex::new(screen::TerminalScreenState::new(rows, cols))),
            memory_writer,
        });

        if let Ok(mut sessions) = SESSIONS.lock() {
            sessions.insert(session_id.clone(), Arc::clone(&runtime));
        }

        let snapshot = snapshot_from_runtime(&runtime)?;
        if let Some(root) = storage_root.as_deref() {
            let _ = memory::record_session_created(memory::SessionCreatedInput {
                storage_root: root.to_string(),
                session_id: snapshot.session_id.clone(),
                title: snapshot.title.clone(),
                cwd: snapshot.cwd.clone(),
                shell: snapshot.shell.clone(),
                cols: snapshot.cols,
                rows: snapshot.rows,
                source: snapshot.source.clone(),
                mode: snapshot.mode.clone(),
                command: snapshot.command.clone(),
                persist: snapshot.persist,
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            });
            let _ = memory::record_process_started(memory::ProcessStartedInput {
                storage_root: root.to_string(),
                session_id: snapshot.session_id.clone(),
                process_id,
                shell: snapshot.shell.clone(),
                cwd: snapshot.cwd.clone(),
                command: snapshot.command.clone(),
                mode: snapshot.mode.clone(),
                source: snapshot.source.clone(),
                cols: snapshot.cols,
                rows: snapshot.rows,
                actor_json: Some("{\"kind\":\"terminal_kernel\"}".to_string()),
                correlation_json: request.correlation_json.clone(),
            });
        }
        spawn_io_threads(session_id, runtime, reader);
        return Ok(snapshot);
    }

    Err(to_error(format!("failed to spawn shell: {spawn_error}")))
}

#[cfg_attr(feature = "node-api", napi)]
pub fn create_session(request: TerminalCreateRequest) -> Result<TerminalSessionSnapshot> {
    create_runtime(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn shell_launch_plan(
    request: TerminalShellLaunchPlanRequest,
) -> Result<TerminalShellLaunchPlanResponse> {
    let shell = request.shell.trim().to_string();
    if shell.is_empty() {
        return Err(to_error("shell is required"));
    }
    let config = shell_integration::shell_integration_config(&shell, false);
    Ok(TerminalShellLaunchPlanResponse {
        shell: shell.clone(),
        args: shell::shell_startup_args(&shell),
        env: shell::shell_environment(&shell)
            .into_iter()
            .map(|(key, value)| TerminalShellLaunchEnvPair { key, value })
            .collect(),
        integration_enabled: config.enabled,
        integration_family: config.family,
        integration_script_asset: config.script_asset,
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn restore_sessions(request: TerminalRestoreRequest) -> Result<Vec<TerminalSessionSnapshot>> {
    let mut restored = Vec::with_capacity(request.sessions.len());
    for item in request.sessions {
        restored.push(create_runtime(item)?);
    }
    Ok(restored)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn create_observer_session(
    request: TerminalObserverCreateRequest,
) -> Result<TerminalSessionSnapshot> {
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err(to_error("observer sessionId is required"));
    }
    if let Ok(sessions) = OBSERVED_SESSIONS.lock() {
        if let Some(runtime) = sessions.get(&session_id) {
            return snapshot_from_observed_runtime(runtime);
        }
    }
    let storage_root = request.storage_root.trim().to_string();
    if storage_root.is_empty() {
        return Err(to_error("observer storageRoot is required"));
    }
    let title = request
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| session_id.clone());
    let shell = request
        .shell
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| "observed-pty".to_string());
    let source = normalize_source(request.source.as_deref());
    let mode = normalize_observer_mode(request.mode.as_deref(), request.command.as_deref());
    let persist = normalize_observer_persist(request.persist, &source);
    let cols = request.cols.max(1);
    let rows = request.rows.max(1);
    let state = Arc::new((
        Mutex::new(SessionOutputState {
            running: true,
            ..SessionOutputState::default()
        }),
        Condvar::new(),
    ));
    let runtime = Arc::new(ObservedSessionRuntime {
        session_id: session_id.clone(),
        title: title.clone(),
        cwd: request.cwd.clone(),
        shell: shell.clone(),
        created_at: now_iso_like(),
        source: source.clone(),
        mode: mode.clone(),
        command: request.command.clone(),
        persist,
        storage_root: storage_root.clone(),
        dimensions: Arc::new(Mutex::new((cols, rows))),
        state,
        screen: Arc::new(Mutex::new(screen::TerminalScreenState::new(rows, cols))),
        shell_parser: Arc::new(Mutex::new(shell_integration::ShellIntegrationParser::new())),
    });
    if let Ok(mut sessions) = OBSERVED_SESSIONS.lock() {
        sessions.insert(session_id.clone(), Arc::clone(&runtime));
    }
    let snapshot = snapshot_from_observed_runtime(&runtime)?;
    let _ = memory::record_session_created(memory::SessionCreatedInput {
        storage_root: storage_root.clone(),
        session_id: snapshot.session_id.clone(),
        title: snapshot.title.clone(),
        cwd: snapshot.cwd.clone(),
        shell: snapshot.shell.clone(),
        cols: snapshot.cols,
        rows: snapshot.rows,
        source: snapshot.source.clone(),
        mode: snapshot.mode.clone(),
        command: snapshot.command.clone(),
        persist: snapshot.persist,
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    });
    let _ = memory::record_process_started(memory::ProcessStartedInput {
        storage_root,
        session_id: snapshot.session_id.clone(),
        process_id: None,
        shell: snapshot.shell.clone(),
        cwd: snapshot.cwd.clone(),
        command: snapshot.command.clone(),
        mode: snapshot.mode.clone(),
        source: snapshot.source.clone(),
        cols: snapshot.cols,
        rows: snapshot.rows,
        actor_json: Some("{\"kind\":\"terminal_kernel\"}".to_string()),
        correlation_json: request.correlation_json.clone(),
    });
    Ok(snapshot)
}

fn observed_runtime_for_session(session_id: &str) -> Option<Arc<ObservedSessionRuntime>> {
    OBSERVED_SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(session_id).cloned())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_observer_input(request: TerminalObserverInputRequest) -> Result<()> {
    let runtime = observed_runtime_for_session(&request.session_id)
        .ok_or_else(|| to_error("session not found"))?;
    let storage_root = request
        .storage_root
        .clone()
        .unwrap_or_else(|| runtime.storage_root.clone());
    let _ = memory::record_write(memory::WriteInput {
        storage_root,
        session_id: request.session_id,
        data: request.data,
        text: request.text,
        keys: request.keys,
        append_newline: request.append_newline.unwrap_or(false),
        source: request.source,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    });
    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_observer_output(request: TerminalObserverOutputRequest) -> Result<()> {
    let runtime = observed_runtime_for_session(&request.session_id)
        .ok_or_else(|| to_error("session not found"))?;
    let storage_root = request
        .storage_root
        .clone()
        .unwrap_or_else(|| runtime.storage_root.clone());
    let context = memory::MemoryContext {
        storage_root,
        session_id: request.session_id.clone(),
    };
    let chunk = request.data.as_bytes();
    let shell_events = runtime
        .shell_parser
        .lock()
        .map(|mut parser| parser.feed(chunk))
        .unwrap_or_default();
    for event in shell_events
        .iter()
        .filter(|event| event.kind != ShellIntegrationEventKind::CommandEnd)
    {
        let _ = memory::record_shell_integration_event(&context, event);
    }
    let _ = memory::record_output(&context, chunk);
    for event in shell_events
        .iter()
        .filter(|event| event.kind == ShellIntegrationEventKind::CommandEnd)
    {
        if let Ok(Some(completion)) = memory::record_shell_integration_event(&context, event) {
            emit_command_completion(
                &runtime.session_id,
                &runtime.source,
                &runtime.mode,
                completion,
            );
        }
    }
    if let Ok(mut screen) = runtime.screen.lock() {
        let diff = screen.feed(chunk);
        let _ = memory::record_screen_diff(&context, screen::screen_diff_payload(&diff));
    }
    append_output(&runtime.state, chunk);
    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn resize_observer_session(request: TerminalObserverResizeRequest) -> Result<()> {
    let runtime = observed_runtime_for_session(&request.session_id)
        .ok_or_else(|| to_error("session not found"))?;
    let cols = request.cols.max(1);
    let rows = request.rows.max(1);
    if let Ok(mut dimensions) = runtime.dimensions.lock() {
        *dimensions = (cols, rows);
    }
    let storage_root = request
        .storage_root
        .clone()
        .unwrap_or_else(|| runtime.storage_root.clone());
    if let Ok(mut screen) = runtime.screen.lock() {
        let diff = screen.resize(rows, cols);
        let context = memory::MemoryContext {
            storage_root: storage_root.clone(),
            session_id: request.session_id.clone(),
        };
        let _ = memory::record_screen_diff(&context, screen::screen_diff_payload(&diff));
    }
    let _ = memory::record_resize(memory::ResizeInput {
        storage_root,
        session_id: request.session_id,
        cols,
        rows,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    });
    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_observer_exit(request: TerminalObserverExitRequest) -> Result<()> {
    let runtime = observed_runtime_for_session(&request.session_id)
        .ok_or_else(|| to_error("session not found"))?;
    let storage_root = request
        .storage_root
        .clone()
        .unwrap_or_else(|| runtime.storage_root.clone());
    let context = memory::MemoryContext {
        storage_root,
        session_id: request.session_id.clone(),
    };
    if let Ok(Some(completion)) = memory::record_exit(&context, request.exit_code) {
        emit_command_completion(
            &runtime.session_id,
            &runtime.source,
            &runtime.mode,
            completion,
        );
    }
    mark_session_exit(&runtime.state, request.exit_code);
    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn close_observer_session(request: TerminalObserverCloseRequest) -> Result<()> {
    let runtime = if let Ok(mut sessions) = OBSERVED_SESSIONS.lock() {
        sessions.remove(&request.session_id)
    } else {
        None
    };
    let storage_root = request
        .storage_root
        .clone()
        .or_else(|| runtime.as_ref().map(|item| item.storage_root.clone()));
    if let Some(runtime) = runtime.as_ref() {
        mark_session_exit(&runtime.state, 0);
    }
    if let Some(root) = storage_root {
        let _ = memory::record_close(memory::CloseInput {
            storage_root: root,
            session_id: request.session_id,
            actor_json: request.actor_json,
            correlation_json: request.correlation_json,
        });
    }
    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn write_session(mut request: TerminalWriteRequest) -> Result<()> {
    let runtime = SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&request.session_id).cloned())
        .ok_or_else(|| to_error("session not found"))?;

    let payload = compose_write_payload(&request)?;
    let storage_root = request
        .storage_root
        .clone()
        .or_else(|| runtime.storage_root.clone());
    if let Some(root) = storage_root.as_deref() {
        let authorization =
            attachments::authorize_write(attachments::TerminalAttachmentWriteRequest {
                session_id: request.session_id.clone(),
                attachment_id: None,
                agent_session_id: None,
                source: request.source.clone(),
                reason: Some("terminal write".to_string()),
                storage_root: Some(root.to_string()),
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            })
            .map_err(to_error)?;
        if !authorization.allowed {
            return Err(to_error(format!(
                "terminal attachment rejected write: {}",
                authorization
                    .warning
                    .unwrap_or_else(|| authorization.status.clone())
            )));
        }
        if authorization.attachment_id.is_some() {
            request.correlation_json = authorization.correlation_json;
        }
    }
    {
        let mut writer = runtime
            .writer
            .lock()
            .map_err(|_| to_error("failed to lock pty writer"))?;

        writer
            .write_all(payload.as_bytes())
            .map_err(|error| to_error(format!("pty write failed: {error}")))?;
        writer
            .flush()
            .map_err(|error| to_error(format!("pty flush failed: {error}")))?;
    }
    if let Some(root) = storage_root {
        let input = memory::WriteInput {
            storage_root: root,
            session_id: request.session_id,
            data: request.data,
            text: request.text,
            keys: request.keys,
            append_newline: request.append_newline.unwrap_or(false),
            source: request.source,
            actor_json: request.actor_json,
            correlation_json: request.correlation_json,
        };
        if let Some(writer) = runtime.memory_writer.as_ref() {
            writer.enqueue(TerminalMemoryTask::Write(input));
        } else {
            let _ = memory::record_write(input);
        }
    }
    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_session(request: TerminalReadRequest) -> Result<TerminalReadResponse> {
    let runtime = SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&request.session_id).cloned());
    let Some(runtime) = runtime else {
        if let Some(runtime) = observed_runtime_for_session(&request.session_id) {
            let storage_root = request
                .storage_root
                .as_deref()
                .unwrap_or(runtime.storage_root.as_str())
                .to_string();
            let wait_ms = request.wait_ms.unwrap_or(DEFAULT_READ_WAIT_MS as u32) as u64;
            let max_bytes = request
                .max_bytes
                .map(|value| value.max(1) as usize)
                .unwrap_or(DEFAULT_READ_MAX_BYTES)
                .min(MAX_SESSION_BUFFER_BYTES);
            let requested_cursor = request
                .cursor
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .and_then(|value| value.parse::<u64>().ok())
                .unwrap_or(0);
            let initial_output_size =
                memory::output_text_size(&storage_root, &runtime.session_id).map_err(to_error)?;
            let observed_cursor = requested_cursor.min(initial_output_size);
            let (lock, condvar) = &*runtime.state;
            let mut state = lock
                .lock()
                .map_err(|_| to_error("failed to lock observed session state"))?;
            if initial_output_size <= observed_cursor && state.running && wait_ms > 0 {
                let deadline = Instant::now() + Duration::from_millis(wait_ms);
                while state.running {
                    let now = Instant::now();
                    if now >= deadline {
                        break;
                    }
                    let remaining = deadline.saturating_duration_since(now);
                    let (next_state, _) = condvar
                        .wait_timeout(state, remaining)
                        .map_err(|_| to_error("failed to wait for observed session output"))?;
                    state = next_state;
                    if !state.running {
                        break;
                    }
                    drop(state);
                    let output_size = memory::output_text_size(&storage_root, &runtime.session_id)
                        .map_err(to_error)?;
                    state = lock
                        .lock()
                        .map_err(|_| to_error("failed to lock observed session state"))?;
                    if output_size > observed_cursor {
                        break;
                    }
                }
            }
            let running = state.running;
            let exit_code = state.exit_code;
            drop(state);
            let projection = memory::read_output_projection(
                &storage_root,
                &runtime.session_id,
                observed_cursor,
                max_bytes,
            )
            .map_err(to_error)?;
            let reason = if projection.cursor > observed_cursor || !projection.output.is_empty() {
                "output"
            } else if !running && exit_code.is_some() {
                "exit"
            } else {
                "timeout"
            };
            let memory = memory::metadata_for_session(
                &storage_root,
                &runtime.session_id,
                projection.truncated,
            )
            .ok();
            return Ok(TerminalReadResponse {
                session_id: runtime.session_id.clone(),
                cursor: projection.cursor.to_string(),
                output: projection.output,
                running,
                exit_code,
                truncated: projection.truncated,
                source: runtime.source.clone(),
                mode: runtime.mode.clone(),
                memory,
                reason: Some(reason.to_string()),
            });
        }
        let storage_root = request
            .storage_root
            .clone()
            .ok_or_else(|| to_error("terminal read requires storageRoot"))?;
        let max_bytes = request
            .max_bytes
            .map(|value| value.max(1) as usize)
            .unwrap_or(DEFAULT_READ_MAX_BYTES)
            .min(MAX_SESSION_BUFFER_BYTES);
        let requested_cursor = request
            .cursor
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        let projection = memory::read_output_projection(
            &storage_root,
            &request.session_id,
            requested_cursor,
            max_bytes,
        )
        .map_err(to_error)?;
        let stored = memory::stored_session_metadata(&storage_root, &request.session_id)
            .map_err(to_error)?;
        let memory =
            memory::metadata_for_session(&storage_root, &request.session_id, projection.truncated)
                .ok();
        let source = stored
            .get("source")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("system")
            .to_string();
        let mode = stored
            .get("mode")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("shell")
            .to_string();
        let exit_code = stored
            .get("exitCode")
            .and_then(serde_json::Value::as_i64)
            .and_then(|value| i32::try_from(value).ok());
        let reason = if projection.cursor > requested_cursor || !projection.output.is_empty() {
            "output"
        } else if exit_code.is_some() {
            "exit"
        } else {
            "timeout"
        };
        return Ok(TerminalReadResponse {
            session_id: request.session_id,
            cursor: projection.cursor.to_string(),
            output: projection.output,
            running: false,
            exit_code,
            truncated: projection.truncated,
            source,
            mode,
            memory,
            reason: Some(reason.to_string()),
        });
    };
    let wait_ms = request.wait_ms.unwrap_or(DEFAULT_READ_WAIT_MS as u32) as u64;
    let max_bytes = request
        .max_bytes
        .map(|value| value.max(1) as usize)
        .unwrap_or(DEFAULT_READ_MAX_BYTES)
        .min(MAX_SESSION_BUFFER_BYTES);
    let requested_cursor = request
        .cursor
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let (lock, condvar) = &*runtime.state;
    let mut state = lock
        .lock()
        .map_err(|_| to_error("failed to lock session state"))?;
    let observed_cursor = requested_cursor.min(state.total_text_bytes);

    if state.total_text_bytes <= observed_cursor && state.running && wait_ms > 0 {
        let deadline = Instant::now() + Duration::from_millis(wait_ms);
        while state.running {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            let remaining = deadline.saturating_duration_since(now);
            let (next_state, _) = condvar
                .wait_timeout(state, remaining)
                .map_err(|_| to_error("failed to wait for session output"))?;
            state = next_state;
            if !state.running {
                break;
            }
            if state.total_text_bytes > observed_cursor {
                break;
            }
        }
    }

    let running = state.running;
    let exit_code = state.exit_code;
    let (cursor, output, truncated) = live_output_projection(&state, observed_cursor, max_bytes);
    drop(state);
    let reason = if cursor > observed_cursor || !output.is_empty() {
        "output"
    } else if !running && exit_code.is_some() {
        "exit"
    } else {
        "timeout"
    };
    let memory = request
        .storage_root
        .as_deref()
        .or(runtime.storage_root.as_deref())
        .and_then(|root| memory::metadata_for_session(root, &runtime.session_id, truncated).ok());

    Ok(TerminalReadResponse {
        session_id: runtime.session_id.clone(),
        cursor: cursor.to_string(),
        output,
        running,
        exit_code,
        truncated,
        source: runtime.source.clone(),
        mode: runtime.mode.clone(),
        memory,
        reason: Some(reason.to_string()),
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn resize_session(request: TerminalResizeRequest) -> Result<()> {
    let runtime = SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&request.session_id).cloned())
        .ok_or_else(|| to_error("session not found"))?;

    let master = runtime
        .master
        .lock()
        .map_err(|_| to_error("failed to lock pty master"))?;

    master
        .resize(PtySize {
            rows: request.rows.max(1),
            cols: request.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| to_error(format!("pty resize failed: {error}")))?;
    let screen_diff = runtime
        .screen
        .lock()
        .ok()
        .map(|mut screen| screen.resize(request.rows, request.cols));
    if let Some(root) = request
        .storage_root
        .clone()
        .or_else(|| runtime.storage_root.clone())
    {
        let writer = runtime.memory_writer.as_ref();
        if let Some(diff) = screen_diff.as_ref() {
            let payload = screen::screen_diff_payload(diff);
            if let Some(writer) = writer {
                writer.enqueue(TerminalMemoryTask::ScreenDiff(payload));
            } else {
                let context = memory::MemoryContext {
                    storage_root: root.clone(),
                    session_id: request.session_id.clone(),
                };
                let _ = memory::record_screen_diff(&context, payload);
            }
        }
        let input = memory::ResizeInput {
            storage_root: root,
            session_id: request.session_id,
            cols: request.cols,
            rows: request.rows,
            actor_json: request.actor_json,
            correlation_json: request.correlation_json,
        };
        if let Some(writer) = writer {
            writer.enqueue(TerminalMemoryTask::Resize(input));
        } else {
            let _ = memory::record_resize(input);
        }
    }
    Ok(())
}

fn normalize_selected_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().chars().take(16_384).collect::<String>())
        .filter(|value| !value.is_empty())
}

fn active_command_from_memory(storage_root: Option<&str>, session_id: &str) -> Option<String> {
    storage_root
        .and_then(|root| memory::active_command_text(root, session_id).ok().flatten())
        .map(|value| value.trim().chars().take(8_192).collect::<String>())
        .filter(|value| !value.is_empty())
}

fn enrich_tui_regions(mut response: TerminalScreenReadResponse) -> TerminalScreenReadResponse {
    let (regions, _truncated) = tui_map::regions_from_screen_read(&response, None, true);
    response.regions = regions;
    response
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_screen(request: TerminalScreenReadRequest) -> Result<TerminalScreenReadResponse> {
    let selected_text = normalize_selected_text(request.selected_text.clone());
    let runtime = SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&request.session_id).cloned());
    let Some(runtime) = runtime else {
        if let Some(runtime) = observed_runtime_for_session(&request.session_id) {
            let storage_root = request
                .storage_root
                .as_deref()
                .unwrap_or(runtime.storage_root.as_str())
                .to_string();
            let snapshot = {
                let screen = runtime
                    .screen
                    .lock()
                    .map_err(|_| to_error("failed to lock observed terminal screen state"))?;
                screen.snapshot(
                    request.include_scrollback.unwrap_or(false),
                    request.max_rows,
                    request.max_bytes,
                )
            };
            let (lock, _) = &*runtime.state;
            let state = lock
                .lock()
                .map_err(|_| to_error("failed to lock observed terminal state"))?;
            let memory = memory::metadata_for_session(
                &storage_root,
                &runtime.session_id,
                snapshot.truncated,
            )
            .ok();
            let active_command =
                active_command_from_memory(Some(storage_root.as_str()), &runtime.session_id);
            return Ok(enrich_tui_regions(TerminalScreenReadResponse {
                session_id: runtime.session_id.clone(),
                cursor: snapshot.cursor,
                screen_version: snapshot.screen_version.min(u32::MAX as u64) as u32,
                rows: snapshot.rows,
                cols: snapshot.cols,
                mode: snapshot.mode,
                visible_text: snapshot.visible_text,
                visible_rows: snapshot.visible_rows,
                scrollback_text: snapshot.scrollback_text,
                scrollback_cursor: snapshot.scrollback_cursor,
                scrollback_rows: snapshot.scrollback_rows,
                cursor_position: snapshot.cursor_position,
                cells: snapshot.cells,
                cells_truncated: snapshot.cells_truncated,
                styles: snapshot.styles,
                links: snapshot.links,
                input_modes: snapshot.input_modes,
                selected_text: selected_text.or(snapshot.selected_text),
                active_command: active_command.or(snapshot.active_command),
                prompt: snapshot.prompt,
                regions: snapshot.regions,
                running: state.running,
                exit_code: state.exit_code,
                truncated: snapshot.truncated,
                memory,
            }));
        }
        let storage_root = request
            .storage_root
            .clone()
            .ok_or_else(|| to_error("terminal screen read requires storageRoot"))?;
        let snapshot = memory::replay_screen_snapshot(
            &storage_root,
            &request.session_id,
            request.include_scrollback.unwrap_or(false),
            request.max_rows,
            request.max_bytes,
        )
        .map_err(to_error)?;
        let memory =
            memory::metadata_for_session(&storage_root, &request.session_id, snapshot.truncated)
                .ok();
        let active_command =
            active_command_from_memory(Some(storage_root.as_str()), &request.session_id);
        return Ok(enrich_tui_regions(TerminalScreenReadResponse {
            session_id: request.session_id.clone(),
            cursor: snapshot.cursor,
            screen_version: snapshot.screen_version.min(u32::MAX as u64) as u32,
            rows: snapshot.rows,
            cols: snapshot.cols,
            mode: snapshot.mode,
            visible_text: snapshot.visible_text,
            visible_rows: snapshot.visible_rows,
            scrollback_text: snapshot.scrollback_text,
            scrollback_cursor: snapshot.scrollback_cursor,
            scrollback_rows: snapshot.scrollback_rows,
            cursor_position: snapshot.cursor_position,
            cells: snapshot.cells,
            cells_truncated: snapshot.cells_truncated,
            styles: snapshot.styles,
            links: snapshot.links,
            input_modes: snapshot.input_modes,
            selected_text: selected_text.or(snapshot.selected_text),
            active_command: active_command.or(snapshot.active_command),
            prompt: snapshot.prompt,
            regions: snapshot.regions,
            running: false,
            exit_code: memory::last_exit_code(&storage_root, &request.session_id)
                .ok()
                .flatten(),
            truncated: snapshot.truncated,
            memory,
        }));
    };
    let snapshot = {
        let screen = runtime
            .screen
            .lock()
            .map_err(|_| to_error("failed to lock terminal screen state"))?;
        screen.snapshot(
            request.include_scrollback.unwrap_or(false),
            request.max_rows,
            request.max_bytes,
        )
    };
    let state = output_state(&runtime)?;
    let memory = request
        .storage_root
        .as_deref()
        .or(runtime.storage_root.as_deref())
        .and_then(|storage_root| {
            memory::metadata_for_session(storage_root, &runtime.session_id, snapshot.truncated).ok()
        });
    let active_command = active_command_from_memory(
        request
            .storage_root
            .as_deref()
            .or(runtime.storage_root.as_deref()),
        &runtime.session_id,
    )
    .or_else(|| {
        if state.running && runtime.mode == "command" {
            runtime.command.clone()
        } else {
            None
        }
    });
    Ok(enrich_tui_regions(TerminalScreenReadResponse {
        session_id: runtime.session_id.clone(),
        cursor: snapshot.cursor,
        screen_version: snapshot.screen_version.min(u32::MAX as u64) as u32,
        rows: snapshot.rows,
        cols: snapshot.cols,
        mode: snapshot.mode,
        visible_text: snapshot.visible_text,
        visible_rows: snapshot.visible_rows,
        scrollback_text: snapshot.scrollback_text,
        scrollback_cursor: snapshot.scrollback_cursor,
        scrollback_rows: snapshot.scrollback_rows,
        cursor_position: snapshot.cursor_position,
        cells: snapshot.cells,
        cells_truncated: snapshot.cells_truncated,
        styles: snapshot.styles,
        links: snapshot.links,
        input_modes: snapshot.input_modes,
        selected_text: selected_text.or(snapshot.selected_text),
        active_command: active_command.or(snapshot.active_command),
        prompt: snapshot.prompt,
        regions: snapshot.regions,
        running: state.running,
        exit_code: state.exit_code,
        truncated: snapshot.truncated,
        memory,
    }))
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_map(request: TerminalMapReadRequest) -> Result<TerminalMapReadResponse> {
    let mut screen = read_screen(TerminalScreenReadRequest {
        session_id: request.session_id.clone(),
        storage_root: request.storage_root.clone(),
        cursor: request.screen_cursor.clone(),
        include_scrollback: Some(false),
        max_rows: None,
        max_bytes: Some(64 * 1024),
        selected_text: None,
    })?;
    let include_text = request.include_text.unwrap_or(true);
    let (regions, regions_truncated) =
        tui_map::regions_from_screen_read(&screen, request.max_regions, include_text);
    let stale_warning =
        tui_map::stale_cursor_warning(request.screen_cursor.as_deref(), &screen.cursor);
    let warning = match (stale_warning, regions_truncated) {
        (Some(stale), true) => Some(format!("{stale}; region output truncated")),
        (Some(stale), false) => Some(stale),
        (None, true) => Some("region output truncated".to_string()),
        (None, false) => None,
    };
    screen.regions = regions.clone();
    Ok(TerminalMapReadResponse {
        session_id: request.session_id,
        memory: screen.memory.clone(),
        screen,
        regions,
        stale: Some(
            warning
                .as_deref()
                .is_some_and(|value| value.contains("stale")),
        ),
        warning,
    })
}

fn runtime_for_session(session_id: &str) -> Option<Arc<SessionRuntime>> {
    SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(session_id).cloned())
}

fn runtime_process_id(runtime: &SessionRuntime) -> Option<u32> {
    runtime
        .child
        .lock()
        .ok()
        .and_then(|child| child.process_id())
}

fn memory_json(storage_root: &str, session_id: &str, truncated: bool) -> Option<String> {
    memory::metadata_for_session(storage_root, session_id, truncated).ok()
}

fn correlation_permission_id(correlation_json: Option<&str>) -> Option<String> {
    correlation_json
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .and_then(|value| {
            value
                .get("permissionId")
                .or_else(|| value.get("permission_id"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn value_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn value_i32(value: &Value, key: &str) -> Option<i32> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok())
}

fn value_u64(value: &Value, key: &str) -> Option<u64> {
    value.get(key).and_then(Value::as_u64)
}

fn value_f64(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64).or_else(|| {
        value
            .get(key)
            .and_then(Value::as_u64)
            .map(|value| value as f64)
    })
}

fn range_from_value(value: Option<&Value>) -> Option<TerminalNumberRange> {
    let value = value?;
    Some(TerminalNumberRange {
        start: value_f64(value, "start")?,
        end: value_f64(value, "end")?,
    })
}

fn command_records(storage_root: &str, session_id: &str) -> Result<Vec<Value>> {
    let raw = memory::read_commands(memory::CommandsReadInput {
        storage_root: storage_root.to_string(),
        session_id: session_id.to_string(),
        cursor: None,
        limit: Some(500),
        status: None,
        audit: None,
        actor_json: None,
        correlation_json: None,
    })
    .map_err(to_error)?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| to_error(error.to_string()))?;
    Ok(value
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

fn latest_command_record(
    storage_root: &str,
    session_id: &str,
    command_id: Option<&str>,
) -> Result<Option<Value>> {
    let mut records = command_records(storage_root, session_id)?;
    records.sort_by_key(|record| value_u64(record, "commandSeq").unwrap_or(0));
    Ok(records.into_iter().rev().find(|record| {
        command_id
            .map(|command_id| value_string(record, "commandId").as_deref() == Some(command_id))
            .unwrap_or(true)
    }))
}

fn command_snapshot_from_record(
    record: &Value,
    fallback_session_id: &str,
) -> Option<TerminalCommandSnapshot> {
    Some(TerminalCommandSnapshot {
        command_id: value_string(record, "commandId")?,
        session_id: value_string(record, "terminalSessionId")
            .unwrap_or_else(|| fallback_session_id.to_string()),
        command_text: value_string(record, "commandText"),
        normalized_command_text: value_string(record, "normalizedCommandText"),
        status: value_string(record, "status").unwrap_or_else(|| "unknown".to_string()),
        exit_code: value_i32(record, "exitCode"),
        signal: value_string(record, "signal"),
        submitted_at: value_string(record, "submittedAt"),
        started_at: value_string(record, "startedAt"),
        completed_at: value_string(record, "completedAt"),
        duration_ms: value_f64(record, "durationMs"),
        cwd_before: value_string(record, "cwdBefore"),
        cwd_after: value_string(record, "cwdAfter"),
        output_range: range_from_value(record.get("outputTextRange")),
        raw_output_range: range_from_value(record.get("rawOutputRange")),
        screen_version_range: range_from_value(record.get("screenVersionRange")),
        artifact_root_path: value_string(record, "artifactRootPath"),
        command_meta_path: value_string(record, "commandMetaPath"),
        command_output_text_path: value_string(record, "commandOutputTextPath"),
        command_raw_output_path: value_string(record, "commandRawOutputPath"),
        command_events_path: value_string(record, "commandEventsPath"),
        command_summary_path: value_string(record, "commandSummaryPath"),
        confidence: record.get("confidence").and_then(Value::as_f64),
    })
}

fn status_is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled")
}

fn status_matches(actual: &str, desired: Option<&str>) -> bool {
    match desired.unwrap_or("any") {
        "any" => status_is_terminal(actual),
        "notRunning" => status_is_terminal(actual) || actual == "unknown",
        desired => actual == desired,
    }
}

fn text_projection_matches(text: &str, needle: Option<&str>, regex: Option<&str>) -> bool {
    if let Some(needle) = needle.map(str::trim).filter(|value| !value.is_empty()) {
        if text.contains(needle) {
            return true;
        }
    }
    if let Some(pattern) = regex.map(str::trim).filter(|value| !value.is_empty()) {
        if regex::Regex::new(pattern)
            .ok()
            .is_some_and(|compiled| compiled.is_match(text))
        {
            return true;
        }
    }
    needle.is_none_or(str::is_empty) && regex.is_none_or(str::is_empty) && !text.is_empty()
}

fn event_ref(kind: &str) -> TerminalContractEventRef {
    TerminalContractEventRef {
        event_id: None,
        kind: kind.to_string(),
        seq: None,
    }
}

fn write_semantic_payload(
    session_id: &str,
    storage_root: Option<String>,
    actor_json: Option<String>,
    correlation_json: Option<String>,
    text: Option<String>,
    keys: Option<Vec<String>>,
    append_newline: bool,
) -> Result<()> {
    write_session(TerminalWriteRequest {
        session_id: session_id.to_string(),
        data: None,
        text,
        keys,
        append_newline: Some(append_newline),
        source: Some("agent".to_string()),
        storage_root,
        actor_json,
        correlation_json,
    })
}

fn tui_plan_correlation(correlation_json: Option<String>, plan: &TuiActPlan) -> Option<String> {
    let mut correlation = correlation_json
        .as_deref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default();
    if let Some(region_id) = plan.region_id.as_deref() {
        correlation
            .entry("regionId".to_string())
            .or_insert_with(|| Value::String(region_id.to_string()));
    }
    correlation
        .entry("screenCursor".to_string())
        .or_insert_with(|| Value::String(plan.screen_cursor.clone()));
    correlation.insert(
        "terminalAct".to_string(),
        serde_json::json!({
            "regionId": plan.region_id.clone(),
            "screenCursor": plan.screen_cursor,
            "risk": plan.risk,
            "target": plan.target.clone(),
            "reason": plan.reason.clone()
        }),
    );
    Some(Value::Object(correlation).to_string())
}

fn execute_tui_plan(
    session_id: &str,
    storage_root: Option<String>,
    actor_json: Option<String>,
    correlation_json: Option<String>,
    plan: &TuiActPlan,
) -> Result<Option<String>> {
    if plan.input_action == "read" {
        return Ok(None);
    }
    let keys = if !plan.keys.is_empty() {
        Some(plan.keys.clone())
    } else if plan.input_action == "selectRegion" {
        let key = match plan.target.as_ref().map(|target| target.kind.as_str()) {
            Some("checkbox" | "radio") => "space",
            _ => "enter",
        };
        Some(vec![key.to_string()])
    } else {
        None
    };
    let action = if keys.is_some() {
        "pressKeys"
    } else if plan.text.is_some() {
        "pasteText"
    } else {
        "submitInput"
    };
    let response = execute_input(TerminalInputExecuteRequest {
        session_id: session_id.to_string(),
        storage_root,
        action: action.to_string(),
        command: None,
        text: plan.text.clone(),
        actor_json,
        correlation_json: tui_plan_correlation(correlation_json, plan),
        append_newline: Some(plan.append_newline),
        bracketed_paste: Some(false),
        sensitive_refs: None,
        cols: None,
        rows: None,
        signal: None,
        reason: plan.reason.clone(),
        keys,
    })?;
    Ok(Some(response.input_id))
}

#[cfg_attr(feature = "node-api", napi)]
pub fn execute_act(request: TerminalActExecuteRequest) -> Result<TerminalActExecuteResponse> {
    let map = read_map(TerminalMapReadRequest {
        session_id: request.session_id.clone(),
        storage_root: request.storage_root.clone(),
        screen_cursor: request.screen_cursor.clone(),
        max_regions: Some(tui_map::MAX_REGIONS as u32),
        include_text: Some(true),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    })?;

    if map.stale.unwrap_or(false) {
        return Ok(TerminalActExecuteResponse {
            session_id: request.session_id,
            act_id: format!("terminal-act-{}", uuid::Uuid::new_v4()),
            status: "staleTarget".to_string(),
            input_id: None,
            permission_id: None,
            screen_cursor: Some(map.screen.cursor.clone()),
            map: Some(map),
            plan: None,
            warning: Some("TUI target is stale; refresh the map and retry".to_string()),
            memory: None,
        });
    }

    let outcome = tui_act::resolve_plan(
        tui_act::TuiActContext {
            current_screen_cursor: &map.screen.cursor,
            regions: &map.regions,
        },
        tui_act::TuiActRequest {
            action: request.action,
            region_id: request.region_id,
            screen_cursor: request.screen_cursor,
            text: request.text,
            direction: request.direction,
            amount: request.amount,
            reason: request.reason,
        },
    );

    match outcome {
        Ok(plan) => {
            let input_id = execute_tui_plan(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                &plan,
            )?;
            Ok(TerminalActExecuteResponse {
                session_id: request.session_id,
                act_id: format!("terminal-act-{}", uuid::Uuid::new_v4()),
                status: "executed".to_string(),
                input_id,
                permission_id: correlation_permission_id(request.correlation_json.as_deref()),
                screen_cursor: Some(plan.screen_cursor.clone()),
                map: None,
                plan: Some(plan),
                warning: None,
                memory: map.memory,
            })
        }
        Err(error) => {
            let status = match error.kind {
                tui_act::TuiActErrorKind::StaleTarget => "staleTarget",
                tui_act::TuiActErrorKind::UnsupportedAction => "notImplemented",
                _ => "error",
            };
            Ok(TerminalActExecuteResponse {
                session_id: request.session_id,
                act_id: format!("terminal-act-{}", uuid::Uuid::new_v4()),
                status: status.to_string(),
                input_id: None,
                permission_id: None,
                screen_cursor: Some(map.screen.cursor.clone()),
                map: if status == "staleTarget" {
                    Some(map)
                } else {
                    None
                },
                plan: None,
                warning: Some(error.message),
                memory: None,
            })
        }
    }
}

#[cfg_attr(feature = "node-api", napi)]
pub fn execute_input(request: TerminalInputExecuteRequest) -> Result<TerminalInputExecuteResponse> {
    let input_id = format!("terminal-input-{}", uuid::Uuid::new_v4());
    let permission_id = correlation_permission_id(request.correlation_json.as_deref());
    let action = request.action.trim().to_string();
    let mut events = vec![event_ref("input_intent")];
    match action.as_str() {
        "runCommand" => {
            let command = request
                .command
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| to_error("runCommand requires command"))?;
            write_semantic_payload(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                Some(command),
                None,
                true,
            )?;
        }
        "submitInput" => {
            let text = request
                .text
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| to_error("submitInput requires text"))?;
            write_semantic_payload(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                Some(text),
                None,
                request.append_newline.unwrap_or(true),
            )?;
        }
        "pasteText" => {
            let text = request
                .text
                .clone()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| to_error("pasteText requires text"))?;
            let text = if request.bracketed_paste.unwrap_or(false) {
                format!("\u{1b}[200~{text}\u{1b}[201~")
            } else {
                text
            };
            write_semantic_payload(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                Some(text),
                None,
                request.append_newline.unwrap_or(false),
            )?;
        }
        "pressKeys" => {
            let keys = request
                .keys
                .clone()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| to_error("pressKeys requires keys"))?;
            write_semantic_payload(
                &request.session_id,
                request.storage_root.clone(),
                request.actor_json.clone(),
                request.correlation_json.clone(),
                None,
                Some(keys),
                false,
            )?;
        }
        "sendSignal" => {
            let signal = request
                .signal
                .clone()
                .ok_or_else(|| to_error("sendSignal requires signal"))?;
            let _ = signal_process(TerminalProcessSignalRequest {
                session_id: request.session_id.clone(),
                storage_root: request
                    .storage_root
                    .clone()
                    .ok_or_else(|| to_error("sendSignal requires storageRoot"))?,
                pid: None,
                signal,
                reason: request.reason.clone(),
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            })?;
        }
        "resize" => {
            resize_session(TerminalResizeRequest {
                session_id: request.session_id.clone(),
                cols: request
                    .cols
                    .ok_or_else(|| to_error("resize requires cols"))?,
                rows: request
                    .rows
                    .ok_or_else(|| to_error("resize requires rows"))?,
                storage_root: request.storage_root.clone(),
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            })?;
        }
        other => {
            return Ok(TerminalInputExecuteResponse {
                session_id: request.session_id.clone(),
                input_id,
                action: other.to_string(),
                status: "notImplemented".to_string(),
                permission_id,
                events,
                memory: request
                    .storage_root
                    .as_deref()
                    .and_then(|root| memory_json(root, &request.session_id, false)),
            });
        }
    }
    events.push(event_ref("input_expanded"));
    let memory = request
        .storage_root
        .as_deref()
        .and_then(|root| memory_json(root, &request.session_id, false));
    Ok(TerminalInputExecuteResponse {
        session_id: request.session_id,
        input_id,
        action,
        status: "executed".to_string(),
        permission_id,
        events,
        memory,
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn evaluate_permission(
    request: TerminalPermissionEvaluateRequest,
) -> Result<TerminalPermissionEvaluateResponse> {
    let risk = request.risk.unwrap_or_else(|| "low".to_string());
    let permission_id = format!("terminal-permission-{}", uuid::Uuid::new_v4());
    let decision = if risk == "none" {
        "allow"
    } else {
        "needsApproval"
    };
    if decision == "needsApproval" {
        let _ = record_permission_requested(TerminalPermissionEventRequest {
            session_id: request.session_id.clone(),
            storage_root: request.storage_root.clone(),
            permission_id: permission_id.clone(),
            action: Some(request.action.clone()),
            risk: Some(risk.clone()),
            summary: request.summary.clone().or(request.title.clone()),
            title: request.title.clone(),
            detail: request.detail.clone(),
            command_id: request.command_id.clone(),
            input_id: request.input_id.clone(),
            agent_session_id: None,
            runtime_turn_id: None,
            tool_call_id: None,
            decision: Some(decision.to_string()),
            reason: Some("semantic terminal action requires approval".to_string()),
            expires_at: None,
            actor_json: request.actor_json.clone(),
            correlation_json: request.correlation_json.clone(),
        });
    }
    Ok(TerminalPermissionEvaluateResponse {
        session_id: request.session_id.clone(),
        permission_id,
        decision: decision.to_string(),
        risk,
        reason: Some(if decision == "allow" {
            "risk does not require approval".to_string()
        } else {
            "semantic terminal action requires approval".to_string()
        }),
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn respond_permission(
    request: TerminalPermissionRespondRequest,
) -> Result<TerminalPermissionRespondResponse> {
    let decision = request.decision.trim().to_ascii_lowercase();
    let event = TerminalPermissionEventRequest {
        session_id: request.session_id.clone(),
        storage_root: request.storage_root.clone(),
        permission_id: request.permission_id.clone(),
        action: None,
        risk: None,
        summary: None,
        title: None,
        detail: None,
        command_id: None,
        input_id: None,
        agent_session_id: None,
        runtime_turn_id: None,
        tool_call_id: None,
        decision: Some(decision.clone()),
        reason: request.reason.clone(),
        expires_at: request.expires_at.clone(),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    };
    if decision == "allow" || decision == "granted" {
        record_permission_granted(event)?;
    } else {
        record_permission_denied(event)?;
    }
    Ok(TerminalPermissionRespondResponse {
        session_id: request.session_id.clone(),
        permission_id: request.permission_id,
        decision,
        expires_at: request.expires_at,
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_processes(
    request: TerminalProcessesReadRequest,
) -> Result<TerminalProcessesReadResponse> {
    let runtime = runtime_for_session(&request.session_id);
    let state = runtime
        .as_ref()
        .and_then(|runtime| output_state(runtime).ok());
    let runtime_pid = runtime
        .as_ref()
        .and_then(|runtime| runtime_process_id(runtime));
    let pid = request.pid.or(runtime_pid);
    let include_tree = request.include_tree.unwrap_or(false);
    let running_hint = state
        .as_ref()
        .map(|state| state.running)
        .unwrap_or(pid.is_some());
    let snapshot = if include_tree {
        process_model::snapshot_process_tree(pid, None)
    } else {
        let processes = pid
            .map(|pid| {
                vec![process_model::ProcessInfo {
                    pid,
                    parent_pid: None,
                    process_group_id: None,
                    name: "pty".to_string(),
                    command: None,
                    status: if running_hint { "running" } else { "zombie" }.to_string(),
                }]
            })
            .unwrap_or_default();
        process_model::ProcessTreeSnapshot {
            captured_at: now_iso_like(),
            root_pid: pid,
            foreground_pid: pid,
            running: running_hint,
            limited: true,
            limited_reason: Some(
                "fast runtime snapshot; request includeTree=true for ps tree".to_string(),
            ),
            process_count: processes.len().min(u32::MAX as usize) as u32,
            processes,
        }
    };
    let running = state
        .as_ref()
        .map(|state| state.running)
        .unwrap_or(snapshot.running);
    let exit_code = state.as_ref().and_then(|state| state.exit_code);
    let signal = None;
    let command_id = latest_command_record(&request.storage_root, &request.session_id, None)
        .ok()
        .flatten()
        .and_then(|record| value_string(&record, "commandId"));
    let mut processes = snapshot
        .processes
        .iter()
        .map(|process| TerminalProcessSnapshot {
            pid: process.pid,
            parent_pid: process.parent_pid,
            foreground: Some(snapshot.foreground_pid == Some(process.pid)),
            command_id: if request.include_command.unwrap_or(true) {
                command_id.clone()
            } else {
                None
            },
            name: Some(process.name.clone()),
            command_line: process.command.clone(),
            cwd: None,
            running: process.status != "zombie",
            exit_code: None,
            signal: None,
            children: if include_tree { Some(Vec::new()) } else { None },
        })
        .collect::<Vec<_>>();
    if processes.is_empty() {
        if let Some(pid) = pid {
            processes.push(TerminalProcessSnapshot {
                pid,
                parent_pid: None,
                foreground: Some(true),
                command_id,
                name: Some("pty".to_string()),
                command_line: None,
                cwd: None,
                running,
                exit_code,
                signal: signal.clone(),
                children: if include_tree { Some(Vec::new()) } else { None },
            });
        }
    }
    Ok(TerminalProcessesReadResponse {
        session_id: request.session_id.clone(),
        pid,
        foreground_pid: snapshot.foreground_pid,
        running,
        exit_code,
        signal,
        limited: Some(snapshot.limited),
        processes,
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn signal_process(
    request: TerminalProcessSignalRequest,
) -> Result<TerminalProcessSignalResponse> {
    let signal = signals::parse_signal(&request.signal)
        .ok_or_else(|| to_error(format!("unsupported terminal signal: {}", request.signal)))?;
    let runtime = runtime_for_session(&request.session_id);
    let pid = request.pid.or_else(|| {
        runtime
            .as_ref()
            .and_then(|runtime| runtime_process_id(runtime))
    });
    let mut status = "sent".to_string();
    if let Some(runtime) = runtime
        .as_ref()
        .filter(|_| !signal.control_bytes.is_empty())
    {
        match runtime.writer.try_lock() {
            Ok(mut writer) => {
                writer
                    .write_all(&signal.control_bytes)
                    .map_err(|error| to_error(format!("pty signal write failed: {error}")))?;
                writer
                    .flush()
                    .map_err(|error| to_error(format!("pty signal flush failed: {error}")))?;
            }
            Err(_) => {
                if let Some(pid) = pid {
                    signals::send_signal(pid, &signal)
                        .map_err(|error| to_error(format!("process signal failed: {error}")))?;
                    status = "sentProcessSignalWriterBusy".to_string();
                } else {
                    status = "writerBusy".to_string();
                }
            }
        }
    } else if let Some(pid) = pid {
        signals::send_signal(pid, &signal)
            .map_err(|error| to_error(format!("process signal failed: {error}")))?;
    } else {
        status = "notImplemented".to_string();
    }
    let _ = memory::record_process_signal_sent(memory::ProcessSignalInput {
        storage_root: request.storage_root.clone(),
        session_id: request.session_id.clone(),
        signal: signal.name.clone(),
        reason: request
            .reason
            .unwrap_or_else(|| signal.default_reason.clone()),
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    });
    Ok(TerminalProcessSignalResponse {
        session_id: request.session_id.clone(),
        pid,
        signal: signal.name,
        status,
        input_id: Some(format!("terminal-input-{}", uuid::Uuid::new_v4())),
        permission_id: correlation_permission_id(request.correlation_json.as_deref()),
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_command_status(
    request: TerminalCommandStatusRequest,
) -> Result<TerminalCommandStatusResponse> {
    let command = latest_command_record(
        &request.storage_root,
        &request.session_id,
        request.command_id.as_deref(),
    )?
    .and_then(|record| command_snapshot_from_record(&record, &request.session_id));
    let command_id = command
        .as_ref()
        .map(|command| command.command_id.clone())
        .or(request.command_id);
    Ok(TerminalCommandStatusResponse {
        session_id: request.session_id.clone(),
        command_id,
        command,
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn wait_command(request: TerminalCommandWaitRequest) -> Result<TerminalCommandWaitResponse> {
    let timeout_ms = request.timeout_ms.unwrap_or(1_000).min(30_000);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms as u64);
    let runtime = runtime_for_session(&request.session_id);
    loop {
        let status_response = read_command_status(TerminalCommandStatusRequest {
            session_id: request.session_id.clone(),
            storage_root: request.storage_root.clone(),
            command_id: request.command_id.clone(),
            include_output_summary: Some(false),
            actor_json: request.actor_json.clone(),
            correlation_json: request.correlation_json.clone(),
        })?;
        if let Some(command) = status_response.command.as_ref() {
            if status_matches(&command.status, request.status.as_deref()) {
                return Ok(TerminalCommandWaitResponse {
                    session_id: request.session_id.clone(),
                    command_id: Some(command.command_id.clone()),
                    status: command.status.clone(),
                    reason: if command.signal.is_some() {
                        "signal"
                    } else {
                        "status"
                    }
                    .to_string(),
                    exit_code: command.exit_code,
                    signal: command.signal.clone(),
                    memory: status_response.memory,
                });
            }
        } else if request.command_id.is_some() {
            return Ok(TerminalCommandWaitResponse {
                session_id: request.session_id.clone(),
                command_id: request.command_id.clone(),
                status: "unknown".to_string(),
                reason: "notFound".to_string(),
                exit_code: None,
                signal: None,
                memory: status_response.memory,
            });
        }
        if Instant::now() >= deadline {
            let command = status_response.command;
            return Ok(TerminalCommandWaitResponse {
                session_id: request.session_id.clone(),
                command_id: command
                    .as_ref()
                    .map(|command| command.command_id.clone())
                    .or(request.command_id.clone()),
                status: command
                    .as_ref()
                    .map(|command| command.status.clone())
                    .unwrap_or_else(|| "timeout".to_string()),
                reason: "timeout".to_string(),
                exit_code: command.as_ref().and_then(|command| command.exit_code),
                signal: command.as_ref().and_then(|command| command.signal.clone()),
                memory: status_response.memory,
            });
        }
        if let Some(runtime) = runtime.as_ref() {
            let (lock, condvar) = &*runtime.state;
            let state = lock
                .lock()
                .map_err(|_| to_error("failed to lock session state"))?;
            let remaining = deadline.saturating_duration_since(Instant::now());
            let _ = condvar
                .wait_timeout(state, remaining.min(Duration::from_millis(250)))
                .map_err(|_| to_error("failed to wait for command status"))?;
        } else {
            break;
        }
    }
    Ok(TerminalCommandWaitResponse {
        session_id: request.session_id.clone(),
        command_id: request.command_id,
        status: "timeout".to_string(),
        reason: "timeout".to_string(),
        exit_code: None,
        signal: None,
        memory: memory_json(&request.storage_root, &request.session_id, false),
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_command_output(
    request: TerminalCommandOutputReadRequest,
) -> Result<TerminalCommandOutputReadResponse> {
    let command = latest_command_record(
        &request.storage_root,
        &request.session_id,
        Some(&request.command_id),
    )?
    .ok_or_else(|| to_error("terminal command not found"))?;
    let range_key = if request.raw.unwrap_or(false) {
        "rawOutputRange"
    } else {
        "outputTextRange"
    };
    let command_range = range_from_value(command.get(range_key))
        .ok_or_else(|| to_error("terminal command has no output range"))?;
    let command_start = number_to_byte_offset(command_range.start);
    let command_end = number_to_byte_offset(command_range.end);
    let relative_start = number_to_byte_offset(request.start.unwrap_or(0.0));
    let relative_end = request.end.map(number_to_byte_offset).unwrap_or_else(|| {
        relative_start
            .saturating_add(request.max_bytes.unwrap_or(DEFAULT_READ_MAX_BYTES as u32) as u64)
    });
    let absolute_start = command_start
        .saturating_add(relative_start)
        .min(command_end);
    let absolute_end = command_start.saturating_add(relative_end).min(command_end);
    let raw = memory::read_output_range(memory::OutputRangeReadInput {
        storage_root: request.storage_root.clone(),
        session_id: request.session_id.clone(),
        start: absolute_start,
        end: absolute_end,
        raw: request.raw.unwrap_or(false),
        audit: None,
        actor_json: request.actor_json.clone(),
        correlation_json: request.correlation_json.clone(),
    })
    .map_err(to_error)?;
    let value: Value = serde_json::from_str(&raw).map_err(|error| to_error(error.to_string()))?;
    Ok(TerminalCommandOutputReadResponse {
        session_id: request.session_id.clone(),
        command_id: request.command_id,
        raw: value.get("raw").and_then(Value::as_bool).unwrap_or(false),
        encoding: value_string(&value, "encoding").unwrap_or_else(|| "utf8".to_string()),
        requested_range: range_from_value(value.get("requestedRange")).unwrap_or(
            TerminalNumberRange {
                start: absolute_start as f64,
                end: absolute_end as f64,
            },
        ),
        range: range_from_value(value.get("range")).unwrap_or(TerminalNumberRange {
            start: absolute_start as f64,
            end: absolute_end as f64,
        }),
        next_start: value_f64(&value, "nextStart").unwrap_or(absolute_end as f64),
        byte_length: value_f64(&value, "byteLength").unwrap_or(0.0),
        total_bytes: value_f64(&value, "totalBytes").unwrap_or(0.0),
        output: value_string(&value, "output").unwrap_or_default(),
        raw_bytes_hex: value_string(&value, "rawBytesHex"),
        sha256: value_string(&value, "sha256"),
        truncated: value
            .get("truncated")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        memory: value
            .get("memory")
            .and_then(|memory| serde_json::to_string(memory).ok())
            .or_else(|| memory_json(&request.storage_root, &request.session_id, false)),
    })
}

#[cfg_attr(feature = "node-api", napi)]
pub fn wait_until(request: TerminalWaitUntilRequest) -> Result<TerminalWaitUntilResponse> {
    match request.target.as_str() {
        "command" => {
            let response = wait_command(TerminalCommandWaitRequest {
                session_id: request.session_id.clone(),
                storage_root: request.storage_root.clone(),
                command_id: request.command_id.clone(),
                status: request.status.clone(),
                timeout_ms: request.timeout_ms,
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            })?;
            Ok(TerminalWaitUntilResponse {
                session_id: request.session_id,
                matched: response.reason != "timeout" && response.reason != "notFound",
                reason: "command".to_string(),
                cursor: None,
                screen_cursor: None,
                command_id: response.command_id,
                output: None,
                memory: response.memory,
            })
        }
        "screen" | "prompt" => {
            let timeout_ms = request.timeout_ms.unwrap_or(1_000).min(30_000);
            let deadline = Instant::now() + Duration::from_millis(timeout_ms as u64);
            let runtime = runtime_for_session(&request.session_id);
            loop {
                let screen = read_screen(TerminalScreenReadRequest {
                    session_id: request.session_id.clone(),
                    storage_root: Some(request.storage_root.clone()),
                    cursor: request.screen_cursor.clone(),
                    include_scrollback: Some(false),
                    max_rows: None,
                    max_bytes: request.max_bytes,
                    selected_text: None,
                })?;
                let matched = if request.target == "prompt" {
                    screen
                        .prompt
                        .as_ref()
                        .is_some_and(|prompt| !prompt.trim().is_empty())
                } else {
                    text_projection_matches(
                        &screen.visible_text,
                        request.text.as_deref(),
                        request.regex.as_deref(),
                    )
                };
                if matched {
                    return Ok(TerminalWaitUntilResponse {
                        session_id: request.session_id,
                        matched: true,
                        reason: if request.target == "prompt" {
                            "prompt"
                        } else {
                            "screen"
                        }
                        .to_string(),
                        cursor: None,
                        screen_cursor: Some(screen.cursor),
                        command_id: None,
                        output: Some(screen.visible_text),
                        memory: screen.memory,
                    });
                }
                if Instant::now() >= deadline {
                    return Ok(TerminalWaitUntilResponse {
                        session_id: request.session_id,
                        matched: false,
                        reason: "timeout".to_string(),
                        cursor: None,
                        screen_cursor: Some(screen.cursor),
                        command_id: None,
                        output: Some(screen.visible_text),
                        memory: screen.memory,
                    });
                }
                if let Some(runtime) = runtime.as_ref() {
                    let (lock, condvar) = &*runtime.state;
                    let state = lock
                        .lock()
                        .map_err(|_| to_error("failed to lock session state"))?;
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    let _ = condvar
                        .wait_timeout(state, remaining.min(Duration::from_millis(250)))
                        .map_err(|_| to_error("failed to wait for terminal screen"))?;
                } else {
                    break;
                }
            }
            Ok(TerminalWaitUntilResponse {
                session_id: request.session_id.clone(),
                matched: false,
                reason: "timeout".to_string(),
                cursor: None,
                screen_cursor: request.screen_cursor,
                command_id: None,
                output: None,
                memory: memory_json(&request.storage_root, &request.session_id, false),
            })
        }
        "event" => {
            let response = memory::read_events(memory::EventsReadInput {
                storage_root: request.storage_root.clone(),
                session_id: request.session_id.clone(),
                cursor: request.cursor.clone(),
                limit: Some(1),
                kinds: None,
                actors: None,
                audit: None,
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            })
            .map_err(to_error)?;
            let value: Value =
                serde_json::from_str(&response).map_err(|error| to_error(error.to_string()))?;
            let items = value
                .get("items")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            Ok(TerminalWaitUntilResponse {
                session_id: request.session_id,
                matched: !items.is_empty(),
                reason: if items.is_empty() { "timeout" } else { "event" }.to_string(),
                cursor: value_string(&value, "nextCursor"),
                screen_cursor: None,
                command_id: None,
                output: None,
                memory: value
                    .get("memory")
                    .and_then(|memory| serde_json::to_string(memory).ok()),
            })
        }
        _ => {
            let response = read_session(TerminalReadRequest {
                session_id: request.session_id.clone(),
                cursor: request.cursor.clone(),
                max_bytes: request.max_bytes,
                wait_ms: request.timeout_ms,
                storage_root: Some(request.storage_root.clone()),
            })?;
            let matched = text_projection_matches(
                &response.output,
                request.text.as_deref(),
                request.regex.as_deref(),
            );
            Ok(TerminalWaitUntilResponse {
                session_id: request.session_id,
                matched,
                reason: if matched {
                    "output".to_string()
                } else {
                    response.reason.unwrap_or_else(|| "timeout".to_string())
                },
                cursor: Some(response.cursor),
                screen_cursor: None,
                command_id: None,
                output: Some(response.output),
                memory: response.memory,
            })
        }
    }
}

#[cfg_attr(feature = "node-api", napi)]
pub fn close_session(request: TerminalCloseRequest) -> Result<()> {
    let runtime = SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&request.session_id).cloned());
    let observed = observed_runtime_for_session(&request.session_id);
    let running = runtime
        .as_ref()
        .and_then(|runtime| output_state(runtime).ok().map(|state| state.running))
        .or_else(|| {
            observed
                .as_ref()
                .and_then(|runtime| runtime.state.0.lock().ok().map(|state| state.running))
        })
        .unwrap_or(false);
    let storage_root = request
        .storage_root
        .clone()
        .or_else(|| runtime.as_ref().and_then(|item| item.storage_root.clone()))
        .or_else(|| observed.as_ref().map(|item| item.storage_root.clone()));
    if let Some(root) = storage_root {
        let writer = runtime
            .as_ref()
            .and_then(|item| item.memory_writer.as_ref());
        if running {
            let input = memory::ProcessSignalInput {
                storage_root: root.clone(),
                session_id: request.session_id.clone(),
                signal: "SIGINT".to_string(),
                reason: "terminal_close".to_string(),
                actor_json: request.actor_json.clone(),
                correlation_json: request.correlation_json.clone(),
            };
            if let Some(writer) = writer {
                writer.enqueue(TerminalMemoryTask::ProcessSignal(input));
            } else {
                let _ = memory::record_process_signal_sent(input);
            }
        }
        let input = memory::CloseInput {
            storage_root: root,
            session_id: request.session_id.clone(),
            actor_json: request.actor_json,
            correlation_json: request.correlation_json,
        };
        if let Some(writer) = writer {
            writer.enqueue(TerminalMemoryTask::Close(input));
        } else {
            let _ = memory::record_close(input);
        }
    }
    run_close_session(&request.session_id);
    if let Ok(mut sessions) = OBSERVED_SESSIONS.lock() {
        sessions.remove(&request.session_id);
    }
    if let Some(observed) = observed.as_ref() {
        mark_session_exit(&observed.state, 0);
    }
    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn shutdown() -> Result<()> {
    let sessions_to_close = if let Ok(sessions) = SESSIONS.lock() {
        sessions
            .values()
            .map(|runtime| (runtime.session_id.clone(), runtime.storage_root.clone()))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    for (id, storage_root) in sessions_to_close {
        if let Some(root) = storage_root {
            let _ = memory::record_close(memory::CloseInput {
                storage_root: root,
                session_id: id.clone(),
                actor_json: Some("{\"kind\":\"terminal_kernel\"}".to_string()),
                correlation_json: None,
            });
        }
        run_close_session(&id);
    }

    let observed_to_close = if let Ok(sessions) = OBSERVED_SESSIONS.lock() {
        sessions
            .values()
            .map(|runtime| {
                (
                    runtime.session_id.clone(),
                    Some(runtime.storage_root.clone()),
                )
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    for (id, storage_root) in observed_to_close {
        if let Some(root) = storage_root {
            let _ = memory::record_close(memory::CloseInput {
                storage_root: root,
                session_id: id.clone(),
                actor_json: Some("{\"kind\":\"terminal_kernel\"}".to_string()),
                correlation_json: None,
            });
        }
        if let Ok(mut sessions) = OBSERVED_SESSIONS.lock() {
            sessions.remove(&id);
        }
    }

    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_memory_timeline(request: TerminalMemoryTimelineReadRequest) -> Result<String> {
    memory::read_timeline(memory::TimelineReadInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        cursor: request.cursor,
        limit: request.limit,
        kinds: request.kinds,
        actors: request.actors,
        command_id: request.command_id,
        tool_call_id: request.tool_call_id,
        agent_session_id: request.agent_session_id,
        seq_start: optional_number_to_u64(request.seq_start),
        seq_end: optional_number_to_u64(request.seq_end),
        time_start_ms: optional_number_to_i64(request.time_start_ms),
        time_end_ms: optional_number_to_i64(request.time_end_ms),
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_events(request: TerminalEventsReadRequest) -> Result<String> {
    memory::read_events(memory::EventsReadInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        cursor: request.cursor,
        limit: request.limit,
        kinds: request.kinds,
        actors: request.actors,
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_commands(request: TerminalCommandsReadRequest) -> Result<String> {
    memory::read_commands(memory::CommandsReadInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        cursor: request.cursor,
        limit: request.limit,
        status: request.status,
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_output_range(request: TerminalOutputRangeReadRequest) -> Result<String> {
    memory::read_output_range(memory::OutputRangeReadInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        start: number_to_byte_offset(request.start),
        end: number_to_byte_offset(request.end),
        raw: request.raw.unwrap_or(false),
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn list_artifacts(request: TerminalArtifactsListRequest) -> Result<String> {
    memory::list_artifacts(memory::ArtifactsListInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_stored_sessions(request: TerminalStoredSessionsReadRequest) -> Result<String> {
    memory::read_stored_sessions(&request.storage_root).map_err(to_error)
}

fn map_permission_event_request(
    request: TerminalPermissionEventRequest,
) -> memory::PermissionEventInput {
    memory::PermissionEventInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        permission_id: request.permission_id,
        action: request.action,
        risk: request.risk,
        summary: request.summary,
        title: request.title,
        detail: request.detail,
        command_id: request.command_id,
        input_id: request.input_id,
        agent_session_id: request.agent_session_id,
        runtime_turn_id: request.runtime_turn_id,
        tool_call_id: request.tool_call_id,
        decision: request.decision,
        reason: request.reason,
        expires_at: request.expires_at,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    }
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_permission_requested(request: TerminalPermissionEventRequest) -> Result<()> {
    memory::record_permission_requested(map_permission_event_request(request)).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_permission_granted(request: TerminalPermissionEventRequest) -> Result<()> {
    memory::record_permission_granted(map_permission_event_request(request)).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_permission_denied(request: TerminalPermissionEventRequest) -> Result<()> {
    memory::record_permission_denied(map_permission_event_request(request)).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_permission_expired(request: TerminalPermissionEventRequest) -> Result<()> {
    memory::record_permission_expired(map_permission_event_request(request)).map_err(to_error)
}

fn map_handoff_event_request(request: TerminalHandoffEventRequest) -> memory::HandoffEventInput {
    memory::HandoffEventInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        from_actor_json: request.from_actor_json,
        to_actor_json: request.to_actor_json,
        reason: request.reason,
        summary: request.summary,
        status: request.status,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    }
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_handoff_started(request: TerminalHandoffEventRequest) -> Result<()> {
    memory::record_handoff_started(map_handoff_event_request(request)).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn record_handoff_completed(request: TerminalHandoffEventRequest) -> Result<()> {
    memory::record_handoff_completed(map_handoff_event_request(request)).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn mark_output_policy(request: TerminalOutputPolicyMarkerRequest) -> Result<()> {
    memory::mark_output_policy(memory::OutputPolicyMarkerInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        start: number_to_byte_offset(request.start),
        end: number_to_byte_offset(request.end),
        policy: request.policy,
        reason: request.reason,
        encrypted_ref: request.encrypted_ref,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn attach_agent(
    request: TerminalAttachmentAttachRequest,
) -> Result<TerminalAttachmentAttachResponse> {
    attachments::attach_agent(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn detach_agent(
    request: TerminalAttachmentDetachRequest,
) -> Result<TerminalAttachmentDetachResponse> {
    attachments::detach_agent(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn list_attachments(
    request: TerminalAttachmentListRequest,
) -> Result<TerminalAttachmentListResponse> {
    attachments::list_attachments(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn pause_attachment(
    request: TerminalAttachmentPauseRequest,
) -> Result<TerminalAttachmentDetachResponse> {
    attachments::pause_attachment(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn resume_attachment(
    request: TerminalAttachmentResumeRequest,
) -> Result<TerminalAttachmentDetachResponse> {
    attachments::resume_attachment(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn authorize_attachment_write(
    request: TerminalAttachmentWriteRequest,
) -> Result<TerminalAttachmentWriteResponse> {
    attachments::authorize_write(request).map_err(to_error)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn launch_terminal_agent(
    request: TerminalAgentLaunchRequest,
) -> Result<TerminalAgentLaunchResponse> {
    terminal_agents::launch_terminal_agent(request).map_err(to_error)
}

#[cfg(test)]
mod tests {
    use crate::memory;

    use super::{
        close_observer_session, close_session, create_observer_session, create_session,
        normalize_terminal_cwd, read_screen, read_session, record_observer_input,
        record_observer_output, resize_observer_session, write_session, TerminalCloseRequest,
        TerminalCreateRequest, TerminalObserverCloseRequest, TerminalObserverCreateRequest,
        TerminalObserverInputRequest, TerminalObserverOutputRequest, TerminalObserverResizeRequest,
        TerminalReadRequest, TerminalScreenReadRequest, TerminalWriteRequest, Utf8StreamDecoder,
    };
    use serde_json::Value;
    use std::fs;
    use std::thread;
    use std::time::Duration;

    fn temp_root(name: &str) -> String {
        let root = std::env::temp_dir().join(format!(
            "lyra-terminal-core-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root.to_string_lossy().to_string()
    }

    #[test]
    fn utf8_stream_decoder_preserves_split_box_drawing() {
        let mut decoder = Utf8StreamDecoder::default();
        assert_eq!(decoder.decode(&[0xE2]), "");
        assert_eq!(decoder.decode(&[0x94]), "");
        assert_eq!(decoder.decode(&[0x80, b' ', 0xE2, 0x95]), "─ ");
        assert_eq!(decoder.decode(&[0xB0]), "╰");
    }

    #[test]
    fn utf8_stream_decoder_replaces_invalid_bytes_without_poisoning_next_text() {
        let mut decoder = Utf8StreamDecoder::default();
        assert_eq!(decoder.decode(&[0xFF, b'a']), "\u{FFFD}a");
        assert_eq!(decoder.decode("中文".as_bytes()), "中文");
    }

    #[test]
    fn default_terminal_cwd_uses_user_home_when_unspecified() {
        let expected_home = if cfg!(windows) {
            std::env::var("USERPROFILE").ok().or_else(|| {
                let drive = std::env::var("HOMEDRIVE").ok()?;
                let path = std::env::var("HOMEPATH").ok()?;
                Some(format!("{drive}{path}"))
            })
        } else {
            std::env::var("HOME").ok()
        }
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

        assert_eq!(normalize_terminal_cwd(None), expected_home);
        assert_eq!(
            normalize_terminal_cwd(Some("  /explicit/workspace  ")).as_deref(),
            Some("/explicit/workspace")
        );
    }

    fn shell_request(command: &str, storage_root: Option<String>) -> TerminalCreateRequest {
        TerminalCreateRequest {
            session_id: None,
            title: Some("test".to_string()),
            cwd: None,
            shell: None,
            cols: 80,
            rows: 24,
            source: Some("ai".to_string()),
            mode: Some("command".to_string()),
            command: Some(command.to_string()),
            env: None,
            persist: Some(false),
            storage_root,
            actor_json: None,
            correlation_json: None,
        }
    }

    fn current_output_cursor(session_id: &str, storage_root: &str) -> String {
        read_session(TerminalReadRequest {
            session_id: session_id.to_string(),
            cursor: Some("0".to_string()),
            max_bytes: Some(65_536),
            wait_ms: Some(2_000),
            storage_root: Some(storage_root.to_string()),
        })
        .expect("read current output")
        .cursor
    }

    fn read_until_contains(session_id: &str, storage_root: &str, cursor: String, needle: &str) {
        let mut cursor = cursor;
        let mut combined = String::new();
        for _ in 0..8 {
            let output = read_session(TerminalReadRequest {
                session_id: session_id.to_string(),
                cursor: Some(cursor),
                max_bytes: None,
                wait_ms: Some(2_000),
                storage_root: Some(storage_root.to_string()),
            })
            .expect("read terminal output");
            cursor = output.cursor;
            combined.push_str(&output.output);
            if combined.contains(needle) {
                return;
            }
        }
        panic!("terminal output did not contain {needle:?}: {combined:?}");
    }

    #[test]
    fn observed_external_pty_session_feeds_rust_memory_and_screen() {
        let root = temp_root("observer-external-pty");
        let snapshot = create_observer_session(TerminalObserverCreateRequest {
            session_id: "visible-session-1".to_string(),
            title: Some("Default".to_string()),
            cwd: Some("/workspace".to_string()),
            shell: Some("/bin/zsh".to_string()),
            cols: 80,
            rows: 24,
            source: Some("user".to_string()),
            mode: Some("shell".to_string()),
            command: None,
            persist: Some(true),
            storage_root: root.clone(),
            actor_json: Some("{\"kind\":\"human_user\"}".to_string()),
            correlation_json: Some("{\"terminalTabId\":\"tab-1\"}".to_string()),
        })
        .expect("create observer");
        assert_eq!(snapshot.session_id, "visible-session-1");
        assert_eq!(snapshot.shell, "/bin/zsh");

        record_observer_input(TerminalObserverInputRequest {
            session_id: snapshot.session_id.clone(),
            data: None,
            text: Some("npm test".to_string()),
            keys: None,
            append_newline: Some(true),
            source: Some("agent".to_string()),
            storage_root: Some(root.clone()),
            actor_json: Some("{\"kind\":\"agent\",\"agentSessionId\":\"agent-1\"}".to_string()),
            correlation_json: Some(
                "{\"agentSessionId\":\"agent-1\",\"terminalToolName\":\"terminal.write\"}"
                    .to_string(),
            ),
        })
        .expect("record input");
        record_observer_output(TerminalObserverOutputRequest {
            session_id: snapshot.session_id.clone(),
            data: "hello \u{1b}[31mred\u{1b}[0m\r\n".to_string(),
            storage_root: Some(root.clone()),
        })
        .expect("record output");

        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: Some("0".to_string()),
            max_bytes: Some(1024),
            wait_ms: Some(0),
            storage_root: Some(root.clone()),
        })
        .expect("read observed output");
        assert_eq!(output.reason.as_deref(), Some("output"));
        assert!(output.output.contains("hello red"));
        assert!(output.running);
        assert!(output.memory.is_some());

        resize_observer_session(TerminalObserverResizeRequest {
            session_id: snapshot.session_id.clone(),
            cols: 100,
            rows: 30,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("resize observer");
        let screen = read_screen(TerminalScreenReadRequest {
            session_id: snapshot.session_id.clone(),
            storage_root: Some(root.clone()),
            cursor: None,
            include_scrollback: Some(false),
            max_rows: Some(30),
            max_bytes: Some(4096),
            selected_text: None,
        })
        .expect("read observed screen");
        assert_eq!(screen.cols, 100);
        assert_eq!(screen.rows, 30);
        assert!(screen.visible_text.contains("hello red"));
        assert!(screen.memory.is_some());

        let memory: Value =
            serde_json::from_str(output.memory.as_ref().expect("memory")).expect("parse memory");
        let events = fs::read_to_string(memory["eventLogPath"].as_str().expect("event path"))
            .expect("read events");
        assert!(events.contains("\"kind\":\"session_created\""));
        assert!(events.contains("\"kind\":\"input_text\""));
        assert!(events.contains("\"kind\":\"output_chunk\""));
        assert!(events.contains("\"kind\":\"screen_diff\""));

        close_observer_session(TerminalObserverCloseRequest {
            session_id: snapshot.session_id,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("close observer");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn ai_source_command_session_can_be_read() {
        let root = temp_root("command-read");
        let snapshot = create_session(shell_request("printf 'hello'", Some(root.clone())))
            .expect("create command session");
        thread::sleep(Duration::from_millis(150));
        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: None,
            max_bytes: None,
            wait_ms: Some(1000),
            storage_root: Some(root.clone()),
        })
        .expect("read session");
        assert!(output.output.contains("hello"));
        assert_eq!(output.reason.as_deref(), Some("output"));
        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("close session");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn shell_session_accepts_key_writes() {
        let root = temp_root("key-write");
        let snapshot = create_session(TerminalCreateRequest {
            session_id: None,
            title: Some("shell".to_string()),
            cwd: None,
            shell: None,
            cols: 80,
            rows: 24,
            source: Some("ai".to_string()),
            mode: Some("shell".to_string()),
            command: None,
            env: None,
            persist: Some(false),
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("create shell session");
        let cursor = current_output_cursor(&snapshot.session_id, &root);
        write_session(TerminalWriteRequest {
            session_id: snapshot.session_id.clone(),
            data: None,
            text: Some("printf 'ping'".to_string()),
            keys: Some(vec!["enter".to_string()]),
            append_newline: None,
            source: Some("ai".to_string()),
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("write shell session");
        thread::sleep(Duration::from_millis(200));
        read_until_contains(&snapshot.session_id, &root, cursor, "ping");
        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("close shell session");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn shell_session_appends_newline_to_data_writes() {
        let root = temp_root("append-newline");
        let snapshot = create_session(TerminalCreateRequest {
            session_id: None,
            title: Some("shell".to_string()),
            cwd: None,
            shell: None,
            cols: 80,
            rows: 24,
            source: Some("ai".to_string()),
            mode: Some("shell".to_string()),
            command: None,
            env: None,
            persist: Some(false),
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("create shell session");
        let cursor = current_output_cursor(&snapshot.session_id, &root);
        write_session(TerminalWriteRequest {
            session_id: snapshot.session_id.clone(),
            data: Some("printf 'newline-data'".to_string()),
            text: None,
            keys: None,
            append_newline: Some(true),
            source: Some("ai".to_string()),
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("write shell session");
        thread::sleep(Duration::from_millis(200));
        read_until_contains(&snapshot.session_id, &root, cursor, "newline-data");
        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("close shell session");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn read_session_uses_memory_output_cursor_without_skipping_long_output() {
        let root = temp_root("cursor-read");
        let snapshot = create_session(shell_request("printf 'abcdef'", Some(root.clone())))
            .expect("create command session");
        let first = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: Some("0".to_string()),
            max_bytes: Some(3),
            wait_ms: Some(1000),
            storage_root: Some(root.clone()),
        })
        .expect("read first chunk");
        assert_eq!(first.output, "abc");
        assert_eq!(first.cursor, "3");
        assert!(first.truncated);
        assert_eq!(first.reason.as_deref(), Some("output"));

        let second = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: Some(first.cursor),
            max_bytes: Some(3),
            wait_ms: Some(1000),
            storage_root: Some(root.clone()),
        })
        .expect("read second chunk");
        assert_eq!(second.output, "def");
        assert_eq!(second.cursor, "6");
        assert!(!second.truncated);

        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("close session");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn wait_session_returns_exit_when_process_exits_without_output() {
        let root = temp_root("wait-exit");
        let snapshot = create_session(shell_request("true", Some(root.clone())))
            .expect("create command session");
        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: Some("0".to_string()),
            max_bytes: Some(16),
            wait_ms: Some(1000),
            storage_root: Some(root.clone()),
        })
        .expect("wait for exit");
        assert_eq!(output.output, "");
        assert_eq!(output.cursor, "0");
        assert_eq!(output.running, false);
        assert_eq!(output.exit_code, Some(0));
        assert_eq!(output.reason.as_deref(), Some("exit"));

        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("close session");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn wait_session_returns_timeout_when_running_without_output() {
        let root = temp_root("wait-timeout");
        let snapshot = create_session(shell_request("sleep 1", Some(root.clone())))
            .expect("create command session");
        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: Some("0".to_string()),
            max_bytes: Some(16),
            wait_ms: Some(50),
            storage_root: Some(root.clone()),
        })
        .expect("wait timeout");
        assert_eq!(output.output, "");
        assert_eq!(output.cursor, "0");
        assert!(output.running);
        assert_eq!(output.exit_code, None);
        assert_eq!(output.reason.as_deref(), Some("timeout"));

        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("close session");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn read_session_reads_stripped_text_and_preserves_raw_output_artifact() {
        let root = temp_root("ansi-read");
        let snapshot = create_session(shell_request(
            "printf '\\033[31mred\\033[0m'",
            Some(root.clone()),
        ))
        .expect("create command session");
        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: Some("0".to_string()),
            max_bytes: Some(16),
            wait_ms: Some(1000),
            storage_root: Some(root.clone()),
        })
        .expect("read ansi output");
        assert_eq!(output.output, "red");
        let memory_json = output.memory.as_ref().expect("memory metadata");
        let memory: Value = serde_json::from_str(memory_json).expect("parse memory");
        let raw = fs::read_to_string(memory["rawOutputPath"].as_str().expect("raw path"))
            .expect("read raw output");
        assert!(raw.contains("\x1b[31mred\x1b[0m"));

        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("close session");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn screen_read_returns_visible_screen_and_records_diff_events() {
        let root = temp_root("screen-read");
        let snapshot = create_session(shell_request(
            "printf '\\033[2J\\033[Hafter'",
            Some(root.clone()),
        ))
        .expect("create command session");
        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: Some("0".to_string()),
            max_bytes: Some(64),
            wait_ms: Some(1000),
            storage_root: Some(root.clone()),
        })
        .expect("wait for output");
        assert_eq!(output.reason.as_deref(), Some("output"));

        let screen = read_screen(TerminalScreenReadRequest {
            session_id: snapshot.session_id.clone(),
            storage_root: Some(root.clone()),
            cursor: None,
            include_scrollback: Some(false),
            max_rows: Some(24),
            max_bytes: Some(1024),
            selected_text: None,
        })
        .expect("read screen");
        assert!(screen.visible_text.starts_with("after"));
        assert_eq!(screen.mode, "normal");
        assert!(screen.screen_version > 0);
        assert_eq!(screen.cursor, screen.screen_version.to_string());
        assert!(screen
            .visible_rows
            .iter()
            .any(|row| row.text.starts_with("after")));
        assert_eq!(screen.input_modes.mouse_reporting, "none");
        assert!(screen.memory.is_some());

        let memory: Value =
            serde_json::from_str(screen.memory.as_ref().expect("memory")).expect("parse memory");
        let events = fs::read_to_string(memory["eventLogPath"].as_str().expect("event path"))
            .expect("read events");
        assert!(events.contains("\"kind\":\"screen_diff\""));
        assert!(events.contains("\"previousScreenVersion\""));
        assert!(events.contains("\"dirtyRowRanges\""));
        assert!(events.contains("\"inputModes\""));

        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
            storage_root: Some(root.clone()),
            actor_json: None,
            correlation_json: None,
        })
        .expect("close session");
        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn screen_read_enriches_selection_active_command_prompt_and_regions() {
        let root = temp_root("screen-context");
        let session_id = format!("session-{}", uuid::Uuid::new_v4());
        memory::record_session_created(memory::SessionCreatedInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            title: "Terminal".to_string(),
            cwd: None,
            shell: "/bin/zsh".to_string(),
            cols: 80,
            rows: 24,
            source: "user".to_string(),
            mode: "shell".to_string(),
            command: None,
            persist: false,
            actor_json: None,
            correlation_json: None,
        })
        .expect("record session");
        memory::record_write(memory::WriteInput {
            storage_root: root.clone(),
            session_id: session_id.clone(),
            data: None,
            text: Some("npm test".to_string()),
            keys: None,
            append_newline: true,
            source: Some("agent".to_string()),
            actor_json: None,
            correlation_json: Some(serde_json::json!({ "commandId": "command-1" }).to_string()),
        })
        .expect("record command");
        memory::record_output(
            &memory::MemoryContext {
                storage_root: root.clone(),
                session_id: session_id.clone(),
            },
            b"\x1b]633;LyraPrompt\x07lyra % ",
        )
        .expect("record output");

        let screen = read_screen(TerminalScreenReadRequest {
            session_id: session_id.clone(),
            storage_root: Some(root.clone()),
            cursor: None,
            include_scrollback: Some(false),
            max_rows: Some(24),
            max_bytes: Some(4096),
            selected_text: Some(" lyra % ".to_string()),
        })
        .expect("read screen");

        assert_eq!(screen.selected_text.as_deref(), Some("lyra %"));
        assert_eq!(screen.active_command.as_deref(), Some("npm test"));
        assert_eq!(screen.prompt.as_deref(), Some("lyra %"));
        assert!(screen
            .regions
            .iter()
            .any(|region| region.kind == "prompt" && region.text == "lyra %"));

        fs::remove_dir_all(root).ok();
    }
}
