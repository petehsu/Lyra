use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use portable_pty::{MasterPty, PtySize};

use crate::lifecycle::terminal_lifecycle;
use crate::live_output::{
    live_output_projection, mark_session_exit, new_running_state, SessionOutputState,
    SessionStateHandle,
};
use crate::protocol::*;
use crate::pty_io::{
    compose_write_payload, normalize_terminal_cwd, parse_exit_code, spawn_io_threads, spawn_pty,
    SpawnedPty,
};
use crate::signals;
use crate::{
    to_error, Result, DEFAULT_READ_MAX_BYTES, DEFAULT_READ_WAIT_MS, MAX_SESSION_BUFFER_BYTES,
};

const CLOSE_INTERRUPT_WAIT_MS: u64 = 250;
const CLOSE_TERM_WAIT_MS: u64 = 750;
const CLOSE_KILL_WAIT_MS: u64 = 750;

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
static SESSIONS: Lazy<Mutex<HashMap<String, Arc<SessionRuntime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub(crate) struct SessionRuntime {
    pub(crate) session_id: String,
    pub(crate) title: String,
    pub(crate) cwd: Option<String>,
    pub(crate) current_cwd: Arc<Mutex<Option<String>>>,
    pub(crate) shell: String,
    pub(crate) cols: u16,
    pub(crate) rows: u16,
    pub(crate) created_at: String,
    created_at_instant: Instant,
    pub(crate) source: String,
    pub(crate) mode: String,
    pub(crate) command: Option<String>,
    pub(crate) process_id: Option<u32>,
    pub(crate) writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub(crate) master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub(crate) child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    pub(crate) state: SessionStateHandle,
}

pub(crate) fn now_iso_like() -> String {
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

pub(crate) fn output_state(
    runtime: &SessionRuntime,
) -> Result<std::sync::MutexGuard<'_, SessionOutputState>> {
    runtime
        .state
        .0
        .lock()
        .map_err(|_| to_error("failed to lock session state"))
}

fn session_running(runtime: &SessionRuntime) -> Option<bool> {
    runtime.state.0.lock().ok().map(|state| state.running)
}

fn wait_for_state_exit(state_handle: &SessionStateHandle, timeout: Duration) -> bool {
    let (lock, condvar) = &**state_handle;
    let Ok(mut state) = lock.lock() else {
        return false;
    };
    if !state.running {
        return true;
    }
    let deadline = Instant::now() + timeout;
    while state.running {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        let Ok((next_state, _)) =
            condvar.wait_timeout(state, deadline.saturating_duration_since(now))
        else {
            return false;
        };
        state = next_state;
    }
    !state.running
}

fn refresh_child_exit(runtime: &SessionRuntime) -> bool {
    if !session_running(runtime).unwrap_or(false) {
        return false;
    }
    let Ok(mut child) = runtime.child.try_lock() else {
        return true;
    };
    match child.try_wait() {
        Ok(Some(status)) => {
            mark_session_exit(&runtime.state, parse_exit_code(status));
            false
        }
        Ok(None) => true,
        Err(_) => true,
    }
}

fn send_named_signal(runtime: &SessionRuntime, name: &str) {
    if !refresh_child_exit(runtime) {
        return;
    }
    let Some(process_id) = runtime.process_id else {
        return;
    };
    match name {
        "SIGTERM" => lyra_process_lifecycle_core::terminate_process_tree(process_id, false),
        "SIGKILL" => lyra_process_lifecycle_core::terminate_process_tree(process_id, true),
        _ => {
            if let Some(signal) = signals::parse_signal(name) {
                let _ = signals::send_signal(process_id, &signal);
            }
        }
    }
}

fn snapshot_from_runtime(runtime: &SessionRuntime) -> Result<TerminalSessionSnapshot> {
    let state = output_state(runtime)?;
    let current_cwd = runtime
        .current_cwd
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    Ok(TerminalSessionSnapshot {
        session_id: runtime.session_id.clone(),
        title: runtime.title.clone(),
        cwd: runtime.cwd.clone(),
        current_cwd,
        shell: runtime.shell.clone(),
        cols: runtime.cols,
        rows: runtime.rows,
        created_at: runtime.created_at.clone(),
        source: runtime.source.clone(),
        mode: runtime.mode.clone(),
        command: runtime.command.clone(),
        persist: false,
        running: state.running,
        exit_code: state.exit_code,
    })
}

fn current_cwd_from_runtime(runtime: &SessionRuntime) -> Option<String> {
    runtime
        .current_cwd
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn terminal_lifecycle_with_cwd(
    session_id: &str,
    phase: &str,
    running: bool,
    exit_code: Option<i32>,
    reason: Option<&str>,
    source: Option<&str>,
    mode: Option<&str>,
    current_cwd: Option<String>,
) -> TerminalLifecycleProjection {
    let mut lifecycle =
        terminal_lifecycle(session_id, phase, running, exit_code, reason, source, mode);
    lifecycle.current_cwd = current_cwd;
    lifecycle
}

fn run_close_session(session_id: &str) {
    let runtime = if let Ok(sessions) = SESSIONS.lock() {
        sessions.get(session_id).cloned()
    } else {
        None
    };

    if let Some(runtime) = runtime {
        if !refresh_child_exit(&runtime) {
            if let Ok(mut sessions) = SESSIONS.lock() {
                sessions.remove(session_id);
            }
            return;
        }
        if let Ok(mut writer) = runtime.writer.lock() {
            let _ = writer.write_all(&[3_u8]);
            let _ = writer.flush();
            if wait_for_state_exit(
                &runtime.state,
                Duration::from_millis(CLOSE_INTERRUPT_WAIT_MS),
            ) {
                if let Ok(mut sessions) = SESSIONS.lock() {
                    sessions.remove(session_id);
                }
                return;
            }
        }
        if runtime.process_id.is_some() {
            send_named_signal(&runtime, "SIGTERM");
            if !wait_for_state_exit(&runtime.state, Duration::from_millis(CLOSE_TERM_WAIT_MS)) {
                send_named_signal(&runtime, "SIGKILL");
                let _ =
                    wait_for_state_exit(&runtime.state, Duration::from_millis(CLOSE_KILL_WAIT_MS));
            }
        }
        if let Ok(mut sessions) = SESSIONS.lock() {
            sessions.remove(session_id);
        }
    }
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

    let SpawnedPty {
        shell,
        process_id,
        writer,
        reader,
        master,
        child,
    } = spawn_pty(
        request.shell.as_deref(),
        request.env.as_deref(),
        rows,
        cols,
        cwd.as_deref(),
        &mode,
        command_text.as_deref(),
    )?;

    let state = new_running_state();
    let runtime = Arc::new(SessionRuntime {
        session_id: session_id.clone(),
        title: title.clone(),
        cwd: cwd.clone(),
        current_cwd: Arc::new(Mutex::new(cwd.clone())),
        shell: shell.clone(),
        cols,
        rows,
        created_at: now_iso_like(),
        created_at_instant: Instant::now(),
        source: source.clone(),
        mode: mode.clone(),
        command: command_text.clone(),
        process_id,
        writer: Arc::new(Mutex::new(writer)),
        master: Arc::new(Mutex::new(master)),
        child: Arc::new(Mutex::new(child)),
        state,
    });

    if let Ok(mut sessions) = SESSIONS.lock() {
        sessions.insert(session_id.clone(), Arc::clone(&runtime));
    }

    let snapshot = snapshot_from_runtime(&runtime)?;
    spawn_io_threads(session_id, runtime, reader, Box::new(|_| {}));
    Ok(snapshot)
}

pub(crate) fn create_session(request: TerminalCreateRequest) -> Result<TerminalSessionSnapshot> {
    create_runtime(request)
}

pub(crate) fn runtime_for_session(session_id: &str) -> Option<Arc<SessionRuntime>> {
    SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(session_id).cloned())
}

pub(crate) fn runtime_process_id(runtime: &SessionRuntime) -> Option<u32> {
    runtime.process_id
}

pub(crate) fn write_session(request: TerminalWriteRequest) -> Result<()> {
    let runtime = SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&request.session_id).cloned())
        .ok_or_else(|| to_error("session not found"))?;

    let payload = compose_write_payload(&request)?;
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
    Ok(())
}

pub(crate) fn read_session(request: TerminalReadRequest) -> Result<TerminalReadResponse> {
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

    let current_cwd = current_cwd_from_runtime(&runtime);
    Ok(TerminalReadResponse {
        session_id: runtime.session_id.clone(),
        cursor: cursor.to_string(),
        output,
        running,
        exit_code,
        truncated,
        source: runtime.source.clone(),
        mode: runtime.mode.clone(),
        memory: None,
        reason: Some(reason.to_string()),
        lifecycle: Some(terminal_lifecycle_with_cwd(
            &runtime.session_id,
            "terminal_read",
            running,
            exit_code,
            Some(reason),
            Some(runtime.source.as_str()),
            Some(runtime.mode.as_str()),
            current_cwd,
        )),
    })
}

pub(crate) fn resize_session(request: TerminalResizeRequest) -> Result<()> {
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
    Ok(())
}

pub(crate) fn close_session(request: TerminalCloseRequest) -> Result<()> {
    run_close_session(&request.session_id);
    Ok(())
}

pub(crate) fn shutdown() -> Result<()> {
    let sessions_to_close = if let Ok(sessions) = SESSIONS.lock() {
        sessions.keys().map(|id| id.clone()).collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    for id in sessions_to_close {
        run_close_session(&id);
    }

    Ok(())
}
