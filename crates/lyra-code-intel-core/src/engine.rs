//! `CodeGraphEngine` — async thin wrapper over codegraph-server's
//! `Indexer` + `QueryEngine` + `ParserRegistry`.
//!
//! One engine instance serves all projects; each project gets its own
//! in-memory `CodeGraph` + `QueryEngine` pair. Indexing runs in a background
//! tokio task; query methods are async and require the project to have been
//! indexed first.

use std::collections::{HashMap, HashSet, VecDeque};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime};

use codegraph::{CodeGraph, Node, NodeId, NodeType};
use codegraph_server::ai_query::QueryEngine;
use codegraph_server::ai_query::{CallInfo, SearchOptions, SymbolMatch};
use codegraph_server::index_state::IndexState;
use codegraph_server::indexer::{IndexConfig, Indexer};
use codegraph_server::mcp::McpServer;
use codegraph_server::parser_registry::ParserRegistry;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::{Mutex, RwLock};

use crate::context::{ProjectContext, ProjectScopeSummary};
use crate::explore::{ExploreResult, ExploreSymbol, SynthesizedEdge};
use crate::status::IndexStatus;
use crate::watcher::FileWatcher;

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
// Keep the same algorithm here so prompt injection and /tools/codegraph/*
// address the same project namespace.

fn project_slug(root: &Path) -> String {
    let canonical = normalize_project_root(root);
    let name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());
    let base = name
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    canonical.to_string_lossy().as_ref().hash(&mut hasher);
    let hash = hasher.finish();
    format!("{base}-{:04x}", hash & 0xFFFF)
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

/// A file that has changed since the last index but hasn't been re-indexed yet.
/// Fed by the watcher; consumed by `staleness` (O(pending) read, no I/O).
#[derive(Debug, Clone)]
pub struct PendingFile {
    pub first_seen: Instant,
    pub last_seen: Instant,
}

#[derive(Debug, Clone)]
pub(crate) struct ProjectScope {
    files: Vec<PathBuf>,
    file_set: HashSet<String>,
    source: ScopeSource,
    excluded_path_count: usize,
    excluded_path_samples: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScopeSource {
    Git,
    WorkspaceManifest,
    Recursive,
}

impl ScopeSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Git => "git",
            Self::WorkspaceManifest => "workspaceManifest",
            Self::Recursive => "recursive",
        }
    }

    fn strategy(self) -> &'static str {
        match self {
            Self::Git => "tracked files plus structurally project-local untracked files",
            Self::WorkspaceManifest => "workspace manifest roots plus root-level project files",
            Self::Recursive => "recursive fallback under the bound project root",
        }
    }

    fn excluded_reason(self) -> Option<&'static str> {
        match self {
            Self::Git => Some(
                "Excluded indexable paths are Git-untracked paths outside the bound project/workspace structure. This is not directory-name filtering.",
            ),
            Self::WorkspaceManifest => Some(
                "Excluded paths are outside workspace manifest roots. This is not directory-name filtering.",
            ),
            Self::Recursive => None,
        }
    }
}

impl ProjectScope {
    pub(crate) fn discover(root: &Path, parsers: &ParserRegistry, config: &IndexConfig) -> Self {
        if let Some(scope) = git_scope(root, parsers, config) {
            return scope;
        }

        let manifest_roots = workspace_member_roots(root);
        if !manifest_roots.is_empty() {
            let mut files = root_level_indexable_files(root, parsers, config);
            for dir in &manifest_roots {
                files.extend(recursive_indexable_files(dir, parsers, config));
            }
            if !files.is_empty() {
                let (excluded_path_count, excluded_path_samples) =
                    workspace_excluded_paths(root, &manifest_roots);
                return Self::new(
                    files,
                    ScopeSource::WorkspaceManifest,
                    excluded_path_count,
                    excluded_path_samples,
                );
            }
        }

        Self::new(
            recursive_indexable_files(root, parsers, config),
            ScopeSource::Recursive,
            0,
            Vec::new(),
        )
    }

    fn new(
        files: Vec<PathBuf>,
        source: ScopeSource,
        excluded_path_count: usize,
        excluded_path_samples: Vec<String>,
    ) -> Self {
        let mut seen = HashSet::new();
        let mut deduped = Vec::new();
        for path in files {
            let key = normalize_index_path(&path);
            if seen.insert(key) {
                deduped.push(path);
            }
        }
        deduped.sort();
        let file_set = deduped
            .iter()
            .map(|path| normalize_index_path(path))
            .collect::<HashSet<_>>();
        Self {
            files: deduped,
            file_set,
            source,
            excluded_path_count,
            excluded_path_samples,
        }
    }

    pub(crate) fn contains_path_str(&self, path: &str) -> bool {
        self.file_set
            .contains(&normalize_index_path(Path::new(path)))
    }

    fn len(&self) -> usize {
        self.files.len()
    }

    fn summary(&self, root: &Path) -> ProjectScopeSummary {
        ProjectScopeSummary {
            source: self.source.as_str().to_string(),
            strategy: self.source.strategy().to_string(),
            included_file_count: self.files.len() as u64,
            included_samples: self
                .files
                .iter()
                .take(12)
                .map(|path| relative_display(root, path))
                .collect(),
            excluded_path_count: self.excluded_path_count as u64,
            excluded_path_samples: self.excluded_path_samples.clone(),
            excluded_reason: self.source.excluded_reason().map(str::to_string),
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
    watcher: Arc<Mutex<Option<Arc<FileWatcher>>>>,
    pending_files: Arc<Mutex<HashMap<PathBuf, PendingFile>>>,
    scope: Arc<RwLock<ProjectScope>>,
}

#[derive(Debug, Clone, Copy)]
enum IndexMode {
    Refresh,
    Rebuild,
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
    mcp_servers: Mutex<HashMap<PathBuf, Arc<Mutex<McpServer>>>>,
    #[allow(dead_code)]
    storage_root: PathBuf,
    /// Whether the embedding model (BGE-Small / Jina-Code) should be loaded
    /// for semantic symbol search and memory search. Default off — when off,
    /// `run_mcp_tool_sync` creates McpServer with `with_graph_only(true)`.
    /// Controlled at runtime via `set_embeddings_enabled` by the agent-runtime
    /// host callback `agent.readCodeGraphEmbeddingEnabled`.
    embeddings_enabled: Arc<AtomicBool>,
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
            mcp_servers: Mutex::new(HashMap::new()),
            storage_root,
            embeddings_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Enable or disable the embedding model. When enabled, `run_mcp_tool_sync`
    /// creates McpServer without `with_graph_only`, allowing semantic search,
    /// duplicate detection, and memory search tools to work.
    pub fn set_embeddings_enabled(&self, enabled: bool) {
        self.embeddings_enabled.store(enabled, Ordering::Relaxed);
    }

    /// Returns whether embeddings are currently enabled.
    pub fn embeddings_enabled(&self) -> bool {
        self.embeddings_enabled.load(Ordering::Relaxed)
    }

    pub fn supports_source_path(&self, path: &Path) -> bool {
        self.parsers.language_for_path(path).is_some()
    }

    // ── Sync wrappers (for agent-runtime OS-thread tool dispatch) ───────

    pub fn index_project_sync(&self, root: PathBuf) -> Result<(), String> {
        self.runtime.block_on(self.index_project(root))
    }

    pub fn rebuild_project_sync(&self, root: PathBuf) -> Result<(), String> {
        self.runtime.block_on(self.rebuild_project(root))
    }

    pub fn refresh_project_sync(&self, root: PathBuf) -> Result<(), String> {
        self.runtime.block_on(self.refresh_project(root))
    }

    pub fn status_sync(&self, root: &Path) -> IndexStatus {
        self.runtime.block_on(self.status(root))
    }

    pub fn explore_sync(
        &self,
        root: &Path,
        query: &str,
        limit: usize,
    ) -> Result<ExploreResult, String> {
        self.runtime.block_on(self.explore(root, query, limit))
    }

    pub fn search_symbols_sync(
        &self,
        root: &Path,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SymbolMatch>, String> {
        self.runtime
            .block_on(self.search_symbols(root, query, limit))
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

    pub fn run_mcp_tool_sync(
        &self,
        root: &Path,
        tool_name: &str,
        tool_args: Value,
    ) -> Result<Value, String> {
        self.runtime.block_on(async {
            let root = normalize_project_root(root);
            let embeddings = self.embeddings_enabled();
            let server = {
                let mut servers = self.mcp_servers.lock().await;
                if let Some(server) = servers.get(&root) {
                    // If the toggle changed since the server was created, the
                    // server may have a stale graph_only setting. We don't
                    // rebuild the server on toggle change (that would discard
                    // the loaded embedding model); instead the server keeps
                    // its original mode until a re-index clears it.
                    server.clone()
                } else {
                    let config = IndexConfig::default();
                    let scope = ProjectScope::discover(&root, &self.parsers, &config);
                    let server = McpServer::new(
                        vec![root.clone()],
                        Vec::new(),
                        config.max_files,
                        codegraph_memory::CodeGraphEmbeddingModel::BgeSmall,
                        true,
                    )
                    .with_graph_only(!embeddings)
                    .with_scope_files(scope.files);
                    let server = Arc::new(Mutex::new(server));
                    servers.insert(root.clone(), server.clone());
                    server
                }
            };
            let result = server
                .lock()
                .await
                .run_single_tool(tool_name, Some(tool_args))
                .await;
            result
        })
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
        // 竞态 guard：已在索引则直接返回。
        // Ready-from-persist needs a cheap coverage check; old partial DBs can
        // otherwise stay "ready" forever.
        let current = entry.status.read().await.clone();
        match current {
            IndexStatus::Indexing { .. } => return Ok(()),
            IndexStatus::Ready { .. } => {
                let mode = if self.ready_needs_rebuild(&root, &entry).await {
                    IndexMode::Rebuild
                } else {
                    IndexMode::Refresh
                };
                return self.start_index_task(root, entry, mode).await;
            }
            _ => {}
        }
        self.start_index_task(root, entry, IndexMode::Refresh).await
    }

    /// Force a clear-and-reparse rebuild. Returns after spawning the work.
    pub async fn rebuild_project(&self, root: PathBuf) -> Result<(), String> {
        let root = normalize_project_root(&root);
        let entry = self.get_or_create_entry(&root).await?;
        self.start_index_task(root, entry, IndexMode::Rebuild).await
    }

    /// Incrementally scan for new/changed/deleted files. Returns after spawning.
    pub async fn refresh_project(&self, root: PathBuf) -> Result<(), String> {
        let root = normalize_project_root(&root);
        let entry = self.get_or_create_entry(&root).await?;
        self.start_index_task(root, entry, IndexMode::Refresh).await
    }

    async fn start_index_task(
        &self,
        root: PathBuf,
        entry: Arc<ProjectEntry>,
        mode: IndexMode,
    ) -> Result<(), String> {
        if !root.is_dir() {
            let message = format!("Project root is not a directory: {}", root.display());
            *entry.status.write().await = IndexStatus::Failed {
                error: message.clone(),
            };
            return Err(message);
        }
        if matches!(&*entry.status.read().await, IndexStatus::Indexing { .. }) {
            return Ok(());
        }

        *entry.status.write().await = IndexStatus::Indexing { progress: 0.0 };
        let _old_watcher = entry.watcher.lock().await.take();
        self.mcp_servers.lock().await.remove(&root);

        let graph = entry.graph.clone();
        let indexer = entry.indexer.clone();
        let query_engine = entry.query_engine.clone();
        let status = entry.status.clone();
        let last_indexed_at = entry.last_indexed_at.clone();
        let watcher_slot = entry.watcher.clone();
        let pending_files = entry.pending_files.clone();
        let index_state = entry.index_state.clone();
        let parsers = Arc::clone(&self.parsers);
        let config = IndexConfig::default();
        let scope = ProjectScope::discover(&root, &self.parsers, &config);
        *entry.scope.write().await = scope.clone();
        let scope_slot = entry.scope.clone();
        let root_clone = root.clone();

        tokio::spawn(async move {
            if matches!(mode, IndexMode::Rebuild) {
                {
                    let mut g = graph.write().await;
                    if let Err(e) = g.clear() {
                        *status.write().await = IndexStatus::Failed {
                            error: format!("clear graph: {e}"),
                        };
                        return;
                    }
                }
                index_state.lock().await.clear();
                pending_files.lock().await.clear();
            }

            let _result = indexer.index_files(&graph, &scope.files, &config).await;

            {
                let mut g = graph.write().await;
                let current_scope = scope_slot.read().await.clone();
                let removed_paths = prune_out_of_scope_file_nodes(&mut g, &current_scope);
                crate::resolution::run_resolution_pass(&mut g, &root_clone);
                if !removed_paths.is_empty() {
                    let mut state = index_state.lock().await;
                    for path in removed_paths {
                        state.remove(Path::new(&path));
                    }
                    state.save();
                }
            }

            query_engine.build_indexes().await;

            let (file_count, symbol_count) = {
                let g = graph.read().await;
                graph_counts(&g)
            };

            if watcher_slot.lock().await.is_none() {
                match FileWatcher::new(
                    Arc::clone(&graph),
                    parsers,
                    Arc::clone(&query_engine),
                    root_clone,
                    Arc::clone(&status),
                    Arc::clone(&last_indexed_at),
                    Arc::clone(&index_state),
                    Arc::clone(&pending_files),
                    Arc::clone(&scope_slot),
                ) {
                    Ok(fw) => *watcher_slot.lock().await = Some(Arc::new(fw)),
                    Err(e) => {
                        eprintln!("[codegraph] failed to start watcher: {e}");
                    }
                }
            }

            *last_indexed_at.write().await = Some(SystemTime::now());
            *status.write().await = IndexStatus::Ready {
                file_count,
                symbol_count,
            };
            pending_files.lock().await.clear();
        });

        Ok(())
    }

    async fn ready_needs_rebuild(&self, root: &Path, entry: &ProjectEntry) -> bool {
        let config = IndexConfig::default();
        let scope = ProjectScope::discover(root, &self.parsers, &config);
        let source_count = scope.len().min(config.max_files);
        if source_count == 0 {
            return false;
        }
        let (graph_file_count, outside_scope_count) = {
            let graph = entry.graph.read().await;
            let paths = graph_file_paths(&graph);
            (
                paths
                    .iter()
                    .filter(|path| scope.contains_path_str(path))
                    .count(),
                paths
                    .iter()
                    .filter(|path| !scope.contains_path_str(path))
                    .count(),
            )
        };
        if graph_file_count == 0 {
            return true;
        }
        if obviously_smaller(graph_file_count, source_count) {
            return true;
        }
        if outside_scope_count > graph_file_count {
            return true;
        }
        let state_count = entry.index_state.lock().await.len();
        state_count > 0 && obviously_smaller(graph_file_count, state_count)
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

        // Collect synthesized edges (provenance: "heuristic") from the graph.
        let synthesized_edges = {
            let g = entry.graph.read().await;
            collect_synthesized_edges(&g, &search_result.results)
        };

        Ok(ExploreResult {
            query: query.to_string(),
            symbols,
            total_matches: search_result.total_matches,
            elapsed_ms: search_result.query_time_ms,
            synthesized_edges,
        })
    }

    pub async fn search_symbols(
        &self,
        root: &Path,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SymbolMatch>, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        let options = SearchOptions::new().with_limit(limit.clamp(1, 100));
        Ok(entry
            .query_engine
            .symbol_search(query, &options)
            .await
            .results)
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
        let scope = entry.scope.read().await.clone();

        let mut file_paths: HashSet<String> = HashSet::new();
        let mut languages: HashSet<String> = HashSet::new();
        let mut entry_points: Vec<String> = Vec::new();
        let mut symbol_count = 0u64;

        for (_id, node) in graph.iter_nodes() {
            let path = node_path(node);
            if !path.is_empty() {
                if !scope.contains_path_str(&path) {
                    continue;
                }
                file_paths.insert(path);
            }
            symbol_count += 1;
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
            scope: scope.summary(&root),
        })
    }

    /// Detect whether indexed results may be stale relative to the workspace.
    /// Reads the watcher-fed `pending_files` dirty set first (O(pending), no
    /// I/O). Falls back to filesystem mtime scan if the dirty set is empty
    /// (covers changes that happened while the watcher wasn't running).
    pub async fn staleness(&self, root: &Path) -> Result<StalenessInfo, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        if !matches!(&*entry.status.read().await, IndexStatus::Ready { .. }) {
            return Ok(StalenessInfo::fresh(0));
        }

        // Fast path: watcher-fed dirty set.
        {
            let pf = entry.pending_files.lock().await;
            if !pf.is_empty() {
                let changed_files: Vec<String> = pf
                    .keys()
                    .map(|p| {
                        p.strip_prefix(root.as_path())
                            .unwrap_or(p)
                            .to_string_lossy()
                            .to_string()
                    })
                    .take(12)
                    .collect();
                return Ok(StalenessInfo {
                    stale: true,
                    checked_files: pf.len() as u64,
                    changed_files,
                });
            }
        }

        // Fallback: filesystem mtime scan (watcher not running or missed events).
        let Some(indexed_at) = entry.last_indexed_at.read().await.clone() else {
            return Ok(StalenessInfo::fresh(0));
        };
        let supported_extensions = self
            .parsers
            .supported_extensions()
            .into_iter()
            .map(|ext| ext.trim_start_matches('.').to_ascii_lowercase())
            .collect::<HashSet<_>>();
        let scope = entry.scope.read().await.clone();
        Ok(changed_scope_files_since(
            &root,
            &scope,
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
        let scope = ProjectScope::discover(root, &self.parsers, &IndexConfig::default());
        let rocksdb_path = self.storage_root.join(&slug).join("rocksdb");
        std::fs::create_dir_all(&rocksdb_path).map_err(|e| format!("create rocksdb dir: {e}"))?;
        let graph = Arc::new(RwLock::new(
            CodeGraph::open(&rocksdb_path).map_err(|e| format!("rocksdb open: {e}"))?,
        ));
        // CodeGraph::with_backend (called by open) runs rebuild_from_storage
        // automatically. If the DB had data, the graph already has nodes —
        // set status to Ready so we skip re-indexing on restart.
        let has_existing_data = {
            let g = graph.read().await;
            g.iter_nodes().count() > 0
        };
        let initial_status = if has_existing_data {
            let (file_count, symbol_count) = {
                let g = graph.read().await;
                let mut file_paths = HashSet::new();
                let mut symbol_count = 0u64;
                for (_id, node) in g.iter_nodes() {
                    let path = node_path(node);
                    if !path.is_empty() {
                        if !scope.contains_path_str(&path) {
                            continue;
                        }
                        file_paths.insert(path);
                    }
                    symbol_count += 1;
                }
                (file_paths.len() as u64, symbol_count)
            };
            IndexStatus::Ready {
                file_count,
                symbol_count,
            }
        } else {
            IndexStatus::Idle
        };
        let mut state = IndexState::for_workspace(&slug, root);
        let _loaded = state.load();
        let index_state = Arc::new(Mutex::new(state));
        let indexer = Arc::new(Indexer::new(
            Arc::clone(&self.parsers),
            Arc::clone(&index_state),
        ));
        let query_engine = Arc::new(QueryEngine::new(Arc::clone(&graph)));

        let entry = Arc::new(ProjectEntry {
            status: Arc::new(RwLock::new(initial_status)),
            graph,
            query_engine,
            indexer,
            last_indexed_at: Arc::new(RwLock::new(if has_existing_data {
                Some(SystemTime::now())
            } else {
                None
            })),
            index_state,
            watcher: Arc::new(Mutex::new(None)),
            pending_files: Arc::new(Mutex::new(HashMap::new())),
            scope: Arc::new(RwLock::new(scope)),
        });
        projects.insert(root.to_path_buf(), entry.clone());
        Ok(entry)
    }

    async fn get_entry(&self, root: &Path) -> Result<Arc<ProjectEntry>, String> {
        let projects = self.projects.read().await;
        projects.get(root).cloned().ok_or_else(|| {
            format!(
                "Project not indexed: {}. Call index_project first.",
                root.display()
            )
        })
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

fn normalize_index_path(path: &Path) -> String {
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn git_scope(root: &Path, parsers: &ParserRegistry, config: &IndexConfig) -> Option<ProjectScope> {
    let repo_root = git_repo_root(root)?;
    let tracked = git_files(root, false)?;
    if tracked.is_empty() {
        return None;
    }

    let mut tracked_paths = Vec::new();
    let mut tracked_dirs = HashSet::new();
    for rel in tracked {
        let path = repo_root.join(rel);
        if !path.starts_with(root) {
            continue;
        }
        if is_indexable_file(&path, parsers, config) {
            remember_project_ancestors(root, &path, &mut tracked_dirs);
            tracked_paths.push(path);
        }
    }

    let workspace_roots = workspace_member_roots(root)
        .into_iter()
        .filter(|path| path != root)
        .collect::<Vec<_>>();
    let mut files = tracked_paths;
    let mut excluded_path_count = 0usize;
    let mut excluded_path_samples = Vec::new();
    for rel in git_files(root, true).unwrap_or_default() {
        let path = repo_root.join(rel);
        if !path.starts_with(root) || !is_indexable_file(&path, parsers, config) {
            continue;
        }
        let parent_is_root = path.parent() == Some(root);
        if parent_is_root
            || is_under_any(&path, &workspace_roots)
            || is_under_any_set(&path, &tracked_dirs)
        {
            files.push(path);
        } else {
            excluded_path_count += 1;
            if excluded_path_samples.len() < 12 {
                excluded_path_samples.push(relative_display(root, &path));
            }
        }
    }

    (!files.is_empty()).then(|| {
        ProjectScope::new(
            files,
            ScopeSource::Git,
            excluded_path_count,
            excluded_path_samples,
        )
    })
}

fn git_repo_root(root: &Path) -> Option<PathBuf> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!path.is_empty()).then(|| normalize_project_root(Path::new(&path)))
}

fn git_files(root: &Path, untracked: bool) -> Option<Vec<PathBuf>> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .arg("ls-files")
        .arg("--full-name");
    if untracked {
        command.arg("-o").arg("--exclude-standard");
    }
    command.arg("-z");
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(
        output
            .stdout
            .split(|byte| *byte == 0)
            .filter(|bytes| !bytes.is_empty())
            .map(|bytes| PathBuf::from(String::from_utf8_lossy(bytes).to_string()))
            .collect(),
    )
}

fn remember_project_ancestors(root: &Path, file: &Path, dirs: &mut HashSet<PathBuf>) {
    let mut current = file.parent();
    while let Some(dir) = current {
        if dir == root {
            break;
        }
        dirs.insert(dir.to_path_buf());
        current = dir.parent();
    }
}

fn is_under_any(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

fn is_under_any_set(path: &Path, roots: &HashSet<PathBuf>) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

fn workspace_member_roots(root: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    roots.extend(cargo_workspace_roots(root));
    roots.extend(pnpm_workspace_roots(root));
    roots.extend(package_workspace_roots(root));
    dedupe_existing_dirs(root, roots)
}

fn cargo_workspace_roots(root: &Path) -> Vec<PathBuf> {
    let manifest = root.join("Cargo.toml");
    let Ok(content) = std::fs::read_to_string(manifest) else {
        return Vec::new();
    };
    let mut in_members = false;
    let mut roots = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("members") && trimmed.contains('[') {
            in_members = true;
        }
        if in_members {
            roots.extend(
                quoted_values(trimmed)
                    .into_iter()
                    .flat_map(|value| expand_workspace_pattern(root, &value)),
            );
            if trimmed.contains(']') {
                in_members = false;
            }
        }
    }
    roots
}

fn pnpm_workspace_roots(root: &Path) -> Vec<PathBuf> {
    let manifest = root.join("pnpm-workspace.yaml");
    let Ok(content) = std::fs::read_to_string(manifest) else {
        return Vec::new();
    };
    content
        .lines()
        .filter_map(|line| line.trim().strip_prefix("- "))
        .map(|value| value.trim().trim_matches('"').trim_matches('\''))
        .filter(|value| !value.starts_with('!'))
        .flat_map(|value| expand_workspace_pattern(root, value))
        .collect()
}

fn package_workspace_roots(root: &Path) -> Vec<PathBuf> {
    let manifest = root.join("package.json");
    let Ok(content) = std::fs::read_to_string(manifest) else {
        return Vec::new();
    };
    let Ok(json) = serde_json::from_str::<Value>(&content) else {
        return Vec::new();
    };
    let mut patterns = Vec::new();
    match json.get("workspaces") {
        Some(Value::Array(values)) => {
            patterns.extend(values.iter().filter_map(Value::as_str).map(str::to_string));
        }
        Some(Value::Object(map)) => {
            if let Some(Value::Array(values)) = map.get("packages") {
                patterns.extend(values.iter().filter_map(Value::as_str).map(str::to_string));
            }
        }
        _ => {}
    }
    patterns
        .into_iter()
        .filter(|value| !value.starts_with('!'))
        .flat_map(|value| expand_workspace_pattern(root, &value))
        .collect()
}

fn quoted_values(line: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut chars = line.chars();
    while let Some(ch) = chars.next() {
        if ch != '"' && ch != '\'' {
            continue;
        }
        let quote = ch;
        let mut value = String::new();
        for next in chars.by_ref() {
            if next == quote {
                break;
            }
            value.push(next);
        }
        if !value.is_empty() {
            values.push(value);
        }
    }
    values
}

fn expand_workspace_pattern(root: &Path, pattern: &str) -> Vec<PathBuf> {
    if pattern.contains('*') {
        let pattern = root.join(pattern).to_string_lossy().to_string();
        return glob::glob(&pattern)
            .ok()
            .into_iter()
            .flat_map(|paths| paths.flatten())
            .collect();
    }
    vec![root.join(pattern)]
}

fn dedupe_existing_dirs(root: &Path, roots: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for path in roots {
        let path = normalize_project_root(&path);
        if path.is_dir() && path.starts_with(root) && seen.insert(normalize_index_path(&path)) {
            out.push(path);
        }
    }
    out
}

fn workspace_excluded_paths(root: &Path, workspace_roots: &[PathBuf]) -> (usize, Vec<String>) {
    let mut count = 0usize;
    let mut samples = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return (0, Vec::new());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with('.') || workspace_roots.iter().any(|dir| dir == &path) {
            continue;
        }
        if path.is_dir() {
            count += 1;
            if samples.len() < 12 {
                samples.push(format!("{}/", relative_display(root, &path)));
            }
        }
    }
    (count, samples)
}

fn relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn root_level_indexable_files(
    root: &Path,
    parsers: &ParserRegistry,
    config: &IndexConfig,
) -> Vec<PathBuf> {
    std::fs::read_dir(root)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .map(|entry| entry.path())
        .filter(|path| path.is_file() && is_indexable_file(path, parsers, config))
        .collect()
}

fn recursive_indexable_files(
    root: &Path,
    parsers: &ParserRegistry,
    config: &IndexConfig,
) -> Vec<PathBuf> {
    let exclude_dirs = config.exclude_dirs.iter().cloned().collect::<HashSet<_>>();
    let mut queue = VecDeque::from([(root.to_path_buf(), 0u32)]);
    let mut files = Vec::new();

    while let Some((dir, depth)) = queue.pop_front() {
        if depth > config.max_depth || files.len() >= config.max_files {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            if files.len() >= config.max_files {
                break;
            }
            let path = entry.path();
            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if file_name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                if exclude_dirs.contains(file_name) || is_generated_parser_dir(file_name) {
                    continue;
                }
                queue.push_back((path, depth + 1));
            } else if is_indexable_file(&path, parsers, config) {
                files.push(path);
            }
        }
    }

    files
}

fn is_indexable_file(path: &Path, parsers: &ParserRegistry, config: &IndexConfig) -> bool {
    path.is_file()
        && parsers.can_parse(path)
        && std::fs::metadata(path)
            .map(|metadata| metadata.len() <= config.max_file_size_bytes)
            .unwrap_or(false)
}

fn graph_counts(graph: &CodeGraph) -> (u64, u64) {
    (
        graph_file_paths(graph).len() as u64,
        graph.iter_nodes().count() as u64,
    )
}

fn graph_file_paths(graph: &CodeGraph) -> HashSet<String> {
    graph
        .iter_nodes()
        .filter_map(|(_id, node)| {
            let path = node_path(node);
            (!path.is_empty()).then_some(path)
        })
        .collect()
}

fn prune_out_of_scope_file_nodes(graph: &mut CodeGraph, scope: &ProjectScope) -> Vec<String> {
    let removed_paths = graph_file_paths(graph)
        .into_iter()
        .filter(|path| !Path::new(path).is_file() || !scope.contains_path_str(path))
        .collect::<Vec<_>>();
    for path in &removed_paths {
        if let Ok(nodes) = graph.query().property("path", path.as_str()).execute() {
            for node_id in nodes {
                let _ = graph.delete_node(node_id);
            }
        }
    }
    removed_paths
}

fn obviously_smaller(indexed: usize, expected: usize) -> bool {
    expected > indexed + 1 && indexed.saturating_mul(2) < expected
}

fn is_generated_parser_dir(name: &str) -> bool {
    name.starts_with("tree-sitter-") && name.ends_with("-src")
}

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
    let has_language = |language: &str| {
        languages
            .iter()
            .any(|value| value.eq_ignore_ascii_case(language))
    };
    let mut frameworks = Vec::new();

    let mut push = |name: &str, detected: bool| {
        if detected {
            frameworks.push(name.to_string());
        }
    };

    push("React", has_ext(".tsx") || has_ext(".jsx"));
    push(
        "Express",
        has_path("/routes/") && has_language("javascript"),
    );
    push(
        "NestJS",
        has_path(".controller.ts") || has_path("nest-cli.json"),
    );
    push(
        "Laravel",
        has_path("/app/http/controllers/")
            || has_path("/routes/web.php")
            || has_path("/routes/api.php"),
    );
    push(
        "Django",
        has_path("manage.py") || has_path("/urls.py") || has_path("/settings.py"),
    );
    push("Flask", has_path("flask") || has_path("/app.py"));
    push(
        "FastAPI",
        has_path("fastapi") || has_path("/api/") && has_language("python"),
    );
    push(
        "Rails",
        has_path("/config/routes.rb") || has_path("/app/controllers/"),
    );
    push(
        "Spring",
        has_path("/src/main/java/") && has_path("controller"),
    );
    push(
        "Play",
        has_path("/conf/routes") || has_path("/app/controllers/") && has_language("scala"),
    );
    push(
        "Gin",
        has_language("go") && (has_path("/router") || has_path("/routes") || has_path("/handler")),
    );
    push(
        "GoFrame",
        has_path("goframe") || has_path("/internal/controller/"),
    );
    push(
        "ASP.NET",
        has_ext(".csproj") || has_path("/controllers/") && has_language("csharp"),
    );
    push(
        "Vapor",
        has_language("swift") && (has_path("/routes.swift") || has_path("/sources/app/")),
    );
    push(
        "Drupal",
        has_ext(".module") || has_ext(".theme") || has_path("/drupal"),
    );
    push(
        "React Native",
        has_path("/android/") && has_path("/ios/") && (has_ext(".tsx") || has_ext(".jsx")),
    );
    push(
        "Expo",
        has_path("app.json") && (has_path("/app/") || has_path("expo")),
    );

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
    let has_language = |language: &str| {
        languages
            .iter()
            .any(|value| value.eq_ignore_ascii_case(language))
    };
    let has_path = |needle: &str| lower_paths.iter().any(|path| path.contains(needle));
    let mut bridges = Vec::new();

    if has_language("swift") && (has_language("objc") || has_path(".m") || has_path(".mm")) {
        bridges.push("Swift ↔ ObjC".to_string());
    }
    if frameworks
        .iter()
        .any(|framework| framework == "React Native" || framework == "Expo")
    {
        bridges.push("React Native JS ↔ native".to_string());
    }

    bridges
}

fn describe_architecture(
    key_modules: &[String],
    frameworks: &[String],
    bridges: &[String],
) -> Option<String> {
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

fn changed_scope_files_since(
    root: &Path,
    scope: &ProjectScope,
    since: SystemTime,
    supported_extensions: &HashSet<String>,
    limit: usize,
) -> StalenessInfo {
    let mut changed_files = Vec::new();
    let mut checked_files = 0u64;

    for path in &scope.files {
        if !is_supported_source_path(path, supported_extensions) {
            continue;
        }
        checked_files += 1;
        let modified_after_index = std::fs::metadata(path)
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

/// Collect synthesized edges (edges with `provenance: "heuristic"`) that are
/// connected to any of the search result nodes. Returns at most 50 edges.
fn collect_synthesized_edges(
    graph: &codegraph::CodeGraph,
    results: &[codegraph_server::ai_query::SymbolMatch],
) -> Vec<SynthesizedEdge> {
    let result_ids: HashSet<NodeId> = results.iter().map(|m| m.node_id).collect();
    let mut edges = Vec::new();
    for (_eid, edge) in graph.iter_edges() {
        let is_synthesized = edge
            .properties
            .get_string("provenance")
            .map(|p| p == "heuristic")
            .unwrap_or(false);
        if !is_synthesized {
            continue;
        }
        // Only include edges connected to search results.
        if !result_ids.contains(&edge.source_id) && !result_ids.contains(&edge.target_id) {
            continue;
        }
        let from_name = graph
            .get_node(edge.source_id)
            .map(|n| node_name(n))
            .unwrap_or_default();
        let to_name = graph
            .get_node(edge.target_id)
            .map(|n| node_name(n))
            .unwrap_or_default();
        let synthesized_by = edge
            .properties
            .get_string("synthesizedBy")
            .unwrap_or("")
            .to_string();
        edges.push(SynthesizedEdge {
            from_node_id: edge.source_id,
            to_node_id: edge.target_id,
            edge_type: edge.edge_type.to_string(),
            from_name,
            to_name,
            synthesized_by,
        });
        if edges.len() >= 50 {
            break;
        }
    }
    edges
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_slug_sanitizes() {
        let slug = project_slug(Path::new("/Users/foo/My Project!"));
        assert!(slug
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_'));
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
