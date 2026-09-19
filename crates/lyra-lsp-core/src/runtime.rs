use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde_json::{json, Value};

use super::catalog::{self, ServerEntry};
use super::events::{default_event, emit_event};
use super::uri::normalize_project_root;
use super::{LspRuntimeEvent, Result};

static SERVERS: Lazy<Mutex<HashMap<String, Arc<LspServerRuntime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static RESTART_BACKOFFS: Lazy<Mutex<HashMap<String, Instant>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const LSP_RESTART_BACKOFF: Duration = Duration::from_secs(2);
const LSP_KILL_GRACE: Duration = Duration::from_millis(1_500);
const LSP_STDERR_WINDOW: Duration = Duration::from_secs(5);
const MAX_LSP_STDERR_EVENTS_PER_WINDOW: usize = 20;
const MAX_LSP_STDERR_LINE_BYTES: usize = 4 * 1024;

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
    flycheck_kicked: AtomicBool,
}

pub(super) fn to_error(message: impl Into<String>) -> super::Error {
    super::uri::to_error(message)
}

pub(super) fn normalize_file_path(file_path: &str) -> Result<std::path::PathBuf> {
    super::uri::normalize_file_path(file_path)
}

pub(super) fn path_to_file_uri(path: &Path) -> Result<String> {
    super::uri::path_to_file_uri(path)
}

pub(super) fn file_uri_to_path(value: &str) -> Option<String> {
    super::uri::file_uri_to_path(value)
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

fn handle_server_message(runtime: &Arc<LspServerRuntime>, message: Value) {
    if let Some(request_id) = message.get("id").and_then(Value::as_u64) {
        if let Ok(mut pending) = runtime.pending.lock() {
            if let Some(sender) = pending.remove(&request_id) {
                let _ = sender.send(message);
                return;
            }
        }
        if message.get("method").is_some() {
            let _ = send_payload(
                runtime,
                &json!({ "jsonrpc": "2.0", "id": request_id, "result": null }),
            );
        }
        return;
    }
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    if method == "textDocument/publishDiagnostics" {
        let paths = runtime
            .uri_paths
            .lock()
            .ok()
            .map(|guard| guard.clone())
            .unwrap_or_default();
        if let Some(params) = message.get("params") {
            super::diagnostics::apply_publish_diagnostics(params, &paths);
        }
        return;
    }
    if method == "experimental/serverStatus" || method == "rust-analyzer/serverStatus" {
        let quiescent = message
            .get("params")
            .and_then(|params| params.get("quiescent"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if quiescent {
            start_rust_flycheck(runtime);
        }
    }
}

fn server_key(server_id: &str, project_root: &Path) -> String {
    format!("{server_id}::{}", project_root.to_string_lossy())
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
    if message.is_empty() {
        return;
    }
    // OpenCode discards stderr. rust-analyzer prints rustc/toolchain probes
    // on a live server; those are workspace notes, not crashes.
    if super::diagnostics::is_workspace_analysis_message(&message) {
        super::diagnostics::record_workspace_note(&runtime.project_root, &message);
        emit_event(LspRuntimeEvent {
            language_id: Some(runtime.language_id.clone()),
            project_root: Some(runtime.project_root.clone()),
            status: Some("workspace".to_string()),
            message: Some(message),
            server_id: Some(runtime.key.clone()),
            ..default_event("server-status")
        });
    }
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
                    handle_server_message(&reader_runtime, message);
                }
                Ok(None) => break,
                Err(error) => {
                    emit_event(LspRuntimeEvent {
                        language_id: Some(reader_runtime.language_id.clone()),
                        project_root: Some(reader_runtime.project_root.clone()),
                        message: Some(format!("lsp reader failed: {error}")),
                        ..default_event("error")
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
            language_id: Some(wait_runtime.language_id.clone()),
            project_root: Some(wait_runtime.project_root.clone()),
            status: Some(
                wait_result
                    .map(|status| format!("stopped({status})"))
                    .unwrap_or_else(|| "stopped".to_string()),
            ),
            ..default_event("server-status")
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

fn rust_analyzer_initialize_options() -> Value {
    json!({
        "checkOnSave": true,
        "check": {
            "command": "check",
            "workspace": true
        }
    })
}

fn start_rust_flycheck(runtime: &Arc<LspServerRuntime>) {
    if runtime.language_id != "rust" {
        return;
    }
    if runtime.flycheck_kicked.swap(true, Ordering::Relaxed) {
        return;
    }
    let runtime = Arc::clone(runtime);
    thread::spawn(move || {
        // ponytail: RA cargo-check is async; this only kicks flycheck. Diagnostics arrive via publishDiagnostics. Upgrade: wait for experimental/serverStatus health=ok if kick-before-metadata becomes common.
        if runtime.stopping.load(Ordering::Relaxed) {
            return;
        }
        if send_request(
            &runtime,
            "rust-analyzer/runFlycheck",
            json!({ "uri": Value::Null }),
        )
        .is_ok()
        {
            return;
        }
        let _ = send_request(
            &runtime,
            "workspace/executeCommand",
            json!({
                "command": "rust-analyzer.runFlycheck",
                "arguments": [Value::Null]
            }),
        );
    });
}

fn typescript_initialize_options() -> Option<Value> {
    let path = std::env::var("LYRA_TSSERVER_PATH").ok()?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(json!({ "tsserver": { "path": trimmed } }))
}

fn start_server(entry: &ServerEntry, project_root: &Path) -> Result<Arc<LspServerRuntime>> {
    // VS Code explorer open only reads the file; language clients start from a
    // bundled server already on disk (json-language-features activate()), never
    // npm-install on the click. Missing binaries stay missing for this open.
    let command_spec = super::acquire::resolve_existing_binary(entry).ok_or_else(|| {
        to_error(format!(
            "language server `{}` is not installed",
            entry.program
        ))
    })?;
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
        key: server_key(entry.id, project_root),
        language_id: entry
            .language_ids
            .first()
            .copied()
            .unwrap_or(entry.id)
            .to_string(),
        project_root: project_root.to_string_lossy().into_owned(),
        child_pid,
        stopping: AtomicBool::new(false),
        writer: Arc::new(Mutex::new(stdin)),
        child: Arc::new(Mutex::new(child)),
        next_request_id: AtomicU64::new(1),
        pending: Arc::new(Mutex::new(HashMap::new())),
        uri_sessions: Arc::new(Mutex::new(HashMap::new())),
        uri_paths: Arc::new(Mutex::new(HashMap::new())),
        flycheck_kicked: AtomicBool::new(false),
    });
    spawn_server_threads(Arc::clone(&runtime), stdout, stderr);
    let root_uri = path_to_file_uri(project_root)?;
    let folder_name = project_root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("project");
    let mut initialize_params = json!({
        "processId": std::process::id(),
        "rootUri": root_uri,
        "rootPath": runtime.project_root,
        "workspaceFolders": [{ "uri": root_uri, "name": folder_name }],
        "capabilities": {
            "workspace": {
                "workspaceFolders": true
            },
            "experimental": {
                "serverStatusNotification": true
            },
            "textDocument": {
                "completion": { "completionItem": { "snippetSupport": false } },
                "definition": { "dynamicRegistration": false },
                "references": { "dynamicRegistration": false },
                "documentSymbol": { "hierarchicalDocumentSymbolSupport": true },
                "publishDiagnostics": {
                    "relatedInformation": false,
                    "versionSupport": false
                },
                "hover": {
                    "dynamicRegistration": false,
                    "contentFormat": ["markdown", "plaintext"]
                }
            }
        }
    });
    if entry.id == "typescript" {
        if let Some(options) = typescript_initialize_options() {
            initialize_params["initializationOptions"] = options;
        }
    }
    if entry.id == "rust" {
        initialize_params["initializationOptions"] = rust_analyzer_initialize_options();
    }
    let initialize_result = send_request(&runtime, "initialize", initialize_params);
    if let Err(error) = initialize_result {
        runtime.stopping.store(true, Ordering::Relaxed);
        lyra_process_lifecycle_core::terminate_process_tree(child_pid, true);
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.kill();
        }
        return Err(error);
    }
    let _ = send_notification(&runtime, "initialized", json!({}));
    if entry.id == "rust" {
        let flycheck_runtime = Arc::clone(&runtime);
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(2));
            start_rust_flycheck(&flycheck_runtime);
        });
    }
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

pub(super) fn warmup_primary_servers(project_root: &str) -> Vec<String> {
    let root = Path::new(project_root);
    if !root.is_dir() {
        return Vec::new();
    }
    catalog::detect_primary_servers(root)
        .into_iter()
        .filter_map(|entry| {
            let language = *entry.language_ids.first().unwrap_or(&entry.id);
            match get_or_create_server(language, root, Some(project_root)) {
                Ok(_) => Some(entry.id.to_string()),
                Err(_) => None,
            }
        })
        .collect()
}

pub(super) fn existing_server(
    language_id: &str,
    file_path: &Path,
    project_root: Option<&str>,
) -> Option<Arc<LspServerRuntime>> {
    let resolved_root = normalize_project_root(project_root, file_path);
    let entry = catalog::server_for_language_in_project(language_id, Some(&resolved_root))?;
    let key = server_key(entry.id, &resolved_root);
    SERVERS.lock().ok()?.get(&key).cloned()
}

pub(super) fn get_or_create_server(
    language_id: &str,
    file_path: &Path,
    project_root: Option<&str>,
) -> Result<Arc<LspServerRuntime>> {
    let resolved_root = normalize_project_root(project_root, file_path);
    let entry = match catalog::server_for_language_in_project(language_id, Some(&resolved_root)) {
        Some(entry) => entry,
        None => {
            emit_event(LspRuntimeEvent {
                language_id: Some(language_id.to_string()),
                project_root: Some(resolved_root.to_string_lossy().into_owned()),
                status: Some("unavailable".to_string()),
                message: Some(format!("language not supported: {language_id}")),
                ..default_event("server-status")
            });
            return Err(to_error(format!("language not supported: {language_id}")));
        }
    };
    let key = server_key(entry.id, &resolved_root);
    if catalog::spawns_language_server(entry) == false {
        return Err(to_error(format!(
            "language server `{}` is syntax-only",
            entry.program
        )));
    }
    if let Ok(guard) = SERVERS.lock() {
        if let Some(runtime) = guard.get(&key) {
            return Ok(Arc::clone(runtime));
        }
    }
    if super::acquire::resolve_existing_binary(entry).is_none() {
        return Err(to_error(format!(
            "language server `{}` is not installed",
            entry.program
        )));
    }
    if let Some(remaining) = restart_backoff_remaining(&key) {
        return Err(to_error(format!(
            "language server is restarting; retry in {} ms",
            remaining.as_millis().max(1)
        )));
    }
    emit_event(LspRuntimeEvent {
        language_id: Some(language_id.to_string()),
        project_root: Some(resolved_root.to_string_lossy().into_owned()),
        status: Some("starting".to_string()),
        server_id: Some(entry.id.to_string()),
        ..default_event("server-status")
    });
    let runtime = start_server(entry, &resolved_root).map_err(|error| {
        record_restart_backoff(&key);
        emit_event(LspRuntimeEvent {
            language_id: Some(language_id.to_string()),
            project_root: Some(resolved_root.to_string_lossy().into_owned()),
            status: Some("unavailable".to_string()),
            message: Some(error.to_string()),
            server_id: Some(entry.id.to_string()),
            ..default_event("server-status")
        });
        error
    })?;
    emit_event(LspRuntimeEvent {
        language_id: Some(language_id.to_string()),
        project_root: Some(runtime.project_root.clone()),
        status: Some("ready".to_string()),
        server_id: Some(entry.id.to_string()),
        ..default_event("server-status")
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

    #[test]
    fn warmup_without_markers_starts_nothing() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("lyra-lsp-warmup-{stamp}"));
        std::fs::create_dir_all(&root).expect("temp dir");
        let started = warmup_primary_servers(&root.to_string_lossy());
        assert!(started.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn typescript_initialize_options_wrap_tsserver_path() {
        let previous = std::env::var("LYRA_TSSERVER_PATH").ok();
        std::env::set_var("LYRA_TSSERVER_PATH", "/tmp/lyra-tsserver.js");
        let options = typescript_initialize_options().expect("options");
        assert_eq!(options["tsserver"]["path"], "/tmp/lyra-tsserver.js");
        match previous {
            Some(value) => std::env::set_var("LYRA_TSSERVER_PATH", value),
            None => std::env::remove_var("LYRA_TSSERVER_PATH"),
        }
    }

    #[test]
    fn rust_analyzer_initialize_options_enable_workspace_flycheck() {
        let options = rust_analyzer_initialize_options();
        assert_eq!(options["checkOnSave"], true);
        assert_eq!(options["check"]["workspace"], true);
        assert_eq!(options["check"]["command"], "check");
    }
}
