use super::*;

const NATIVE_AGENT_SEARCH_CANDIDATE_LIMIT: usize = 500;

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
    let results = search_workspace_native(NativeWorkspaceSearchOptions {
        workspace_root: &workspace_path.root,
        root: &workspace_path.absolute,
        query: &query,
        glob: None,
        include_hidden,
        limit,
        case_sensitive: false,
        source_only: false,
        enable_content: false,
        mode: "fast",
    })?;
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
    _max_file_bytes: usize,
    case_sensitive: bool,
    source_only: bool,
) -> Result<Vec<Value>, NativeToolFailure> {
    search_workspace_native(NativeWorkspaceSearchOptions {
        workspace_root,
        root,
        query,
        glob,
        include_hidden,
        limit,
        case_sensitive,
        source_only,
        enable_content: true,
        mode: "normal",
    })
}

pub(crate) fn search_workspace_symbols(
    workspace_root: &Path,
    root: &Path,
    query: &str,
    include_hidden: bool,
    limit: usize,
) -> Result<Vec<Value>, NativeToolFailure> {
    let needle = query.to_lowercase();
    let candidates = search_workspace_native(NativeWorkspaceSearchOptions {
        workspace_root,
        root,
        query,
        glob: None,
        include_hidden,
        limit: limit
            .saturating_mul(5)
            .max(limit)
            .min(NATIVE_AGENT_SEARCH_CANDIDATE_LIMIT),
        case_sensitive: false,
        source_only: true,
        enable_content: true,
        mode: "full",
    })?;
    let mut seen_paths = HashSet::new();
    let mut results = Vec::new();
    for candidate in candidates {
        if results.len() >= limit {
            break;
        }
        let Some(relative) = candidate.get("path").and_then(Value::as_str) else {
            continue;
        };
        if !seen_paths.insert(relative.to_string()) {
            continue;
        }
        let path = workspace_root.join(relative);
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        if bytes.contains(&0) {
            continue;
        }
        let text = String::from_utf8_lossy(&bytes);
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
                "matchRanges": [{
                    "line": index + 1,
                    "startChar": match_range(trimmed, query, false).map(|range| range.0).unwrap_or(0),
                    "endChar": match_range(trimmed, query, false).map(|range| range.1).unwrap_or_else(|| trimmed.chars().count()),
                }],
            }));
            if results.len() >= limit {
                break;
            }
        }
    }
    Ok(results)
}

struct NativeWorkspaceSearchOptions<'a> {
    workspace_root: &'a Path,
    root: &'a Path,
    query: &'a str,
    glob: Option<&'a str>,
    include_hidden: bool,
    limit: usize,
    case_sensitive: bool,
    source_only: bool,
    enable_content: bool,
    mode: &'a str,
}

fn search_workspace_native(
    options: NativeWorkspaceSearchOptions<'_>,
) -> Result<Vec<Value>, NativeToolFailure> {
    let compiled_glob = compile_optional_glob(options.glob)?;
    let native_limit = options
        .limit
        .saturating_mul(if options.enable_content { 4 } else { 2 })
        .max(options.limit)
        .min(NATIVE_AGENT_SEARCH_CANDIDATE_LIMIT);
    let request = json!({
        "query": options.query,
        "limit": native_limit,
        "scopePreset": "custom",
        "customRoots": [options.root.display().to_string()],
        "mode": options.mode,
        "includeHidden": options.include_hidden,
        "enableContent": options.enable_content,
        "enableFuzzy": true,
        "enableExtensionMatch": true,
    });
    let response_text =
        lyra_search_core::search_local_blocking_json(request.to_string()).map_err(|error| {
            NativeToolFailure::new(
                "search_failed",
                format!("native local search failed: {error}"),
                "Retry with a narrower root or a more specific query.",
            )
        })?;
    let response: Value = serde_json::from_str(&response_text).map_err(|error| {
        NativeToolFailure::new(
            "search_failed",
            format!("native local search returned invalid JSON: {error}"),
            "Retry the search.",
        )
    })?;
    let mut results = Vec::new();
    for result in response
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if results.len() >= options.limit {
            break;
        }
        let Some(path_text) = result.get("path").and_then(Value::as_str) else {
            continue;
        };
        let absolute = PathBuf::from(path_text);
        if options.source_only && !looks_like_source_file(&absolute) {
            continue;
        }
        let relative = absolute
            .strip_prefix(options.workspace_root)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path_text.replace('\\', "/"));
        if let Some(pattern) = compiled_glob.as_ref() {
            let file_name = absolute
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if !pattern.matches(&relative) && !pattern.matches(file_name) {
                continue;
            }
        }
        let file_name = result
            .get("fileName")
            .and_then(Value::as_str)
            .or_else(|| absolute.file_name().and_then(|value| value.to_str()))
            .unwrap_or("");
        let match_kind = result
            .get("matchKind")
            .and_then(Value::as_str)
            .unwrap_or("path");
        let snippet = result
            .get("snippet")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                if match_kind == "file_name" {
                    file_name
                } else {
                    &relative
                }
            });
        if options.case_sensitive
            && !native_case_sensitive_match(
                match_kind,
                options.query,
                file_name,
                &relative,
                snippet,
            )
        {
            continue;
        }
        let line = result.get("line").and_then(Value::as_u64);
        let (start_char, end_char) = match_range(snippet, options.query, options.case_sensitive)
            .unwrap_or((0, snippet.chars().count()));
        let mut range = json!({
            "startChar": start_char,
            "endChar": end_char,
        });
        if let Some(line) = line {
            range["line"] = json!(line);
        }
        results.push(json!({
            "path": relative,
            "line": line.map(Value::from).unwrap_or(Value::Null),
            "matchKind": match_kind,
            "snippet": snippet,
            "matchRanges": [range],
        }));
    }
    Ok(results)
}

fn compile_optional_glob(glob: Option<&str>) -> Result<Option<Pattern>, NativeToolFailure> {
    match glob {
        Some(pattern) => Pattern::new(pattern).map(Some).map_err(|error| {
            NativeToolFailure::new(
                "bad_glob",
                format!("invalid glob pattern: {error}"),
                "Retry with a valid source glob such as **/*.rs.",
            )
        }),
        None => Ok(None),
    }
}

fn native_case_sensitive_match(
    match_kind: &str,
    query: &str,
    file_name: &str,
    relative: &str,
    snippet: &str,
) -> bool {
    match match_kind {
        "content" => snippet.contains(query),
        "file_name" => file_name.contains(query),
        _ => relative.contains(query) || snippet.contains(query),
    }
}

fn match_range(haystack: &str, needle: &str, case_sensitive: bool) -> Option<(usize, usize)> {
    if needle.is_empty() {
        return None;
    }
    let haystack_cmp = if case_sensitive {
        haystack.to_string()
    } else {
        haystack.to_lowercase()
    };
    let needle_cmp = if case_sensitive {
        needle.to_string()
    } else {
        needle.to_lowercase()
    };
    let byte_start = haystack_cmp.find(&needle_cmp)?;
    let byte_end = byte_start + needle_cmp.len();
    let start_char = haystack[..byte_start].chars().count();
    let end_char = haystack[..byte_end].chars().count();
    Some((start_char, end_char))
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
