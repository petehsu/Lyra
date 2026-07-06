use super::*;

use std::sync::OnceLock;

use lyra_code_intel_core::CodeGraphEngine;

/// Global singleton — one engine serves all sessions.
/// The engine embeds its own tokio runtime, so sync callers (native tools)
/// can drive async queries via `*_sync` wrappers without a runtime context.
static CODEGRAPH_ENGINE: OnceLock<CodeGraphEngine> = OnceLock::new();

fn engine() -> &'static CodeGraphEngine {
    CODEGRAPH_ENGINE.get_or_init(|| {
        let storage_root = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("~/.local/share"))
            .join("lyra")
            .join("codegraph");
        CodeGraphEngine::new(storage_root)
    })
}

// ── Tool functions ──────────────────────────────────────────────────────
// Each function resolves the session's workspace root, then calls the
// matching `*_sync` wrapper on the global engine.

fn required_symbol_or_query(input: &Value) -> Result<String, NativeToolFailure> {
    value_string(input, "symbol")
        .or_else(|| value_string(input, "query"))
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "symbol is required",
                "Retry the tool call with `symbol` (or `query` when called through Tool-FS).",
            )
        })
}

fn with_staleness_notice(root: &Path, mut content: String, mut raw: Value) -> (String, Value) {
    let Ok(staleness) = engine().staleness_sync(root) else {
        return (content, raw);
    };
    if !staleness.stale {
        return (content, raw);
    }
    let changed = staleness.changed_files.join(", ");
    content.push_str(&format!(
        "\n\n⚠️ Code graph may be stale; changed since last index: {changed}. Re-index or verify with direct file reads before editing."
    ));
    raw["staleness"] = serde_json::to_value(staleness).unwrap_or_else(|_| json!({ "stale": true }));
    (content, raw)
}

pub(crate) fn tool_codegraph_explore(session_id: &str, input: &Value) -> NativeToolResult {
    let root = session_workspace_root(session_id)?;
    let query = required_value_string(input, "query")?;
    let limit = value_usize(input, "limit", 10, 50);
    let result = engine().explore_sync(&root, &query, limit).map_err(|e| {
        NativeToolFailure::new(
            "codegraph_explore_failed",
            e,
            "Ensure the project is indexed, then retry.",
        )
    })?;
    let content = format!(
        "Found {} symbols matching \"{}\" ({} ms). Each symbol includes direct callers and callees.",
        result.symbols.len(),
        result.query,
        result.elapsed_ms,
    );
    let (content, raw) = with_staleness_notice(
        &root,
        content,
        serde_json::to_value(&result).unwrap_or_else(|_| json!({})),
    );
    Ok(NativeToolSuccess {
        content,
        raw,
        recommended_next_action: Some(
            "Inspect individual symbols, then use /tools/code/callers, /tools/code/callees, or /tools/code/impact through Tool-FS for deeper analysis."
                .to_string(),
        ),
    })
}

pub(crate) fn tool_codegraph_callers(session_id: &str, input: &Value) -> NativeToolResult {
    let root = session_workspace_root(session_id)?;
    let symbol = required_symbol_or_query(input)?;
    let depth = value_usize(input, "depth", 1, 4) as u32;
    let limit = value_usize(input, "limit", 50, 100);
    let callers = engine()
        .callers_sync(&root, &symbol, depth, limit)
        .map_err(|e| {
            NativeToolFailure::new(
                "codegraph_callers_failed",
                e,
                "Ensure the project is indexed and the symbol name is correct.",
            )
        })?;
    let content = if callers.is_empty() {
        format!("No callers found for \"{symbol}\".")
    } else {
        format!("Found {} caller(s) of \"{symbol}\".", callers.len())
    };
    let (content, raw) = with_staleness_notice(
        &root,
        content,
        json!({ "symbol": symbol, "callers": callers }),
    );
    Ok(NativeToolSuccess {
        content,
        raw,
        recommended_next_action: None,
    })
}

pub(crate) fn tool_codegraph_callees(session_id: &str, input: &Value) -> NativeToolResult {
    let root = session_workspace_root(session_id)?;
    let symbol = required_symbol_or_query(input)?;
    let depth = value_usize(input, "depth", 1, 4) as u32;
    let limit = value_usize(input, "limit", 50, 100);
    let callees = engine()
        .callees_sync(&root, &symbol, depth, limit)
        .map_err(|e| {
            NativeToolFailure::new(
                "codegraph_callees_failed",
                e,
                "Ensure the project is indexed and the symbol name is correct.",
            )
        })?;
    let content = if callees.is_empty() {
        format!("No callees found for \"{symbol}\".")
    } else {
        format!("Found {} callee(s) of \"{symbol}\".", callees.len())
    };
    let (content, raw) = with_staleness_notice(
        &root,
        content,
        json!({ "symbol": symbol, "callees": callees }),
    );
    Ok(NativeToolSuccess {
        content,
        raw,
        recommended_next_action: None,
    })
}

pub(crate) fn tool_codegraph_impact(session_id: &str, input: &Value) -> NativeToolResult {
    let root = session_workspace_root(session_id)?;
    let symbol = required_symbol_or_query(input)?;
    let depth = value_usize(input, "depth", 2, 4) as u32;
    let limit = value_usize(input, "limit", 50, 100);
    let callers = engine()
        .impact_sync(&root, &symbol, depth, limit)
        .map_err(|e| {
            NativeToolFailure::new(
                "codegraph_impact_failed",
                e,
                "Ensure the project is indexed and the symbol name is correct.",
            )
        })?;
    let content = if callers.is_empty() {
        format!(
            "No upstream callers found for \"{symbol}\" — impact is limited to the symbol itself."
        )
    } else {
        format!(
            "Changing \"{symbol}\" could affect {} upstream caller(s) (depth {depth}).",
            callers.len()
        )
    };
    let (content, raw) = with_staleness_notice(
        &root,
        content,
        json!({ "symbol": symbol, "affectedCallers": callers }),
    );
    Ok(NativeToolSuccess {
        content,
        raw,
        recommended_next_action: Some(
            "Review each caller before modifying the symbol. Use /tools/code/explore through Tool-FS for broader context."
                .to_string(),
        ),
    })
}

pub(crate) fn tool_codegraph_context(session_id: &str, _input: &Value) -> NativeToolResult {
    let root = session_workspace_root(session_id)?;
    let context = engine().project_context_sync(&root).map_err(|e| {
        NativeToolFailure::new(
            "codegraph_context_failed",
            e,
            "Ensure the project is indexed, then retry.",
        )
    })?;
    let content = format!(
        "Project: {} files, {} symbols, {} entry points, {} languages, {} framework hints.",
        context.file_count,
        context.symbol_count,
        context.entry_points.len(),
        context.languages.len(),
        context.frameworks.len(),
    );
    let (content, raw) = with_staleness_notice(
        &root,
        content,
        serde_json::to_value(&context).unwrap_or_else(|_| json!({})),
    );
    Ok(NativeToolSuccess {
        content,
        raw,
        recommended_next_action: Some(
            "Use /tools/code/explore for specific symbols, or /tools/code/callers and /tools/code/callees for call-chain analysis."
                .to_string(),
        ),
    })
}

pub(crate) fn tool_codegraph_server(session_id: &str, input: &Value) -> NativeToolResult {
    let root = session_workspace_root(session_id)?;
    let tool_name = codegraph_server_tool_name(input)?;
    let args = codegraph_server_args(input);
    let result = engine()
        .run_mcp_tool_sync(&root, &tool_name, args)
        .map_err(|e| {
            NativeToolFailure::new(
                "codegraph_server_failed",
                e,
                "Check the CodeGraph tool arguments and retry.",
            )
        })?;
    let content = codegraph_server_content(&tool_name, &root, &result);
    Ok(NativeToolSuccess {
        content,
        raw: result,
        recommended_next_action: None,
    })
}

fn codegraph_server_content(tool_name: &str, root: &Path, raw: &Value) -> String {
    let mut lines = Vec::new();
    let items = first_result_array(raw);
    let total = raw
        .get("total_matches")
        .or_else(|| raw.get("total"))
        .or_else(|| raw.pointer("/summary/total"))
        .and_then(Value::as_u64)
        .unwrap_or(items.map(|items| items.len()).unwrap_or(0) as u64);
    let query_ms = raw.get("query_time_ms").and_then(Value::as_u64);
    lines.push(match query_ms {
        Some(ms) => format!("{tool_name}: {total} result(s), query {ms} ms."),
        None => format!("{tool_name}: {total} result(s)."),
    });

    if let Some(status) = raw.get("embedding_status").and_then(Value::as_str) {
        lines.push(format!("embedding_status: {status}"));
    }
    if let Some(summary) = raw.get("summary") {
        lines.push(format!("summary: {}", short_json(summary, 900)));
    }

    if let Some(items) = items {
        for (index, item) in items.iter().take(8).enumerate() {
            lines.push(format!(
                "{}. {}",
                index + 1,
                codegraph_result_line(root, item)
            ));
        }
    } else if lines.len() == 1 {
        lines.push(short_json(raw, 2000));
    }

    truncate_chars(&lines.join("\n"), 6000)
}

fn first_result_array(raw: &Value) -> Option<&Vec<Value>> {
    for key in [
        "results",
        "symbols",
        "functions",
        "callers",
        "callees",
        "dependencies",
        "nodes",
        "edges",
        "matches",
        "files",
    ] {
        if let Some(items) = raw.get(key).and_then(Value::as_array) {
            return Some(items);
        }
    }
    None
}

fn codegraph_result_line(root: &Path, item: &Value) -> String {
    let symbol = item.get("symbol").unwrap_or(item);
    let name = symbol
        .get("name")
        .or_else(|| item.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("<unnamed>");
    let kind = symbol
        .get("kind")
        .or_else(|| item.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("item");
    let reason = item
        .get("match_reason")
        .and_then(Value::as_str)
        .map(|value| format!(" ({value})"))
        .unwrap_or_default();
    let location = symbol
        .get("location")
        .or_else(|| item.get("location"))
        .map(|location| codegraph_location(root, location))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| short_json(item, 240));
    format!("{kind} {name}{reason} at {location}")
}

fn codegraph_location(root: &Path, location: &Value) -> String {
    let file = location
        .get("file")
        .or_else(|| location.get("uri"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if file.is_empty() {
        return String::new();
    }
    let file = Path::new(file);
    let relative = file
        .strip_prefix(root)
        .unwrap_or(file)
        .to_string_lossy()
        .to_string();
    match location.get("line").and_then(Value::as_u64) {
        Some(line) => format!("{relative}:{line}"),
        None => relative,
    }
}

fn short_json(value: &Value, limit: usize) -> String {
    truncate_chars(
        &serde_json::to_string(value).unwrap_or_else(|_| value.to_string()),
        limit,
    )
}

fn truncate_chars(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let mut out = value.chars().take(limit).collect::<String>();
    out.push_str("...");
    out
}

fn codegraph_server_tool_name(input: &Value) -> Result<String, NativeToolFailure> {
    input
        .pointer("/toolOperation/toolHandle")
        .or_else(|| input.get("toolHandle"))
        .or_else(|| input.get("tool_handle"))
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("codegraph_"))
        .map(str::to_string)
        .or_else(|| {
            value_string(input, "operation")
                .filter(|operation| !operation.trim().is_empty())
                .map(|operation| format!("codegraph_{operation}"))
        })
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "CodeGraph tool name is required.",
                "Run through Tool-FS with a /tools/codegraph/* path or codegraph_* toolHandle.",
            )
        })
}

fn codegraph_server_args(input: &Value) -> Value {
    let mut args = input.as_object().cloned().unwrap_or_default();
    for key in [
        "action",
        "toolPath",
        "domain",
        "operation",
        "toolOperation",
        "toolHandle",
        "tool_handle",
    ] {
        args.remove(key);
    }
    Value::Object(args)
}

/// Kick off background indexing for a session's project.
/// Called from `bind_project` (Phase 4) — not a model-facing tool.
pub(crate) fn trigger_indexing(working_dir: &Path) {
    let _ = engine().index_project_sync(working_dir.to_path_buf());
}

/// Get the current index status for a session's project.
/// Called from IPC / runtime context builder (Phase 4/5).
pub(crate) fn index_status(working_dir: &Path) -> lyra_code_intel_core::IndexStatus {
    engine().status_sync(working_dir)
}

/// Check CodeGraph staleness for a working directory (sync).
/// Used by goal continuation evaluation to detect un-indexed file changes.
pub(crate) fn codegraph_staleness(
    working_dir: &Path,
) -> Result<lyra_code_intel_core::StalenessInfo, String> {
    engine().staleness_sync(working_dir)
}

/// Build the `projectContext` JSON for prompt injection.
/// When the index is Ready, includes the full summary (entry points,
/// key modules, languages). Otherwise, returns just the status.
pub(crate) fn project_context_for_prompt(working_dir: &Path) -> Value {
    let status = engine().status_sync(working_dir);
    match &status {
        lyra_code_intel_core::IndexStatus::Ready {
            file_count,
            symbol_count,
        } => match engine().project_context_sync(working_dir) {
            Ok(ctx) => {
                let staleness = engine().staleness_sync(working_dir).ok();
                json!({
                    "state": "ready",
                    "fileCount": ctx.file_count.max(*file_count),
                    "symbolCount": ctx.symbol_count.max(*symbol_count),
                    "entryPoints": ctx.entry_points,
                    "keyModules": ctx.key_modules,
                    "languages": ctx.languages,
                    "frameworks": ctx.frameworks,
                    "bridges": ctx.bridges,
                    "architecture": ctx.architecture,
                    "scope": ctx.scope,
                    "staleness": staleness,
                })
            }
            Err(_) => {
                let staleness = engine().staleness_sync(working_dir).ok();
                json!({
                    "state": "ready",
                    "fileCount": file_count,
                    "symbolCount": symbol_count,
                    "staleness": staleness,
                })
            }
        },
        lyra_code_intel_core::IndexStatus::Indexing { progress } => json!({
            "state": "indexing",
            "progress": progress,
        }),
        lyra_code_intel_core::IndexStatus::Failed { error } => json!({
            "state": "failed",
            "error": error,
        }),
        lyra_code_intel_core::IndexStatus::Idle => json!({ "state": "idle" }),
    }
}

/// IPC handler: `agent.codegraph.status(sessionId?, workingDir?)`.
/// Returns `{ state, progress?, fileCount?, symbolCount?, error? }`.
///
/// 当 payload 带 `workingDir` 时直接用，无需 session（draft tab 选项目即触发）。
/// 否则从 session 解析 workingDir（原有行为）。
pub(crate) fn codegraph_status(payload: Value) -> super::AgentRuntimeResult<Value> {
    // 优先用 payload.workingDir（不依赖 session）。
    let direct_working_dir = payload
        .get("workingDir")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let (working_dir, is_home) = if let Some(dir) = direct_working_dir {
        (dir, false)
    } else {
        let session_id = payload
            .get("sessionId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let mut state = state().lock().map_err(|_| {
            crate::AgentRuntimeError::Core("agent runtime state lock failed".to_string())
        })?;
        let id = state.resolve_session_id(session_id)?;
        let session = state
            .sessions
            .get(&id)
            .ok_or_else(|| crate::AgentRuntimeError::Core(format!("session not found: {id}")))?;
        let working_dir = session
            .snapshot
            .get("workingDir")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        let is_home = session
            .snapshot
            .get("workingDirIsHome")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        (working_dir, is_home)
    };
    if working_dir.is_empty() || is_home {
        return Ok(json!({ "state": "idle" }));
    }
    let working_dir = Path::new(&working_dir);
    let mut status = index_status(working_dir);
    if matches!(status, lyra_code_intel_core::IndexStatus::Idle) {
        trigger_indexing(working_dir);
        status = index_status(working_dir);
    }
    Ok(match status {
        lyra_code_intel_core::IndexStatus::Ready {
            file_count,
            symbol_count,
        } => {
            let context = engine().project_context_sync(working_dir).ok();
            let staleness = engine().staleness_sync(working_dir).ok();
            json!({
                "state": "ready",
                "fileCount": context.as_ref().map(|ctx| ctx.file_count.max(file_count)).unwrap_or(file_count),
                "symbolCount": context.as_ref().map(|ctx| ctx.symbol_count.max(symbol_count)).unwrap_or(symbol_count),
                "scope": context.map(|ctx| ctx.scope),
                "staleness": staleness,
                "embeddingsEnabled": engine().embeddings_enabled(),
            })
        }
        lyra_code_intel_core::IndexStatus::Indexing { progress } => json!({
            "state": "indexing",
            "progress": progress,
        }),
        lyra_code_intel_core::IndexStatus::Failed { error } => json!({
            "state": "failed",
            "error": error,
        }),
        lyra_code_intel_core::IndexStatus::Idle => json!({ "state": "idle" }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codegraph_server_content_includes_raw_results() {
        let root = Path::new("/repo");
        let raw = json!({
            "query_time_ms": 6,
            "total_matches": 1,
            "embedding_status": "graph-only",
            "results": [{
                "match_reason": "SymbolName",
                "symbol": {
                    "name": "AgentEvent",
                    "kind": "Interface",
                    "location": {
                        "file": "/repo/crates/lyra-agent-runtime/src/agent_event.rs",
                        "line": 12
                    }
                }
            }]
        });

        let content = codegraph_server_content("codegraph_symbol_search", root, &raw);
        assert!(content.contains("AgentEvent"));
        assert!(content.contains("agent_event.rs:12"));
        assert!(!content.contains("Ran codegraph_symbol_search."));
    }
}
