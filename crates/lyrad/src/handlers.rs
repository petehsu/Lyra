use lyra_lsp_core::{
    change_document as lsp_change_document, close_document as lsp_close_document,
    completion as lsp_completion, find_references as lsp_find_references,
    get_diagnostics as lsp_get_diagnostics, goto_definition as lsp_goto_definition,
    hover as lsp_hover, open_document as lsp_open_document, save_document as lsp_save_document,
    LspCompletionRequest, LspDiagnosticsRequest, LspDocumentRequest, LspPositionRequest,
};
use lyra_runtime_protocol::RuntimeError;
use lyra_terminal_core::{
    close_session as close_terminal_session, create_session as create_terminal_session,
    read_session as read_terminal_session, resize_session as resize_terminal_session,
    restore_sessions as restore_terminal_sessions, write_session as write_terminal_session,
    TerminalCloseRequest, TerminalCreateRequest, TerminalReadRequest, TerminalResizeRequest,
    TerminalRestoreRequest, TerminalWriteRequest,
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
        "terminal.sessions.restore" => {
            let request: RuntimeTerminalRestoreRequest = from_payload(payload)?;
            let snapshots = restore_terminal_sessions(TerminalRestoreRequest {
                sessions: request
                    .sessions
                    .into_iter()
                    .map(map_terminal_create_request)
                    .collect(),
            })
            .map_err(map_runtime_error)?;
            to_value(&snapshots)
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
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
        }
        "terminal.sessions.close" => {
            let request: RuntimeTerminalCloseRequest = from_payload(payload)?;
            close_terminal_session(TerminalCloseRequest {
                session_id: request.session_id,
            })
            .map_err(map_runtime_error)?;
            Ok(Value::Null)
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
        "lsp.get_diagnostics" => {
            let request: RuntimeLspDiagnosticsRequest = from_payload(payload)?;
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
        _ => unknown_method("lsp", method),
    }
}

bridge_request!(RuntimeTerminalCreateRequest {
    session_id: Option<String>,
    title: Option<String>,
    cwd: Option<String>,
    shell: Option<String>,
    cols: u16,
    rows: u16,
    source: Option<String>,
    mode: Option<String>,
    command: Option<String>,
    persist: Option<bool>
});

bridge_request!(RuntimeTerminalRestoreRequest {
    sessions: Vec<RuntimeTerminalCreateRequest>
});

bridge_request!(RuntimeTerminalWriteRequest {
    session_id: String,
    data: Option<String>,
    text: Option<String>,
    keys: Option<Vec<String>>,
    append_newline: Option<bool>,
    source: Option<String>
});

bridge_request!(RuntimeTerminalReadRequest {
    session_id: String,
    cursor: Option<String>,
    max_bytes: Option<u32>,
    wait_ms: Option<u32>
});

bridge_request!(RuntimeTerminalResizeRequest {
    session_id: String,
    cols: u16,
    rows: u16
});

bridge_request!(RuntimeTerminalCloseRequest { session_id: String });

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

bridge_request!(RuntimeLspDiagnosticsRequest {
    file_path: String,
    language_id: String,
    content: String,
    version: i32,
    project_root: Option<String>
});

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

fn from_payload<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, RuntimeError> {
    serde_json::from_value(payload).map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))
}

fn to_value<T: Serialize>(value: &T) -> Result<Value, RuntimeError> {
    serde_json::to_value(value)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
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
