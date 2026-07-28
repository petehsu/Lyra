use std::collections::HashSet;
use std::path::Path;
use std::time::SystemTime;

use codegraph::{CodeGraph, NodeId, NodeType};
use codegraph_server::ai_query::{CallInfo, SearchOptions, SymbolMatch};

use crate::context::ProjectContext;
use crate::explore::{ExploreResult, ExploreSymbol, SynthesizedEdge};
use crate::status::IndexStatus;

use super::{
    node_language, node_name, node_path, normalize_project_root, CodeGraphEngine, ProjectEntry,
    ProjectScope, StalenessInfo,
};

impl CodeGraphEngine {
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
        for symbol in &search_result.results {
            let detail = entry.query_engine.get_symbol_info(symbol.node_id).await;
            let (callers, callees) = detail
                .map(|detail| (detail.callers, detail.callees))
                .unwrap_or_default();
            symbols.push(ExploreSymbol {
                symbol: symbol.symbol.clone(),
                score: symbol.score,
                match_reason: symbol.match_reason.clone(),
                callers,
                callees,
            });
        }
        let synthesized_edges = {
            let graph = entry.graph.read().await;
            collect_synthesized_edges(&graph, &search_result.results)
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

    pub async fn callers(
        &self,
        root: &Path,
        symbol: &str,
        depth: u32,
        limit: usize,
    ) -> Result<Vec<CallInfo>, String> {
        let entry = self.get_entry(&normalize_project_root(root)).await?;
        let node_id = self.find_symbol(&entry, symbol).await?;
        let mut callers = entry
            .query_engine
            .get_callers(node_id, depth.clamp(1, 4))
            .await;
        callers.truncate(limit.clamp(1, 100));
        Ok(callers)
    }

    pub async fn callees(
        &self,
        root: &Path,
        symbol: &str,
        depth: u32,
        limit: usize,
    ) -> Result<Vec<CallInfo>, String> {
        let entry = self.get_entry(&normalize_project_root(root)).await?;
        let node_id = self.find_symbol(&entry, symbol).await?;
        let mut callees = entry
            .query_engine
            .get_callees(node_id, depth.clamp(1, 4))
            .await;
        callees.truncate(limit.clamp(1, 100));
        Ok(callees)
    }

    pub async fn impact(
        &self,
        root: &Path,
        symbol: &str,
        depth: u32,
        limit: usize,
    ) -> Result<Vec<CallInfo>, String> {
        self.callers(root, symbol, depth, limit).await
    }

    pub async fn project_context(&self, root: &Path) -> Result<ProjectContext, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        let status = entry.status.read().await.clone();
        let graph = entry.graph.read().await;
        let scope = entry.scope.read().await.clone();
        let mut file_paths = HashSet::new();
        let mut languages = HashSet::new();
        let mut entry_points = Vec::new();
        let mut symbol_count = 0_u64;
        for (_id, node) in graph.iter_nodes() {
            let path = node_path(node);
            if !path.is_empty() {
                if !scope.contains_path_str(&path) {
                    continue;
                }
                file_paths.insert(path);
            }
            symbol_count += 1;
            if let Some(language) = node_language(node) {
                languages.insert(language);
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

    pub async fn staleness(&self, root: &Path) -> Result<StalenessInfo, String> {
        let root = normalize_project_root(root);
        let entry = self.get_entry(&root).await?;
        if !matches!(&*entry.status.read().await, IndexStatus::Ready { .. }) {
            return Ok(StalenessInfo::fresh(0));
        }
        {
            let pending = entry.pending_files.lock().await;
            if !pending.is_empty() {
                return Ok(StalenessInfo {
                    stale: true,
                    checked_files: pending.len() as u64,
                    changed_files: pending
                        .keys()
                        .map(|path| {
                            path.strip_prefix(&root)
                                .unwrap_or(path)
                                .to_string_lossy()
                                .to_string()
                        })
                        .take(12)
                        .collect(),
                });
            }
        }
        let Some(indexed_at) = *entry.last_indexed_at.read().await else {
            return Ok(StalenessInfo::fresh(0));
        };
        let supported_extensions = self
            .parsers
            .supported_extensions()
            .into_iter()
            .map(|ext| ext.trim_start_matches('.').to_ascii_lowercase())
            .collect();
        let scope = entry.scope.read().await;
        Ok(changed_scope_files_since(
            &root,
            &scope,
            indexed_at,
            &supported_extensions,
            12,
        ))
    }

    async fn find_symbol(&self, entry: &ProjectEntry, name: &str) -> Result<NodeId, String> {
        let result = entry
            .query_engine
            .symbol_search(name, &SearchOptions::new().with_limit(1))
            .await;
        result
            .results
            .into_iter()
            .next()
            .map(|symbol| symbol.node_id)
            .ok_or_else(|| format!("Symbol not found: {name}"))
    }
}

fn is_entry_point(name: &str, node_type: &NodeType) -> bool {
    matches!(node_type, NodeType::Function)
        && (matches!(
            name,
            "main" | "main()" | "run" | "start" | "app" | "handler" | "listen"
        ) || name.starts_with("route_")
            || name.starts_with("handle_"))
}

fn extract_top_dirs(paths: &HashSet<String>, root: &Path) -> Vec<String> {
    let root = root.to_string_lossy();
    paths
        .iter()
        .filter_map(|path| path.strip_prefix(root.as_ref()))
        .filter_map(|path| {
            let mut parts = path.trim_start_matches('/').split('/');
            let first = parts.next()?;
            (!first.is_empty() && parts.next().is_some()).then(|| first.to_string())
        })
        .collect::<HashSet<_>>()
        .into_iter()
        .take(10)
        .collect()
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
    (!parts.is_empty()).then(|| parts.join("; "))
}

fn changed_scope_files_since(
    root: &Path,
    scope: &ProjectScope,
    since: SystemTime,
    supported_extensions: &HashSet<String>,
    limit: usize,
) -> StalenessInfo {
    let mut changed_files = Vec::new();
    let mut checked_files = 0;
    for path in &scope.files {
        let supported = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| supported_extensions.contains(&ext.to_ascii_lowercase()));
        if !supported {
            continue;
        }
        checked_files += 1;
        let changed = std::fs::metadata(path)
            .and_then(|metadata| metadata.modified())
            .map(|modified| modified > since)
            .unwrap_or(false);
        if changed {
            changed_files.push(
                path.strip_prefix(root)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .to_string(),
            );
            if changed_files.len() >= limit {
                break;
            }
        }
    }
    StalenessInfo {
        stale: !changed_files.is_empty(),
        changed_files,
        checked_files,
    }
}

fn collect_synthesized_edges(graph: &CodeGraph, results: &[SymbolMatch]) -> Vec<SynthesizedEdge> {
    let result_ids = results
        .iter()
        .map(|result| result.node_id)
        .collect::<HashSet<_>>();
    graph
        .iter_edges()
        .filter_map(|(_id, edge)| {
            let synthesized = edge
                .properties
                .get_string("provenance")
                .is_some_and(|provenance| provenance == "heuristic");
            if !synthesized
                || (!result_ids.contains(&edge.source_id) && !result_ids.contains(&edge.target_id))
            {
                return None;
            }
            Some(SynthesizedEdge {
                from_node_id: edge.source_id,
                to_node_id: edge.target_id,
                edge_type: edge.edge_type.to_string(),
                from_name: graph
                    .get_node(edge.source_id)
                    .map(node_name)
                    .unwrap_or_default(),
                to_name: graph
                    .get_node(edge.target_id)
                    .map(node_name)
                    .unwrap_or_default(),
                synthesized_by: edge
                    .properties
                    .get_string("synthesizedBy")
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .take(50)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_points_are_function_only() {
        assert!(is_entry_point("main", &NodeType::Function));
        assert!(!is_entry_point("helper", &NodeType::Function));
        assert!(!is_entry_point("main", &NodeType::Class));
    }

    #[test]
    fn top_dirs_and_framework_bridges_are_projected() {
        let paths = HashSet::from([
            "/app/src/auth/login.tsx".to_string(),
            "/app/android/app/build.gradle".to_string(),
            "/app/ios/AppDelegate.swift".to_string(),
            "/app/ios/LegacyBridge.m".to_string(),
        ]);
        assert!(extract_top_dirs(&paths, Path::new("/app")).contains(&"src".to_string()));
        let languages = HashSet::from([
            "typescript".to_string(),
            "swift".to_string(),
            "objc".to_string(),
        ]);
        let frameworks = detect_frameworks(&paths, &languages);
        let bridges = detect_cross_language_bridges(&paths, &languages, &frameworks);
        assert!(frameworks.contains(&"React Native".to_string()));
        assert!(bridges.contains(&"Swift ↔ ObjC".to_string()));
    }
}
