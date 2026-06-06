use super::*;

pub(crate) fn execute_code_tool_adapter(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    execute_native_tool_adapter(
        session_id,
        turn_id,
        cancellation,
        tool_call_id,
        tool_name,
        display_name,
        action,
        arguments,
        started_at,
    )
}

pub(crate) fn tool_project_search(session_id: &str, input: &Value) -> NativeToolResult {
    let query = required_value_string(input, "query")?;
    let root = value_string(input, "root").unwrap_or_else(|| ".".to_string());
    let workspace_path = resolve_workspace_path(session_id, &root, false)?;
    let include_hidden = value_bool(input, "includeHidden", false);
    let limit = value_usize(input, "limit", DEFAULT_SEARCH_LIMIT, 500);
    let max_file_bytes = value_usize(input, "maxFileBytes", 1_000_000, 5_000_000);
    let results = search_workspace_text(
        &workspace_path.root,
        &workspace_path.absolute,
        &query,
        None,
        include_hidden,
        limit,
        max_file_bytes,
        false,
        false,
    )?;
    let content = format_search_results(&results);
    Ok(NativeToolSuccess {
        content,
        raw: json!({
            "query": query,
            "root": workspace_path.relative,
            "results": results,
            "truncated": results.len() >= limit,
        }),
        recommended_next_action: None,
    })
}

pub(crate) fn tool_code_search_text(session_id: &str, input: &Value) -> NativeToolResult {
    let query = value_string(input, "query")
        .or_else(|| value_string(input, "pattern"))
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "query or pattern is required",
                "Retry with the source text to search for.",
            )
        })?;
    let root = value_string(input, "root").unwrap_or_else(|| ".".to_string());
    let workspace_path = resolve_workspace_path(session_id, &root, false)?;
    let glob = value_string(input, "glob");
    let include_hidden = value_bool(input, "includeHidden", false);
    let limit = value_usize(input, "limit", DEFAULT_SEARCH_LIMIT, 500);
    let case_sensitive = value_bool(input, "caseSensitive", false);
    let results = search_workspace_text(
        &workspace_path.root,
        &workspace_path.absolute,
        &query,
        glob.as_deref(),
        include_hidden,
        limit,
        1_000_000,
        case_sensitive,
        true,
    )?;
    Ok(NativeToolSuccess {
        content: format_search_results(&results),
        raw: json!({
            "query": query,
            "root": workspace_path.relative,
            "glob": glob,
            "results": results,
            "truncated": results.len() >= limit,
        }),
        recommended_next_action: None,
    })
}

pub(crate) fn tool_code_search_symbol(session_id: &str, input: &Value) -> NativeToolResult {
    let query = value_string(input, "query")
        .or_else(|| value_string(input, "symbol"))
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "query or symbol is required",
                "Retry with the symbol name to search for.",
            )
        })?;
    let root = value_string(input, "root").unwrap_or_else(|| ".".to_string());
    let workspace_path = resolve_workspace_path(session_id, &root, false)?;
    let include_hidden = value_bool(input, "includeHidden", false);
    let limit = value_usize(input, "limit", DEFAULT_SEARCH_LIMIT, 500);
    let results = search_workspace_symbols(
        &workspace_path.root,
        &workspace_path.absolute,
        &query,
        include_hidden,
        limit,
    )?;
    Ok(NativeToolSuccess {
        content: format_search_results(&results),
        raw: json!({
            "query": query,
            "root": workspace_path.relative,
            "results": results,
            "truncated": results.len() >= limit,
        }),
        recommended_next_action: None,
    })
}

pub(crate) fn tool_code_graph_expand(session_id: &str, input: &Value) -> NativeToolResult {
    let symbol = value_string(input, "symbol")
        .or_else(|| value_string(input, "query"))
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "symbol or query is required",
                "Retry with the symbol to expand.",
            )
        })?;
    let root = value_string(input, "root").unwrap_or_else(|| ".".to_string());
    let workspace_path = resolve_workspace_path(session_id, &root, false)?;
    let limit = value_usize(input, "limit", DEFAULT_SEARCH_LIMIT, 500);
    let symbol_matches = search_workspace_symbols(
        &workspace_path.root,
        &workspace_path.absolute,
        &symbol,
        false,
        limit,
    )?;
    let text_matches = search_workspace_text(
        &workspace_path.root,
        &workspace_path.absolute,
        &symbol,
        None,
        false,
        limit,
        1_000_000,
        false,
        true,
    )?;
    Ok(NativeToolSuccess {
        content: format!(
            "symbol matches:\n{}\n\nreferences:\n{}",
            format_search_results(&symbol_matches),
            format_search_results(&text_matches)
        ),
        raw: json!({
            "symbol": symbol,
            "root": workspace_path.relative,
            "nodes": symbol_matches,
            "edges": text_matches,
            "degraded": true,
            "degradedReason": "native lightweight graph uses local text and symbol scans until full code graph service is attached",
        }),
        recommended_next_action: Some(
            "Use code_search_text or lsp_query for narrower follow-up evidence.".to_string(),
        ),
    })
}

pub(crate) fn search_workspace_text(
    workspace_root: &Path,
    root: &Path,
    query: &str,
    glob: Option<&str>,
    include_hidden: bool,
    limit: usize,
    max_file_bytes: usize,
    case_sensitive: bool,
    source_only: bool,
) -> Result<Vec<Value>, NativeToolFailure> {
    let compiled_glob = match glob {
        Some(pattern) => Some(Pattern::new(pattern).map_err(|error| {
            NativeToolFailure::new(
                "bad_glob",
                format!("invalid glob pattern: {error}"),
                "Retry with a valid source glob such as **/*.rs.",
            )
        })?),
        None => None,
    };
    let mut files = Vec::new();
    collect_workspace_files(
        workspace_root,
        root,
        include_hidden,
        MAX_SEARCH_FILES,
        &mut files,
    )?;
    let needle = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let mut results = Vec::new();
    for path in files {
        if results.len() >= limit {
            break;
        }
        let relative = path
            .strip_prefix(workspace_root)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.display().to_string());
        if let Some(pattern) = compiled_glob.as_ref()
            && !pattern.matches(&relative)
        {
            continue;
        }
        if source_only && !looks_like_source_file(&path) {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let haystack_name = if case_sensitive {
            file_name.to_string()
        } else {
            file_name.to_lowercase()
        };
        if haystack_name.contains(&needle) {
            results.push(json!({
                "path": relative,
                "line": Value::Null,
                "matchKind": "file_name",
                "snippet": file_name,
            }));
            if results.len() >= limit {
                break;
            }
        }
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.len() as usize > max_file_bytes {
            continue;
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes.contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        for (index, line) in text.lines().enumerate() {
            let haystack = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            if haystack.contains(&needle) {
                results.push(json!({
                    "path": relative,
                    "line": index + 1,
                    "matchKind": "content",
                    "snippet": line.trim(),
                }));
                break;
            }
        }
    }
    Ok(results)
}

pub(crate) fn search_workspace_symbols(
    workspace_root: &Path,
    root: &Path,
    query: &str,
    include_hidden: bool,
    limit: usize,
) -> Result<Vec<Value>, NativeToolFailure> {
    let mut files = Vec::new();
    collect_workspace_files(
        workspace_root,
        root,
        include_hidden,
        MAX_SEARCH_FILES,
        &mut files,
    )?;
    let needle = query.to_lowercase();
    let mut results = Vec::new();
    for path in files {
        if results.len() >= limit {
            break;
        }
        if !looks_like_source_file(&path) {
            continue;
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes.contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
        let relative = path
            .strip_prefix(workspace_root)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.display().to_string());
        for (index, line) in text.lines().enumerate() {
            let trimmed = line.trim();
            if !trimmed.to_lowercase().contains(&needle) || !looks_like_symbol_line(trimmed) {
                continue;
            }
            results.push(json!({
                "path": relative,
                "line": index + 1,
                "matchKind": "symbol",
                "kind": classify_symbol_line(trimmed),
                "snippet": trimmed,
            }));
            if results.len() >= limit {
                break;
            }
        }
    }
    Ok(results)
}

pub(crate) fn looks_like_source_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or(""),
        "rs" | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "mjs"
            | "cjs"
            | "py"
            | "go"
            | "java"
            | "kt"
            | "swift"
            | "cpp"
            | "c"
            | "h"
            | "hpp"
            | "cs"
            | "rb"
            | "php"
            | "scala"
            | "toml"
            | "json"
            | "md"
            | "yml"
            | "yaml"
    )
}

pub(crate) fn looks_like_symbol_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    [
        "fn ",
        "pub fn ",
        "struct ",
        "pub struct ",
        "enum ",
        "pub enum ",
        "trait ",
        "pub trait ",
        "impl ",
        "class ",
        "interface ",
        "function ",
        "export function ",
        "const ",
        "export const ",
        "def ",
    ]
    .iter()
    .any(|prefix| trimmed.starts_with(prefix))
}

pub(crate) fn classify_symbol_line(line: &str) -> &'static str {
    let line = line.trim_start();
    if line.contains("struct ") || line.starts_with("class ") {
        "type"
    } else if line.contains("enum ") {
        "enum"
    } else if line.contains("trait ") || line.starts_with("interface ") {
        "interface"
    } else if line.contains("fn ") || line.starts_with("def ") || line.contains("function ") {
        "function"
    } else {
        "symbol"
    }
}

pub(crate) fn format_search_results(results: &[Value]) -> String {
    if results.is_empty() {
        return "No matches.".to_string();
    }
    results
        .iter()
        .map(|result| {
            let path = result.get("path").and_then(Value::as_str).unwrap_or("-");
            let line = result.get("line").and_then(Value::as_u64);
            let snippet = result.get("snippet").and_then(Value::as_str).unwrap_or("");
            match line {
                Some(line) => format!("{path}:{line}: {snippet}"),
                None => format!("{path}: {snippet}"),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn tool_lsp_query(session_id: &str, input: &Value) -> NativeToolResult {
    let workspace = session_workspace_root(session_id)?;
    let query_type = value_string(input, "queryType").unwrap_or_else(|| "diagnostics".to_string());
    Ok(NativeToolSuccess {
        content: format!(
            "LSP query '{query_type}' is not available in the native runtime fallback. Workspace: {}",
            workspace.display()
        ),
        raw: json!({
            "available": false,
            "degraded": true,
            "queryType": query_type,
            "workspaceRoot": workspace.display().to_string(),
            "message": "LSP bridge is unavailable; use code_search_text or code_search_symbol for local evidence."
        }),
        recommended_next_action: Some(
            "Use code_search_text or code_search_symbol for local code evidence.".to_string(),
        ),
    })
}
