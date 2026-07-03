use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(feature = "node-api")]
use napi::bindgen_prelude::*;
#[cfg(feature = "node-api")]
use napi_derive::napi;
use once_cell::sync::Lazy;
use serde::Serialize;
use serde_json::{json, Value};
use url::Url;

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

type RustEventCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;

static SERVERS: Lazy<Mutex<HashMap<String, Arc<LspServerRuntime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RUST_EVENT_CALLBACK: Lazy<Mutex<Option<RustEventCallback>>> = Lazy::new(|| Mutex::new(None));
static RESTART_BACKOFFS: Lazy<Mutex<HashMap<String, Instant>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const LSP_RESTART_BACKOFF: Duration = Duration::from_secs(2);
const LSP_KILL_GRACE: Duration = Duration::from_millis(1_500);
const LSP_STDERR_WINDOW: Duration = Duration::from_secs(5);
const MAX_LSP_STDERR_EVENTS_PER_WINDOW: usize = 20;
const MAX_LSP_STDERR_LINE_BYTES: usize = 4 * 1024;

#[derive(Clone)]
struct ServerCommandSpec {
    program: String,
    args: Vec<String>,
}

struct LspServerRuntime {
    key: String,
    language_id: String,
    project_root: String,
    child_pid: u32,
    stopping: AtomicBool,
    writer: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    next_request_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>,
    uri_sessions: Arc<Mutex<HashMap<String, String>>>,
    uri_paths: Arc<Mutex<HashMap<String, String>>>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct LspDocumentRequest {
    pub session_id: String,
    pub file_path: String,
    pub language_id: String,
    pub content: String,
    pub version: i32,
    pub project_root: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct LspCompletionRequest {
    pub session_id: String,
    pub file_path: String,
    pub language_id: String,
    pub line: u32,
    pub column: u32,
    pub version: i32,
    pub project_root: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
pub struct LspPositionRequest {
    pub file_path: String,
    pub language_id: String,
    pub line: u32,
    pub column: u32,
    pub project_root: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspLocation {
    pub file_path: String,
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspHoverResult {
    pub contents: String,
    pub start_line: Option<u32>,
    pub start_character: Option<u32>,
    pub end_line: Option<u32>,
    pub end_character: Option<u32>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspCompletionItem {
    pub label: String,
    pub insert_text: Option<String>,
    pub detail: Option<String>,
    pub documentation: Option<String>,
    pub kind: Option<u32>,
    pub sort_text: Option<String>,
    pub filter_text: Option<String>,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspCompletionResult {
    pub items: Vec<LspCompletionItem>,
    pub is_incomplete: bool,
}

#[cfg_attr(feature = "node-api", napi(object))]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspRuntimeEvent {
    pub kind: String,
    pub session_id: Option<String>,
    pub file_path: Option<String>,
    pub language_id: Option<String>,
    pub project_root: Option<String>,
    pub status: Option<String>,
    pub message: Option<String>,
}

fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn emit_event(event: LspRuntimeEvent) {
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

fn normalize_language_id(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_lowercase();
    match normalized.as_str() {
        "typescript" | "ts" => Some("typescript"),
        "javascript" | "js" => Some("javascript"),
        "rust" | "rs" => Some("rust"),
        "python" | "py" => Some("python"),
        _ => None,
    }
}

fn resolve_server_command(language_id: &str) -> Option<ServerCommandSpec> {
    match language_id {
        "typescript" | "javascript" => {
            let program = std::env::var("LYRA_LSP_TYPESCRIPT_SERVER")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "typescript-language-server".to_string());
            Some(ServerCommandSpec {
                program,
                args: vec!["--stdio".to_string()],
            })
        }
        "rust" => {
            let program = std::env::var("LYRA_LSP_RUST_ANALYZER")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "rust-analyzer".to_string());
            Some(ServerCommandSpec {
                program,
                args: Vec::new(),
            })
        }
        "python" => {
            let program = std::env::var("LYRA_LSP_PYRIGHT")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "pyright-langserver".to_string());
            Some(ServerCommandSpec {
                program,
                args: vec!["--stdio".to_string()],
            })
        }
        _ => None,
    }
}

fn normalize_file_path(file_path: &str) -> Result<PathBuf> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err(to_error("file_path is required"));
    }

    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Ok(path)
    } else {
        std::env::current_dir()
            .map(|base| base.join(path))
            .map_err(|error| to_error(format!("failed to resolve file path: {error}")))
    }
}

fn normalize_project_root(project_root: Option<&str>, file_path: &Path) -> PathBuf {
    if let Some(explicit) = project_root {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            let explicit_path = PathBuf::from(trimmed);
            if explicit_path.is_absolute() {
                return explicit_path;
            }
            if let Ok(cwd) = std::env::current_dir() {
                return cwd.join(explicit_path);
            }
            return explicit_path;
        }
    }

    let mut cursor = if file_path.is_dir() {
        file_path.to_path_buf()
    } else {
        file_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| file_path.to_path_buf())
    };

    loop {
        if cursor.join(".git").exists() {
            return cursor;
        }
        if !cursor.pop() {
            break;
        }
    }

    file_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| file_path.to_path_buf())
}

fn path_to_file_uri(path: &Path) -> Result<String> {
    Url::from_file_path(path)
        .map(|value| value.to_string())
        .map_err(|_| to_error("failed to convert file path to uri"))
}

fn file_uri_to_path(value: &str) -> Option<String> {
    let parsed = Url::parse(value).ok()?;
    let path = parsed.to_file_path().ok()?;
    Some(path.to_string_lossy().into_owned())
}

fn send_payload(runtime: &LspServerRuntime, payload: &Value) -> Result<()> {
    let serialized = serde_json::to_vec(payload)
        .map_err(|error| to_error(format!("failed to serialize lsp payload: {error}")))?;

    let header = format!("Content-Length: {}\r\n\r\n", serialized.len());
    let mut writer = runtime
        .writer
        .lock()
        .map_err(|_| to_error("failed to lock lsp stdin"))?;

    writer
        .write_all(header.as_bytes())
        .and_then(|_| writer.write_all(&serialized))
        .and_then(|_| writer.flush())
        .map_err(|error| to_error(format!("failed to write lsp payload: {error}")))
}

fn send_notification(runtime: &LspServerRuntime, method: &str, params: Value) -> Result<()> {
    let payload = json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params
    });
    send_payload(runtime, &payload)
}

fn send_request(runtime: &LspServerRuntime, method: &str, params: Value) -> Result<Value> {
    let request_id = runtime.next_request_id.fetch_add(1, Ordering::Relaxed);
    let payload = json!({
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params
    });

    let (sender, receiver) = mpsc::channel::<Value>();
    {
        let mut pending = runtime
            .pending
            .lock()
            .map_err(|_| to_error("failed to lock pending requests"))?;
        pending.insert(request_id, sender);
    }

    if let Err(error) = send_payload(runtime, &payload) {
        if let Ok(mut pending) = runtime.pending.lock() {
            pending.remove(&request_id);
        }
        return Err(error);
    }

    let response = receiver
        .recv_timeout(Duration::from_secs(8))
        .map_err(|_| to_error(format!("lsp request timeout: {method}")))?;

    if let Some(error) = response.get("error") {
        return Err(to_error(format!("lsp request failed: {error}")));
    }

    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

fn parse_lsp_message<R: Read>(reader: &mut BufReader<R>) -> std::io::Result<Option<Value>> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut header_line = String::new();
        let read_bytes = reader.read_line(&mut header_line)?;
        if read_bytes == 0 {
            return Ok(None);
        }

        let trimmed = header_line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().ok();
            }
        }
    }

    let length = match content_length {
        Some(value) if value > 0 => value,
        _ => return Ok(None),
    };

    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body)?;

    serde_json::from_slice::<Value>(&body)
        .map(Some)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()))
}

fn dispatch_lsp_notification(_runtime: &Arc<LspServerRuntime>, _message: &Value) {}

fn server_key(language_id: &str, project_root: &Path) -> String {
    format!("{language_id}::{}", project_root.to_string_lossy())
}

fn record_restart_backoff(key: &str) {
    if let Ok(mut guard) = RESTART_BACKOFFS.lock() {
        guard.insert(key.to_string(), Instant::now() + LSP_RESTART_BACKOFF);
    }
}

fn restart_backoff_remaining(key: &str) -> Option<Duration> {
    let mut guard = RESTART_BACKOFFS.lock().ok()?;
    let until = *guard.get(key)?;
    let now = Instant::now();
    if until <= now {
        guard.remove(key);
        None
    } else {
        Some(until.saturating_duration_since(now))
    }
}

fn emit_lsp_stderr(runtime: &LspServerRuntime, message: String) {
    emit_event(LspRuntimeEvent {
        kind: "error".to_string(),
        session_id: None,
        file_path: None,
        language_id: Some(runtime.language_id.clone()),
        project_root: Some(runtime.project_root.clone()),
        status: None,
        message: Some(message),
    });
}

fn read_bounded_stderr_line<R: BufRead>(
    reader: &mut R,
    buffer: &mut Vec<u8>,
) -> std::io::Result<Option<(String, bool)>> {
    buffer.clear();
    let mut truncated = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            if buffer.is_empty() {
                return Ok(None);
            }
            let text = String::from_utf8_lossy(buffer).trim().to_string();
            return Ok(Some((text, truncated)));
        }

        if let Some(newline_index) = available.iter().position(|byte| *byte == b'\n') {
            let line_bytes = &available[..newline_index];
            let remaining = MAX_LSP_STDERR_LINE_BYTES.saturating_sub(buffer.len());
            let append_len = line_bytes.len().min(remaining);
            buffer.extend_from_slice(&line_bytes[..append_len]);
            truncated |= append_len < line_bytes.len();
            reader.consume(newline_index + 1);
            let text = String::from_utf8_lossy(buffer).trim().to_string();
            return Ok(Some((text, truncated)));
        }

        let remaining = MAX_LSP_STDERR_LINE_BYTES.saturating_sub(buffer.len());
        if remaining == 0 {
            let text = String::from_utf8_lossy(buffer).trim().to_string();
            return Ok(Some((text, true)));
        }
        let append_len = available.len().min(remaining);
        buffer.extend_from_slice(&available[..append_len]);
        reader.consume(append_len);
        if buffer.len() >= MAX_LSP_STDERR_LINE_BYTES {
            let text = String::from_utf8_lossy(buffer).trim().to_string();
            return Ok(Some((text, true)));
        }
    }
}

fn format_stderr_message(text: String, truncated: bool) -> String {
    if truncated {
        format!("{text} [truncated]")
    } else {
        text
    }
}

fn emit_dropped_stderr(runtime: &LspServerRuntime, dropped: usize) {
    if dropped > 0 {
        emit_lsp_stderr(
            runtime,
            format!("suppressed {dropped} language-server stderr messages"),
        );
    }
}

fn spawn_server_threads(
    runtime: Arc<LspServerRuntime>,
    mut stdout: impl Read + Send + 'static,
    mut stderr: impl Read + Send + 'static,
) {
    let reader_runtime = Arc::clone(&runtime);
    thread::spawn(move || {
        let mut reader = BufReader::new(&mut stdout);
        loop {
            match parse_lsp_message(&mut reader) {
                Ok(Some(message)) => {
                    if let Some(request_id) = message.get("id").and_then(Value::as_u64) {
                        if let Ok(mut pending) = reader_runtime.pending.lock() {
                            if let Some(sender) = pending.remove(&request_id) {
                                let _ = sender.send(message);
                                continue;
                            }
                        }
                    }
                    dispatch_lsp_notification(&reader_runtime, &message);
                }
                Ok(None) => break,
                Err(error) => {
                    emit_event(LspRuntimeEvent {
                        kind: "error".to_string(),
                        session_id: None,
                        file_path: None,
                        language_id: Some(reader_runtime.language_id.clone()),
                        project_root: Some(reader_runtime.project_root.clone()),
                        status: None,
                        message: Some(format!("lsp reader failed: {error}")),
                    });
                    break;
                }
            }
        }
    });

    let stderr_runtime = Arc::clone(&runtime);
    thread::spawn(move || {
        let mut reader = BufReader::new(&mut stderr);
        let mut line = Vec::with_capacity(MAX_LSP_STDERR_LINE_BYTES);
        let mut window_started_at = Instant::now();
        let mut emitted_in_window = 0_usize;
        let mut dropped_in_window = 0_usize;
        loop {
            if window_started_at.elapsed() >= LSP_STDERR_WINDOW {
                emit_dropped_stderr(&stderr_runtime, dropped_in_window);
                window_started_at = Instant::now();
                emitted_in_window = 0;
                dropped_in_window = 0;
            }
            match read_bounded_stderr_line(&mut reader, &mut line) {
                Ok(None) => break,
                Ok(Some((text, truncated))) => {
                    if text.is_empty() {
                        continue;
                    }
                    if emitted_in_window < MAX_LSP_STDERR_EVENTS_PER_WINDOW {
                        emit_lsp_stderr(&stderr_runtime, format_stderr_message(text, truncated));
                        emitted_in_window += 1;
                    } else {
                        dropped_in_window += 1;
                    }
                }
                Err(_) => break,
            }
        }
        emit_dropped_stderr(&stderr_runtime, dropped_in_window);
    });

    let wait_runtime = Arc::clone(&runtime);
    thread::spawn(move || {
        let wait_result = wait_runtime
            .child
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok());

        let was_stopping = wait_runtime.stopping.load(Ordering::Relaxed);
        if let Ok(mut guard) = SERVERS.lock() {
            guard.remove(&wait_runtime.key);
        }
        if !was_stopping && !wait_result.as_ref().is_some_and(|status| status.success()) {
            record_restart_backoff(&wait_runtime.key);
        }

        let status_text = wait_result
            .map(|status| format!("stopped({status})"))
            .unwrap_or_else(|| "stopped".to_string());

        emit_event(LspRuntimeEvent {
            kind: "server-status".to_string(),
            session_id: None,
            file_path: None,
            language_id: Some(wait_runtime.language_id.clone()),
            project_root: Some(wait_runtime.project_root.clone()),
            status: Some(status_text),
            message: None,
        });
    });
}

fn start_server(language_id: &str, project_root: &Path) -> Result<Arc<LspServerRuntime>> {
    let command_spec = resolve_server_command(language_id)
        .ok_or_else(|| to_error(format!("unsupported language: {language_id}")))?;

    let mut command = Command::new(&command_spec.program);
    command
        .args(&command_spec.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(project_root);
    lyra_process_lifecycle_core::configure_daemon_child_command(&mut command);

    let child = command.spawn().map_err(|error| {
        to_error(format!(
            "failed to start language server `{}`: {error}",
            command_spec.program
        ))
    })?;

    let mut child = child;
    let child_pid = child.id();
    lyra_process_lifecycle_core::spawn_parent_death_watcher(child_pid, true);
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| to_error("failed to capture language server stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| to_error("failed to capture language server stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| to_error("failed to capture language server stderr"))?;

    let key = server_key(language_id, project_root);
    let runtime = Arc::new(LspServerRuntime {
        key,
        language_id: language_id.to_string(),
        project_root: project_root.to_string_lossy().into_owned(),
        child_pid,
        stopping: AtomicBool::new(false),
        writer: Arc::new(Mutex::new(stdin)),
        child: Arc::new(Mutex::new(child)),
        next_request_id: AtomicU64::new(1),
        pending: Arc::new(Mutex::new(HashMap::new())),
        uri_sessions: Arc::new(Mutex::new(HashMap::new())),
        uri_paths: Arc::new(Mutex::new(HashMap::new())),
    });

    spawn_server_threads(Arc::clone(&runtime), stdout, stderr);

    let root_uri = path_to_file_uri(project_root)?;
    let initialize_result = send_request(
        &runtime,
        "initialize",
        json!({
            "processId": std::process::id(),
            "rootUri": root_uri,
            "rootPath": runtime.project_root,
            "capabilities": {
                "textDocument": {
                    "completion": {
                        "completionItem": {
                            "snippetSupport": false
                        }
                    },
                    "definition": {
                        "dynamicRegistration": false
                    },
                    "references": {
                        "dynamicRegistration": false
                    },
                    "hover": {
                        "dynamicRegistration": false,
                        "contentFormat": ["plaintext"]
                    }
                }
            }
        }),
    );

    if let Err(error) = initialize_result {
        runtime.stopping.store(true, Ordering::Relaxed);
        lyra_process_lifecycle_core::terminate_process_tree(child_pid, true);
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.kill();
        }
        return Err(error);
    }

    let _ = send_notification(&runtime, "initialized", json!({}));

    Ok(runtime)
}

fn stop_runtime(runtime: Arc<LspServerRuntime>) {
    runtime.stopping.store(true, Ordering::Relaxed);
    let _ = send_notification(&runtime, "shutdown", json!({}));
    let _ = send_notification(&runtime, "exit", json!({}));
    lyra_process_lifecycle_core::terminate_process_tree(runtime.child_pid, false);
    thread::spawn(move || {
        thread::sleep(LSP_KILL_GRACE);
        lyra_process_lifecycle_core::terminate_process_tree(runtime.child_pid, true);
    });
}

fn get_or_create_server(
    language_id: &str,
    file_path: &Path,
    project_root: Option<&str>,
) -> Result<Arc<LspServerRuntime>> {
    let normalized_language = normalize_language_id(language_id)
        .ok_or_else(|| to_error(format!("language not supported: {language_id}")))?;
    let resolved_root = normalize_project_root(project_root, file_path);
    let key = server_key(normalized_language, &resolved_root);

    if let Ok(guard) = SERVERS.lock() {
        if let Some(runtime) = guard.get(&key) {
            return Ok(Arc::clone(runtime));
        }
    }
    if let Some(remaining) = restart_backoff_remaining(&key) {
        return Err(to_error(format!(
            "language server is restarting; retry in {} ms",
            remaining.as_millis().max(1)
        )));
    }

    emit_event(LspRuntimeEvent {
        kind: "server-status".to_string(),
        session_id: None,
        file_path: None,
        language_id: Some(normalized_language.to_string()),
        project_root: Some(resolved_root.to_string_lossy().into_owned()),
        status: Some("starting".to_string()),
        message: None,
    });

    let runtime = start_server(normalized_language, &resolved_root).map_err(|error| {
        record_restart_backoff(&key);
        emit_event(LspRuntimeEvent {
            kind: "server-status".to_string(),
            session_id: None,
            file_path: None,
            language_id: Some(normalized_language.to_string()),
            project_root: Some(resolved_root.to_string_lossy().into_owned()),
            status: Some("unavailable".to_string()),
            message: Some(error.to_string()),
        });
        error
    })?;

    emit_event(LspRuntimeEvent {
        kind: "server-status".to_string(),
        session_id: None,
        file_path: None,
        language_id: Some(normalized_language.to_string()),
        project_root: Some(runtime.project_root.clone()),
        status: Some("ready".to_string()),
        message: None,
    });

    if let Ok(mut guard) = SERVERS.lock() {
        if let Some(existing) = guard.get(&runtime.key) {
            return Ok(Arc::clone(existing));
        }
        guard.insert(runtime.key.clone(), Arc::clone(&runtime));
    }

    Ok(runtime)
}

fn handle_open_document(request: LspDocumentRequest) -> Result<()> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let runtime = get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    )?;

    let already_open = runtime
        .uri_sessions
        .lock()
        .ok()
        .map(|sessions| sessions.get(&uri).is_some())
        .unwrap_or(false);

    if let Ok(mut sessions) = runtime.uri_sessions.lock() {
        sessions.insert(uri.clone(), request.session_id.clone());
    }
    if let Ok(mut paths) = runtime.uri_paths.lock() {
        paths.insert(uri.clone(), file_path.to_string_lossy().into_owned());
    }

    if already_open {
        send_notification(
            &runtime,
            "textDocument/didChange",
            json!({
                "textDocument": {
                    "uri": uri,
                    "version": request.version,
                },
                "contentChanges": [
                    {
                        "text": request.content
                    }
                ]
            }),
        )
    } else {
        send_notification(
            &runtime,
            "textDocument/didOpen",
            json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": normalize_language_id(&request.language_id).unwrap_or("plaintext"),
                    "version": request.version,
                    "text": request.content
                }
            }),
        )
    }
}

fn handle_change_document(request: LspDocumentRequest) -> Result<()> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let runtime = get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    )?;

    if let Ok(mut sessions) = runtime.uri_sessions.lock() {
        sessions.insert(uri.clone(), request.session_id.clone());
    }
    if let Ok(mut paths) = runtime.uri_paths.lock() {
        paths.insert(uri.clone(), file_path.to_string_lossy().into_owned());
    }

    send_notification(
        &runtime,
        "textDocument/didChange",
        json!({
            "textDocument": {
                "uri": uri,
                "version": request.version,
            },
            "contentChanges": [
                {
                    "text": request.content
                }
            ]
        }),
    )
}

fn handle_save_document(request: LspDocumentRequest) -> Result<()> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let runtime = get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    )?;

    send_notification(
        &runtime,
        "textDocument/didSave",
        json!({
            "textDocument": {
                "uri": uri
            },
            "text": request.content
        }),
    )
}

fn handle_close_document(request: LspDocumentRequest) -> Result<()> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let runtime = get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    )?;

    if let Ok(mut sessions) = runtime.uri_sessions.lock() {
        sessions.remove(&uri);
    }
    if let Ok(mut paths) = runtime.uri_paths.lock() {
        paths.remove(&uri);
    }

    send_notification(
        &runtime,
        "textDocument/didClose",
        json!({
            "textDocument": {
                "uri": uri
            }
        }),
    )
}

fn parse_completion_result(value: Value) -> LspCompletionResult {
    if let Some(items) = value.as_array() {
        return LspCompletionResult {
            items: items.iter().filter_map(parse_completion_item).collect(),
            is_incomplete: false,
        };
    }

    let is_incomplete = value
        .get("isIncomplete")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let items = value
        .get("items")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().filter_map(parse_completion_item).collect())
        .unwrap_or_default();

    LspCompletionResult {
        items,
        is_incomplete,
    }
}

fn parse_completion_item(value: &Value) -> Option<LspCompletionItem> {
    let label = value.get("label")?.as_str()?.to_string();
    let documentation = match value.get("documentation") {
        Some(Value::String(text)) => Some(text.to_string()),
        Some(Value::Object(object)) => object
            .get("value")
            .and_then(Value::as_str)
            .map(str::to_string),
        _ => None,
    };

    Some(LspCompletionItem {
        label,
        insert_text: value
            .get("insertText")
            .and_then(Value::as_str)
            .map(str::to_string),
        detail: value
            .get("detail")
            .and_then(Value::as_str)
            .map(str::to_string),
        documentation,
        kind: value
            .get("kind")
            .and_then(Value::as_u64)
            .map(|number| number as u32),
        sort_text: value
            .get("sortText")
            .and_then(Value::as_str)
            .map(str::to_string),
        filter_text: value
            .get("filterText")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn handle_completion(request: LspCompletionRequest) -> Result<LspCompletionResult> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let runtime = match get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    ) {
        Ok(runtime) => runtime,
        Err(_) => {
            return Ok(LspCompletionResult {
                items: Vec::new(),
                is_incomplete: false,
            })
        }
    };

    if let Ok(mut sessions) = runtime.uri_sessions.lock() {
        sessions.insert(uri.clone(), request.session_id.clone());
    }
    if let Ok(mut paths) = runtime.uri_paths.lock() {
        paths.insert(uri.clone(), file_path.to_string_lossy().into_owned());
    }

    let response = send_request(
        &runtime,
        "textDocument/completion",
        json!({
            "textDocument": {
                "uri": uri,
            },
            "position": {
                "line": request.line,
                "character": request.column,
            }
        }),
    );

    match response {
        Ok(value) => Ok(parse_completion_result(value)),
        Err(error) => {
            emit_event(LspRuntimeEvent {
                kind: "error".to_string(),
                session_id: Some(request.session_id),
                file_path: Some(request.file_path),
                language_id: normalize_language_id(&request.language_id).map(str::to_string),
                project_root: request.project_root,
                status: None,
                message: Some(error.to_string()),
            });
            Ok(LspCompletionResult {
                items: Vec::new(),
                is_incomplete: false,
            })
        }
    }
}

// --- Go-to-definition ---

fn parse_location(value: &Value) -> Option<LspLocation> {
    let uri = value.get("uri").and_then(Value::as_str)?;
    let range = value.get("range")?;
    let start = range.get("start")?;
    let end = range.get("end")?;
    let file_path = file_uri_to_path(uri)?;
    Some(LspLocation {
        file_path,
        start_line: start.get("line")?.as_u64()? as u32,
        start_character: start.get("character")?.as_u64()? as u32,
        end_line: end.get("line")?.as_u64()? as u32,
        end_character: end.get("character")?.as_u64()? as u32,
    })
}

fn parse_locations(value: &Value) -> Vec<LspLocation> {
    if let Some(array) = value.as_array() {
        return array.iter().filter_map(parse_location).collect();
    }
    if value.get("uri").is_some() {
        return parse_location(value).into_iter().collect();
    }
    Vec::new()
}

fn handle_goto_definition(request: LspPositionRequest) -> Result<Vec<LspLocation>> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let runtime = get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    )?;

    let response = send_request(
        &runtime,
        "textDocument/definition",
        json!({
            "textDocument": { "uri": uri },
            "position": {
                "line": request.line,
                "character": request.column,
            }
        }),
    )?;

    Ok(parse_locations(&response))
}

// --- Find references ---

fn handle_find_references(request: LspPositionRequest) -> Result<Vec<LspLocation>> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let runtime = get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    )?;

    let response = send_request(
        &runtime,
        "textDocument/references",
        json!({
            "textDocument": { "uri": uri },
            "position": {
                "line": request.line,
                "character": request.column,
            },
            "context": {
                "includeDeclaration": true
            }
        }),
    )?;

    Ok(parse_locations(&response))
}

// --- Hover ---

fn handle_hover(request: LspPositionRequest) -> Result<Option<LspHoverResult>> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let runtime = get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    )?;

    let response = send_request(
        &runtime,
        "textDocument/hover",
        json!({
            "textDocument": { "uri": uri },
            "position": {
                "line": request.line,
                "character": request.column,
            }
        }),
    )?;

    if response.is_null() {
        return Ok(None);
    }

    let contents = match response.get("contents") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Object(obj)) => obj
            .get("value")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|item| match item {
                Value::String(s) => Some(s.as_str()),
                Value::Object(o) => o.get("value").and_then(Value::as_str),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return Ok(None),
    };

    if contents.is_empty() {
        return Ok(None);
    }

    let (start_line, start_character, end_line, end_character) =
        if let Some(range) = response.get("range") {
            let s = range.get("start");
            let e = range.get("end");
            (
                s.and_then(|v| v.get("line"))
                    .and_then(Value::as_u64)
                    .map(|n| n as u32),
                s.and_then(|v| v.get("character"))
                    .and_then(Value::as_u64)
                    .map(|n| n as u32),
                e.and_then(|v| v.get("line"))
                    .and_then(Value::as_u64)
                    .map(|n| n as u32),
                e.and_then(|v| v.get("character"))
                    .and_then(Value::as_u64)
                    .map(|n| n as u32),
            )
        } else {
            (None, None, None, None)
        };

    Ok(Some(LspHoverResult {
        contents,
        start_line,
        start_character,
        end_line,
        end_character,
    }))
}

// --- Public exports ---

#[cfg_attr(feature = "node-api", napi)]
pub fn open_document(request: LspDocumentRequest) -> Result<()> {
    handle_open_document(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn change_document(request: LspDocumentRequest) -> Result<()> {
    handle_change_document(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn save_document(request: LspDocumentRequest) -> Result<()> {
    handle_save_document(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn close_document(request: LspDocumentRequest) -> Result<()> {
    handle_close_document(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn completion(request: LspCompletionRequest) -> Result<LspCompletionResult> {
    handle_completion(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn goto_definition(request: LspPositionRequest) -> Result<Vec<LspLocation>> {
    handle_goto_definition(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn find_references(request: LspPositionRequest) -> Result<Vec<LspLocation>> {
    handle_find_references(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn hover(request: LspPositionRequest) -> Result<Option<LspHoverResult>> {
    handle_hover(request)
}

#[cfg_attr(feature = "node-api", napi)]
pub fn shutdown() -> Result<()> {
    let runtimes = if let Ok(guard) = SERVERS.lock() {
        guard.values().cloned().collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    for runtime in runtimes {
        stop_runtime(runtime);
    }

    if let Ok(mut guard) = SERVERS.lock() {
        guard.clear();
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn stderr_reader_splits_overlong_lines_without_unbounded_buffer() {
        let input = vec![b'a'; MAX_LSP_STDERR_LINE_BYTES + 12];
        let mut reader = BufReader::new(Cursor::new(input));
        let mut buffer = Vec::new();

        let (first, first_truncated) = read_bounded_stderr_line(&mut reader, &mut buffer)
            .expect("read first")
            .expect("first chunk");
        let (second, second_truncated) = read_bounded_stderr_line(&mut reader, &mut buffer)
            .expect("read second")
            .expect("second chunk");

        assert_eq!(first.len(), MAX_LSP_STDERR_LINE_BYTES);
        assert!(first_truncated);
        assert_eq!(second.len(), 12);
        assert!(!second_truncated);
    }

    #[test]
    fn stderr_reader_trims_newline_and_marks_truncated() {
        let input = format!("{}\n", "b".repeat(MAX_LSP_STDERR_LINE_BYTES + 1));
        let mut reader = BufReader::new(Cursor::new(input.into_bytes()));
        let mut buffer = Vec::new();

        let (line, truncated) = read_bounded_stderr_line(&mut reader, &mut buffer)
            .expect("read")
            .expect("line");

        assert_eq!(line.len(), MAX_LSP_STDERR_LINE_BYTES);
        assert!(truncated);
    }
}
