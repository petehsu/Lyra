mod modules;

use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use lyra_lsp_core::{
    change_document as lsp_change_document, clear_rust_event_callback as clear_lsp_event_callback,
    close_document as lsp_close_document, completion as lsp_completion,
    find_references as lsp_find_references, get_diagnostics as lsp_get_diagnostics,
    goto_definition as lsp_goto_definition, hover as lsp_hover, open_document as lsp_open_document,
    register_rust_event_callback as register_lsp_event_callback,
    save_document as lsp_save_document, shutdown as shutdown_lsp, LspCompletionRequest,
    LspDiagnosticsRequest, LspDocumentRequest, LspPositionRequest,
};
use lyra_mcp_core::{
    clear_rust_event_callback as clear_mcp_event_callback,
    create_mcp_server_from_template_json, delete_mcp_secret_refs_json,
    materialize_mcp_runtime_environment_json, merge_mcp_effective_config_json,
    normalize_mcp_environment_input_json, read_mcp_runtime_introspection_json,
    read_mcp_runtime_statuses_json, read_mcp_scope_document_json, read_mcp_secret_store_json,
    register_rust_event_callback as register_mcp_event_callback, restart_mcp_runtime_json,
    sanitize_mcp_environment_json, shutdown_mcp_runtime, start_mcp_runtime_json,
    stop_mcp_runtime_json, validate_mcp_server_json, write_mcp_managed_manifest_json,
    write_mcp_scope_document_json, write_mcp_secret_store_json,
};
use lyra_runtime_protocol::{
    HandshakeRequest, HandshakeResponse, RuntimeEnvelope, RuntimeError, PROTOCOL_VERSION,
};
use lyra_terminal_core::{
    clear_rust_event_callback as clear_terminal_event_callback,
    close_session as close_terminal_session, create_session as create_terminal_session,
    read_session as read_terminal_session,
    register_rust_event_callback as register_terminal_event_callback,
    resize_session as resize_terminal_session, restore_sessions as restore_terminal_sessions,
    shutdown as shutdown_terminal, write_session as write_terminal_session, TerminalCloseRequest,
    TerminalCreateRequest, TerminalReadRequest, TerminalResizeRequest, TerminalRestoreRequest,
    TerminalWriteRequest,
};
use modules::code_intel::{
    expand_code_graph_json, read_code_index_status_json, rebuild_code_index_json,
    search_code_symbol_json, search_code_text_json,
};
use modules::fs::{
    read_search_index_status_json, rebuild_search_index_json, search_local_json,
    search_local_stream_cancel_json, search_local_stream_read_json, search_local_stream_start_json,
};
use modules::web::{
    search_site_stream_cancel_json, search_site_stream_read_json, search_site_stream_start_json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

const RUNTIME_NAME: &str = "lyrad";
const TERMINAL_RUNTIME_EVENT_NAME: &str = "terminal.runtime";
const MCP_RUNTIME_EVENT_NAME: &str = "mcp.runtime";
const LSP_RUNTIME_EVENT_NAME: &str = "lsp.runtime";
const TOKIO_WORKER_STACK_SIZE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone)]
struct ConnectionContext {
    outgoing: UnboundedSender<RuntimeEnvelope>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTerminalCreateRequest {
    session_id: Option<String>,
    title: Option<String>,
    cwd: Option<String>,
    shell: Option<String>,
    cols: u16,
    rows: u16,
    source: Option<String>,
    mode: Option<String>,
    command: Option<String>,
    persist: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTerminalRestoreRequest {
    sessions: Vec<RuntimeTerminalCreateRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTerminalWriteRequest {
    session_id: String,
    data: Option<String>,
    text: Option<String>,
    keys: Option<Vec<String>>,
    append_newline: Option<bool>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTerminalReadRequest {
    session_id: String,
    cursor: Option<String>,
    max_bytes: Option<u32>,
    wait_ms: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTerminalResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTerminalCloseRequest {
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLspDocumentRequest {
    session_id: String,
    file_path: String,
    language_id: String,
    content: String,
    version: i32,
    project_root: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLspCompletionRequest {
    session_id: String,
    file_path: String,
    language_id: String,
    line: u32,
    column: u32,
    version: i32,
    project_root: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLspPositionRequest {
    file_path: String,
    language_id: String,
    line: u32,
    column: u32,
    project_root: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeLspDiagnosticsRequest {
    file_path: String,
    language_id: String,
    content: String,
    version: i32,
    project_root: Option<String>,
}

fn runtime_error(code: &str, message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(code, message.into())
}

fn map_runtime_error(error: impl std::fmt::Display) -> RuntimeError {
    runtime_error("RUNTIME_ERROR", error.to_string())
}

fn json_request(payload: Value) -> Result<String, RuntimeError> {
    serde_json::to_string(&payload)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
}

fn parse_json_result(payload: String) -> Result<Value, RuntimeError> {
    serde_json::from_str(&payload)
        .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
}

fn call_json<E>(
    payload: Value,
    handler: impl FnOnce(String) -> Result<String, E>,
) -> Result<Value, RuntimeError>
where
    E: std::fmt::Display,
{
    let request_json = json_request(payload)?;
    let response_json = handler(request_json).map_err(map_runtime_error)?;
    parse_json_result(response_json)
}

fn call_json_noarg<E>(handler: impl FnOnce() -> Result<String, E>) -> Result<Value, RuntimeError>
where
    E: std::fmt::Display,
{
    let response_json = handler().map_err(map_runtime_error)?;
    parse_json_result(response_json)
}

fn call_void<E>(
    payload: Value,
    handler: impl FnOnce(String) -> Result<(), E>,
) -> Result<Value, RuntimeError>
where
    E: std::fmt::Display,
{
    let request_json = json_request(payload)?;
    handler(request_json).map_err(map_runtime_error)?;
    Ok(Value::Null)
}

fn to_value<T: Serialize>(value: &T) -> Result<Value, RuntimeError> {
    serde_json::to_value(value)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
}

fn map_terminal_create_request(request: RuntimeTerminalCreateRequest) -> TerminalCreateRequest {
    TerminalCreateRequest {
        session_id: request.session_id,
        title: request.title,
        cwd: request.cwd,
        shell: request.shell,
        cols: request.cols,
        rows: request.rows,
        source: request.source,
        mode: request.mode,
        command: request.command,
        persist: request.persist,
    }
}

fn normalize_terminal_restore_request(
    request: RuntimeTerminalRestoreRequest,
) -> TerminalRestoreRequest {
    TerminalRestoreRequest {
        sessions: request
            .sessions
            .into_iter()
            .map(map_terminal_create_request)
            .collect(),
    }
}

fn handle_terminal_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "terminal.sessions.create" => {
            let request: RuntimeTerminalCreateRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            let snapshot = create_terminal_session(map_terminal_create_request(request))
                .map_err(map_runtime_error)?;
            to_value(&snapshot)
        }
        "terminal.sessions.restore" => {
            let request: RuntimeTerminalRestoreRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            let snapshots = restore_terminal_sessions(normalize_terminal_restore_request(request))
                .map_err(map_runtime_error)?;
            to_value(&snapshots)
        }
        "terminal.sessions.write" => {
            let request: RuntimeTerminalWriteRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            write_terminal_session(TerminalWriteRequest {
                session_id: request.session_id,
                data: request.data,
                text: request.text,
                keys: request.keys,
                append_newline: request.append_newline,
                source: request.source,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.sessions.read" => {
            let request: RuntimeTerminalReadRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            let response = read_terminal_session(TerminalReadRequest {
                session_id: request.session_id,
                cursor: request.cursor,
                max_bytes: request.max_bytes,
                wait_ms: request.wait_ms,
            })
            .map_err(map_runtime_error)?;
            to_value(&response)
        }
        "terminal.sessions.resize" => {
            let request: RuntimeTerminalResizeRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            resize_terminal_session(TerminalResizeRequest {
                session_id: request.session_id,
                cols: request.cols,
                rows: request.rows,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.sessions.close" => {
            let request: RuntimeTerminalCloseRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            close_terminal_session(TerminalCloseRequest {
                session_id: request.session_id,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        _ => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown terminal runtime method: {method}"),
        )),
    }
}

fn handle_lsp_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "lsp.documents.open" => {
            let request: RuntimeLspDocumentRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            lsp_open_document(LspDocumentRequest {
                session_id: request.session_id,
                file_path: request.file_path,
                language_id: request.language_id,
                content: request.content,
                version: request.version,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "lsp.documents.change" => {
            let request: RuntimeLspDocumentRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            lsp_change_document(LspDocumentRequest {
                session_id: request.session_id,
                file_path: request.file_path,
                language_id: request.language_id,
                content: request.content,
                version: request.version,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "lsp.documents.save" => {
            let request: RuntimeLspDocumentRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            lsp_save_document(LspDocumentRequest {
                session_id: request.session_id,
                file_path: request.file_path,
                language_id: request.language_id,
                content: request.content,
                version: request.version,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "lsp.documents.close" => {
            let request: RuntimeLspDocumentRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            lsp_close_document(LspDocumentRequest {
                session_id: request.session_id,
                file_path: request.file_path,
                language_id: request.language_id,
                content: request.content,
                version: request.version,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "lsp.completion" => {
            let request: RuntimeLspCompletionRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            let result = lsp_completion(LspCompletionRequest {
                session_id: request.session_id,
                file_path: request.file_path,
                language_id: request.language_id,
                line: request.line,
                column: request.column,
                version: request.version,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            to_value(&result)
        }
        "lsp.goto_definition" => {
            let request: RuntimeLspPositionRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            let result = lsp_goto_definition(LspPositionRequest {
                file_path: request.file_path,
                language_id: request.language_id,
                line: request.line,
                column: request.column,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            to_value(&result)
        }
        "lsp.find_references" => {
            let request: RuntimeLspPositionRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            let result = lsp_find_references(LspPositionRequest {
                file_path: request.file_path,
                language_id: request.language_id,
                line: request.line,
                column: request.column,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            to_value(&result)
        }
        "lsp.hover" => {
            let request: RuntimeLspPositionRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            let result = lsp_hover(LspPositionRequest {
                file_path: request.file_path,
                language_id: request.language_id,
                line: request.line,
                column: request.column,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            to_value(&result)
        }
        "lsp.get_diagnostics" => {
            let request: RuntimeLspDiagnosticsRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            let result = lsp_get_diagnostics(LspDiagnosticsRequest {
                file_path: request.file_path,
                language_id: request.language_id,
                content: request.content,
                version: request.version,
                project_root: request.project_root,
            })
            .map_err(map_runtime_error)?;
            to_value(&result)
        }
        _ => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown lsp runtime method: {method}"),
        )),
    }
}

fn handle_mcp_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "mcp.read_scope_document" => call_json(payload, read_mcp_scope_document_json),
        "mcp.write_scope_document" => call_void(payload, write_mcp_scope_document_json),
        "mcp.read_secret_store" => call_json(payload, read_mcp_secret_store_json),
        "mcp.write_secret_store" => call_void(payload, write_mcp_secret_store_json),
        "mcp.sanitize_environment" => call_json(payload, sanitize_mcp_environment_json),
        "mcp.normalize_environment_input" => {
            call_json(payload, normalize_mcp_environment_input_json)
        }
        "mcp.delete_secret_refs" => call_json(payload, delete_mcp_secret_refs_json),
        "mcp.merge_effective_config" => call_json(payload, merge_mcp_effective_config_json),
        "mcp.validate_server" => call_json(payload, validate_mcp_server_json),
        "mcp.write_managed_manifest" => call_void(payload, write_mcp_managed_manifest_json),
        "mcp.materialize_runtime_environment" => {
            call_json(payload, materialize_mcp_runtime_environment_json)
        }
        "mcp.create_server_from_template" => {
            call_json(payload, create_mcp_server_from_template_json)
        }
        "mcp.read_runtime_statuses" => call_json_noarg(read_mcp_runtime_statuses_json),
        "mcp.read_runtime_introspection" => call_json(payload, read_mcp_runtime_introspection_json),
        "mcp.start_runtime" => call_json(payload, start_mcp_runtime_json),
        "mcp.stop_runtime" => call_json(payload, stop_mcp_runtime_json),
        "mcp.restart_runtime" => call_json(payload, restart_mcp_runtime_json),
        _ => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown mcp runtime method: {method}"),
        )),
    }
}

fn handle_search_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "search.local" => call_json(payload, search_local_json),
        "search.local.stream.start" => call_json(payload, search_local_stream_start_json),
        "search.local.stream.read" => call_json(payload, search_local_stream_read_json),
        "search.local.stream.cancel" => call_json(payload, search_local_stream_cancel_json),
        "search.index.status" => call_json(payload, read_search_index_status_json),
        "search.index.rebuild" => call_json(payload, rebuild_search_index_json),
        "search.site.stream.start" => call_json(payload, search_site_stream_start_json),
        "search.site.stream.read" => call_json(payload, search_site_stream_read_json),
        "search.site.stream.cancel" => call_json(payload, search_site_stream_cancel_json),
        _ => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown search runtime method: {method}"),
        )),
    }
}

fn handle_code_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "code.index.status" => call_json(payload, read_code_index_status_json),
        "code.index.rebuild" => call_json(payload, rebuild_code_index_json),
        "code.search.text" => call_json(payload, search_code_text_json),
        "code.search.symbol" => call_json(payload, search_code_symbol_json),
        "code.graph.expand" => call_json(payload, expand_code_graph_json),
        _ => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown code runtime method: {method}"),
        )),
    }
}

fn handle_runtime_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "runtime.handshake" => {
            let request: HandshakeRequest = serde_json::from_value(payload)
                .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
            if request.protocol_version != PROTOCOL_VERSION {
                return Err(runtime_error(
                    "PROTOCOL_VERSION_MISMATCH",
                    format!(
                        "expected protocol version {}, got {}",
                        PROTOCOL_VERSION, request.protocol_version
                    ),
                ));
            }
            serde_json::to_value(HandshakeResponse {
                protocol_version: PROTOCOL_VERSION,
                server_name: RUNTIME_NAME.to_string(),
            })
            .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
        }
        method if method.starts_with("code.") => handle_code_request(method, payload),
        method if method.starts_with("search.") => handle_search_request(method, payload),
        method if method.starts_with("terminal.") => handle_terminal_request(method, payload),
        method if method.starts_with("mcp.") => handle_mcp_request(method, payload),
        method if method.starts_with("lsp.") => handle_lsp_request(method, payload),
        other => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown runtime method: {other}"),
        )),
    }
}

fn forward_json_event(
    outgoing: &UnboundedSender<RuntimeEnvelope>,
    event_name: &str,
    payload_json: &str,
) {
    let payload = match serde_json::from_str::<Value>(payload_json) {
        Ok(payload) => payload,
        Err(error) => json!({
            "kind": "error",
            "message": format!("failed to decode {event_name} payload: {error}")
        }),
    };
    let _ = outgoing.send(RuntimeEnvelope::Event {
        event: event_name.to_string(),
        payload,
    });
}

fn register_runtime_hooks(connection: &ConnectionContext) {
    let terminal_outgoing = connection.outgoing.clone();
    register_terminal_event_callback(Arc::new(move |event_json| {
        forward_json_event(&terminal_outgoing, TERMINAL_RUNTIME_EVENT_NAME, &event_json);
    }));

    let mcp_outgoing = connection.outgoing.clone();
    register_mcp_event_callback(Arc::new(move |event_json| {
        forward_json_event(&mcp_outgoing, MCP_RUNTIME_EVENT_NAME, &event_json);
    }));

    let lsp_outgoing = connection.outgoing.clone();
    register_lsp_event_callback(Arc::new(move |event_json| {
        forward_json_event(&lsp_outgoing, LSP_RUNTIME_EVENT_NAME, &event_json);
    }));
}

fn shutdown_runtime_modules() {
    let _ = shutdown_terminal();
    let _ = shutdown_mcp_runtime();
    let _ = shutdown_lsp();
    clear_terminal_event_callback();
    clear_mcp_event_callback();
    clear_lsp_event_callback();
}

fn resolve_socket_path() -> PathBuf {
    let mut args = env::args().skip(1);
    while let Some(argument) = args.next() {
        if argument == "--socket" {
            if let Some(value) = args.next() {
                return PathBuf::from(value);
            }
        }
    }
    panic!("missing required --socket argument");
}

async fn write_loop(
    mut writer: tokio::net::unix::OwnedWriteHalf,
    mut receiver: tokio::sync::mpsc::UnboundedReceiver<RuntimeEnvelope>,
) {
    while let Some(envelope) = receiver.recv().await {
        let encoded = match serde_json::to_vec(&envelope) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if writer.write_all(&encoded).await.is_err() {
            break;
        }
        if writer.write_all(b"\n").await.is_err() {
            break;
        }
    }
}

async fn handle_request_envelope(
    connection: ConnectionContext,
    id: String,
    method: String,
    payload: Value,
) {
    let outgoing = connection.outgoing.clone();
    let response = match tokio::task::spawn_blocking(move || handle_runtime_request(&method, payload)).await {
        Ok(Ok(result)) => RuntimeEnvelope::Response {
            id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Ok(Err(error)) => RuntimeEnvelope::Response {
            id,
            ok: false,
            result: None,
            error: Some(error),
        },
        Err(error) => RuntimeEnvelope::Response {
            id,
            ok: false,
            result: None,
            error: Some(runtime_error("TASK_JOIN_FAILED", error.to_string())),
        },
    };
    let _ = outgoing.send(response);
}

async fn serve_connection(stream: UnixStream) -> Result<(), RuntimeError> {
    let (reader, writer) = stream.into_split();
    let (outgoing, receiver) = unbounded_channel::<RuntimeEnvelope>();
    let context = ConnectionContext {
        outgoing: outgoing.clone(),
    };
    register_runtime_hooks(&context);

    let writer_task = tokio::spawn(write_loop(writer, receiver));
    let mut lines = BufReader::new(reader).lines();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| runtime_error("SOCKET_READ_FAILED", error.to_string()))?
    {
        if line.trim().is_empty() {
            continue;
        }
        let envelope: RuntimeEnvelope = serde_json::from_str(&line)
            .map_err(|error| runtime_error("PROTOCOL_DECODE_FAILED", error.to_string()))?;
        match envelope {
            RuntimeEnvelope::Request {
                id,
                method,
                payload,
            } => {
                tokio::spawn(handle_request_envelope(
                    context.clone(),
                    id,
                    method,
                    payload,
                ));
            }
            RuntimeEnvelope::Response { .. } => {}
            RuntimeEnvelope::Event { .. } => {}
        }
    }

    writer_task.abort();
    shutdown_runtime_modules();
    Ok(())
}

#[cfg(unix)]
fn main() {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(TOKIO_WORKER_STACK_SIZE_BYTES)
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("failed to initialize {RUNTIME_NAME} runtime: {error}");
            std::process::exit(1);
        }
    };

    runtime.block_on(run_unix_runtime());
}

#[cfg(unix)]
async fn run_unix_runtime() {
    let socket_path = resolve_socket_path();
    if let Some(parent) = socket_path.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            eprintln!(
                "failed to create socket directory {}: {error}",
                parent.display()
            );
            std::process::exit(1);
        }
    }
    if Path::new(&socket_path).exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

    let listener = match UnixListener::bind(&socket_path) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!(
                "failed to bind runtime socket {}: {error}",
                socket_path.display()
            );
            std::process::exit(1);
        }
    };

    match listener.accept().await {
        Ok((stream, _addr)) => {
            if let Err(error) = serve_connection(stream).await {
                eprintln!("runtime server error: {}", error.message);
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("failed to accept runtime connection: {error}");
            std::process::exit(1);
        }
    }
}

#[cfg(not(unix))]
fn main() {
    eprintln!("lyrad local socket runtime is currently implemented for unix targets only");
    std::process::exit(1);
}
