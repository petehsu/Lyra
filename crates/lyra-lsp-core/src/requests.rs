use serde_json::{json, Value};

use super::catalog;
use super::events::{default_event, emit_event};
use super::runtime::{
    existing_server, file_uri_to_path, get_or_create_server, normalize_file_path, path_to_file_uri,
    send_notification, send_request,
};
use super::{
    LspCompletionItem, LspCompletionRequest, LspCompletionResult, LspDocumentRequest,
    LspHoverResult, LspLocation, LspPositionRequest, LspRuntimeEvent, LspSymbol, Result,
};

fn document_language(language_id: &str) -> String {
    catalog::document_language_id(language_id)
}

fn document_runtime(
    request: &LspDocumentRequest,
) -> Result<Option<std::sync::Arc<super::runtime::LspServerRuntime>>> {
    if !catalog::supported_language(&request.language_id) {
        return Ok(None);
    }
    let file_path = normalize_file_path(&request.file_path)?;
    match get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    ) {
        Ok(runtime) => Ok(Some(runtime)),
        Err(_) => Ok(None),
    }
}

pub(super) fn open_document(request: LspDocumentRequest) -> Result<()> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let Some(runtime) = document_runtime(&request)? else {
        return Ok(());
    };
    let already_open = runtime
        .uri_sessions
        .lock()
        .ok()
        .is_some_and(|sessions| sessions.contains_key(&uri));
    if let Ok(mut sessions) = runtime.uri_sessions.lock() {
        sessions.insert(uri.clone(), request.session_id);
    }
    if let Ok(mut paths) = runtime.uri_paths.lock() {
        paths.insert(uri.clone(), file_path.to_string_lossy().into_owned());
    }
    if already_open {
        send_notification(
            &runtime,
            "textDocument/didChange",
            json!({
                "textDocument": { "uri": uri, "version": request.version },
                "contentChanges": [{ "text": request.content }]
            }),
        )
    } else {
        send_notification(
            &runtime,
            "textDocument/didOpen",
            json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": document_language(&request.language_id),
                    "version": request.version,
                    "text": request.content
                }
            }),
        )
    }
}

pub(super) fn change_document(request: LspDocumentRequest) -> Result<()> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let Some(runtime) = document_runtime(&request)? else {
        return Ok(());
    };
    if let Ok(mut sessions) = runtime.uri_sessions.lock() {
        sessions.insert(uri.clone(), request.session_id);
    }
    if let Ok(mut paths) = runtime.uri_paths.lock() {
        paths.insert(uri.clone(), file_path.to_string_lossy().into_owned());
    }
    send_notification(
        &runtime,
        "textDocument/didChange",
        json!({
            "textDocument": { "uri": uri, "version": request.version },
            "contentChanges": [{ "text": request.content }]
        }),
    )
}

pub(super) fn save_document(request: LspDocumentRequest) -> Result<()> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let Some(runtime) = document_runtime(&request)? else {
        return Ok(());
    };
    send_notification(
        &runtime,
        "textDocument/didSave",
        json!({ "textDocument": { "uri": uri }, "text": request.content }),
    )
}

pub(super) fn close_document(request: LspDocumentRequest) -> Result<()> {
    let file_path = normalize_file_path(&request.file_path)?;
    let uri = path_to_file_uri(&file_path)?;
    let Some(runtime) = existing_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    ) else {
        return Ok(());
    };
    if let Ok(mut sessions) = runtime.uri_sessions.lock() {
        sessions.remove(&uri);
    }
    if let Ok(mut paths) = runtime.uri_paths.lock() {
        paths.remove(&uri);
    }
    send_notification(
        &runtime,
        "textDocument/didClose",
        json!({ "textDocument": { "uri": uri } }),
    )
}

fn parse_completion_result(value: Value) -> LspCompletionResult {
    if let Some(items) = value.as_array() {
        return LspCompletionResult {
            items: items.iter().filter_map(parse_completion_item).collect(),
            is_incomplete: false,
        };
    }
    LspCompletionResult {
        is_incomplete: value
            .get("isIncomplete")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        items: value
            .get("items")
            .and_then(Value::as_array)
            .map(|entries| entries.iter().filter_map(parse_completion_item).collect())
            .unwrap_or_default(),
    }
}

fn parse_completion_item(value: &Value) -> Option<LspCompletionItem> {
    let documentation = match value.get("documentation") {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Object(object)) => object
            .get("value")
            .and_then(Value::as_str)
            .map(str::to_string),
        _ => None,
    };
    Some(LspCompletionItem {
        label: value.get("label")?.as_str()?.to_string(),
        insert_text: string_field(value, "insertText"),
        detail: string_field(value, "detail"),
        documentation,
        kind: value
            .get("kind")
            .and_then(Value::as_u64)
            .map(|number| number as u32),
        sort_text: string_field(value, "sortText"),
        filter_text: string_field(value, "filterText"),
    })
}

fn string_field(value: &Value, field: &str) -> Option<String> {
    value.get(field).and_then(Value::as_str).map(str::to_string)
}

pub(super) fn completion(request: LspCompletionRequest) -> Result<LspCompletionResult> {
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
            });
        }
    };
    if let Ok(mut sessions) = runtime.uri_sessions.lock() {
        sessions.insert(uri.clone(), request.session_id.clone());
    }
    if let Ok(mut paths) = runtime.uri_paths.lock() {
        paths.insert(uri.clone(), file_path.to_string_lossy().into_owned());
    }
    match send_request(
        &runtime,
        "textDocument/completion",
        json!({
            "textDocument": { "uri": uri },
            "position": { "line": request.line, "character": request.column }
        }),
    ) {
        Ok(value) => Ok(parse_completion_result(value)),
        Err(error) => {
            emit_event(LspRuntimeEvent {
                session_id: Some(request.session_id),
                file_path: Some(request.file_path),
                language_id: catalog::server_for_language(&request.language_id)
                    .map(|_| document_language(&request.language_id)),
                project_root: request.project_root,
                message: Some(error.to_string()),
                ..default_event("error")
            });
            Ok(LspCompletionResult {
                items: Vec::new(),
                is_incomplete: false,
            })
        }
    }
}

fn parse_location(value: &Value) -> Option<LspLocation> {
    let range = value.get("range")?;
    let start = range.get("start")?;
    let end = range.get("end")?;
    Some(LspLocation {
        file_path: file_uri_to_path(value.get("uri")?.as_str()?)?,
        start_line: start.get("line")?.as_u64()? as u32,
        start_character: start.get("character")?.as_u64()? as u32,
        end_line: end.get("line")?.as_u64()? as u32,
        end_character: end.get("character")?.as_u64()? as u32,
    })
}

fn parse_locations(value: &Value) -> Vec<LspLocation> {
    if let Some(array) = value.as_array() {
        array.iter().filter_map(parse_location).collect()
    } else if value.get("uri").is_some() {
        parse_location(value).into_iter().collect()
    } else {
        Vec::new()
    }
}

fn position_request(
    request: &LspPositionRequest,
    method: &str,
    extra: Option<Value>,
) -> Result<Value> {
    let file_path = normalize_file_path(&request.file_path)?;
    let runtime = get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    )?;
    let mut params = json!({
        "textDocument": { "uri": path_to_file_uri(&file_path)? },
        "position": { "line": request.line, "character": request.column }
    });
    if let (Some(object), Some(extra)) = (params.as_object_mut(), extra) {
        if let Some(extra) = extra.as_object() {
            object.extend(extra.clone());
        }
    }
    send_request(&runtime, method, params)
}

pub(super) fn goto_definition(request: LspPositionRequest) -> Result<Vec<LspLocation>> {
    position_request(&request, "textDocument/definition", None).map(|value| parse_locations(&value))
}

pub(super) fn find_references(request: LspPositionRequest) -> Result<Vec<LspLocation>> {
    position_request(
        &request,
        "textDocument/references",
        Some(json!({ "context": { "includeDeclaration": true } })),
    )
    .map(|value| parse_locations(&value))
}

pub(super) fn hover(request: LspPositionRequest) -> Result<Option<LspHoverResult>> {
    let response = position_request(&request, "textDocument/hover", None)?;
    if response.is_null() {
        return Ok(None);
    }
    let contents = match response.get("contents") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Object(object)) => {
            string_field(&Value::Object(object.clone()), "value").unwrap_or_default()
        }
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => Some(text.as_str()),
                Value::Object(object) => object.get("value").and_then(Value::as_str),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => return Ok(None),
    };
    if contents.is_empty() {
        return Ok(None);
    }
    let range = response.get("range");
    let start = range.and_then(|value| value.get("start"));
    let end = range.and_then(|value| value.get("end"));
    Ok(Some(LspHoverResult {
        contents,
        start_line: number_field(start, "line"),
        start_character: number_field(start, "character"),
        end_line: number_field(end, "line"),
        end_character: number_field(end, "character"),
    }))
}

pub(super) fn document_symbols(request: LspPositionRequest) -> Result<Vec<LspSymbol>> {
    let file_path = normalize_file_path(&request.file_path)?;
    let runtime = get_or_create_server(
        &request.language_id,
        &file_path,
        request.project_root.as_deref(),
    )?;
    let value = send_request(
        &runtime,
        "textDocument/documentSymbol",
        json!({
            "textDocument": { "uri": path_to_file_uri(&file_path)? }
        }),
    )?;
    Ok(parse_symbols(&value, &file_path.to_string_lossy()))
}

fn parse_symbols(value: &Value, fallback_path: &str) -> Vec<LspSymbol> {
    let Some(array) = value.as_array() else {
        return Vec::new();
    };
    let mut symbols = Vec::new();
    for entry in array {
        collect_symbol(entry, fallback_path, &mut symbols);
    }
    symbols
}

fn collect_symbol(value: &Value, fallback_path: &str, out: &mut Vec<LspSymbol>) {
    let Some(name) = value.get("name").and_then(Value::as_str) else {
        return;
    };
    let range = value
        .get("selectionRange")
        .or_else(|| value.get("range"))
        .or_else(|| {
            value
                .get("location")
                .and_then(|location| location.get("range"))
        });
    let Some(range) = range else {
        return;
    };
    let file_path = value
        .get("location")
        .and_then(|location| location.get("uri"))
        .and_then(Value::as_str)
        .and_then(file_uri_to_path)
        .unwrap_or_else(|| fallback_path.to_string());
    let start = range.get("start");
    let end = range.get("end");
    out.push(LspSymbol {
        name: name.to_string(),
        kind: value.get("kind").and_then(Value::as_u64).unwrap_or(13) as u32,
        file_path,
        start_line: number_field(start, "line").unwrap_or(0),
        start_character: number_field(start, "character").unwrap_or(0),
        end_line: number_field(end, "line").unwrap_or(0),
        end_character: number_field(end, "character").unwrap_or(0),
    });
    if let Some(children) = value.get("children").and_then(Value::as_array) {
        for child in children {
            collect_symbol(child, fallback_path, out);
        }
    }
}

fn number_field(value: Option<&Value>, field: &str) -> Option<u32> {
    value?
        .get(field)
        .and_then(Value::as_u64)
        .map(|number| number as u32)
}
