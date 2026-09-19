use super::*;
use lyra_lsp_core::{
    LspDiagnostic, LspDocumentRequest, LspPositionRequest, diagnostics_generation,
    document_symbols, error_diagnostics, find_references, format_error_block, goto_definition,
    hover, language_id_for_path, language_supported, open_document, wait_for_diagnostics,
    workspace_analysis_note,
};
use std::path::Path;
use std::time::Duration;

const ERROR_LIMIT: usize = 20;
const DIAGNOSTIC_WAIT: Duration = Duration::from_millis(1500);
const MAX_INJECT_FILES: usize = 3;

pub(crate) struct LspTouchedFile {
    pub absolute: String,
    pub relative: String,
    pub content: String,
}

pub(crate) fn tool_lsp_query(session_id: &str, input: &Value) -> NativeToolResult {
    let workspace = session_workspace_root(session_id)?;
    let query_type = value_string(input, "queryType").unwrap_or_else(|| "diagnostics".to_string());
    let project_root = workspace.to_string_lossy().into_owned();
    let path = value_string(input, "path");
    let absolute = path
        .as_ref()
        .map(|relative| workspace.join(relative))
        .unwrap_or_else(|| workspace.clone());
    let language_id = value_string(input, "languageId")
        .or_else(|| language_id_for_path(&absolute.to_string_lossy()).map(str::to_string))
        .unwrap_or_default();
    match query_type.as_str() {
        "diagnostics" => {
            let items = if let Some(relative) = path.as_deref() {
                lyra_lsp_core::diagnostics(lyra_lsp_core::LspDiagnosticsRequest {
                    file_path: Some(workspace.join(relative).to_string_lossy().into_owned()),
                    project_root: Some(project_root.clone()),
                })
                .unwrap_or_default()
            } else {
                lyra_lsp_core::diagnostics(lyra_lsp_core::LspDiagnosticsRequest {
                    file_path: None,
                    project_root: Some(project_root.clone()),
                })
                .unwrap_or_default()
            };
            if items.is_empty() {
                if let Some(note) = workspace_analysis_note(Some(&project_root)) {
                    return Ok(unavailable(
                        "diagnostics",
                        &project_root,
                        &format!("Language-server analysis unavailable: {note}"),
                    ));
                }
            }
            Ok(NativeToolSuccess {
                content: if items.is_empty() {
                    "No language-server diagnostics.".to_string()
                } else {
                    items
                        .iter()
                        .map(format_diagnostic_line)
                        .collect::<Vec<_>>()
                        .join("\n")
                },
                raw: json!({
                    "available": true,
                    "queryType": "diagnostics",
                    "workspaceRoot": project_root,
                    "diagnostics": items,
                }),
                recommended_next_action: None,
            })
        }
        "definition" | "references" | "hover" | "symbols" => {
            let file_path = absolute.to_string_lossy().into_owned();
            if language_id.is_empty() || !language_supported(&language_id) {
                return Ok(unavailable(
                    &query_type,
                    &project_root,
                    "No language server for this path.",
                ));
            }
            let request = LspPositionRequest {
                file_path: file_path.clone(),
                language_id: language_id.clone(),
                line: input.get("line").and_then(Value::as_u64).unwrap_or(0) as u32,
                column: input.get("column").and_then(Value::as_u64).unwrap_or(0) as u32,
                project_root: Some(project_root.clone()),
            };
            match query_type.as_str() {
                "definition" => {
                    let locations = goto_definition(request).map_err(|error| {
                        NativeToolFailure::new(
                            "lsp_unavailable",
                            error.to_string(),
                            "Use grep or open the file in the editor if the language server is still starting.",
                        )
                    })?;
                    Ok(NativeToolSuccess {
                        content: format_locations(&locations),
                        raw: json!({
                            "available": true,
                            "queryType": "definition",
                            "workspaceRoot": project_root,
                            "locations": locations,
                        }),
                        recommended_next_action: None,
                    })
                }
                "references" => {
                    let locations = find_references(request).map_err(|error| {
                        NativeToolFailure::new(
                            "lsp_unavailable",
                            error.to_string(),
                            "Use grep if the language server is still starting.",
                        )
                    })?;
                    Ok(NativeToolSuccess {
                        content: format_locations(&locations),
                        raw: json!({
                            "available": true,
                            "queryType": "references",
                            "workspaceRoot": project_root,
                            "locations": locations,
                        }),
                        recommended_next_action: None,
                    })
                }
                "hover" => {
                    let hover = hover(request).map_err(|error| {
                        NativeToolFailure::new(
                            "lsp_unavailable",
                            error.to_string(),
                            "Read the surrounding file if hover is unavailable.",
                        )
                    })?;
                    Ok(NativeToolSuccess {
                        content: hover
                            .as_ref()
                            .map(|value| value.contents.clone())
                            .unwrap_or_else(|| "No hover information.".to_string()),
                        raw: json!({
                            "available": true,
                            "queryType": "hover",
                            "workspaceRoot": project_root,
                            "hover": hover,
                        }),
                        recommended_next_action: None,
                    })
                }
                _ => {
                    let symbols = document_symbols(request).map_err(|error| {
                        NativeToolFailure::new(
                            "lsp_unavailable",
                            error.to_string(),
                            "Use grep or file_read if document symbols are unavailable.",
                        )
                    })?;
                    Ok(NativeToolSuccess {
                        content: symbols
                            .iter()
                            .map(|symbol| {
                                format!(
                                    "{}:{}: {}",
                                    symbol.file_path,
                                    symbol.start_line.saturating_add(1),
                                    symbol.name
                                )
                            })
                            .collect::<Vec<_>>()
                            .join("\n"),
                        raw: json!({
                            "available": true,
                            "queryType": "symbols",
                            "workspaceRoot": project_root,
                            "symbols": symbols,
                        }),
                        recommended_next_action: None,
                    })
                }
            }
        }
        "completion" => Ok(NativeToolSuccess {
            content: "Completion is provided in the editor, not as an Agent query.".to_string(),
            raw: json!({
                "available": true,
                "queryType": "completion",
                "items": [],
                "workspaceRoot": project_root,
            }),
            recommended_next_action: Some(
                "Use diagnostics, definition, references, or hover for coding evidence."
                    .to_string(),
            ),
        }),
        other => Ok(unavailable(other, &project_root, "Unknown LSP query type.")),
    }
}

pub(crate) fn warmup_lsp_file(session_id: &str, absolute: &Path, content: &str) {
    if session_working_dir_is_home(session_id) {
        return;
    }
    let Some(language_id) = language_id_for_path(&absolute.to_string_lossy()) else {
        return;
    };
    let request = LspDocumentRequest {
        session_id: session_id.to_string(),
        file_path: absolute.to_string_lossy().into_owned(),
        language_id: language_id.to_string(),
        content: content.to_string(),
        version: 1,
        project_root: session_workspace_root(session_id)
            .ok()
            .map(|path| path.to_string_lossy().into_owned()),
    };
    std::thread::spawn(move || {
        let _ = open_document(request);
    });
}

pub(crate) fn attach_lsp_errors(
    session_id: &str,
    mut success: NativeToolSuccess,
    files: &[LspTouchedFile],
) -> NativeToolSuccess {
    let mut blocks = Vec::new();
    let mut analysis_unavailable = false;
    for file in files.iter().take(MAX_INJECT_FILES) {
        if let Some((block, unavailable)) = collect_error_block(session_id, file) {
            analysis_unavailable |= unavailable;
            blocks.push(block);
        }
    }
    if blocks.is_empty() {
        return success;
    }
    let joined = blocks.join("\n\n");
    success.content = format!("{}\n\n{joined}", success.content);
    success.raw["lspErrors"] = json!(true);
    if analysis_unavailable {
        success.raw["lspAvailable"] = json!(false);
        success.recommended_next_action = Some(
            "Language-server analysis is unavailable. Install the project toolchain before treating this edit as clean.".to_string(),
        );
    } else {
        success.recommended_next_action = Some(
            "Fix the language-server errors in the changed file before continuing.".to_string(),
        );
    }
    success
}

fn collect_error_block(session_id: &str, file: &LspTouchedFile) -> Option<(String, bool)> {
    let language_id = language_id_for_path(&file.absolute)?;
    let project_root = session_workspace_root(session_id)
        .ok()
        .map(|path| path.to_string_lossy().into_owned());
    let generation = diagnostics_generation(&file.absolute);
    let _ = open_document(LspDocumentRequest {
        session_id: session_id.to_string(),
        file_path: file.absolute.clone(),
        language_id: language_id.to_string(),
        content: file.content.clone(),
        version: 1,
        project_root: project_root.clone(),
    });
    let items = wait_for_diagnostics(&file.absolute, generation, DIAGNOSTIC_WAIT);
    let errors = error_diagnostics(&items, ERROR_LIMIT);
    if let Some(block) = format_error_block(&errors) {
        let text = if file.relative.is_empty() {
            block
        } else {
            block.replace(&file.absolute, &file.relative)
        };
        return Some((text, false));
    }
    let note = workspace_analysis_note(project_root.as_deref())?;
    let target = if file.relative.is_empty() {
        file.absolute.as_str()
    } else {
        file.relative.as_str()
    };
    Some((
        format!(
            "Language-server analysis unavailable for {target}.\n{note}\nDo not treat this file as clean until the project toolchain is installed and diagnostics appear."
        ),
        true,
    ))
}

fn format_diagnostic_line(item: &LspDiagnostic) -> String {
    format!(
        "{}:{}:{}: {}",
        item.file_path,
        item.start_line.saturating_add(1),
        item.start_character.saturating_add(1),
        item.message
    )
}

fn format_locations(locations: &[lyra_lsp_core::LspLocation]) -> String {
    if locations.is_empty() {
        return "No locations.".to_string();
    }
    locations
        .iter()
        .map(|location| {
            format!(
                "{}:{}:{}",
                location.file_path,
                location.start_line.saturating_add(1),
                location.start_character.saturating_add(1)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn unavailable(query_type: &str, workspace: &str, message: &str) -> NativeToolSuccess {
    NativeToolSuccess {
        content: message.to_string(),
        raw: json!({
            "available": false,
            "queryType": query_type,
            "workspaceRoot": workspace,
            "message": message,
        }),
        recommended_next_action: Some(
            "Use grep or file_read for local code evidence when a language server is not available."
                .to_string(),
        ),
    }
}

fn session_working_dir_is_home(session_id: &str) -> bool {
    state()
        .lock()
        .ok()
        .and_then(|guard| {
            guard.sessions.get(session_id).and_then(|session| {
                session
                    .snapshot
                    .get("workingDirIsHome")
                    .and_then(Value::as_bool)
            })
        })
        .unwrap_or(false)
}

pub(crate) fn workspace_problems_runtime_value(
    working_dir: Option<&str>,
    project_bound: bool,
    working_dir_is_home: bool,
) -> Option<Value> {
    if !project_bound || working_dir_is_home {
        return None;
    }
    let root = working_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let error_count = lyra_lsp_core::workspace_error_count(root);
    if error_count == 0 {
        return None;
    }
    Some(json!({ "errorCount": error_count }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lsp_query_reads_the_shared_diagnostic_store() {
        let path = "/tmp/lyra-agent-lsp-query.rs";
        lyra_lsp_core::upsert_diagnostics(
            path,
            vec![LspDiagnostic {
                file_path: path.to_string(),
                severity: 1,
                message: "missing type".to_string(),
                source: Some("rustc".to_string()),
                code: None,
                start_line: 3,
                start_character: 0,
                end_line: 3,
                end_character: 4,
            }],
        );
        let items = lyra_lsp_core::diagnostics(lyra_lsp_core::LspDiagnosticsRequest {
            file_path: Some(path.to_string()),
            project_root: None,
        })
        .expect("store");
        assert_eq!(items[0].message, "missing type");
        let block = format_error_block(&error_diagnostics(&items, 20)).expect("block");
        assert!(block.contains("missing type"));
    }

    #[test]
    fn workspace_problems_runtime_value_sends_error_count_only_when_bound() {
        let root = "/tmp/lyra-agent-workspace-problems";
        let path = format!("{root}/main.rs");
        lyra_lsp_core::upsert_diagnostics(
            &path,
            vec![LspDiagnostic {
                file_path: path.clone(),
                severity: 1,
                message: "missing type".to_string(),
                source: Some("rustc".to_string()),
                code: None,
                start_line: 0,
                start_character: 0,
                end_line: 0,
                end_character: 1,
            }],
        );
        let value = workspace_problems_runtime_value(Some(root), true, false).expect("count");
        assert_eq!(value, json!({ "errorCount": 1 }));
        assert!(value.get("diagnostics").is_none());
        assert!(workspace_problems_runtime_value(Some(root), false, false).is_none());
        assert!(workspace_problems_runtime_value(Some(root), true, true).is_none());
        assert!(workspace_problems_runtime_value(Some(""), true, false).is_none());
        lyra_lsp_core::upsert_diagnostics(
            &path,
            vec![LspDiagnostic {
                file_path: path.clone(),
                severity: 2,
                message: "unused".to_string(),
                source: Some("rustc".to_string()),
                code: None,
                start_line: 0,
                start_character: 0,
                end_line: 0,
                end_character: 1,
            }],
        );
        assert!(workspace_problems_runtime_value(Some(root), true, false).is_none());
    }
}
