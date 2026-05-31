use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(feature = "node-api")]
use napi::bindgen_prelude::*;
#[cfg(feature = "node-api")]
use napi_derive::napi;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use shell::{
    configure_shell_command, configure_shell_environment, make_shell_candidates, shell_exists,
};

mod shell;

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

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
static SESSIONS: Lazy<Mutex<HashMap<String, Arc<SessionRuntime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RUST_EVENT_CALLBACK: Lazy<Mutex<Option<RustEventCallback>>> = Lazy::new(|| Mutex::new(None));

type RustEventCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;
type SessionStateHandle = Arc<(Mutex<SessionOutputState>, Condvar)>;

#[cfg_attr(not(feature = "node-api"), allow(dead_code))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeEvent {
    kind: String,
    session_id: String,
    data: Option<String>,
    exit_code: Option<i32>,
    error: Option<String>,
    source: Option<String>,
    mode: Option<String>,
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
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    state: SessionStateHandle,
}

#[derive(Default)]
struct SessionOutputState {
    buffer: Vec<u8>,
    retained_start: u64,
    total_bytes: u64,
    running: bool,
    exit_code: Option<i32>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalCreateRequest {
    pub session_id: Option<String>,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub source: Option<String>,
    pub mode: Option<String>,
    pub command: Option<String>,
    pub persist: Option<bool>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalWriteRequest {
    pub session_id: String,
    pub data: Option<String>,
    pub text: Option<String>,
    pub keys: Option<Vec<String>>,
    pub append_newline: Option<bool>,
    pub source: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalReadRequest {
    pub session_id: String,
    pub cursor: Option<String>,
    pub max_bytes: Option<u32>,
    pub wait_ms: Option<u32>,
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
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalCloseRequest {
    pub session_id: String,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct TerminalRestoreRequest {
    pub sessions: Vec<TerminalCreateRequest>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSnapshot {
    pub session_id: String,
    pub title: String,
    pub cwd: Option<String>,
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

fn normalize_persist(request: &TerminalCreateRequest, source: &str) -> bool {
    request.persist.unwrap_or(source != "ai")
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
        condvar.notify_all();
    }
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
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let chunk = &buffer[..size];
                    append_output(&state_for_reader, chunk);
                    let data = String::from_utf8_lossy(chunk).to_string();
                    emit_event(NativeEvent {
                        kind: "data".to_string(),
                        session_id: session_id_for_reader.clone(),
                        data: Some(data),
                        exit_code: None,
                        error: None,
                        source: Some(source_for_reader.clone()),
                        mode: Some(mode_for_reader.clone()),
                    });
                }
                Err(error) => {
                    if error.kind() == std::io::ErrorKind::Interrupted {
                        continue;
                    }
                    emit_event(NativeEvent {
                        kind: "error".to_string(),
                        session_id: session_id_for_reader.clone(),
                        data: None,
                        exit_code: None,
                        error: Some(error.to_string()),
                        source: Some(source_for_reader.clone()),
                        mode: Some(mode_for_reader.clone()),
                    });
                    break;
                }
            }
        }
    });

    let source_for_exit = runtime.source.clone();
    let mode_for_exit = runtime.mode.clone();
    let state_for_exit = Arc::clone(&runtime.state);
    thread::spawn(move || {
        let exit_code = if let Ok(mut child) = runtime.child.lock() {
            child.wait().ok().map(parse_exit_code).unwrap_or(1)
        } else {
            1
        };

        mark_session_exit(&state_for_exit, exit_code);

        emit_event(NativeEvent {
            kind: "exit".to_string(),
            session_id,
            data: None,
            exit_code: Some(exit_code),
            error: None,
            source: Some(source_for_exit),
            mode: Some(mode_for_exit),
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
            payload.push_str(match key.as_str() {
                "enter" => "\n",
                "escape" => "\u{1b}",
                "tab" => "\t",
                "ctrl_c" => "\u{3}",
                "ctrl_d" => "\u{4}",
                "up" => "\u{1b}[A",
                "down" => "\u{1b}[B",
                "right" => "\u{1b}[C",
                "left" => "\u{1b}[D",
                "page_up" => "\u{1b}[5~",
                "page_down" => "\u{1b}[6~",
                "home" => "\u{1b}[H",
                "end" => "\u{1b}[F",
                other => {
                    return Err(to_error(format!("unsupported terminal key: {other}")));
                }
            });
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
    let command_text = request
        .command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

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
        apply_shell_cwd(&mut builder, request.cwd.as_deref());
        if mode == "shell" {
            configure_shell_environment(&mut builder, &shell);
            configure_shell_command(&mut builder, &shell);
        } else if let Some(command) = command_text.as_deref() {
            configure_command_mode(&mut builder, &shell, command);
        }

        let child = match pair.slave.spawn_command(builder) {
            Ok(v) => v,
            Err(error) => {
                spawn_error = error.to_string();
                continue;
            }
        };

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

        let runtime = Arc::new(SessionRuntime {
            session_id: session_id.clone(),
            title: title.clone(),
            cwd: request.cwd.clone(),
            shell,
            cols,
            rows,
            created_at: now_iso_like(),
            source,
            mode,
            command: command_text.clone(),
            persist,
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
            state,
        });

        if let Ok(mut sessions) = SESSIONS.lock() {
            sessions.insert(session_id.clone(), Arc::clone(&runtime));
        }

        let snapshot = snapshot_from_runtime(&runtime)?;
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
pub fn restore_sessions(request: TerminalRestoreRequest) -> Result<Vec<TerminalSessionSnapshot>> {
    let mut restored = Vec::with_capacity(request.sessions.len());
    for item in request.sessions {
        restored.push(create_runtime(item)?);
    }
    Ok(restored)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn write_session(request: TerminalWriteRequest) -> Result<()> {
    let runtime = SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&request.session_id).cloned())
        .ok_or_else(|| to_error("session not found"))?;

    let payload = compose_write_payload(&request)?;
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
    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn read_session(request: TerminalReadRequest) -> Result<TerminalReadResponse> {
    let runtime = SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&request.session_id).cloned())
        .ok_or_else(|| to_error("session not found"))?;

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
    let observed_cursor = requested_cursor.min(state.total_bytes);

    if state.total_bytes <= observed_cursor && state.running && wait_ms > 0 {
        let wait_deadline = Duration::from_millis(wait_ms);
        let (next_state, _) = condvar
            .wait_timeout_while(state, wait_deadline, |current| {
                current.total_bytes <= observed_cursor && current.running
            })
            .map_err(|_| to_error("failed to wait for session output"))?;
        state = next_state;
    }

    let available_start = observed_cursor.max(state.retained_start);
    let mut truncated = observed_cursor < state.retained_start;
    let start_index = (available_start.saturating_sub(state.retained_start)) as usize;
    let mut output_bytes = if start_index >= state.buffer.len() {
        Vec::new()
    } else {
        state.buffer[start_index..].to_vec()
    };
    if output_bytes.len() > max_bytes {
        let keep_from = output_bytes.len() - max_bytes;
        output_bytes = output_bytes[keep_from..].to_vec();
        truncated = true;
    }

    Ok(TerminalReadResponse {
        session_id: runtime.session_id.clone(),
        cursor: state.total_bytes.to_string(),
        output: String::from_utf8_lossy(&output_bytes).to_string(),
        running: state.running,
        exit_code: state.exit_code,
        truncated,
        source: runtime.source.clone(),
        mode: runtime.mode.clone(),
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
        .map_err(|error| to_error(format!("pty resize failed: {error}")))
}

#[cfg_attr(feature = "node-api", napi)]
pub fn close_session(request: TerminalCloseRequest) -> Result<()> {
    run_close_session(&request.session_id);
    Ok(())
}

#[cfg_attr(feature = "node-api", napi)]
pub fn shutdown() -> Result<()> {
    let ids = if let Ok(sessions) = SESSIONS.lock() {
        sessions.keys().cloned().collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    for id in ids {
        run_close_session(&id);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        close_session, create_session, read_session, write_session, TerminalCloseRequest,
        TerminalCreateRequest, TerminalReadRequest, TerminalWriteRequest,
    };
    use std::thread;
    use std::time::Duration;

    fn shell_request(command: &str) -> TerminalCreateRequest {
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
            persist: Some(false),
        }
    }

    #[test]
    fn ai_source_command_session_can_be_read() {
        let snapshot =
            create_session(shell_request("printf 'hello'")).expect("create command session");
        thread::sleep(Duration::from_millis(150));
        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: None,
            max_bytes: None,
            wait_ms: Some(1000),
        })
        .expect("read session");
        assert!(output.output.contains("hello"));
        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
        })
        .expect("close session");
    }

    #[test]
    fn shell_session_accepts_key_writes() {
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
            persist: Some(false),
        })
        .expect("create shell session");
        write_session(TerminalWriteRequest {
            session_id: snapshot.session_id.clone(),
            data: None,
            text: Some("printf 'ping'".to_string()),
            keys: Some(vec!["enter".to_string()]),
            append_newline: None,
            source: Some("ai".to_string()),
        })
        .expect("write shell session");
        thread::sleep(Duration::from_millis(200));
        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: None,
            max_bytes: None,
            wait_ms: Some(1000),
        })
        .expect("read shell session");
        assert!(output.output.contains("ping"));
        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
        })
        .expect("close shell session");
    }

    #[test]
    fn shell_session_appends_newline_to_data_writes() {
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
            persist: Some(false),
        })
        .expect("create shell session");
        write_session(TerminalWriteRequest {
            session_id: snapshot.session_id.clone(),
            data: Some("printf 'newline-data'".to_string()),
            text: None,
            keys: None,
            append_newline: Some(true),
            source: Some("ai".to_string()),
        })
        .expect("write shell session");
        thread::sleep(Duration::from_millis(200));
        let output = read_session(TerminalReadRequest {
            session_id: snapshot.session_id.clone(),
            cursor: None,
            max_bytes: None,
            wait_ms: Some(1000),
        })
        .expect("read shell session");
        assert!(output.output.contains("newline-data"));
        close_session(TerminalCloseRequest {
            session_id: snapshot.session_id,
        })
        .expect("close shell session");
    }
}
