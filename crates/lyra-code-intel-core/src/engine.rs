//! `CodeGraphEngine` — async thin wrapper over codegraph-server's
//! `Indexer` + `QueryEngine` + `ParserRegistry`.
//!
//! One engine instance serves all projects; each project gets its own
//! in-memory `CodeGraph` + `QueryEngine` pair. Indexing runs in a background
//! tokio task; query methods are async and require the project to have been
//! indexed first.

use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Instant, SystemTime};

use codegraph::{CodeGraph, Node};
use codegraph_server::ai_query::QueryEngine;
use codegraph_server::ai_query::{CallInfo, SymbolMatch};
use codegraph_server::index_state::IndexState;
use codegraph_server::indexer::{IndexConfig, Indexer};
use codegraph_server::mcp::McpServer;
use codegraph_server::parser_registry::ParserRegistry;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::{Mutex, RwLock};

use crate::context::ProjectContext;
use crate::explore::ExploreResult;
use crate::status::IndexStatus;
use crate::watcher::FileWatcher;

mod queries;
mod scope;

pub(crate) use scope::ProjectScope;

// ── Inline property accessors ─────────────────────────────────────────
// codegraph-server's `domain::node_props` module is `pub(crate)`, so we
// replicate the canonical accessors here. Upgrade path: ask upstream to
// make `node_props` pub, then delete these.

pub(super) fn node_name(node: &Node) -> String {
    node.properties.get_string("name").unwrap_or("").to_string()
}

pub(super) fn node_path(node: &Node) -> String {
    node.properties.get_string("path").unwrap_or("").to_string()
}

pub(super) fn node_language(node: &Node) -> Option<String> {
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

pub(super) fn normalize_project_root(root: &Path) -> PathBuf {
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
    pub(super) fn fresh(checked_files: u64) -> Self {
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

// ── Entry per project ─────────────────────────────────────────────────

pub(super) struct ProjectEntry {
    pub(super) status: Arc<RwLock<IndexStatus>>,
    pub(super) graph: Arc<RwLock<CodeGraph>>,
    pub(super) query_engine: Arc<QueryEngine>,
    indexer: Arc<Indexer>,
    pub(super) last_indexed_at: Arc<RwLock<Option<SystemTime>>>,
    #[allow(dead_code)]
    index_state: Arc<Mutex<IndexState>>,
    watcher: Arc<Mutex<Option<Arc<FileWatcher>>>>,
    pub(super) pending_files: Arc<Mutex<HashMap<PathBuf, PendingFile>>>,
    pub(super) scope: Arc<RwLock<ProjectScope>>,
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
    pub(super) parsers: Arc<ParserRegistry>,
    pub(super) projects: RwLock<HashMap<PathBuf, Arc<ProjectEntry>>>,
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

    pub(super) async fn get_entry(&self, root: &Path) -> Result<Arc<ProjectEntry>, String> {
        let projects = self.projects.read().await;
        projects.get(root).cloned().ok_or_else(|| {
            format!(
                "Project not indexed: {}. Call index_project first.",
                root.display()
            )
        })
    }
}

// ── Free helpers ───────────────────────────────────────────────────────

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
}
