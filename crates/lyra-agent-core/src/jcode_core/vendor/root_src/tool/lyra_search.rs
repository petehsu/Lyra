use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use lyra_local_search::{
    LocalSearchContentMode, LocalSearchEngine, LocalSearchEngineConfig,
    LocalSearchIndexRootOptions, LocalSearchKind, LocalSearchOptions, LocalSearchResponse,
    LocalSearchResult, LocalSearchStatus, LocalSearchStorageMode,
};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 100;
const SNIPPET_LIMIT: usize = 500;
const DEFAULT_TIMEOUT_MS: u64 = 12_000;
const MAX_TIMEOUT_MS: u64 = 60_000;

pub struct LyraSearchTool;

impl LyraSearchTool {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Debug, Deserialize)]
struct LyraSearchInput {
    #[serde(default = "default_action")]
    action: String,
    #[serde(default)]
    query: Option<String>,
    #[serde(default = "default_scope")]
    scope: String,
    #[serde(default)]
    root: Option<String>,
    #[serde(default)]
    roots: Vec<String>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(default)]
    include_hidden: Option<bool>,
    #[serde(default)]
    include_vendor: Option<bool>,
    #[serde(default = "default_respect_gitignore")]
    respect_gitignore: bool,
    #[serde(default = "default_content")]
    content: String,
    #[serde(default)]
    fuzzy: Option<bool>,
    #[serde(default)]
    extension_match: Option<bool>,
    #[serde(default)]
    storage_root: Option<String>,
    #[serde(default)]
    #[serde(alias = "timeoutMs")]
    timeout_ms: Option<u64>,
}

fn default_action() -> String {
    "search".to_string()
}

fn default_scope() -> String {
    "auto".to_string()
}

fn default_content() -> String {
    "auto".to_string()
}

fn default_respect_gitignore() -> bool {
    true
}

#[async_trait]
impl Tool for LyraSearchTool {
    fn name(&self) -> &str {
        "lyra_search"
    }

    fn description(&self) -> &str {
        "Search local files with Lyra's indexed/fuzzy/content search. Use for broad local file discovery, locating projects/pages/assets, or content snippets; prefer agentgrep for focused code search after the workspace is known."
    }

    fn parameters_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "intent": super::intent_schema_property(),
                "action": {
                    "type": "string",
                    "enum": ["search", "status", "rebuild"],
                    "description": "Operation to run. Defaults to search. Use status to inspect the local index, rebuild only when repeated searches need a fresh index."
                },
                "query": {
                    "type": "string",
                    "description": "Search query. Required for action=search."
                },
                "scope": {
                    "type": "string",
                    "enum": ["auto", "workspace", "home", "custom", "full_system"],
                    "description": "Search scope. auto uses the bound workspace when present; if the session is unbound at filesystem root, auto searches common home folders such as Desktop, Downloads, Documents, and Pictures instead of scanning / or the entire home."
                },
                "root": {
                    "type": "string",
                    "description": "Single explicit root. Relative paths resolve against the session working directory."
                },
                "roots": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Explicit roots for scope=custom. Relative paths resolve against the session working directory."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum results to return, clamped to 1-100. Defaults to 20."
                },
                "kind": {
                    "type": "string",
                    "enum": ["all", "file", "directory"],
                    "description": "Optional result kind filter."
                },
                "extensions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional file extension filters, for example [\"html\", \"ts\"]."
                },
                "include_hidden": {
                    "type": "boolean",
                    "description": "Include hidden files and directories. Defaults to false."
                },
                "include_vendor": {
                    "type": "boolean",
                    "description": "Include vendor/dependency directories such as node_modules and target. Defaults to false."
                },
                "respect_gitignore": {
                    "type": "boolean",
                    "description": "Respect gitignore and ignore files. Defaults to true."
                },
                "content": {
                    "type": "string",
                    "enum": ["disabled", "auto", "required"],
                    "description": "Content search mode. auto searches path and text content when useful; disabled searches paths only; required requires content matches."
                },
                "fuzzy": {
                    "type": "boolean",
                    "description": "Enable fuzzy path ranking. Defaults to true."
                },
                "extension_match": {
                    "type": "boolean",
                    "description": "Enable extension-name matching. Defaults to true."
                },
                "storage_root": {
                    "type": "string",
                    "description": "Optional Lyra search storage root. Defaults to ~/.lyra/modules/search."
                },
                "timeout_ms": {
                    "type": "integer",
                    "description": "Maximum search time in milliseconds, clamped to 1000-60000. Defaults to 12000 so broad local scans return partial results instead of stalling the Agent."
                }
            }
        })
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let params: LyraSearchInput = serde_json::from_value(input)?;
        let action = params.action.trim().to_ascii_lowercase();
        let cancel_flag = ctx
            .graceful_shutdown_signal
            .as_ref()
            .map(|signal| signal.as_atomic());

        tokio::task::spawn_blocking(move || match action.as_str() {
            "search" => run_search(params, ctx, cancel_flag),
            "status" => run_status(params, &ctx),
            "rebuild" => run_rebuild(params, ctx, cancel_flag),
            other => Err(anyhow::anyhow!(
                "Unsupported lyra_search action: {other}. Use search, status, or rebuild."
            )),
        })
        .await?
    }
}

fn run_search(
    params: LyraSearchInput,
    ctx: ToolContext,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<ToolOutput> {
    let query = params
        .query
        .as_deref()
        .map(str::trim)
        .filter(|query| !query.is_empty())
        .ok_or_else(|| anyhow::anyhow!("lyra_search action=search requires query"))?
        .to_string();
    let roots = resolve_roots(&params, &ctx)?;
    let engine = engine_for_params(&params, &ctx)?;
    let options = LocalSearchOptions {
        query: query.clone(),
        roots: roots.clone(),
        kinds: kind_filter(params.kind.as_deref())?,
        extensions: normalize_extensions(&params.extensions),
        limit: clamp_limit(params.limit),
        include_hidden: params.include_hidden.unwrap_or(false),
        include_vendor: params.include_vendor.unwrap_or(false),
        respect_gitignore: params.respect_gitignore,
        content_mode: parse_content_mode(&params.content)?,
        enable_fuzzy: params.fuzzy.unwrap_or(true),
        enable_extension_match: params.extension_match.unwrap_or(true),
        ..LocalSearchOptions::default()
    };
    let (cancel_flag, timed_out) = timed_search_cancel_flag(cancel_flag, params.timeout_ms);
    let response = engine.search(options, Some(cancel_flag))?;
    let output =
        render_search_response(&query, &roots, &response, timed_out.load(Ordering::Relaxed));
    Ok(ToolOutput::new(output).with_title(format!("lyra_search: {query}")))
}

fn run_status(params: LyraSearchInput, ctx: &ToolContext) -> Result<ToolOutput> {
    let engine = engine_for_params(&params, ctx)?;
    let status = engine.status();
    Ok(ToolOutput::new(render_status(&status)).with_title("lyra_search status"))
}

fn run_rebuild(
    params: LyraSearchInput,
    ctx: ToolContext,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<ToolOutput> {
    let roots = resolve_roots(&params, &ctx)?;
    let engine = engine_for_params(&params, &ctx)?;
    let content_mode = parse_content_mode(&params.content)?;
    let mut status = engine.status();
    for root in roots {
        let options = LocalSearchIndexRootOptions {
            root,
            include_hidden: params.include_hidden.unwrap_or(false),
            include_vendor: params.include_vendor.unwrap_or(false),
            respect_gitignore: params.respect_gitignore,
            content_mode,
            ..LocalSearchIndexRootOptions::default()
        };
        status = engine.index_root(options, cancel_flag.clone())?;
    }
    Ok(ToolOutput::new(render_status(&status)).with_title("lyra_search rebuild"))
}

fn engine_for_params(params: &LyraSearchInput, ctx: &ToolContext) -> Result<LocalSearchEngine> {
    let storage_root = resolve_storage_root(params, ctx);
    match storage_root {
        Some(storage_root) => Ok(LocalSearchEngine::with_config(LocalSearchEngineConfig {
            storage_mode: LocalSearchStorageMode::Persistent { storage_root },
        })),
        None => Ok(LocalSearchEngine::new()),
    }
}

fn resolve_storage_root(params: &LyraSearchInput, ctx: &ToolContext) -> Option<PathBuf> {
    if let Some(root) = params
        .storage_root
        .as_deref()
        .map(str::trim)
        .filter(|root| !root.is_empty())
    {
        return Some(ctx.resolve_path(Path::new(root)));
    }
    dirs::home_dir().map(|home| home.join(".lyra").join("modules").join("search"))
}

fn resolve_roots(params: &LyraSearchInput, ctx: &ToolContext) -> Result<Vec<PathBuf>> {
    let explicit = explicit_roots(params, ctx);
    if !explicit.is_empty() {
        return Ok(explicit);
    }

    match params.scope.trim().to_ascii_lowercase().as_str() {
        "auto" => {
            if let Some(working_dir) = ctx.working_dir.as_deref()
                && !is_filesystem_root(working_dir)
            {
                return Ok(vec![working_dir.to_path_buf()]);
            }
            auto_home_roots()
        }
        "workspace" => {
            let working_dir = ctx.working_dir.as_deref().ok_or_else(|| {
                anyhow::anyhow!("workspace scope requires a bound working directory or root")
            })?;
            if is_filesystem_root(working_dir) {
                anyhow::bail!(
                    "workspace scope is unbound at filesystem root; pass root/roots, bind a project session, or use scope=home/custom/full_system explicitly"
                );
            }
            Ok(vec![working_dir.to_path_buf()])
        }
        "home" => home_root(),
        "custom" => Err(anyhow::anyhow!(
            "custom scope requires root or roots so lyra_search does not guess a broad filesystem scope"
        )),
        "full_system" => Ok(full_system_roots()),
        other => Err(anyhow::anyhow!(
            "Unsupported lyra_search scope: {other}. Use auto, workspace, home, custom, or full_system."
        )),
    }
}

fn explicit_roots(params: &LyraSearchInput, ctx: &ToolContext) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = params
        .root
        .as_deref()
        .map(str::trim)
        .filter(|root| !root.is_empty())
    {
        roots.push(ctx.resolve_path(Path::new(root)));
    }
    roots.extend(
        params
            .roots
            .iter()
            .map(String::as_str)
            .map(str::trim)
            .filter(|root| !root.is_empty())
            .map(|root| ctx.resolve_path(Path::new(root))),
    );
    roots
}

fn home_root() -> Result<Vec<PathBuf>> {
    dirs::home_dir()
        .map(|home| vec![home])
        .ok_or_else(|| anyhow::anyhow!("Could not resolve home directory for lyra_search"))
}

fn auto_home_roots() -> Result<Vec<PathBuf>> {
    let home = dirs::home_dir()
        .ok_or_else(|| anyhow::anyhow!("Could not resolve home directory for lyra_search"))?;
    let roots = common_home_roots(&home);
    if roots.is_empty() {
        Ok(vec![home])
    } else {
        Ok(roots)
    }
}

fn common_home_roots(home: &Path) -> Vec<PathBuf> {
    [
        "Desktop",
        "Downloads",
        "Documents",
        "Pictures",
        "Movies",
        "Music",
        "Applications",
    ]
    .iter()
    .map(|name| home.join(name))
    .filter(|path| path.exists())
    .collect()
}

fn full_system_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
        return vec![PathBuf::from(format!("{drive}\\"))];
    }
    #[cfg(not(windows))]
    {
        vec![PathBuf::from("/")]
    }
}

fn is_filesystem_root(path: &Path) -> bool {
    path.parent().is_none()
}

fn clamp_limit(limit: Option<usize>) -> usize {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

fn clamp_timeout_ms(timeout_ms: Option<u64>) -> u64 {
    timeout_ms
        .unwrap_or(DEFAULT_TIMEOUT_MS)
        .clamp(1_000, MAX_TIMEOUT_MS)
}

fn timed_search_cancel_flag(
    upstream_cancel_flag: Option<Arc<AtomicBool>>,
    timeout_ms: Option<u64>,
) -> (Arc<AtomicBool>, Arc<AtomicBool>) {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    let timed_out = Arc::new(AtomicBool::new(false));
    let timeout_cancel = Arc::clone(&cancel_flag);
    let timeout_marker = Arc::clone(&timed_out);
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(clamp_timeout_ms(timeout_ms)));
        timeout_marker.store(true, Ordering::Relaxed);
        timeout_cancel.store(true, Ordering::Relaxed);
    });

    if let Some(upstream_cancel_flag) = upstream_cancel_flag {
        let cancel = Arc::clone(&cancel_flag);
        std::thread::spawn(move || {
            while !cancel.load(Ordering::Relaxed) {
                if upstream_cancel_flag.load(Ordering::Relaxed) {
                    cancel.store(true, Ordering::Relaxed);
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        });
    }

    (cancel_flag, timed_out)
}

fn kind_filter(kind: Option<&str>) -> Result<Vec<LocalSearchKind>> {
    match kind.unwrap_or("all").trim().to_ascii_lowercase().as_str() {
        "" | "all" => Ok(Vec::new()),
        "file" | "files" => Ok(vec![LocalSearchKind::File]),
        "directory" | "directories" | "dir" | "dirs" => Ok(vec![LocalSearchKind::Directory]),
        other => Err(anyhow::anyhow!(
            "Unsupported lyra_search kind: {other}. Use all, file, or directory."
        )),
    }
}

fn normalize_extensions(extensions: &[String]) -> Vec<String> {
    extensions
        .iter()
        .map(String::as_str)
        .map(str::trim)
        .filter(|extension| !extension.is_empty())
        .map(|extension| extension.trim_start_matches('.').to_ascii_lowercase())
        .collect()
}

fn parse_content_mode(value: &str) -> Result<LocalSearchContentMode> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "auto" => Ok(LocalSearchContentMode::Auto),
        "disabled" | "off" | "false" => Ok(LocalSearchContentMode::Disabled),
        "required" | "content" | "true" => Ok(LocalSearchContentMode::Required),
        other => Err(anyhow::anyhow!(
            "Unsupported lyra_search content mode: {other}. Use disabled, auto, or required."
        )),
    }
}

fn render_search_response(
    query: &str,
    roots: &[PathBuf],
    response: &LocalSearchResponse,
    timed_out: bool,
) -> String {
    let mut output = String::new();
    output.push_str(&format!("Lyra local search for '{query}'\n"));
    output.push_str(&format!(
        "Index state: {}\n",
        enum_label(&response.index_state)
    ));
    output.push_str(&format!(
        "Matches: {} returned, {} total{}\n",
        response.results.len(),
        response.total_match_count,
        if response.truncated {
            " (truncated)"
        } else {
            ""
        }
    ));
    output.push_str("Roots:\n");
    for root in roots {
        output.push_str(&format!("- {}\n", root.display()));
    }
    if timed_out {
        output.push_str(
            "Note: search stopped after the time budget; results may be partial. Use root/roots, a narrower query, or timeout_ms for a broader scan.\n",
        );
    }

    if response.results.is_empty() {
        output.push_str("\nNo matches.\n");
        return output;
    }

    output.push('\n');
    for (index, result) in response.results.iter().enumerate() {
        render_result(&mut output, index + 1, result);
    }
    output
}

fn render_result(output: &mut String, index: usize, result: &LocalSearchResult) {
    output.push_str(&format!("[{index}] {}\n", result.path.display()));
    output.push_str(&format!(
        "    display={} kind={} match={} source={} score={}\n",
        result.display_path,
        enum_label(&result.kind),
        enum_label(&result.match_kind),
        enum_label(&result.source),
        result.score
    ));
    if let Some(snippet) = result.snippet.as_deref() {
        let snippet = snippet.replace(['\r', '\n'], " ");
        output.push_str(&format!(
            "    snippet: {}\n",
            crate::util::truncate_str(&snippet, SNIPPET_LIMIT)
        ));
    }
}

fn render_status(status: &LocalSearchStatus) -> String {
    let mut output = String::new();
    output.push_str("Lyra local search index status\n");
    output.push_str(&format!("State: {}\n", enum_label(&status.state)));
    output.push_str(&format!(
        "Indexed: {} files, {} dirs, {} content files\n",
        status.indexed_file_count, status.indexed_dir_count, status.indexed_content_file_count
    ));
    output.push_str(&format!("SQLite FTS: {}\n", status.sqlite_fts_available));
    if status.roots.is_empty() {
        output.push_str("Roots: none\n");
        return output;
    }
    output.push_str("Roots:\n");
    for root in &status.roots {
        output.push_str(&format!(
            "- {}: {} ({} files, {} dirs, {} content files",
            root.root.display(),
            enum_label(&root.state),
            root.indexed_file_count,
            root.indexed_dir_count,
            root.indexed_content_file_count
        ));
        if let Some(last_indexed_at) = root.last_indexed_at {
            output.push_str(&format!(", lastIndexedAt={last_indexed_at}"));
        }
        if let Some(error) = root.error.as_deref() {
            output.push_str(&format!(
                ", error={}",
                crate::util::truncate_str(error, 240)
            ));
        }
        output.push_str(")\n");
    }
    output
}

fn enum_label<T>(value: &T) -> String
where
    T: Serialize + std::fmt::Debug,
{
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| format!("{value:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn context_for(working_dir: PathBuf) -> ToolContext {
        ToolContext {
            session_id: "test-session".to_string(),
            message_id: "test-message".to_string(),
            tool_call_id: "test-call".to_string(),
            working_dir: Some(working_dir),
            stdin_request_tx: None,
            graceful_shutdown_signal: None,
            execution_mode: super::super::ToolExecutionMode::Direct,
        }
    }

    #[tokio::test]
    async fn search_custom_root_returns_local_content_match() {
        let temp = tempfile::tempdir().expect("tempdir");
        let storage = tempfile::tempdir().expect("storage");
        fs::write(
            temp.path().join("index.html"),
            "<title>NovaTech - smart solutions</title>",
        )
        .expect("write fixture");

        let tool = LyraSearchTool::new();
        let output = tool
            .execute(
                json!({
                    "query": "NovaTech",
                    "scope": "custom",
                    "roots": [temp.path().to_string_lossy()],
                    "storage_root": storage.path().to_string_lossy(),
                    "limit": 5
                }),
                context_for(temp.path().to_path_buf()),
            )
            .await
            .expect("search");

        assert!(output.output.contains("index.html"), "{}", output.output);
        assert!(output.output.contains("NovaTech"), "{}", output.output);
    }

    #[tokio::test]
    async fn workspace_scope_rejects_unbound_filesystem_root() {
        let storage = tempfile::tempdir().expect("storage");
        let tool = LyraSearchTool::new();
        let result = tool
            .execute(
                json!({
                    "query": "anything",
                    "scope": "workspace",
                    "storage_root": storage.path().to_string_lossy()
                }),
                context_for(PathBuf::from("/")),
            )
            .await;

        let error = result.expect_err("workspace root should be rejected");
        assert!(
            error.to_string().contains("workspace scope is unbound"),
            "{error}"
        );
    }

    #[test]
    fn schema_exposes_display_intent() {
        let schema = LyraSearchTool::new().parameters_schema();
        assert_eq!(schema["properties"]["intent"]["type"], "string");
    }

    #[test]
    fn schema_exposes_timeout_budget() {
        let schema = LyraSearchTool::new().parameters_schema();
        assert_eq!(schema["properties"]["timeout_ms"]["type"], "integer");
    }

    #[test]
    fn auto_home_roots_prefers_common_user_folders() {
        let temp = tempfile::tempdir().expect("tempdir");
        let downloads = temp.path().join("Downloads");
        let documents = temp.path().join("Documents");
        fs::create_dir(&downloads).expect("downloads");
        fs::create_dir(&documents).expect("documents");

        let roots = common_home_roots(temp.path());

        assert!(roots.contains(&downloads));
        assert!(roots.contains(&documents));
        assert!(!roots.contains(&temp.path().to_path_buf()));
    }
}
