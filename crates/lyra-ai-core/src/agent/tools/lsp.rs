use super::*;

fn infer_language_id(file_path: &str) -> Option<&'static str> {
    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())?;
    match ext {
        "ts" | "tsx" | "mts" | "cts" => Some("typescript"),
        "js" | "jsx" | "mjs" | "cjs" => Some("javascript"),
        "rs" => Some("rust"),
        "py" | "pyi" => Some("python"),
        _ => None,
    }
}

fn resolve_lsp_language_id(
    object: &serde_json::Map<String, Value>,
    file_path: &str,
) -> Result<String, AgentToolError> {
    if let Some(lang) = object.get("languageId").and_then(Value::as_str) {
        let trimmed = lang.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    infer_language_id(file_path)
        .map(str::to_string)
        .ok_or_else(|| {
            AgentToolError::exec_failed(format!(
                "cannot infer language for {file_path}; provide languageId explicitly"
            ))
        })
}

pub(super) fn run_lsp_goto_definition(
    input: &Value,
    project_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let file_path = required_string(object, "filePath")?;
    let line = required_u32(object, "line")?;
    let column = required_u32(object, "column")?;
    let language_id = resolve_lsp_language_id(object, &file_path)?;

    let locations = lyra_lsp_core::goto_definition(lyra_lsp_core::LspPositionRequest {
        file_path: file_path.clone(),
        language_id,
        line,
        column,
        project_root: project_root.map(str::to_string),
    })
    .map_err(|e| AgentToolError::exec_failed(format!("lsp goto_definition failed: {e}")))?;

    if locations.is_empty() {
        return Ok(json!({ "definitions": [], "message": "No definition found" }));
    }

    let items: Vec<Value> = locations
        .iter()
        .map(|loc| {
            json!({
                "filePath": loc.file_path,
                "startLine": loc.start_line,
                "startColumn": loc.start_character,
                "endLine": loc.end_line,
                "endColumn": loc.end_character,
            })
        })
        .collect();

    Ok(json!({ "definitions": items }))
}

pub(super) fn run_lsp_find_references(
    input: &Value,
    project_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let file_path = required_string(object, "filePath")?;
    let line = required_u32(object, "line")?;
    let column = required_u32(object, "column")?;
    let language_id = resolve_lsp_language_id(object, &file_path)?;

    let locations = lyra_lsp_core::find_references(lyra_lsp_core::LspPositionRequest {
        file_path: file_path.clone(),
        language_id,
        line,
        column,
        project_root: project_root.map(str::to_string),
    })
    .map_err(|e| AgentToolError::exec_failed(format!("lsp find_references failed: {e}")))?;

    let items: Vec<Value> = locations
        .iter()
        .map(|loc| {
            json!({
                "filePath": loc.file_path,
                "startLine": loc.start_line,
                "startColumn": loc.start_character,
                "endLine": loc.end_line,
                "endColumn": loc.end_character,
            })
        })
        .collect();

    Ok(json!({ "references": items, "count": items.len() }))
}

pub(super) fn run_lsp_hover(
    input: &Value,
    project_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let file_path = required_string(object, "filePath")?;
    let line = required_u32(object, "line")?;
    let column = required_u32(object, "column")?;
    let language_id = resolve_lsp_language_id(object, &file_path)?;

    let result = lyra_lsp_core::hover(lyra_lsp_core::LspPositionRequest {
        file_path,
        language_id,
        line,
        column,
        project_root: project_root.map(str::to_string),
    })
    .map_err(|e| AgentToolError::exec_failed(format!("lsp hover failed: {e}")))?;

    match result {
        Some(hover) => Ok(json!({
            "contents": hover.contents,
            "range": {
                "startLine": hover.start_line,
                "startColumn": hover.start_character,
                "endLine": hover.end_line,
                "endColumn": hover.end_character,
            }
        })),
        None => Ok(json!({ "contents": null, "message": "No hover information available" })),
    }
}

pub(super) fn run_lsp_get_diagnostics(
    input: &Value,
    project_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let file_path = required_string(object, "filePath")?;
    let content = required_raw_string(object, "content")?;
    let language_id = resolve_lsp_language_id(object, &file_path)?;

    let diagnostics = lyra_lsp_core::get_diagnostics(lyra_lsp_core::LspDiagnosticsRequest {
        file_path,
        language_id,
        content,
        version: 1,
        project_root: project_root.map(str::to_string),
    })
    .map_err(|e| AgentToolError::exec_failed(format!("lsp get_diagnostics failed: {e}")))?;

    let items: Vec<Value> = diagnostics
        .iter()
        .map(|d| {
            json!({
                "startLine": d.start_line,
                "startColumn": d.start_character,
                "endLine": d.end_line,
                "endColumn": d.end_character,
                "severity": match d.severity {
                    Some(1) => "error",
                    Some(2) => "warning",
                    Some(3) => "info",
                    Some(4) => "hint",
                    _ => "unknown",
                },
                "code": d.code,
                "source": d.source,
                "message": d.message,
            })
        })
        .collect();

    let error_count = diagnostics.iter().filter(|d| d.severity == Some(1)).count();
    let warning_count = diagnostics.iter().filter(|d| d.severity == Some(2)).count();

    Ok(json!({
        "diagnostics": items,
        "count": items.len(),
        "errors": error_count,
        "warnings": warning_count,
    }))
}
