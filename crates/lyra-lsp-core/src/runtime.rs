use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use url::Url;

use super::{Error, LspRuntimeEvent, Result, RustEventCallback, Status};

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

pub(super) struct LspServerRuntime {
    key: String,
    pub(super) language_id: String,
    pub(super) project_root: String,
    child_pid: u32,
    stopping: AtomicBool,
    writer: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    next_request_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>,
    pub(super) uri_sessions: Arc<Mutex<HashMap<String, String>>>,
    pub(super) uri_paths: Arc<Mutex<HashMap<String, String>>>,
}

pub(super) fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

pub(super) fn emit_event(event: LspRuntimeEvent) {
    if let Ok(guard) = RUST_EVENT_CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            if let Ok(payload) = serde_json::to_string(&event) {
                callback(payload);
            }
        }
    }
}

pub(super) fn register_event_callback(callback: RustEventCallback) {
    if let Ok(mut guard) = RUST_EVENT_CALLBACK.lock() {
        *guard = Some(callback);
    }
}

pub(super) fn clear_event_callback() {
    if let Ok(mut guard) = RUST_EVENT_CALLBACK.lock() {
        *guard = None;
    }
}

pub(super) fn normalize_language_id(value: &str) -> Option<&'static str> {
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

pub(super) fn normalize_file_path(file_path: &str) -> Result<PathBuf> {
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

pub(super) fn path_to_file_uri(path: &Path) -> Result<String> {
    Url::from_file_path(path)
        .map(|value| value.to_string())
        .map_err(|_| to_error("failed to convert file path to uri"))
}

pub(super) fn file_uri_to_path(value: &str) -> Option<String> {
    Url::parse(value)
        .ok()?
        .to_file_path()
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
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

pub(super) fn send_notification(
    runtime: &LspServerRuntime,
    method: &str,
    params: Value,
) -> Result<()> {
    send_payload(
        runtime,
        &json!({ "jsonrpc": "2.0", "method": method, "params": params }),
    )
}

pub(super) fn send_request(
    runtime: &LspServerRuntime,
    method: &str,
    params: Value,
) -> Result<Value> {
    let request_id = runtime.next_request_id.fetch_add(1, Ordering::Relaxed);
    let (sender, receiver) = mpsc::channel::<Value>();
    runtime
        .pending
        .lock()
        .map_err(|_| to_error("failed to lock pending requests"))?
        .insert(request_id, sender);
    if let Err(error) = send_payload(
        runtime,
        &json!({ "jsonrpc": "2.0", "id": request_id, "method": method, "params": params }),
    ) {
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
    let mut content_length = None;
    loop {
        let mut header_line = String::new();
        if reader.read_line(&mut header_line)? == 0 {
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
    let Some(length) = content_length.filter(|value| *value > 0) else {
        return Ok(None);
    };
    let mut body = vec![0_u8; length];
    reader.read_exact(&mut body)?;
    serde_json::from_slice::<Value>(&body)
        .map(Some)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()))
}

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
            return if buffer.is_empty() {
                Ok(None)
            } else {
                Ok(Some((
                    String::from_utf8_lossy(buffer).trim().to_string(),
                    truncated,
                )))
            };
        }
        if let Some(newline_index) = available.iter().position(|byte| *byte == b'\n') {
            let line_bytes = &available[..newline_index];
            let remaining = MAX_LSP_STDERR_LINE_BYTES.saturating_sub(buffer.len());
            let append_len = line_bytes.len().min(remaining);
            buffer.extend_from_slice(&line_bytes[..append_len]);
            truncated |= append_len < line_bytes.len();
            reader.consume(newline_index + 1);
            return Ok(Some((
                String::from_utf8_lossy(buffer).trim().to_string(),
                truncated,
            )));
        }
        let remaining = MAX_LSP_STDERR_LINE_BYTES.saturating_sub(buffer.len());
        if remaining == 0 {
            return Ok(Some((
                String::from_utf8_lossy(buffer).trim().to_string(),
                true,
            )));
        }
        let append_len = available.len().min(remaining);
        buffer.extend_from_slice(&available[..append_len]);
        reader.consume(append_len);
        if buffer.len() >= MAX_LSP_STDERR_LINE_BYTES {
            return Ok(Some((
                String::from_utf8_lossy(buffer).trim().to_string(),
                true,
            )));
        }
    }
}

fn spawn_server_threads(
    runtime: Arc<LspServerRuntime>,
    stdout: impl Read + Send + 'static,
    stderr: impl Read + Send + 'static,
) {
    let reader_runtime = Arc::clone(&runtime);
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
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
        let mut reader = BufReader::new(stderr);
        let mut line = Vec::with_capacity(MAX_LSP_STDERR_LINE_BYTES);
        let mut window_started_at = Instant::now();
        let mut emitted = 0_usize;
        let mut dropped = 0_usize;
        loop {
            if window_started_at.elapsed() >= LSP_STDERR_WINDOW {
                emit_dropped_stderr(&stderr_runtime, dropped);
                window_started_at = Instant::now();
                emitted = 0;
                dropped = 0;
            }
            match read_bounded_stderr_line(&mut reader, &mut line) {
                Ok(None) => break,
                Ok(Some((text, truncated))) if !text.is_empty() => {
                    if emitted < MAX_LSP_STDERR_EVENTS_PER_WINDOW {
                        let message = if truncated {
                            format!("{text} [truncated]")
                        } else {
                            text
                        };
                        emit_lsp_stderr(&stderr_runtime, message);
                        emitted += 1;
                    } else {
                        dropped += 1;
                    }
                }
                Ok(Some(_)) => {}
                Err(_) => break,
            }
        }
        emit_dropped_stderr(&stderr_runtime, dropped);
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
        emit_event(LspRuntimeEvent {
            kind: "server-status".to_string(),
            session_id: None,
            file_path: None,
            language_id: Some(wait_runtime.language_id.clone()),
            project_root: Some(wait_runtime.project_root.clone()),
            status: Some(
                wait_result
                    .map(|status| format!("stopped({status})"))
                    .unwrap_or_else(|| "stopped".to_string()),
            ),
            message: None,
        });
    });
}

fn emit_dropped_stderr(runtime: &LspServerRuntime, dropped: usize) {
    if dropped > 0 {
        emit_lsp_stderr(
            runtime,
            format!("suppressed {dropped} language-server stderr messages"),
        );
    }
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
    let mut child = command.spawn().map_err(|error| {
        to_error(format!(
            "failed to start language server `{}`: {error}",
            command_spec.program
        ))
    })?;
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
    let runtime = Arc::new(LspServerRuntime {
        key: server_key(language_id, project_root),
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
    let initialize_result = send_request(
        &runtime,
        "initialize",
        json!({
            "processId": std::process::id(),
            "rootUri": path_to_file_uri(project_root)?,
            "rootPath": runtime.project_root,
            "capabilities": {
                "textDocument": {
                    "completion": { "completionItem": { "snippetSupport": false } },
                    "definition": { "dynamicRegistration": false },
                    "references": { "dynamicRegistration": false },
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

pub(super) fn get_or_create_server(
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

pub(super) fn shutdown() -> Result<()> {
    let runtimes = SERVERS
        .lock()
        .map(|guard| guard.values().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
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
