//! File system watcher for incremental re-indexing.
//!
//! Stripped-down port of codegraph-server's `watcher.rs` — no LSP client,
//! no memory manager, no symbol index, no embed queue. Just graph + parsers
//! + query engine.
//!
//! ponytail: debounce 300ms / tick 50ms (same as reference). Upgrade path:
//! event-driven push to frontend instead of polling.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use codegraph::CodeGraph;
use codegraph_server::ai_query::QueryEngine;
use codegraph_server::parser_registry::ParserRegistry;
use codegraph_server::watcher::GraphUpdater;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::{mpsc, Mutex, RwLock};

use crate::engine::PendingFile;

const DEBOUNCE_MS: u64 = 300;
const TICK_MS: u64 = 50;

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
        pending_files: Arc<Mutex<HashMap<PathBuf, PendingFile>>>,
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
        let pending_files_clone = Arc::clone(&pending_files);

        tokio::spawn(async move {
            let debounce = Duration::from_millis(DEBOUNCE_MS);
            let mut pending: HashMap<PathBuf, (EventKind, Instant)> = HashMap::new();

            loop {
                tokio::select! {
                    event = rx.recv() => match event {
                        Some(event) => {
                            let now = Instant::now();
                            for path in &event.paths {
                                pending.insert(path.clone(), (event.kind, now));
                            }
                            // Track dirty files for staleness reporting.
                            {
                                let mut pf = pending_files_clone.lock().await;
                                for path in &event.paths {
                                    pf.entry(path.clone())
                                        .and_modify(|f| f.last_seen = now)
                                        .or_insert(PendingFile { first_seen: now, last_seen: now });
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
                            Self::handle_event(
                                &graph_clone,
                                &parsers_clone,
                                &query_engine_clone,
                                &root_clone,
                                kind,
                                &path,
                            ).await;
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
        root: &Path,
        kind: EventKind,
        path: &Path,
    ) {
        match kind {
            EventKind::Create(_) | EventKind::Modify(_) => {
                if !parsers.can_parse(path) {
                    return;
                }
                if let Err(e) = Self::handle_file_change(graph, parsers, query_engine, root, path).await {
                    eprintln!("[codegraph-watcher] error processing {}: {e}", path.display());
                }
            }
            EventKind::Remove(_) => {
                if let Err(e) = Self::handle_file_remove(graph, query_engine, path).await {
                    eprintln!("[codegraph-watcher] error removing {}: {e}", path.display());
                }
            }
            _ => {}
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
        path: &Path,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        {
            let mut graph = graph.write().await;
            Self::remove_file_nodes(&mut graph, path)?;
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
}