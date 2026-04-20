mod host_rpc;
mod modules;

use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Duration;

use host_rpc::HostRpcClient;
use lyra_ai_core::{
    answer_agent_plan_question_json, answer_agent_question_json, archive_agent_thread_json,
    bind_agent_session_project_json, clear_rust_event_callback as clear_agent_event_callback,
    create_agent_session_json, delete_agent_session_json, delete_ai_profile_json,
    discover_ai_models_json, ensure_agent_thread_json, enter_agent_plan_mode_json,
    fork_agent_thread_json, get_agent_pending_interactions_json, get_agent_plan_json,
    get_agent_session_json, get_agent_thread_json, get_ai_memory_config_json,
    list_agent_sessions_json, list_agent_threads_json, read_ai_preset_catalog_json,
    read_ai_profiles_json, read_ai_provider_catalog_json, refresh_ai_models_json,
    register_host_tools_bridge, register_mcp_server_tools_bridge,
    register_rust_event_callback as register_agent_event_callback,
    resolve_agent_plan_approval_json, resume_agent_execution_json, resume_agent_thread_json,
    rollback_agent_thread_json, run_ai_memory_scheduler_tick, send_agent_thread_turn_json,
    send_agent_turn_json, set_browser_strategy_runtime_state, set_default_ai_profile_json,
    set_persona_runtime_state, set_skill_prompts, submit_command_approval_json,
    unarchive_agent_thread_json, unregister_host_tool_set, unregister_mcp_server_tools,
    update_ai_memory_config_json, upsert_ai_profile_json, validate_ai_profile_json,
    BrowserStrategyRuntimeState, ExternalToolApprovalMode, ExternalToolSideEffectLevel,
    ExternalToolSideEffects, HostToolDescriptor, McpServerToolDescriptor, PersonaRuntimeState,
    SkillPromptEntry, ToolExecutionMode,
};
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
    call_mcp_tool_json, clear_rust_event_callback as clear_mcp_event_callback,
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
use tokio::sync::Mutex;
use tokio::time::MissedTickBehavior;

const RUNTIME_NAME: &str = "lyrad";
const TERMINAL_RUNTIME_EVENT_NAME: &str = "terminal.runtime";
const MCP_RUNTIME_EVENT_NAME: &str = "mcp.runtime";
const LSP_RUNTIME_EVENT_NAME: &str = "lsp.runtime";
const AGENT_RUNTIME_EVENT_NAME: &str = "agent.runtime";

#[derive(Clone)]
struct ConnectionContext {
    outgoing: UnboundedSender<RuntimeEnvelope>,
    host_rpc: HostRpcClient,
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
struct RuntimeTerminalExecRequest {
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeTerminalExecResult {
    session_id: String,
    command: String,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    output: String,
    timed_out: bool,
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

fn map_agent_runtime_error(error: impl std::fmt::Display) -> RuntimeError {
    let raw = error.to_string();
    let Some(rest) = raw.strip_prefix("AGENT_ERROR::") else {
        return runtime_error("RUNTIME_ERROR", raw);
    };
    let mut parts = rest.splitn(2, "::");
    let code = parts.next().unwrap_or("RUNTIME_ERROR").trim();
    let message = parts.next().unwrap_or(raw.as_str());
    runtime_error(
        if code.is_empty() {
            "RUNTIME_ERROR"
        } else {
            code
        },
        message.to_string(),
    )
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

fn call_agent_json<E>(
    payload: Value,
    handler: impl FnOnce(String) -> Result<String, E>,
) -> Result<Value, RuntimeError>
where
    E: std::fmt::Display,
{
    let request_json = json_request(payload)?;
    let response_json = handler(request_json).map_err(map_agent_runtime_error)?;
    parse_json_result(response_json)
}

fn call_agent_void<E>(
    payload: Value,
    handler: impl FnOnce(String) -> Result<(), E>,
) -> Result<Value, RuntimeError>
where
    E: std::fmt::Display,
{
    let request_json = json_request(payload)?;
    handler(request_json).map_err(map_agent_runtime_error)?;
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

fn run_terminal_exec(payload: Value) -> Result<Value, RuntimeError> {
    let request: RuntimeTerminalExecRequest = serde_json::from_value(payload)
        .map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))?;
    let command = request.command.trim().to_string();
    if command.is_empty() {
        return Err(runtime_error("BAD_REQUEST", "command is required"));
    }

    let cwd = request
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(90_000).max(1_000));

    #[cfg(target_os = "windows")]
    let mut child = Command::new("cmd")
        .args(["/C", command.as_str()])
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| runtime_error("TERMINAL_EXEC_FAILED", error.to_string()))?;
    #[cfg(not(target_os = "windows"))]
    let mut child = Command::new("/bin/sh")
        .args(["-lc", command.as_str()])
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| runtime_error("TERMINAL_EXEC_FAILED", error.to_string()))?;

    let started_at = std::time::Instant::now();
    let mut timed_out = false;
    loop {
        if child
            .try_wait()
            .map_err(|error| runtime_error("TERMINAL_EXEC_FAILED", error.to_string()))?
            .is_some()
        {
            break;
        }
        if started_at.elapsed() >= timeout {
            timed_out = true;
            child
                .kill()
                .map_err(|error| runtime_error("TERMINAL_EXEC_FAILED", error.to_string()))?;
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    let output = child
        .wait_with_output()
        .map_err(|error| runtime_error("TERMINAL_EXEC_FAILED", error.to_string()))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let combined_output = match (stdout.trim().is_empty(), stderr.trim().is_empty()) {
        (false, false) => format!("{stdout}\n{stderr}"),
        (false, true) => stdout.clone(),
        (true, false) => stderr.clone(),
        (true, true) => String::new(),
    };

    to_value(&RuntimeTerminalExecResult {
        session_id: format!("runtime-exec-{}", uuid::Uuid::new_v4()),
        command,
        exit_code: output.status.code(),
        stdout,
        stderr,
        output: combined_output,
        timed_out,
    })
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
        "terminal.exec" => run_terminal_exec(payload),
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
        "mcp.call_tool" => call_json(payload, call_mcp_tool_json),
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

fn handle_agent_request(
    method: &str,
    payload: Value,
    host_rpc: Option<&HostRpcClient>,
) -> Result<Value, RuntimeError> {
    match method {
        "agent.sessions.list" => call_agent_json(payload, list_agent_sessions_json),
        "agent.sessions.create" => call_agent_json(payload, create_agent_session_json),
        "agent.sessions.get" => call_agent_json(payload, get_agent_session_json),
        "agent.threads.ensure" => call_agent_json(payload, ensure_agent_thread_json),
        "agent.threads.get" => call_agent_json(payload, get_agent_thread_json),
        "agent.threads.list" => call_agent_json(payload, list_agent_threads_json),
        "agent.threads.fork" => call_agent_json(payload, fork_agent_thread_json),
        "agent.threads.archive" => call_agent_json(payload, archive_agent_thread_json),
        "agent.threads.unarchive" => call_agent_json(payload, unarchive_agent_thread_json),
        "agent.threads.resume" => call_agent_json(payload, resume_agent_thread_json),
        "agent.threads.rollback" => call_agent_json(payload, rollback_agent_thread_json),
        "agent.sessions.bind_project" => call_agent_json(payload, bind_agent_session_project_json),
        "agent.sessions.delete" => call_agent_void(payload, delete_agent_session_json),
        "agent.turns.send" => call_agent_json(payload, send_agent_turn_json),
        "agent.threads.turns.send" => call_agent_json(payload, send_agent_thread_turn_json),
        "agent.plan.enter" => call_agent_json(payload, enter_agent_plan_mode_json),
        "agent.plan.get" => call_agent_json(payload, get_agent_plan_json),
        "agent.interactions.get_pending" => {
            call_agent_json(payload, get_agent_pending_interactions_json)
        }
        "agent.questions.answer" => call_agent_json(payload, answer_agent_question_json),
        "agent.plan.answer_question" => call_agent_json(payload, answer_agent_plan_question_json),
        "agent.plan.resolve_approval" => call_agent_json(payload, resolve_agent_plan_approval_json),
        "agent.command_approval.submit" => call_agent_json(payload, submit_command_approval_json),
        "agent.execution.resume" => call_agent_json(payload, resume_agent_execution_json),
        "agent.memory.getConfig" => call_agent_json(payload, get_ai_memory_config_json),
        "agent.memory.updateConfig" => call_agent_json(payload, update_ai_memory_config_json),
        "agent.persona_context.sync" => handle_persona_context_sync(payload),
        "agent.mcp_bridge.sync" => handle_mcp_bridge_sync(payload),
        "agent.mcp_bridge.remove" => handle_mcp_bridge_remove(payload),
        "agent.host_tools.sync" => handle_host_tools_sync(
            payload,
            host_rpc.ok_or_else(|| {
                runtime_error(
                    "HOST_RPC_UNAVAILABLE",
                    "host RPC is unavailable for this connection",
                )
            })?,
        ),
        "agent.host_tools.remove" => handle_host_tools_remove(payload),
        "agent.browser_strategy.sync" => handle_browser_strategy_sync(payload),
        "agent.skills.set_prompts" => handle_set_skill_prompts(payload),
        _ => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown agent runtime method: {method}"),
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

// --- MCP ↔ Agent Bridge ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpBridgeSyncRequest {
    server: Value,
    tools: Vec<McpBridgeTool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpBridgeTool {
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    input_schema: Option<Value>,
    #[serde(default)]
    output_schema: Option<Value>,
    #[serde(default)]
    execution_mode: Option<String>,
    #[serde(default)]
    approval_mode: Option<String>,
    #[serde(default)]
    side_effects: Option<McpBridgeToolSideEffects>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpBridgeToolSideEffects {
    #[serde(default)]
    level: Option<String>,
    #[serde(default)]
    mutates_workspace: Option<bool>,
    #[serde(default)]
    mutates_memory: Option<bool>,
    #[serde(default)]
    mutates_external_systems: Option<bool>,
    #[serde(default)]
    mutates_session_state: Option<bool>,
    #[serde(default)]
    opens_interactive_session: Option<bool>,
    #[serde(default)]
    reads_network: Option<bool>,
}

fn parse_execution_mode(value: Option<&str>) -> Option<ToolExecutionMode> {
    match value {
        Some("parallel_readonly") => Some(ToolExecutionMode::ParallelReadOnly),
        Some("serial") => Some(ToolExecutionMode::Serial),
        _ => None,
    }
}

fn parse_approval_mode(value: Option<&str>) -> Option<ExternalToolApprovalMode> {
    match value {
        Some("auto") => Some(ExternalToolApprovalMode::Auto),
        Some("ask") => Some(ExternalToolApprovalMode::Ask),
        Some("deny") => Some(ExternalToolApprovalMode::Deny),
        _ => None,
    }
}

fn parse_side_effect_level(value: Option<&str>) -> Option<ExternalToolSideEffectLevel> {
    match value {
        Some("read_only") => Some(ExternalToolSideEffectLevel::ReadOnly),
        Some("network_read") => Some(ExternalToolSideEffectLevel::NetworkRead),
        Some("session_mutation") => Some(ExternalToolSideEffectLevel::SessionMutation),
        Some("workspace_write") => Some(ExternalToolSideEffectLevel::WorkspaceWrite),
        Some("external_mutation") => Some(ExternalToolSideEffectLevel::ExternalMutation),
        _ => None,
    }
}

fn map_side_effects(value: Option<McpBridgeToolSideEffects>) -> Option<ExternalToolSideEffects> {
    value.map(|effects| {
        let mutates_workspace = effects.mutates_workspace.unwrap_or(false);
        let mutates_memory = effects.mutates_memory.unwrap_or(false);
        let mutates_external_systems = effects.mutates_external_systems.unwrap_or(false);
        let mutates_session_state = effects.mutates_session_state.unwrap_or(false);
        let opens_interactive_session = effects.opens_interactive_session.unwrap_or(false);
        let reads_network = effects.reads_network.unwrap_or(false);
        let level = parse_side_effect_level(effects.level.as_deref()).unwrap_or({
            if mutates_workspace {
                ExternalToolSideEffectLevel::WorkspaceWrite
            } else if mutates_session_state || opens_interactive_session {
                ExternalToolSideEffectLevel::SessionMutation
            } else if mutates_external_systems {
                ExternalToolSideEffectLevel::ExternalMutation
            } else if reads_network {
                ExternalToolSideEffectLevel::NetworkRead
            } else {
                ExternalToolSideEffectLevel::ReadOnly
            }
        });
        ExternalToolSideEffects {
            level,
            mutates_workspace,
            mutates_memory,
            mutates_external_systems,
            mutates_session_state,
            opens_interactive_session,
            reads_network,
        }
    })
}

fn handle_mcp_bridge_sync(payload: Value) -> Result<Value, RuntimeError> {
    let request: McpBridgeSyncRequest =
        serde_json::from_value(payload).map_err(|e| runtime_error("BAD_REQUEST", e.to_string()))?;

    let server_id = request
        .server
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if server_id.is_empty() {
        return Err(runtime_error("BAD_REQUEST", "missing server.id"));
    }

    // Unregister any previously registered tools for this server.
    unregister_mcp_server_tools(&server_id);

    let tools: Vec<McpServerToolDescriptor> = request
        .tools
        .into_iter()
        .map(|t| McpServerToolDescriptor {
            name: t.name,
            description: t.description.unwrap_or_default(),
            input_schema: t.input_schema,
            output_schema: t.output_schema,
            execution_mode: parse_execution_mode(t.execution_mode.as_deref()),
            approval_mode: parse_approval_mode(t.approval_mode.as_deref()),
            side_effects: map_side_effects(t.side_effects),
        })
        .collect();
    let count = tools.len();

    // Capture the full server config for use in MCP calls.
    let server_config = Arc::new(request.server);

    register_mcp_server_tools_bridge(
        &server_id,
        tools,
        Arc::new(move |_sid, tool_name, input| {
            let arguments = input
                .get("arguments")
                .and_then(Value::as_object)
                .cloned()
                .or_else(|| input.as_object().cloned())
                .unwrap_or_default();
            let call_request = json!({
                "server": *server_config,
                "toolName": tool_name,
                "arguments": arguments,
            });
            let request_json = serde_json::to_string(&call_request)
                .map_err(|e| format!("failed to serialize MCP call: {e}"))?;
            let response_json = call_mcp_tool_json(request_json)
                .map_err(|e| format!("MCP tool call failed: {e}"))?;
            serde_json::from_str(&response_json)
                .map_err(|e| format!("failed to parse MCP response: {e}"))
        }),
    );

    Ok(json!({ "registered": count, "serverId": server_id }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpBridgeRemoveRequest {
    server_id: String,
}

fn handle_mcp_bridge_remove(payload: Value) -> Result<Value, RuntimeError> {
    let request: McpBridgeRemoveRequest =
        serde_json::from_value(payload).map_err(|e| runtime_error("BAD_REQUEST", e.to_string()))?;
    unregister_mcp_server_tools(&request.server_id);
    Ok(json!({ "removed": true, "serverId": request.server_id }))
}

// --- Host Tool Bridge ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostToolsSyncRequest {
    tool_set_id: String,
    tools: Vec<HostBridgeTool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostBridgeTool {
    name: String,
    description: String,
    #[serde(default)]
    input_schema: Option<Value>,
    #[serde(default)]
    output_schema: Option<Value>,
    #[serde(default)]
    execution_mode: Option<String>,
    #[serde(default)]
    approval_mode: Option<String>,
    #[serde(default)]
    side_effects: Option<McpBridgeToolSideEffects>,
    host_method: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostToolsRemoveRequest {
    tool_set_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserStrategySyncRequest {
    preferred_engine: Option<String>,
    browser_use_health: Option<String>,
    browser_use_tool_exposed: Option<bool>,
}

fn handle_host_tools_sync(payload: Value, host_rpc: &HostRpcClient) -> Result<Value, RuntimeError> {
    let request: HostToolsSyncRequest =
        serde_json::from_value(payload).map_err(|e| runtime_error("BAD_REQUEST", e.to_string()))?;
    let tool_set_id = request.tool_set_id.trim().to_string();
    if tool_set_id.is_empty() {
        return Err(runtime_error("BAD_REQUEST", "missing toolSetId"));
    }

    unregister_host_tool_set(&tool_set_id);

    let tools: Vec<HostToolDescriptor> = request
        .tools
        .into_iter()
        .map(|tool| HostToolDescriptor {
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema.unwrap_or_else(|| {
                json!({
                    "type": "object",
                    "additionalProperties": true
                })
            }),
            output_schema: tool
                .output_schema
                .unwrap_or_else(|| json!({ "type": "object" })),
            execution_mode: parse_execution_mode(tool.execution_mode.as_deref())
                .unwrap_or(ToolExecutionMode::Serial),
            approval_mode: parse_approval_mode(tool.approval_mode.as_deref())
                .unwrap_or(ExternalToolApprovalMode::Auto),
            side_effects: map_side_effects(tool.side_effects)
                .unwrap_or_else(ExternalToolSideEffects::read_only),
            host_method: tool.host_method,
        })
        .collect();
    let registered_count = tools.len();
    let bridge_client = host_rpc.clone();

    register_host_tools_bridge(
        &tool_set_id,
        tools,
        Arc::new(move |descriptor, input, context| {
            let response = bridge_client.call_json_blocking(
                &descriptor.host_method,
                json!({
                    "toolName": descriptor.name,
                    "arguments": input,
                    "context": {
                        "storageRoot": context.storage_root,
                        "projectRoot": context.project_root,
                        "agentSessionId": context.agent_session_id,
                        "agentTurnId": context.agent_turn_id,
                        "toolCallId": context.tool_call_id,
                        "planMode": context.plan_mode,
                    }
                }),
                Duration::from_secs(3),
            );
            response.map_err(|error| lyra_ai_core::AgentToolError {
                code: error.code,
                message: error.message,
                metadata: error.details,
            })
        }),
    );

    Ok(json!({ "registered": registered_count, "toolSetId": tool_set_id }))
}

fn handle_host_tools_remove(payload: Value) -> Result<Value, RuntimeError> {
    let request: HostToolsRemoveRequest =
        serde_json::from_value(payload).map_err(|e| runtime_error("BAD_REQUEST", e.to_string()))?;
    unregister_host_tool_set(&request.tool_set_id);
    Ok(json!({ "removed": true, "toolSetId": request.tool_set_id }))
}

fn handle_browser_strategy_sync(payload: Value) -> Result<Value, RuntimeError> {
    let request: BrowserStrategySyncRequest =
        serde_json::from_value(payload).map_err(|e| runtime_error("BAD_REQUEST", e.to_string()))?;
    set_browser_strategy_runtime_state(BrowserStrategyRuntimeState {
        preferred_engine: request
            .preferred_engine
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        browser_use_health: request
            .browser_use_health
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        browser_use_tool_exposed: request.browser_use_tool_exposed.unwrap_or(false),
    });
    Ok(json!({ "ok": true }))
}

fn handle_persona_context_sync(payload: Value) -> Result<Value, RuntimeError> {
    let state: PersonaRuntimeState =
        serde_json::from_value(payload).map_err(|e| runtime_error("BAD_REQUEST", e.to_string()))?;
    set_persona_runtime_state(state);
    Ok(json!({ "ok": true }))
}

// --- Skill Prompt Bridge ---

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetSkillPromptsRequest {
    prompts: Vec<SkillPromptPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SkillPromptPayload {
    skill_id: String,
    name: String,
    content: String,
}

fn handle_set_skill_prompts(payload: Value) -> Result<Value, RuntimeError> {
    let request: SetSkillPromptsRequest =
        serde_json::from_value(payload).map_err(|e| runtime_error("BAD_REQUEST", e.to_string()))?;

    let entries: Vec<SkillPromptEntry> = request
        .prompts
        .into_iter()
        .map(|p| SkillPromptEntry {
            skill_id: p.skill_id,
            name: p.name,
            content: p.content,
        })
        .collect();
    let count = entries.len();
    set_skill_prompts(entries);

    Ok(json!({ "count": count }))
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
        "profiles.read" => call_json(payload, read_ai_profiles_json),
        "providers.catalog.read" => call_json(payload, read_ai_provider_catalog_json),
        "providers.presets.read" => call_json(payload, read_ai_preset_catalog_json),
        "profiles.upsert" => call_json(payload, upsert_ai_profile_json),
        "profiles.delete" => call_void(payload, delete_ai_profile_json),
        "profiles.set_default" => call_json(payload, set_default_ai_profile_json),
        "profiles.validate" => call_json(payload, validate_ai_profile_json),
        "models.discover" => call_json(payload, discover_ai_models_json),
        "models.refresh" => call_json(payload, refresh_ai_models_json),
        method if method.starts_with("code.") => handle_code_request(method, payload),
        method if method.starts_with("search.") => handle_search_request(method, payload),
        method if method.starts_with("terminal.") => handle_terminal_request(method, payload),
        method if method.starts_with("agent.") => handle_agent_request(method, payload, None),
        method if method.starts_with("mcp.") => handle_mcp_request(method, payload),
        method if method.starts_with("lsp.") => handle_lsp_request(method, payload),
        other => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown runtime method: {other}"),
        )),
    }
}

fn handle_runtime_request_with_connection(
    method: &str,
    payload: Value,
    connection: &ConnectionContext,
) -> Result<Value, RuntimeError> {
    if method.starts_with("agent.") {
        handle_agent_request(method, payload, Some(&connection.host_rpc))
    } else {
        handle_runtime_request(method, payload)
    }
}

fn extract_storage_root(payload: &Value) -> Option<String> {
    payload
        .get("storageRoot")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn memory_scheduler_loop(roots: Arc<Mutex<HashSet<String>>>) {
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    interval.set_missed_tick_behavior(MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let snapshot = {
            let guard = roots.lock().await;
            guard.iter().cloned().collect::<Vec<_>>()
        };
        for storage_root in snapshot {
            let _ =
                tokio::task::spawn_blocking(move || run_ai_memory_scheduler_tick(&storage_root))
                    .await;
        }
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
    let agent_outgoing = connection.outgoing.clone();
    register_agent_event_callback(Arc::new(move |event_json| {
        forward_json_event(&agent_outgoing, AGENT_RUNTIME_EVENT_NAME, &event_json);
    }));

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
    clear_agent_event_callback();
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
    let response = match tokio::task::spawn_blocking(move || {
        handle_runtime_request_with_connection(&method, payload, &connection)
    })
    .await
    {
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
        host_rpc: HostRpcClient::new(outgoing.clone()),
    };
    register_runtime_hooks(&context);
    let registered_storage_roots = Arc::new(Mutex::new(HashSet::<String>::new()));

    let writer_task = tokio::spawn(write_loop(writer, receiver));
    let scheduler_task = tokio::spawn(memory_scheduler_loop(Arc::clone(&registered_storage_roots)));
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
                if let Some(storage_root) = extract_storage_root(&payload) {
                    registered_storage_roots.lock().await.insert(storage_root);
                }
                tokio::spawn(handle_request_envelope(
                    context.clone(),
                    id,
                    method,
                    payload,
                ));
            }
            RuntimeEnvelope::Response {
                id,
                ok,
                result,
                error,
            } => {
                context
                    .host_rpc
                    .resolve_response(id, ok, result, error)
                    .await;
            }
            RuntimeEnvelope::Event { .. } => {}
        }
    }

    writer_task.abort();
    scheduler_task.abort();
    shutdown_runtime_modules();
    Ok(())
}

#[cfg(unix)]
#[tokio::main(flavor = "multi_thread")]
async fn main() {
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
