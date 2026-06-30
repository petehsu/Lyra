//! `CodeGraphEngine` — async thin wrapper over codegraph-server's
//! `Indexer` + `QueryEngine` + `ParserRegistry`.
//!
//! One engine instance serves all projects; each project gets its own
//! in-memory `CodeGraph` + `QueryEngine` pair. Indexing runs in a background
//! tokio task; query methods are async and require the project to have been
//! indexed first.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use codegraph::{CodeGraph, Node, NodeId, NodeType};
use codegraph_server::ai_query::{CallInfo, SearchOptions};
use codegraph_server::ai_query::QueryEngine;
use codegraph_server::indexer::{IndexConfig, Indexer};
use codegraph_server::index_state::IndexState;
use codegraph_server::parser_registry::ParserRegistry;
use serde::Serialize;
use tokio::sync::{Mutex, RwLock};

use crate::context::ProjectContext;
use crate::explore::{ExploreResult, ExploreSymbol};
use crate::status::IndexStatus;

// ── Inline property accessors ─────────────────────────────────────────
// codegraph-server's `domain::node_props` module is `pub(crate)`, so we
// replicate the canonical accessors here. Upgrade path: ask upstream to
// make `node_props` pub, then delete these.

fn node_name(node: &Node) -> String {
    node.properties.get_string("name").unwrap_or("").to_string()
}

fn node_path(node: &Node) -> String {
    node.properties.get_string("path").unwrap_or("").to_string()
}

fn node_language(node: &Node) -> Option<String> {
    node.properties.get_string("language").map(str::to_string)
}

// ── Slug ──────────────────────────────────────────────────────────────
// ponytail: codegraph-server's `memory::project_slug` is `pub(crate)`.
// We replicate a sanitized-dirname approach. This slug drives IndexState
// file paths only (not RocksDB persistence in this MVP). Upgrade path:
// ask upstream to make `project_slug` pub.

fn project_slug(root: &Path) -> String {
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .to_lowercase()
}

fn normalize_project_root(root: &Path) -> PathBuf {
    root.canonicalize().unwrap_or_else(|_| root.to_path_buf())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StalenessInfo {
    pub stale: bool,
    pub changed_files: Vec<String>,
    pub checked_files: u64,
}

impl StalenessInfo {
    fn fresh(checked_files: u64) -> Self {
        Self {
            stale: false,
            changed_files: Vec::new(),
            checked_files,
        }
    }
}

// ── Entry per project ─────────────────────────────────────────────────

struct ProjectEntry {
    status: Arc<RwLock<IndexStatus>>,
    graph: Arc<RwLock<CodeGraph>>,
    query_engine: Arc<QueryEngine>,
    indexer: Arc<Indexer>,
    last_indexed_at: Arc<RwLock<Option<SystemTime>>>,
    #[allow(dead_code)]
    index_state: Arc<Mutex<IndexState>>,
}

/// One engine serves all projects. Each project gets its own graph +
/// query engine; the parser registry (38 languages, heavy) is shared.
///
/// The embedded `runtime` lets the engine be driven from **synchronous**
/// call sites (agent-runtime native tools run on OS threads, not in a
/// tokio context). All async methods are exposed via `*_sync` wrappers
/// that call `runtime.block_on(...)`.
pub struct CodeGraphEngine {
    runtime: tokio::runtime::Runtime,
    parsers: Arc<ParserRegistry>,
    projects: RwLock<HashMap<PathBuf, Arc<ProjectEntry>>>,
    #[allow(dead_code)]
    storage_root: PathBuf,
}

impl CodeGraphEngine {
    pub fn new(storage_root: PathBuf) -> Self {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .thread_name("codegraph")
            .build()
            .expect("failed to create codegraph tokio runtime");
        Self {
            runtime,
            parsers: Arc::new(ParserRegistry::new()),
            projects: RwLock::new(HashMap::new()),
            storage_root,
        }
    }

    // ── Sync wrappers (for agent-runtime OS-thread tool dispatch) ───────

    pub fn index_project_sync(&self, root: PathBuf) -> Result<(), String> {
        self.runtime.block_on(self.index_project(root))
    }

    pub fn status_sync(&self, root: &Path) -> IndexStatus {
        self.runtime.block_on(self.status(root))
    }

    pub fn explore_sync(&self, root: &Path, query: &str, limit: usize) -> Result<ExploreResult, String> {
        self.runtime.block_on(self.explore(root, query, limit))
    }

    pub fn callers_sync(
        &self,
        root: &Path,
        symbol: &str,
        depth: u32,
        limit: usize,
    ) -> Result<Vec<CallInfo>, String> {
        self.runtime
            .block_on(self.callers(root, symbol, depth, limit))
    }

    pub fn callees_sync(
        &self,
        root: &Path,
        symbol: &str,
        depth: u32,
        limit: usize,
    ) -> Result<Vec<CallInfo>, String> {
        self.runtime
            .block_on(self.callees(root, symbol, depth, limit))
    }

    pub fn impact_sync(
        &self,
        root: &Path,
        symbol: &str,
        depth: u32,
        limit: usize,
    ) -> Result<Vec<CallInfo>, String> {
        self.runtime
            .block_on(self.impact(root, symbol, depth, limit))
    }

    pub fn project_context_sync(&self, root: &Path) -> Result<ProjectContext, String> {
        self.runtime.block_on(self.project_context(root))
    }

    pub fn staleness_sync(&self, root: &Path) -> Result<StalenessInfo, String> {
        self.runtime.block_on(self.staleness(root))
    }

    // ── Indexing ──────────────────────────────────────────────────────

    /// Kick off background indexing for `root`. Returns immediately;
    /// the indexing task runs in a spawned tokio task.
    pub async fn index_project(&self, root: PathBuf) -> Result<(), String> {
        let root = normalize_project_root(&root);
        let entry = self.get_or_create_entry(&root).await?;
        if !root.is_dir() {
            let message = format!("Project root is not a directory: {}", root.display());
            *entry.status.write().await = IndexStatus::Failed {
                error: message.clone(),
            };
            return Err(message);
        }
        *entry.status.write().await = IndexStatus::Indexing { progress: 0.0 };

        let graph = entry.graph.clone();
        let indexer = entry.indexer.clone();
        let query_engine = entry.query_engine.clone();
        let status = entry.status.clone();
        let last_indexed_at = entry.last_indexed_at.clone();
        let root_clone = root.clone();

        tokio::spawn(async move {
            let result = indexer
                .index_workspace(&graph, &[root_clone.clone()], &IndexConfig::default())
                .await;

            // Build caller/callee/text indexes from the freshly parsed graph.
            query_engine.build_indexes().await;

            // Count symbols for the Ready status.
            let symbol_count = {
                let g = graph.read().await;
                g.iter_nodes().count() as u64
            };

            *last_indexed_at.write().await = Some(SystemTime::now());
            *status.write().await = IndexStatus::Ready {
                file_count: result.total_files as u64,
                symbol_count,
            };
        });

        Ok(())
    }

    // ── Queries ───────────────────────────────────────────────────────

    /// Current index status for a project. Returns `Idle` if the project
    /// has never been indexed.
    pub async fn status(&self, root: &Path) -> IndexStatus {
        let root = normalize_project_root(root);
        let projects = self.projects.read().await;
        match projects.get(root.as_path()) {
            Some(entry) => entry.status.read().await.clone(),
            None => IndexStatus::Idle,
        }
    }

    /// Unified explore: one call returns matching symbols + their direct
    /// callers/callees. This is the primary tool for the agent.
    pub async fn explore(
        &self,
        root: &Path,
        query: &str,
        limit: usize,
    ) -> Result<ExploreResult, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        let options = SearchOptions::new().with_limit(limit.clamp(1, 50));
        let search_result = entry.query_engine.symbol_search(query, &options).await;

        let mut symbols = Vec::with_capacity(search_result.results.len());
        for m in &search_result.results {
            let detail = entry.query_engine.get_symbol_info(m.node_id).await;
            let (callers, callees) = match detail {
                Some(d) => (d.callers, d.callees),
                None => (Vec::new(), Vec::new()),
            };
            symbols.push(ExploreSymbol {
                symbol: m.symbol.clone(),
                score: m.score,
                match_reason: m.match_reason.clone(),
                callers,
                callees,
            });
        }

        Ok(ExploreResult {
            query: query.to_string(),
            symbols,
            total_matches: search_result.total_matches,
            elapsed_ms: search_result.query_time_ms,
        })
    }

    /// Find all functions that call the given symbol (by name).
    pub async fn callers(
        &self,
        root: &Path,
        symbol: &str,
        depth: u32,
        limit: usize,
    ) -> Result<Vec<CallInfo>, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        let node_id = self.find_symbol(&entry, symbol).await?;
        let mut callers = entry
            .query_engine
            .get_callers(node_id, depth.clamp(1, 4))
            .await;
        callers.truncate(limit.clamp(1, 100));
        Ok(callers)
    }

    /// Find all functions called by the given symbol (by name).
    pub async fn callees(
        &self,
        root: &Path,
        symbol: &str,
        depth: u32,
        limit: usize,
    ) -> Result<Vec<CallInfo>, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        let node_id = self.find_symbol(&entry, symbol).await?;
        let mut callees = entry
            .query_engine
            .get_callees(node_id, depth.clamp(1, 4))
            .await;
        callees.truncate(limit.clamp(1, 100));
        Ok(callees)
    }

    /// Analyze the blast radius of changing a symbol.
    /// ponytail: MVP returns upstream callers. Full impact analysis
    /// (codegraph-server's domain::impact) is Phase 6. Upgrade path: call
    /// `domain::impact::analyze_impact` once it's exposed as pub.
    pub async fn impact(
        &self,
        root: &Path,
        symbol: &str,
        depth: u32,
        limit: usize,
    ) -> Result<Vec<CallInfo>, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        let node_id = self.find_symbol(&entry, symbol).await?;
        let mut callers = entry
            .query_engine
            .get_callers(node_id, depth.clamp(1, 4))
            .await;
        callers.truncate(limit.clamp(1, 100));
        Ok(callers)
    }

    /// Generate a project overview from the graph for prompt injection.
    pub async fn project_context(&self, root: &Path) -> Result<ProjectContext, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        let status = entry.status.read().await.clone();
        let graph = entry.graph.read().await;

        let mut file_paths: HashSet<String> = HashSet::new();
        let mut languages: HashSet<String> = HashSet::new();
        let mut entry_points: Vec<String> = Vec::new();
        let mut symbol_count = 0u64;

        for (_id, node) in graph.iter_nodes() {
            symbol_count += 1;
            let path = node_path(node);
            if !path.is_empty() {
                file_paths.insert(path);
            }
            if let Some(lang) = node_language(node) {
                languages.insert(lang);
            }
            let name = node_name(node);
            if is_entry_point(&name, &node.node_type) {
                entry_points.push(name);
            }
        }

        let key_modules = extract_top_dirs(&file_paths, &root);
        let frameworks = detect_frameworks(&file_paths, &languages);
        let bridges = detect_cross_language_bridges(&file_paths, &languages, &frameworks);
        let architecture = describe_architecture(&key_modules, &frameworks, &bridges);

        Ok(ProjectContext {
            status,
            file_count: file_paths.len() as u64,
            symbol_count,
            entry_points: entry_points.into_iter().take(20).collect(),
            key_modules,
            languages: languages.into_iter().collect(),
            frameworks,
            bridges,
            architecture,
        })
    }

    /// Detect whether indexed results may be stale relative to the workspace.
    /// ponytail: this intentionally scans source mtimes at query time instead of
    /// adding a watcher. Ceiling: O(project files) per codegraph tool call;
    /// upgrade path is a watcher-fed dirty set in `ProjectEntry`.
    pub async fn staleness(&self, root: &Path) -> Result<StalenessInfo, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        if !matches!(&*entry.status.read().await, IndexStatus::Ready { .. }) {
            return Ok(StalenessInfo::fresh(0));
        }
        let Some(indexed_at) = entry.last_indexed_at.read().await.clone() else {
            return Ok(StalenessInfo::fresh(0));
        };
        let supported_extensions = self
            .parsers
            .supported_extensions()
            .into_iter()
            .map(|ext| ext.trim_start_matches('.').to_ascii_lowercase())
            .collect::<HashSet<_>>();
        Ok(changed_files_since(
            &root,
            indexed_at,
            &supported_extensions,
            12,
        ))
    }

    // ── Internal helpers ──────────────────────────────────────────────

    async fn get_or_create_entry(&self, root: &Path) -> Result<Arc<ProjectEntry>, String> {
        // Fast path: already exists.
        {
            let projects = self.projects.read().await;
            if let Some(entry) = projects.get(root) {
                return Ok(entry.clone());
            }
        }
        // Slow path: create new entry under write lock.
        let mut projects = self.projects.write().await;
        // Double-check: another task may have created it while we waited.
        if let Some(entry) = projects.get(root) {
            return Ok(entry.clone());
        }

        let slug = project_slug(root);
        let graph = Arc::new(RwLock::new(
            CodeGraph::in_memory().map_err(|e| format!("in-memory graph: {e}"))?,
        ));
        let mut state = IndexState::for_workspace(&slug, root);
        let _loaded = state.load();
        let index_state = Arc::new(Mutex::new(state));
        let indexer = Arc::new(Indexer::new(
            Arc::clone(&self.parsers),
            Arc::clone(&index_state),
        ));
        let query_engine = Arc::new(QueryEngine::new(Arc::clone(&graph)));

        let entry = Arc::new(ProjectEntry {
            status: Arc::new(RwLock::new(IndexStatus::Idle)),
            graph,
            query_engine,
            indexer,
            last_indexed_at: Arc::new(RwLock::new(None)),
            index_state,
        });
        projects.insert(root.to_path_buf(), entry.clone());
        Ok(entry)
    }

    async fn get_entry(&self, root: &Path) -> Result<Arc<ProjectEntry>, String> {
        let projects = self.projects.read().await;
        projects
            .get(root)
            .cloned()
            .ok_or_else(|| format!("Project not indexed: {}. Call index_project first.", root.display()))
    }

    async fn find_symbol(&self, entry: &ProjectEntry, name: &str) -> Result<NodeId, String> {
        let options = SearchOptions::new().with_limit(1);
        let result = entry.query_engine.symbol_search(name, &options).await;
        result
            .results
            .into_iter()
            .map(|m| m.node_id)
            .next()
            .ok_or_else(|| format!("Symbol not found: {name}"))
    }
}

// ── Free helpers ───────────────────────────────────────────────────────

fn is_entry_point(name: &str, node_type: &NodeType) -> bool {
    if !matches!(node_type, NodeType::Function) {
        return false;
    }
    matches!(
        name,
        "main" | "main()" | "run" | "start" | "app" | "handler" | "listen"
    ) || name.starts_with("route_")
        || name.starts_with("handle_")
}

fn extract_top_dirs(paths: &HashSet<String>, root: &Path) -> Vec<String> {
    let root_str = root.to_string_lossy();
    let mut dirs: HashSet<String> = HashSet::new();
    for path in paths {
        if let Some(rest) = path.strip_prefix(root_str.as_ref()) {
            let rest = rest.trim_start_matches('/');
            let mut parts = rest.split('/');
            if let Some(first) = parts.next() {
                if !first.is_empty() && parts.next().is_some() {
                    dirs.insert(first.to_string());
                }
            }
        }
    }
    dirs.into_iter().take(10).collect()
}

fn detect_frameworks(paths: &HashSet<String>, languages: &HashSet<String>) -> Vec<String> {
    let lower_paths = paths
        .iter()
        .map(|path| path.replace('\\', "/").to_ascii_lowercase())
        .collect::<Vec<_>>();
    let has_path = |needle: &str| lower_paths.iter().any(|path| path.contains(needle));
    let has_ext = |ext: &str| lower_paths.iter().any(|path| path.ends_with(ext));
    let has_language = |language: &str| languages.iter().any(|value| value.eq_ignore_ascii_case(language));
    let mut frameworks = Vec::new();

    let mut push = |name: &str, detected: bool| {
        if detected {
            frameworks.push(name.to_string());
        }
    };

    push("React", has_ext(".tsx") || has_ext(".jsx"));
    push("Express", has_path("/routes/") && has_language("javascript"));
    push("NestJS", has_path(".controller.ts") || has_path("nest-cli.json"));
    push("Laravel", has_path("/app/http/controllers/") || has_path("/routes/web.php") || has_path("/routes/api.php"));
    push("Django", has_path("manage.py") || has_path("/urls.py") || has_path("/settings.py"));
    push("Flask", has_path("flask") || has_path("/app.py"));
    push("FastAPI", has_path("fastapi") || has_path("/api/") && has_language("python"));
    push("Rails", has_path("/config/routes.rb") || has_path("/app/controllers/"));
    push("Spring", has_path("/src/main/java/") && has_path("controller"));
    push("Play", has_path("/conf/routes") || has_path("/app/controllers/") && has_language("scala"));
    push("Gin", has_language("go") && (has_path("/router") || has_path("/routes") || has_path("/handler")));
    push("GoFrame", has_path("goframe") || has_path("/internal/controller/"));
    push("ASP.NET", has_ext(".csproj") || has_path("/controllers/") && has_language("csharp"));
    push("Vapor", has_language("swift") && (has_path("/routes.swift") || has_path("/sources/app/")));
    push("Drupal", has_ext(".module") || has_ext(".theme") || has_path("/drupal"));
    push("React Native", has_path("/android/") && has_path("/ios/") && (has_ext(".tsx") || has_ext(".jsx")));
    push("Expo", has_path("app.json") && (has_path("/app/") || has_path("expo")));

    frameworks.sort();
    frameworks.dedup();
    frameworks
}

fn detect_cross_language_bridges(
    paths: &HashSet<String>,
    languages: &HashSet<String>,
    frameworks: &[String],
) -> Vec<String> {
    let lower_paths = paths
        .iter()
        .map(|path| path.replace('\\', "/").to_ascii_lowercase())
        .collect::<Vec<_>>();
    let has_language = |language: &str| languages.iter().any(|value| value.eq_ignore_ascii_case(language));
    let has_path = |needle: &str| lower_paths.iter().any(|path| path.contains(needle));
    let mut bridges = Vec::new();

    if has_language("swift") && (has_language("objc") || has_path(".m") || has_path(".mm")) {
        bridges.push("Swift ↔ ObjC".to_string());
    }
    if frameworks.iter().any(|framework| framework == "React Native" || framework == "Expo") {
        bridges.push("React Native JS ↔ native".to_string());
    }

    bridges
}

fn describe_architecture(key_modules: &[String], frameworks: &[String], bridges: &[String]) -> Option<String> {
    if frameworks.is_empty() && key_modules.is_empty() && bridges.is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    if !frameworks.is_empty() {
        parts.push(format!("frameworks: {}", frameworks.join(", ")));
    }
    if !key_modules.is_empty() {
        parts.push(format!("modules: {}", key_modules.join(", ")));
    }
    if !bridges.is_empty() {
        parts.push(format!("bridges: {}", bridges.join(", ")));
    }
    Some(parts.join("; "))
}

fn changed_files_since(
    root: &Path,
    since: SystemTime,
    supported_extensions: &HashSet<String>,
    limit: usize,
) -> StalenessInfo {
    let mut queue = VecDeque::from([root.to_path_buf()]);
    let mut changed_files = Vec::new();
    let mut checked_files = 0u64;
    let exclude_dirs = IndexConfig::default()
        .exclude_dirs
        .into_iter()
        .collect::<HashSet<_>>();

    while let Some(dir) = queue.pop_front() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if path.is_dir() {
                if file_name.starts_with('.') || exclude_dirs.contains(file_name) {
                    continue;
                }
                queue.push_back(path);
                continue;
            }
            if !is_supported_source_path(&path, supported_extensions) {
                continue;
            }
            checked_files += 1;
            let modified_after_index = std::fs::metadata(&path)
                .and_then(|metadata| metadata.modified())
                .map(|modified| modified > since)
                .unwrap_or(false);
            if modified_after_index {
                changed_files.push(
                    path.strip_prefix(root)
                        .unwrap_or(path.as_path())
                        .to_string_lossy()
                        .to_string(),
                );
                if changed_files.len() >= limit {
                    return StalenessInfo {
                        stale: true,
                        changed_files,
                        checked_files,
                    };
                }
            }
        }
    }

    StalenessInfo {
        stale: !changed_files.is_empty(),
        changed_files,
        checked_files,
    }
}

fn is_supported_source_path(path: &Path, supported_extensions: &HashSet<String>) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| supported_extensions.contains(&ext.to_ascii_lowercase()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_slug_sanitizes() {
        let slug = project_slug(Path::new("/Users/foo/My Project!"));
        assert!(slug.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
        assert!(slug.contains("my"));
    }

    #[test]
    fn is_entry_point_detects_main() {
        assert!(is_entry_point("main", &NodeType::Function));
        assert!(!is_entry_point("helper", &NodeType::Function));
        assert!(!is_entry_point("main", &NodeType::Class));
    }

    #[test]
    fn extract_top_dirs_finds_modules() {
        let mut paths = HashSet::new();
        paths.insert("/root/src/auth/login.rs".to_string());
        paths.insert("/root/src/auth/logout.rs".to_string());
        paths.insert("/root/src/api/routes.rs".to_string());
        let dirs = extract_top_dirs(&paths, Path::new("/root/src"));
        assert!(dirs.contains(&"auth".to_string()));
        assert!(dirs.contains(&"api".to_string()));
    }

    #[test]
    fn detect_frameworks_and_bridges_from_paths() {
        let paths = HashSet::from([
            "/app/src/App.tsx".to_string(),
            "/app/android/app/build.gradle".to_string(),
            "/app/ios/AppDelegate.swift".to_string(),
            "/app/ios/LegacyBridge.m".to_string(),
        ]);
        let languages = HashSet::from([
            "typescript".to_string(),
            "swift".to_string(),
            "objc".to_string(),
        ]);
        let frameworks = detect_frameworks(&paths, &languages);
        let bridges = detect_cross_language_bridges(&paths, &languages, &frameworks);

        assert!(frameworks.contains(&"React".to_string()));
        assert!(frameworks.contains(&"React Native".to_string()));
        assert!(bridges.contains(&"Swift ↔ ObjC".to_string()));
        assert!(bridges.contains(&"React Native JS ↔ native".to_string()));
    }
}