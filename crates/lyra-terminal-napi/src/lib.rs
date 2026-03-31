use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi::{JsFunction, JsObject};
use napi_derive::napi;
use once_cell::sync::Lazy;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use shell::{
    configure_shell_command, configure_shell_environment, make_shell_candidates, shell_exists,
};

mod shell;

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
static SESSIONS: Lazy<Mutex<HashMap<String, Arc<SessionRuntime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static EVENT_CALLBACK: Lazy<Mutex<Option<EventCallback>>> = Lazy::new(|| Mutex::new(None));

type EventCallback = ThreadsafeFunction<NativeEvent, ErrorStrategy::CalleeHandled>;

#[derive(Clone)]
struct NativeEvent {
    kind: String,
    session_id: String,
    data: Option<String>,
    exit_code: Option<i32>,
    error: Option<String>,
}

struct SessionRuntime {
    snapshot: TerminalSessionSnapshot,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

#[napi(object)]
pub struct TerminalCreateRequest {
    pub session_id: Option<String>,
    pub title: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub source: Option<String>,
}

#[napi(object)]
pub struct TerminalWriteRequest {
    pub session_id: String,
    pub data: String,
    pub source: Option<String>,
}

#[napi(object)]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[napi(object)]
pub struct TerminalCloseRequest {
    pub session_id: String,
}

#[napi(object)]
pub struct TerminalRestoreRequest {
    pub sessions: Vec<TerminalCreateRequest>,
}

#[napi(object)]
#[derive(Clone)]
pub struct TerminalSessionSnapshot {
    pub session_id: String,
    pub title: String,
    pub cwd: Option<String>,
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
    pub created_at: String,
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

fn is_ai_source(source: Option<&str>) -> bool {
    matches!(source.map(str::trim), Some("ai"))
}

fn emit_event(event: NativeEvent) {
    if let Ok(guard) = EVENT_CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            let _ = callback.call(Ok(event), ThreadsafeFunctionCallMode::NonBlocking);
        }
    }
}

fn run_close_session(session_id: &str) {
    let runtime = if let Ok(mut sessions) = SESSIONS.lock() {
        sessions.remove(session_id)
    } else {
        None
    };

    if let Some(runtime) = runtime {
        if let Ok(mut writer) = runtime.writer.lock() {
            let _ = writer.write_all(b"exit\n");
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

fn spawn_io_threads(
    session_id: String,
    runtime: Arc<SessionRuntime>,
    mut reader: Box<dyn Read + Send>,
) {
    let session_id_for_reader = session_id.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                    emit_event(NativeEvent {
                        kind: "data".to_string(),
                        session_id: session_id_for_reader.clone(),
                        data: Some(data),
                        exit_code: None,
                        error: None,
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
                    });
                    break;
                }
            }
        }
    });

    thread::spawn(move || {
        let exit_code = if let Ok(mut child) = runtime.child.lock() {
            child
                .wait()
                .ok()
                .map(|status| if status.success() { 0 } else { 1 })
                .unwrap_or_default()
        } else {
            1
        };

        if let Ok(mut sessions) = SESSIONS.lock() {
            sessions.remove(&session_id);
        }

        emit_event(NativeEvent {
            kind: "exit".to_string(),
            session_id,
            data: None,
            exit_code: Some(exit_code),
            error: None,
        });
    });
}

fn create_runtime(request: TerminalCreateRequest) -> Result<TerminalSessionSnapshot> {
    if is_ai_source(request.source.as_deref()) {
        return Err(to_error("ai terminal execution is disabled in v1"));
    }

    let session_id = request
        .session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(next_session_id);

    if let Ok(sessions) = SESSIONS.lock() {
        if let Some(runtime) = sessions.get(&session_id) {
            return Ok(runtime.snapshot.clone());
        }
    }

    let title = request
        .title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| session_id.clone());

    let rows = request.rows.max(1);
    let cols = request.cols.max(1);
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

        let mut command = CommandBuilder::new(shell.clone());
        configure_shell_environment(&mut command, &shell);
        configure_shell_command(&mut command, &shell);
        if let Some(cwd) = request.cwd.as_deref() {
            let cwd_trimmed = cwd.trim();
            if !cwd_trimmed.is_empty() {
                command.cwd(cwd_trimmed);
            }
        }

        let child = match pair.slave.spawn_command(command) {
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

        let snapshot = TerminalSessionSnapshot {
            session_id: session_id.clone(),
            title: title.clone(),
            cwd: request.cwd.clone(),
            shell,
            cols,
            rows,
            created_at: now_iso_like(),
        };

        let runtime = Arc::new(SessionRuntime {
            snapshot: snapshot.clone(),
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
        });

        if let Ok(mut sessions) = SESSIONS.lock() {
            sessions.insert(session_id.clone(), Arc::clone(&runtime));
        }

        spawn_io_threads(session_id, runtime, reader);
        return Ok(snapshot);
    }

    Err(to_error(format!("failed to spawn shell: {spawn_error}")))
}

#[napi]
pub fn register_event_callback(callback: JsFunction) -> Result<()> {
    let tsfn: EventCallback =
        callback.create_threadsafe_function(0, |context: ThreadSafeCallContext<NativeEvent>| {
            let mut object: JsObject = context.env.create_object()?;
            object.set_named_property("kind", context.env.create_string(&context.value.kind)?)?;
            object.set_named_property(
                "sessionId",
                context.env.create_string(&context.value.session_id)?,
            )?;

            if let Some(data) = context.value.data {
                object.set_named_property("data", context.env.create_string(&data)?)?;
            }

            if let Some(exit_code) = context.value.exit_code {
                object.set_named_property("exitCode", context.env.create_int32(exit_code)?)?;
            }

            if let Some(error) = context.value.error {
                object.set_named_property("error", context.env.create_string(&error)?)?;
            }

            Ok(vec![object.into_unknown()])
        })?;

    if let Ok(mut guard) = EVENT_CALLBACK.lock() {
        *guard = Some(tsfn);
    }

    Ok(())
}

#[napi]
pub fn create_session(request: TerminalCreateRequest) -> Result<TerminalSessionSnapshot> {
    create_runtime(request)
}

#[napi]
pub fn restore_sessions(request: TerminalRestoreRequest) -> Result<Vec<TerminalSessionSnapshot>> {
    let mut restored = Vec::with_capacity(request.sessions.len());
    for item in request.sessions {
        restored.push(create_runtime(item)?);
    }
    Ok(restored)
}

#[napi]
pub fn write_session(request: TerminalWriteRequest) -> Result<()> {
    if is_ai_source(request.source.as_deref()) {
        return Err(to_error("ai terminal execution is disabled in v1"));
    }

    let runtime = SESSIONS
        .lock()
        .ok()
        .and_then(|sessions| sessions.get(&request.session_id).cloned())
        .ok_or_else(|| to_error("session not found"))?;

    let mut writer = runtime
        .writer
        .lock()
        .map_err(|_| to_error("failed to lock pty writer"))?;

    writer
        .write_all(request.data.as_bytes())
        .map_err(|error| to_error(format!("pty write failed: {error}")))?;
    writer
        .flush()
        .map_err(|error| to_error(format!("pty flush failed: {error}")))?;

    Ok(())
}

#[napi]
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

#[napi]
pub fn close_session(request: TerminalCloseRequest) -> Result<()> {
    run_close_session(&request.session_id);
    Ok(())
}

#[napi]
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
