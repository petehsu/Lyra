use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use portable_pty::{MasterPty, PtySize};

use crate::attachments;
use crate::events::{emit_command_completion, emit_cwd_changed};
use crate::lifecycle::terminal_lifecycle;
use crate::live_output::{
    append_output, live_output_projection, mark_session_exit, new_running_state,
    SessionOutputState, SessionStateHandle,
};
use crate::memory;
use crate::memory_writer::{TerminalMemoryTask, TerminalMemoryWriter};
use crate::protocol::*;
use crate::pty_io::{
    compose_write_payload, normalize_terminal_cwd, spawn_io_threads, spawn_pty, SpawnedPty,
};
use crate::screen;
use crate::shell_integration;
use crate::shell_integration::ShellIntegrationEventKind;
use crate::{
    to_error, Result, DEFAULT_READ_MAX_BYTES, DEFAULT_READ_WAIT_MS, MAX_SESSION_BUFFER_BYTES,
};

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
static SESSIONS: Lazy<Mutex<HashMap<String, Arc<SessionRuntime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static OBSERVED_SESSIONS: Lazy<Mutex<HashMap<String, Arc<ObservedSessionRuntime>>>> =
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
    pub(crate) source: String,
    pub(crate) mode: String,
    pub(crate) command: Option<String>,
    pub(crate) persist: bool,
    pub(crate) storage_root: Option<String>,
    pub(crate) writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pub(crate) master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub(crate) child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    pub(crate) state: SessionStateHandle,
    pub(crate) screen: Arc<Mutex<screen::TerminalScreenState>>,
    pub(crate) memory_writer: Option<TerminalMemoryWriter>,
}

pub(crate) struct ObservedSessionRuntime {
    pub(crate) session_id: String,
    pub(crate) title: String,
    pub(crate) cwd: Option<String>,
    pub(crate) current_cwd: Arc<Mutex<Option<String>>>,
    pub(crate) shell: String,
    pub(crate) created_at: String,
    pub(crate) source: String,
    pub(crate) mode: String,
    pub(crate) command: Option<String>,
    pub(crate) persist: bool,
    pub(crate) storage_root: String,
    pub(crate) dimensions: Arc<Mutex<(u16, u16)>>,
    pub(crate) state: SessionStateHandle,
    pub(crate) screen: Arc<Mutex<screen::TerminalScreenState>>,
    pub(crate) shell_parser: Arc<Mutex<shell_integration::ShellIntegrationParser>>,
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

pub(crate) fn output_state(
    runtime: &SessionRuntime,
) -> Result<std::sync::MutexGuard<'_, SessionOutputState>> {
    runtime
        .state
        .0
        .lock()
        .map_err(|_| to_error("failed to lock session state"))
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
        persist: runtime.persist,
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

fn current_cwd_from_observed_runtime(runtime: &ObservedSessionRuntime) -> Option<String> {
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
        current_cwd: Arc::new(Mutex::new(cwd.clone())),
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
        master: Arc::new(Mutex::new(master)),
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
    Ok(snapshot)
}

pub(crate) fn create_session(request: TerminalCreateRequest) -> Result<TerminalSessionSnapshot> {
    create_runtime(request)
}

pub(crate) fn restore_sessions(
    request: TerminalRestoreRequest,
) -> Result<Vec<TerminalSessionSnapshot>> {
    let mut restored = Vec::with_capacity(request.sessions.len());
    for item in request.sessions {
        restored.push(create_runtime(item)?);
    }
    Ok(restored)
}

pub(crate) fn create_observer_session(
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
    let state = new_running_state();
    let runtime = Arc::new(ObservedSessionRuntime {
        session_id: session_id.clone(),
        title: title.clone(),
        cwd: request.cwd.clone(),
        current_cwd: Arc::new(Mutex::new(request.cwd.clone())),
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

pub(crate) fn observed_runtime_for_session(
    session_id: &str,
) -> Option<Arc<ObservedSessionRuntime>> {
    OBSERVED_SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(session_id).cloned())
}

pub(crate) fn runtime_for_session(session_id: &str) -> Option<Arc<SessionRuntime>> {
    SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(session_id).cloned())
}

pub(crate) fn runtime_process_id(runtime: &SessionRuntime) -> Option<u32> {
    runtime
        .child
        .lock()
        .ok()
        .and_then(|child| child.process_id())
}

pub(crate) fn record_observer_input(request: TerminalObserverInputRequest) -> Result<()> {
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

pub(crate) fn record_observer_output(request: TerminalObserverOutputRequest) -> Result<()> {
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
        .filter(|event| event.kind == ShellIntegrationEventKind::CwdChanged)
    {
        if let Some(cwd) = event.cwd.as_ref() {
            if let Ok(mut current_cwd) = runtime.current_cwd.lock() {
                *current_cwd = Some(cwd.clone());
            }
            emit_cwd_changed(&runtime.session_id, &runtime.source, &runtime.mode, cwd);
        }
    }
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

pub(crate) fn resize_observer_session(request: TerminalObserverResizeRequest) -> Result<()> {
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

pub(crate) fn record_observer_exit(request: TerminalObserverExitRequest) -> Result<()> {
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

pub(crate) fn close_observer_session(request: TerminalObserverCloseRequest) -> Result<()> {
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

pub(crate) fn write_session(mut request: TerminalWriteRequest) -> Result<()> {
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

pub(crate) fn read_session(request: TerminalReadRequest) -> Result<TerminalReadResponse> {
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
            let current_cwd = current_cwd_from_observed_runtime(&runtime);
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
            session_id: request.session_id.clone(),
            cursor: projection.cursor.to_string(),
            output: projection.output,
            running: false,
            exit_code,
            truncated: projection.truncated,
            source: source.clone(),
            mode: mode.clone(),
            memory,
            reason: Some(reason.to_string()),
            lifecycle: Some(terminal_lifecycle(
                &request.session_id,
                "terminal_read",
                false,
                exit_code,
                Some(reason),
                Some(source.as_str()),
                Some(mode.as_str()),
            )),
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
        memory,
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

pub(crate) fn close_session(request: TerminalCloseRequest) -> Result<()> {
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

pub(crate) fn shutdown() -> Result<()> {
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
