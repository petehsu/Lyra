use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi::{JsFunction, JsObject};
use napi_derive::napi;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use url::Url;

type EventCallback = ThreadsafeFunction<LspRuntimeEvent, ErrorStrategy::CalleeHandled>;

static SERVERS: Lazy<Mutex<HashMap<String, Arc<LspServerRuntime>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static EVENT_CALLBACK: Lazy<Mutex<Option<EventCallback>>> = Lazy::new(|| Mutex::new(None));

#[derive(Clone)]
struct ServerCommandSpec {
    program: String,
    args: Vec<String>,
}

struct LspServerRuntime {
    key: String,
    language_id: String,
    project_root: String,
    writer: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    next_request_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>,
    uri_sessions: Arc<Mutex<HashMap<String, String>>>,
    uri_paths: Arc<Mutex<HashMap<String, String>>>,
}

#[napi(object)]
pub struct LspDocumentRequest {
    pub session_id: String,
    pub file_path: String,
    pub language_id: String,
    pub content: String,
    pub version: i32,
    pub project_root: Option<String>,
}

#[napi(object)]
pub struct LspCompletionRequest {
    pub session_id: String,
    pub file_path: String,
    pub language_id: String,
    pub line: u32,
    pub column: u32,
    pub version: i32,
    pub project_root: Option<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct LspCompletionItem {
    pub label: String,
    pub insert_text: Option<String>,
    pub detail: Option<String>,
    pub documentation: Option<String>,
    pub kind: Option<u32>,
    pub sort_text: Option<String>,
    pub filter_text: Option<String>,
}

#[napi(object)]
#[derive(Clone)]
pub struct LspCompletionResult {
    pub items: Vec<LspCompletionItem>,
    pub is_incomplete: bool,
}

#[napi(object)]
#[derive(Clone)]
pub struct LspDiagnostic {
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
    pub severity: Option<u32>,
    pub code: Option<String>,
    pub source: Option<String>,
    pub message: String,
}

#[napi(object)]
#[derive(Clone)]
pub struct LspRuntimeEvent {
    pub kind: String,
    pub session_id: Option<String>,
    pub file_path: Option<String>,
    pub language_id: Option<String>,
    pub project_root: Option<String>,
    pub status: Option<String>,
    pub message: Option<String>,
    pub diagnostics: Option<Vec<LspDiagnostic>>,
}

fn to_error(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn emit_event(event: LspRuntimeEvent) {
    if let Ok(guard) = EVENT_CALLBACK.lock() {
        if let Some(callback) = guard.as_ref() {
            let _ = callback.call(Ok(event), ThreadsafeFunctionCallMode::NonBlocking);
        }
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

fn parse_diagnostics(value: &Value) -> Vec<LspDiagnostic> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };

    items
        .iter()
        .filter_map(|entry| {
            let range = entry.get("range")?;
            let start = range.get("start")?;
            let end = range.get("end")?;
            let start_line = start.get("line")?.as_u64()? as u32;
            let start_character = start.get("character")?.as_u64()? as u32;
            let end_line = end.get("line")?.as_u64()? as u32;
            let end_character = end.get("character")?.as_u64()? as u32;
            let message = entry
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown diagnostic")
                .to_string();

            let severity = entry
                .get("severity")
                .and_then(Value::as_u64)
                .map(|value| value as u32);

            let code = match entry.get("code") {
                Some(Value::String(value)) => Some(value.to_string()),
                Some(Value::Number(value)) => Some(value.to_string()),
                _ => None,
            };

            let source = entry
                .get("source")
                .and_then(Value::as_str)
                .map(str::to_string);

            Some(LspDiagnostic {
                start_line,
                start_character,
                end_line,
                end_character,
                severity,
                code,
                source,
                message,
            })
        })
        .collect()
}

fn dispatch_lsp_notification(runtime: &Arc<LspServerRuntime>, message: &Value) {
    let method = message
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if method != "textDocument/publishDiagnostics" {
        return;
    }

    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let uri = params
        .get("uri")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let diagnostics = parse_diagnostics(params.get("diagnostics").unwrap_or(&Value::Null));
    let session_id = runtime
        .uri_sessions
        .lock()
        .ok()
        .and_then(|entries| entries.get(&uri).cloned());

    let file_path = runtime
        .uri_paths
        .lock()
        .ok()
        .and_then(|entries| entries.get(&uri).cloned())
        .or_else(|| file_uri_to_path(&uri));

    emit_event(LspRuntimeEvent {
        kind: "diagnostic".to_string(),
        session_id,
        file_path,
        language_id: Some(runtime.language_id.clone()),
        project_root: Some(runtime.project_root.clone()),
        status: None,
        message: None,
        diagnostics: Some(diagnostics),
    });
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
                        diagnostics: None,
                    });
                    break;
                }
            }
        }
    });

    let stderr_runtime = Arc::clone(&runtime);
    thread::spawn(move || {
        let mut reader = BufReader::new(&mut stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let text = line.trim();
                    if text.is_empty() {
                        continue;
                    }
                    emit_event(LspRuntimeEvent {
                        kind: "error".to_string(),
                        session_id: None,
                        file_path: None,
                        language_id: Some(stderr_runtime.language_id.clone()),
                        project_root: Some(stderr_runtime.project_root.clone()),
                        status: None,
                        message: Some(text.to_string()),
                        diagnostics: None,
                    });
                }
                Err(_) => break,
            }
        }
    });

    let wait_runtime = Arc::clone(&runtime);
    thread::spawn(move || {
        let wait_result = wait_runtime
            .child
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok());

        if let Ok(mut guard) = SERVERS.lock() {
            guard.remove(&wait_runtime.key);
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
            diagnostics: None,
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

    let child = command.spawn().map_err(|error| {
        to_error(format!(
            "failed to start language server `{}`: {error}",
            command_spec.program
        ))
    })?;

    let mut child = child;
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

    let key = format!("{language_id}::{}", project_root.to_string_lossy());
    let runtime = Arc::new(LspServerRuntime {
        key,
        language_id: language_id.to_string(),
        project_root: project_root.to_string_lossy().into_owned(),
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
                    "publishDiagnostics": {
                        "relatedInformation": true
                    }
                }
            }
        }),
    );

    if let Err(error) = initialize_result {
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.kill();
        }
        return Err(error);
    }

    let _ = send_notification(&runtime, "initialized", json!({}));

    Ok(runtime)
}

fn get_or_create_server(
    language_id: &str,
    file_path: &Path,
    project_root: Option<&str>,
) -> Result<Arc<LspServerRuntime>> {
    let normalized_language = normalize_language_id(language_id)
        .ok_or_else(|| to_error(format!("language not supported: {language_id}")))?;
    let resolved_root = normalize_project_root(project_root, file_path);
    let key = format!(
        "{}::{}",
        normalized_language,
        resolved_root.to_string_lossy()
    );

    if let Ok(guard) = SERVERS.lock() {
        if let Some(runtime) = guard.get(&key) {
            return Ok(Arc::clone(runtime));
        }
    }

    emit_event(LspRuntimeEvent {
        kind: "server-status".to_string(),
        session_id: None,
        file_path: None,
        language_id: Some(normalized_language.to_string()),
        project_root: Some(resolved_root.to_string_lossy().into_owned()),
        status: Some("starting".to_string()),
        message: None,
        diagnostics: None,
    });

    let runtime = start_server(normalized_language, &resolved_root).map_err(|error| {
        emit_event(LspRuntimeEvent {
            kind: "server-status".to_string(),
            session_id: None,
            file_path: None,
            language_id: Some(normalized_language.to_string()),
            project_root: Some(resolved_root.to_string_lossy().into_owned()),
            status: Some("unavailable".to_string()),
            message: Some(error.to_string()),
            diagnostics: None,
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
        diagnostics: None,
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
                diagnostics: None,
            });
            Ok(LspCompletionResult {
                items: Vec::new(),
                is_incomplete: false,
            })
        }
    }
}

#[napi]
pub fn register_event_callback(callback: JsFunction) -> Result<()> {
    let tsfn: EventCallback = callback.create_threadsafe_function(
        0,
        |context: ThreadSafeCallContext<LspRuntimeEvent>| {
            let mut object: JsObject = context.env.create_object()?;
            object.set_named_property("kind", context.env.create_string(&context.value.kind)?)?;

            if let Some(session_id) = context.value.session_id {
                object.set_named_property("sessionId", context.env.create_string(&session_id)?)?;
            }
            if let Some(file_path) = context.value.file_path {
                object.set_named_property("filePath", context.env.create_string(&file_path)?)?;
            }
            if let Some(language_id) = context.value.language_id {
                object
                    .set_named_property("languageId", context.env.create_string(&language_id)?)?;
            }
            if let Some(project_root) = context.value.project_root {
                object
                    .set_named_property("projectRoot", context.env.create_string(&project_root)?)?;
            }
            if let Some(status) = context.value.status {
                object.set_named_property("status", context.env.create_string(&status)?)?;
            }
            if let Some(message) = context.value.message {
                object.set_named_property("message", context.env.create_string(&message)?)?;
            }

            if let Some(diagnostics) = context.value.diagnostics {
                let mut js_diagnostics = context.env.create_array_with_length(diagnostics.len())?;
                for (index, diagnostic) in diagnostics.iter().enumerate() {
                    let mut js_item = context.env.create_object()?;
                    js_item.set_named_property(
                        "startLine",
                        context.env.create_uint32(diagnostic.start_line)?,
                    )?;
                    js_item.set_named_property(
                        "startCharacter",
                        context.env.create_uint32(diagnostic.start_character)?,
                    )?;
                    js_item.set_named_property(
                        "endLine",
                        context.env.create_uint32(diagnostic.end_line)?,
                    )?;
                    js_item.set_named_property(
                        "endCharacter",
                        context.env.create_uint32(diagnostic.end_character)?,
                    )?;
                    js_item.set_named_property(
                        "message",
                        context.env.create_string(&diagnostic.message)?,
                    )?;
                    if let Some(severity) = diagnostic.severity {
                        js_item
                            .set_named_property("severity", context.env.create_uint32(severity)?)?;
                    }
                    if let Some(code) = diagnostic.code.as_ref() {
                        js_item.set_named_property("code", context.env.create_string(code)?)?;
                    }
                    if let Some(source) = diagnostic.source.as_ref() {
                        js_item.set_named_property("source", context.env.create_string(source)?)?;
                    }
                    js_diagnostics.set_element(index as u32, js_item)?;
                }
                object.set_named_property("diagnostics", js_diagnostics)?;
            }

            Ok(vec![object.into_unknown()])
        },
    )?;

    if let Ok(mut guard) = EVENT_CALLBACK.lock() {
        *guard = Some(tsfn);
    }

    Ok(())
}

#[napi]
pub fn open_document(request: LspDocumentRequest) -> Result<()> {
    handle_open_document(request)
}

#[napi]
pub fn change_document(request: LspDocumentRequest) -> Result<()> {
    handle_change_document(request)
}

#[napi]
pub fn save_document(request: LspDocumentRequest) -> Result<()> {
    handle_save_document(request)
}

#[napi]
pub fn close_document(request: LspDocumentRequest) -> Result<()> {
    handle_close_document(request)
}

#[napi]
pub fn completion(request: LspCompletionRequest) -> Result<LspCompletionResult> {
    handle_completion(request)
}

#[napi]
pub fn shutdown() -> Result<()> {
    let runtimes = if let Ok(guard) = SERVERS.lock() {
        guard.values().cloned().collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    for runtime in runtimes {
        let _ = send_notification(&runtime, "shutdown", json!({}));
        let _ = send_notification(&runtime, "exit", json!({}));
        if let Ok(mut child) = runtime.child.lock() {
            let _ = child.kill();
        }
    }

    if let Ok(mut guard) = SERVERS.lock() {
        guard.clear();
    }

    Ok(())
}
