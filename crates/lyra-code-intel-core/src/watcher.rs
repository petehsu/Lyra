//! File system watcher for incremental re-indexing.
//!
//! Stripped-down port of codegraph-server's `watcher.rs` — no LSP client,
//! no memory manager, no symbol index, no embed queue. Just graph + parsers
//! + query engine.
//!
//! ponytail: debounce 300ms / tick 50ms (same as reference). Upgrade path:
//! event-driven push to frontend instead of polling.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use codegraph::CodeGraph;
use codegraph_server::ai_query::QueryEngine;
use codegraph_server::index_state::IndexState;
use codegraph_server::indexer::IndexConfig;
use codegraph_server::parser_registry::ParserRegistry;
use codegraph_server::watcher::GraphUpdater;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::{mpsc, Mutex, RwLock};

use crate::engine::{PendingFile, ProjectScope};
use crate::status::IndexStatus;

const DEBOUNCE_MS: u64 = 300;
const TICK_MS: u64 = 50;
const RECONCILE_MS: u64 = 1_000;

/// File system watcher that triggers re-parsing on changes.
pub struct FileWatcher {
    _watcher: RecommendedWatcher,
}

impl FileWatcher {
    /// Create a new file watcher with debouncing.
    pub fn new(
        graph: Arc<RwLock<CodeGraph>>,
        parsers: Arc<ParserRegistry>,
        query_engine: Arc<QueryEngine>,
        project_root: PathBuf,
        status: Arc<RwLock<IndexStatus>>,
        last_indexed_at: Arc<RwLock<Option<SystemTime>>>,
        index_state: Arc<Mutex<IndexState>>,
        pending_files: Arc<Mutex<HashMap<PathBuf, PendingFile>>>,
        scope: Arc<RwLock<ProjectScope>>,
    ) -> Result<Self, notify::Error> {
        let (tx, mut rx) = mpsc::channel::<Event>(100);

        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.blocking_send(event);
                }
            },
            Config::default(),
        )?;

        let graph_clone = Arc::clone(&graph);
        let parsers_clone = Arc::clone(&parsers);
        let query_engine_clone = Arc::clone(&query_engine);
        let root_clone = project_root.clone();
        let status_clone = Arc::clone(&status);
        let last_indexed_at_clone = Arc::clone(&last_indexed_at);
        let index_state_clone = Arc::clone(&index_state);
        let pending_files_clone = Arc::clone(&pending_files);
        let scope_clone = Arc::clone(&scope);

        tokio::spawn(async move {
            let debounce = Duration::from_millis(DEBOUNCE_MS);
            let reconcile_interval = Duration::from_millis(RECONCILE_MS);
            let mut pending: HashMap<PathBuf, (EventKind, Instant)> = HashMap::new();
            let mut last_reconcile = Instant::now();

            loop {
                tokio::select! {
                    event = rx.recv() => match event {
                        Some(event) => {
                            let now = Instant::now();
                            for path in &event.paths {
                                if is_watchable_event(&parsers_clone, event.kind, path) {
                                    pending.insert(path.clone(), (event.kind, now));
                                }
                            }
                            // Track dirty files for staleness reporting.
                            {
                                let mut pf = pending_files_clone.lock().await;
                                for path in &event.paths {
                                    if is_watchable_event(&parsers_clone, event.kind, path) {
                                        pf.entry(path.clone())
                                            .and_modify(|f| f.last_seen = now)
                                            .or_insert(PendingFile { first_seen: now, last_seen: now });
                                    }
                                }
                            }
                        }
                        None => break,
                    },
                    _ = tokio::time::sleep(Duration::from_millis(TICK_MS)) => {
                        let now = Instant::now();
                        let mut to_process = Vec::new();
                        pending.retain(|path, (kind, ts)| {
                            if now.duration_since(*ts) >= debounce {
                                to_process.push((path.clone(), *kind));
                                false
                            } else {
                                true
                            }
                        });
                        for (path, kind) in to_process {
                            let updated = Self::handle_event(
                                &graph_clone,
                                &parsers_clone,
                                &query_engine_clone,
                                &index_state_clone,
                                &scope_clone,
                                &root_clone,
                                kind,
                                &path,
                            ).await;
                            pending_files_clone.lock().await.remove(&path);
                            if updated {
                                refresh_ready_status(
                                    &graph_clone,
                                    &status_clone,
                                    &last_indexed_at_clone,
                                ).await;
                            }
                        }
                        if now.duration_since(last_reconcile) >= reconcile_interval {
                            last_reconcile = now;
                            let current_scope = scope_clone.read().await.clone();
                            let updated = Self::remove_missing_or_out_of_scope_nodes(
                                &graph_clone,
                                &query_engine_clone,
                                &index_state_clone,
                                &current_scope,
                            ).await.unwrap_or_else(|e| {
                                eprintln!("[codegraph-watcher] error reconciling graph: {e}");
                                false
                            });
                            if updated {
                                refresh_ready_status(
                                    &graph_clone,
                                    &status_clone,
                                    &last_indexed_at_clone,
                                ).await;
                            }
                        }
                    }
                }
            }
        });

        let mut fw = Self { _watcher: watcher };
        fw.watch(&project_root)?;
        Ok(fw)
    }

    fn watch(&mut self, path: &Path) -> Result<(), notify::Error> {
        self._watcher.watch(path, RecursiveMode::Recursive)
    }

    async fn handle_event(
        graph: &Arc<RwLock<CodeGraph>>,
        parsers: &Arc<ParserRegistry>,
        query_engine: &Arc<QueryEngine>,
        index_state: &Arc<Mutex<IndexState>>,
        scope: &Arc<RwLock<ProjectScope>>,
        root: &Path,
        kind: EventKind,
        path: &Path,
    ) -> bool {
        match kind {
            EventKind::Create(_) | EventKind::Modify(_) => {
                if path.is_dir() {
                    let latest_scope =
                        ProjectScope::discover(root, parsers, &IndexConfig::default());
                    let changed = Self::remove_missing_or_out_of_scope_nodes(
                        graph,
                        query_engine,
                        index_state,
                        &latest_scope,
                    )
                    .await;
                    *scope.write().await = latest_scope;
                    return changed.unwrap_or_else(|e| {
                        eprintln!("[codegraph-watcher] error reconciling graph: {e}");
                        false
                    });
                }
                if !parsers.can_parse(path) {
                    if matches!(kind, EventKind::Modify(_))
                        && !path.exists()
                        && has_supported_extension(parsers, path)
                    {
                        *scope.write().await =
                            ProjectScope::discover(root, parsers, &IndexConfig::default());
                        if let Err(e) =
                            Self::handle_file_remove(graph, query_engine, index_state, path).await
                        {
                            eprintln!("[codegraph-watcher] error removing {}: {e}", path.display());
                            return false;
                        }
                        return true;
                    }
                    return false;
                }
                let latest_scope = ProjectScope::discover(root, parsers, &IndexConfig::default());
                let in_scope = latest_scope.contains_path_str(&path.to_string_lossy());
                *scope.write().await = latest_scope;
                if !in_scope {
                    return false;
                }
                if !path.is_file() {
                    if let Err(e) =
                        Self::handle_file_remove(graph, query_engine, index_state, path).await
                    {
                        eprintln!("[codegraph-watcher] error removing {}: {e}", path.display());
                        return false;
                    }
                    return true;
                }
                if let Err(e) =
                    Self::handle_file_change(graph, parsers, query_engine, root, path).await
                {
                    eprintln!(
                        "[codegraph-watcher] error processing {}: {e}",
                        path.display()
                    );
                    return false;
                }
                true
            }
            EventKind::Remove(_) => {
                if !has_supported_extension(parsers, path) {
                    let latest_scope =
                        ProjectScope::discover(root, parsers, &IndexConfig::default());
                    let changed = Self::remove_missing_or_out_of_scope_nodes(
                        graph,
                        query_engine,
                        index_state,
                        &latest_scope,
                    )
                    .await;
                    *scope.write().await = latest_scope;
                    return changed.unwrap_or_else(|e| {
                        eprintln!("[codegraph-watcher] error reconciling graph: {e}");
                        false
                    });
                }
                *scope.write().await =
                    ProjectScope::discover(root, parsers, &IndexConfig::default());
                if let Err(e) =
                    Self::handle_file_remove(graph, query_engine, index_state, path).await
                {
                    eprintln!("[codegraph-watcher] error removing {}: {e}", path.display());
                    return false;
                }
                true
            }
            _ => false,
        }
    }

    async fn handle_file_change(
        graph: &Arc<RwLock<CodeGraph>>,
        parsers: &Arc<ParserRegistry>,
        query_engine: &Arc<QueryEngine>,
        root: &Path,
        path: &Path,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let parser = match parsers.parser_for_path(path) {
            Some(p) => p,
            None => return Ok(()),
        };
        let content = tokio::fs::read_to_string(path).await?;
        {
            let mut graph = graph.write().await;
            Self::remove_file_nodes(&mut graph, path)?;
            parser.parse_source(&content, path, &mut graph)?;
            GraphUpdater::resolve_cross_file_imports(&mut graph);
            crate::resolution::run_resolution_pass_for_file(&mut graph, root, path);
        }
        query_engine.build_indexes().await;
        Ok(())
    }

    async fn handle_file_remove(
        graph: &Arc<RwLock<CodeGraph>>,
        query_engine: &Arc<QueryEngine>,
        index_state: &Arc<Mutex<IndexState>>,
        path: &Path,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        {
            let mut graph = graph.write().await;
            Self::remove_file_nodes(&mut graph, path)?;
        }
        {
            let mut state = index_state.lock().await;
            state.remove(path);
            state.save();
        }
        query_engine.build_indexes().await;
        Ok(())
    }

    fn remove_file_nodes(
        graph: &mut CodeGraph,
        path: &Path,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let path_str = path.to_string_lossy().to_string();
        if let Ok(nodes) = graph.query().property("path", path_str).execute() {
            for node_id in nodes {
                let _ = graph.delete_node(node_id);
            }
        }
        Ok(())
    }

    async fn remove_missing_or_out_of_scope_nodes(
        graph: &Arc<RwLock<CodeGraph>>,
        query_engine: &Arc<QueryEngine>,
        index_state: &Arc<Mutex<IndexState>>,
        scope: &ProjectScope,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let removed_paths = {
            let mut graph = graph.write().await;
            let mut paths = HashSet::new();
            for (_id, node) in graph.iter_nodes() {
                let path = node.properties.get_string("path").unwrap_or("");
                if !path.is_empty() {
                    paths.insert(path.to_string());
                }
            }
            let removed_paths = paths
                .into_iter()
                .filter(|path| !Path::new(path).is_file() || !scope.contains_path_str(path))
                .collect::<Vec<_>>();
            for path in &removed_paths {
                Self::remove_file_nodes(&mut graph, Path::new(path))?;
            }
            removed_paths
        };
        if removed_paths.is_empty() {
            return Ok(false);
        }
        {
            let mut state = index_state.lock().await;
            for path in &removed_paths {
                state.remove(Path::new(path));
            }
            state.save();
        }
        query_engine.build_indexes().await;
        Ok(true)
    }
}

fn is_watchable_event(parsers: &ParserRegistry, kind: EventKind, path: &Path) -> bool {
    match kind {
        EventKind::Create(_) => parsers.can_parse(path),
        EventKind::Modify(_) => {
            path.is_dir()
                || parsers.can_parse(path)
                || (!path.exists() && has_supported_extension(parsers, path))
        }
        EventKind::Remove(_) => path.is_dir() || has_supported_extension(parsers, path),
        _ => false,
    }
}

fn has_supported_extension(parsers: &ParserRegistry, path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    parsers
        .supported_extensions()
        .into_iter()
        .any(|supported| supported.trim_start_matches('.').eq_ignore_ascii_case(ext))
}

async fn refresh_ready_status(
    graph: &Arc<RwLock<CodeGraph>>,
    status: &Arc<RwLock<IndexStatus>>,
    last_indexed_at: &Arc<RwLock<Option<SystemTime>>>,
) {
    let (file_count, symbol_count) = {
        let graph = graph.read().await;
        let mut files = std::collections::HashSet::new();
        for (_id, node) in graph.iter_nodes() {
            let path = node.properties.get_string("path").unwrap_or("");
            if !path.is_empty() {
                files.insert(path.to_string());
            }
        }
        (files.len() as u64, graph.iter_nodes().count() as u64)
    };
    *last_indexed_at.write().await = Some(SystemTime::now());
    *status.write().await = IndexStatus::Ready {
        file_count,
        symbol_count,
    };
}
