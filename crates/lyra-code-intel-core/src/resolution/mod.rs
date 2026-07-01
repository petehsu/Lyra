//! Framework resolution pipeline.
//!
//! Orchestrates the three-pass resolution:
//! 1. Extract — per-file: create framework nodes (routes, middleware) + unresolved refs
//! 2. Resolve — match unresolved refs to target nodes in the graph
//! 3. Post-extract — cross-file finalization (e.g. route prefix propagation)
//!
//! Synthesized edges carry provenance in `Edge.properties`:
//!   `provenance: "heuristic"`, `synthesizedBy: "framework:<name>"`

pub mod types;
pub mod registry;
pub mod helpers;
pub mod frameworks;

pub use registry::FrameworkRegistry;
pub use types::{FrameworkResolver, NodeInfo, ResolutionContext, ResolvedRef, UnresolvedRef};

use std::path::Path;
use std::sync::Arc;

use codegraph::PropertyMap;

/// Full resolution pass — extract from all known files, resolve all refs.
/// Called after initial indexing in `engine.rs::index_project`.
pub fn run_resolution_pass(graph: &mut codegraph::CodeGraph, root: &Path) {
    let ctx = ResolutionContext::from_graph(graph, root);
    let registry = FrameworkRegistry::new();
    let frameworks = registry.detect_all(&ctx);
    if frameworks.is_empty() {
        return;
    }

    // ── Extract pass ──────────────────────────────────────────────────
    let mut all_refs: Vec<(Arc<dyn FrameworkResolver>, UnresolvedRef)> = Vec::new();
    for file_path in ctx.get_all_files() {
        let path = Path::new(file_path);
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        for resolver in &frameworks {
            let refs = resolver.extract(path, &content, graph);
            for r in refs {
                all_refs.push((resolver.clone(), r));
            }
        }
    }

    // Rebuild context — extract may have added framework nodes.
    let ctx = ResolutionContext::from_graph(graph, root);

    // ── Resolve pass + edge creation ───────────────────────────────────
    for (resolver, unresolved) in all_refs {
        if let Some(resolved) = resolver.resolve(&unresolved, &ctx) {
            let props = PropertyMap::new()
                .with("provenance", "heuristic")
                .with("synthesizedBy", format!("framework:{}", resolver.name()));
            let _ = graph.add_edge(
                unresolved.from_node_id,
                resolved.target_node_id,
                unresolved.reference_kind,
                props,
            );
        }
    }

    // ── Post-extract pass ──────────────────────────────────────────────
    for resolver in &frameworks {
        let updates = resolver.post_extract(&ctx);
        for (id, _, props) in updates {
            let _ = graph.update_node_properties(id, props);
        }
    }
}

/// Single-file resolution pass — extract from one file only, then resolve
/// against the full graph context. Called from `watcher.rs::handle_file_change`
/// after re-parsing a changed file.
///
/// ponytail: does not re-extract from unchanged files. Ceiling: if a route in
/// file A references a handler in file B, and file B changes, the route→handler
/// edge is deleted (cascade on handler node removal) and not recreated until A
/// is also re-indexed. Upgrade path: store unresolved refs persistently and
/// re-resolve all on any file change.
pub fn run_resolution_pass_for_file(
    graph: &mut codegraph::CodeGraph,
    root: &Path,
    file_path: &Path,
) {
    let ctx = ResolutionContext::from_graph(graph, root);
    let registry = FrameworkRegistry::new();
    let frameworks = registry.detect_all(&ctx);
    if frameworks.is_empty() {
        return;
    }

    // Extract from the changed file only.
    let mut all_refs: Vec<(Arc<dyn FrameworkResolver>, UnresolvedRef)> = Vec::new();
    if let Ok(content) = std::fs::read_to_string(file_path) {
        for resolver in &frameworks {
            let refs = resolver.extract(file_path, &content, graph);
            for r in refs {
                all_refs.push((resolver.clone(), r));
            }
        }
    }

    // Rebuild context after extract.
    let ctx = ResolutionContext::from_graph(graph, root);

    // Resolve + edge creation.
    for (resolver, unresolved) in all_refs {
        if let Some(resolved) = resolver.resolve(&unresolved, &ctx) {
            let props = PropertyMap::new()
                .with("provenance", "heuristic")
                .with("synthesizedBy", format!("framework:{}", resolver.name()));
            let _ = graph.add_edge(
                unresolved.from_node_id,
                resolved.target_node_id,
                unresolved.reference_kind,
                props,
            );
        }
    }

    // Post-extract.
    for resolver in &frameworks {
        let updates = resolver.post_extract(&ctx);
        for (id, _, props) in updates {
            let _ = graph.update_node_properties(id, props);
        }
    }
}
