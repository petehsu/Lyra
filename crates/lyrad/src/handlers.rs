use lyra_lsp_core::{
    change_document as lsp_change_document, close_document as lsp_close_document,
    completion as lsp_completion, find_references as lsp_find_references,
    goto_definition as lsp_goto_definition, hover as lsp_hover, open_document as lsp_open_document,
    save_document as lsp_save_document, LspCompletionRequest, LspDocumentRequest,
    LspPositionRequest,
};
use lyra_runtime_protocol::RuntimeError;
use lyra_terminal_core::{
    close_session as close_terminal_session, create_session as create_terminal_session,
    evaluate_permission as evaluate_terminal_permission, read_processes as read_terminal_processes,
    read_session as read_terminal_session, resize_session as resize_terminal_session,
    respond_permission as respond_terminal_permission,
    shell_launch_plan as terminal_shell_launch_plan, signal_process as signal_terminal_process,
    write_session as write_terminal_session, TerminalCloseRequest, TerminalCreateRequest,
    TerminalPermissionEvaluateRequest, TerminalPermissionRespondRequest,
    TerminalProcessSignalRequest, TerminalProcessesReadRequest, TerminalReadRequest,
    TerminalResizeRequest, TerminalShellLaunchEnvPair, TerminalShellLaunchPlanRequest,
    TerminalWriteRequest,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

macro_rules! bridge_request {
    ($name:ident { $($field:ident : $ty:ty),+ $(,)? }) => {
        #[derive(Debug, Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct $name {
            $( $field: $ty, )+
        }
    };
}

pub(crate) fn handle_terminal_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "terminal.sessions.create" => {
            let request: RuntimeTerminalCreateRequest = from_payload(payload)?;
            let snapshot = create_terminal_session(map_terminal_create_request(request))
                .map_err(map_runtime_error)?;
            to_value(&snapshot)
        }
        "terminal.shell.launchPlan" => {
            let request: RuntimeTerminalShellLaunchPlanRequest = from_payload(payload)?;
            let response = terminal_shell_launch_plan(TerminalShellLaunchPlanRequest {
                shell: request.shell,
            })
            .map_err(map_runtime_error)?;
            to_value(&response)
        }
        "terminal.sessions.write" => {
            let request: RuntimeTerminalWriteRequest = from_payload(payload)?;
            write_terminal_session(TerminalWriteRequest {
                session_id: request.session_id,
                data: request.data,
                text: request.text,
                keys: request.keys,
                append_newline: request.append_newline,
                source: request.source,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.sessions.read" => {
            let request: RuntimeTerminalReadRequest = from_payload(payload)?;
            let response = read_terminal_session(TerminalReadRequest {
                session_id: request.session_id,
                cursor: request.cursor,
                max_bytes: request.max_bytes,
                wait_ms: request.wait_ms,
                storage_root: request.storage_root,
            })
            .map_err(map_runtime_error)?;
            to_value(&response)
        }
        "terminal.sessions.resize" => {
            let request: RuntimeTerminalResizeRequest = from_payload(payload)?;
            resize_terminal_session(TerminalResizeRequest {
                session_id: request.session_id,
                cols: request.cols,
                rows: request.rows,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.sessions.close" => {
            let request: RuntimeTerminalCloseRequest = from_payload(payload)?;
            close_terminal_session(TerminalCloseRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.permissions.evaluate" => {
            let request: RuntimeTerminalPermissionEvaluateRequest = from_payload(payload)?;
            let response = evaluate_terminal_permission(TerminalPermissionEvaluateRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                action: request.action,
                input_id: request.input_id,
                command_id: request.command_id,
                risk: request.risk,
                title: request.title,
                summary: request.summary,
                detail: request.detail,
                redacted_preview: request.redacted_preview,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            to_value(&response)
        }
        "terminal.permissions.respond" => {
            let request: RuntimeTerminalPermissionRespondRequest = from_payload(payload)?;
            let response = respond_terminal_permission(TerminalPermissionRespondRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                permission_id: request.permission_id,
                decision: request.decision,
                reason: request.reason,
                expires_at: request.expires_at,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            to_value(&response)
        }
        "terminal.processes.read" => {
            let request: RuntimeTerminalProcessesReadRequest = from_payload(payload)?;
            let response = read_terminal_processes(TerminalProcessesReadRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                pid: request.pid,
                include_tree: request.include_tree,
                include_command: request.include_command,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            to_value(&response)
        }
        "terminal.processes.signal" => {
            let request: RuntimeTerminalProcessSignalRequest = from_payload(payload)?;
            let response = signal_terminal_process(TerminalProcessSignalRequest {
                session_id: request.session_id,
                storage_root: request.storage_root,
                pid: request.pid,
                signal: request.signal,
                reason: request.reason,
                actor_json: value_to_json_string(request.actor),
                correlation_json: value_to_json_string(request.correlation),
            })
            .map_err(map_runtime_error)?;
            to_value(&response)
        }
        _ => unknown_method("terminal", method),
    }
}

pub(crate) fn handle_lsp_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "lsp.documents.open"
        | "lsp.documents.change"
        | "lsp.documents.save"
        | "lsp.documents.close" => {
            let request: RuntimeLspDocumentRequest = from_payload(payload)?;
            let mapped = LspDocumentRequest {
                session_id: request.session_id,
                file_path: request.file_path,
                language_id: request.language_id,
                content: request.content,
                version: request.version,
                project_root: request.project_root,
            };
            match method {
                "lsp.documents.open" => lsp_open_document(mapped),
                "lsp.documents.change" => lsp_change_document(mapped),
                "lsp.documents.save" => lsp_save_document(mapped),
                _ => lsp_close_document(mapped),
            }
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "lsp.completion" => {
            let request: RuntimeLspCompletionRequest = from_payload(payload)?;
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
        "lsp.goto_definition" | "lsp.find_references" => {
            let request: RuntimeLspPositionRequest = from_payload(payload)?;
            let mapped = LspPositionRequest {
                file_path: request.file_path,
                language_id: request.language_id,
                line: request.line,
                column: request.column,
                project_root: request.project_root,
            };
            let result = match method {
                "lsp.goto_definition" => lsp_goto_definition(mapped),
                _ => lsp_find_references(mapped),
            }
            .map_err(map_runtime_error)?;
            to_value(&result)
        }
        "lsp.hover" => {
            let request: RuntimeLspPositionRequest = from_payload(payload)?;
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
        _ => unknown_method("lsp", method),
    }
}

bridge_request!(RuntimeTerminalCreateRequest {
    session_id: Option<String>,
    title: Option<String>,
    cwd: Option<String>,
    shell: Option<String>,
    env: Option<Vec<TerminalShellLaunchEnvPair>>,
    cols: u16,
    rows: u16,
    source: Option<String>,
    mode: Option<String>,
    command: Option<String>,
    persist: Option<bool>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalShellLaunchPlanRequest { shell: String });

bridge_request!(RuntimeTerminalWriteRequest {
    session_id: String,
    data: Option<String>,
    text: Option<String>,
    keys: Option<Vec<String>>,
    append_newline: Option<bool>,
    source: Option<String>,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalReadRequest {
    session_id: String,
    cursor: Option<String>,
    max_bytes: Option<u32>,
    wait_ms: Option<u32>,
    storage_root: Option<String>
});

bridge_request!(RuntimeTerminalResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalCloseRequest {
    session_id: String,
    storage_root: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalPermissionEvaluateRequest {
    session_id: String,
    storage_root: String,
    action: String,
    input_id: Option<String>,
    command_id: Option<String>,
    risk: Option<String>,
    title: Option<String>,
    summary: Option<String>,
    detail: Option<String>,
    redacted_preview: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalPermissionRespondRequest {
    session_id: String,
    storage_root: String,
    permission_id: String,
    decision: String,
    reason: Option<String>,
    expires_at: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalProcessesReadRequest {
    session_id: String,
    storage_root: String,
    pid: Option<u32>,
    include_tree: Option<bool>,
    include_command: Option<bool>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeTerminalProcessSignalRequest {
    session_id: String,
    storage_root: String,
    pid: Option<u32>,
    signal: String,
    reason: Option<String>,
    actor: Option<Value>,
    correlation: Option<Value>
});

bridge_request!(RuntimeLspDocumentRequest {
    session_id: String,
    file_path: String,
    language_id: String,
    content: String,
    version: i32,
    project_root: Option<String>
});

bridge_request!(RuntimeLspCompletionRequest {
    session_id: String,
    file_path: String,
    language_id: String,
    line: u32,
    column: u32,
    version: i32,
    project_root: Option<String>
});

bridge_request!(RuntimeLspPositionRequest {
    file_path: String,
    language_id: String,
    line: u32,
    column: u32,
    project_root: Option<String>
});

fn map_terminal_create_request(request: RuntimeTerminalCreateRequest) -> TerminalCreateRequest {
    TerminalCreateRequest {
        session_id: request.session_id,
        title: request.title,
        cwd: request.cwd,
        shell: request.shell,
        env: request.env,
        cols: request.cols,
        rows: request.rows,
        source: request.source,
        mode: request.mode,
        command: request.command,
        persist: request.persist,
        storage_root: request.storage_root,
        actor_json: value_to_json_string(request.actor),
        correlation_json: value_to_json_string(request.correlation),
    }
}

fn from_payload<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, RuntimeError> {
    serde_json::from_value(payload).map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))
}

fn to_value<T: Serialize>(value: &T) -> Result<Value, RuntimeError> {
    serde_json::to_value(value)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
}

fn value_to_json_string(value: Option<Value>) -> Option<String> {
    value.map(|item| item.to_string())
}

fn map_runtime_error(error: impl std::fmt::Display) -> RuntimeError {
    runtime_error("RUNTIME_ERROR", error.to_string())
}

fn unknown_method(scope: &str, method: &str) -> Result<Value, RuntimeError> {
    Err(runtime_error(
        "METHOD_NOT_FOUND",
        format!("unknown {scope} runtime method: {method}"),
    ))
}

fn runtime_error(code: &str, message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(code, message.into())
}

#[cfg(test)]
mod tests {
    use super::handle_terminal_request;
    use serde_json::json;

    #[test]
    fn terminal_phase_methods_are_wired_to_core() {
        let storage_root = std::env::temp_dir()
            .join(format!("lyrad-terminal-wiring-{}", std::process::id()))
            .to_string_lossy()
            .to_string();
        let cases = [
            (
                "terminal.shell.launchPlan",
                json!({
                    "shell": "/bin/zsh"
                }),
            ),
            (
                "terminal.permissions.evaluate",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "action": "runCommand",
                    "risk": "shell"
                }),
            ),
            (
                "terminal.permissions.respond",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "permissionId": "permission-1",
                    "decision": "deny"
                }),
            ),
            (
                "terminal.processes.read",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root
                }),
            ),
            (
                "terminal.processes.signal",
                json!({
                    "sessionId": "terminal-session-1",
                    "storageRoot": storage_root,
                    "signal": "SIGTERM"
                }),
            ),
        ];

        for (method, payload) in cases {
            if let Err(error) = handle_terminal_request(method, payload) {
                assert_ne!(error.code, "NOT_IMPLEMENTED", "{method} should be wired");
            }
        }
    }

    #[test]
    fn unknown_terminal_methods_still_return_method_not_found() {
        let error = handle_terminal_request("terminal.notReal", json!({}))
            .expect_err("unknown method should fail");

        assert_eq!(error.code, "METHOD_NOT_FOUND");
    }
}