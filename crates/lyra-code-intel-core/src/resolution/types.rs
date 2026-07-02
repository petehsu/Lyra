//! Resolution types: trait, context, ref structs.
//!
//! Port of codegraph-colby's `resolution/types.ts` — adapted to Rust's
//! ownership model. `ResolutionContext` is an owned snapshot (no locks held),
//! built from a `&CodeGraph` read.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

pub use codegraph::{CodeGraph, EdgeType, NodeId, NodeType, PropertyMap};

// ── NodeInfo ──────────────────────────────────────────────────────────
// Lightweight node snapshot for resolution lookups. Avoids cloning the
// full `PropertyMap` — resolvers only need id, type, name, path.

#[derive(Debug, Clone)]
pub struct NodeInfo {
    pub id: NodeId,
    pub node_type: NodeType,
    pub name: String,
    pub path: String,
    /// String kind — from `properties["kind"]` if set, else derived from `node_type`.
    /// Resolvers filter by this to match TS reference semantics (e.g. "method", "struct", "route").
    pub kind: String,
}

/// Map NodeType to the canonical kind string the TS resolvers expect.
pub fn node_type_to_kind(nt: NodeType) -> &'static str {
    match nt {
        NodeType::CodeFile => "file",
        NodeType::Function => "function",
        NodeType::Class => "class",
        NodeType::Module => "module",
        NodeType::Variable => "variable",
        NodeType::Type => "type",
        NodeType::Interface => "interface",
        NodeType::Generic => "generic",
    }
}

/// Does a kind string match a set of acceptable kinds?
/// Handles aliases: "method" matches "function", "struct" matches "class",
/// "protocol"/"trait" matches "interface", "constant"/"property" matches "variable".
pub fn kind_matches(actual: &str, expected: &str) -> bool {
    if actual == expected {
        return true;
    }
    let canon = |k: &str| -> &'static str {
        match k {
            "method" => "function",
            "struct" => "class",
            "protocol" | "trait" => "interface",
            "constant" | "property" => "variable",
            _ => "",
        }
    };
    let ca = canon(actual);
    let ce = canon(expected);
    // If canon returned "" (unknown kind), fall back to direct comparison.
    (!ca.is_empty() && !ce.is_empty() && ca == ce) || actual == expected
}

// ── ResolutionContext ─────────────────────────────────────────────────
// Read-only snapshot of the graph. Owned data, no borrows, no locks.
// Built once from `&CodeGraph`, used for detect/resolve/post_extract.

pub struct ResolutionContext {
    project_root: PathBuf,
    nodes_by_name: HashMap<String, Vec<NodeInfo>>,
    nodes_by_path: HashMap<String, Vec<NodeInfo>>,
    file_paths: HashSet<String>,
    languages: HashSet<String>,
}

impl ResolutionContext {
    pub fn from_graph(graph: &CodeGraph, root: &Path) -> Self {
        let mut nodes_by_name: HashMap<String, Vec<NodeInfo>> = HashMap::new();
        let mut nodes_by_path: HashMap<String, Vec<NodeInfo>> = HashMap::new();
        let mut file_paths: HashSet<String> = HashSet::new();
        let mut languages: HashSet<String> = HashSet::new();

        for (id, node) in graph.iter_nodes() {
            let name = node.properties.get_string("name").unwrap_or("").to_string();
            let path = node.properties.get_string("path").unwrap_or("").to_string();
            let kind = node
                .properties
                .get_string("kind")
                .map(str::to_string)
                .unwrap_or_else(|| node_type_to_kind(node.node_type).to_string());
            let info = NodeInfo {
                id,
                node_type: node.node_type,
                name: name.clone(),
                path: path.clone(),
                kind,
            };
            if !name.is_empty() {
                nodes_by_name.entry(name).or_default().push(info.clone());
            }
            if !path.is_empty() {
                file_paths.insert(path.clone());
                nodes_by_path.entry(path).or_default().push(info);
            }
            if let Some(lang) = node.properties.get_string("language") {
                languages.insert(lang.to_string());
            }
        }

        Self {
            project_root: root.to_path_buf(),
            nodes_by_name,
            nodes_by_path,
            file_paths,
            languages,
        }
    }

    pub fn get_nodes_by_name(&self, name: &str) -> &[NodeInfo] {
        self.nodes_by_name
            .get(name)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    pub fn get_nodes_in_file(&self, path: &str) -> &[NodeInfo] {
        self.nodes_by_path
            .get(path)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    pub fn get_project_root(&self) -> &Path {
        &self.project_root
    }

    pub fn get_all_files(&self) -> &HashSet<String> {
        &self.file_paths
    }

    /// Return nodes whose `kind` matches any of `expected_kinds` (with alias folding).
    pub fn get_nodes_by_kind(&self, expected_kinds: &[&str]) -> Vec<&NodeInfo> {
        self.nodes_by_name
            .values()
            .flatten()
            .filter(|n| expected_kinds.iter().any(|k| kind_matches(&n.kind, k)))
            .collect()
    }

    pub fn get_languages(&self) -> &HashSet<String> {
        &self.languages
    }

    pub fn file_exists(&self, path: &str) -> bool {
        Path::new(path).exists()
    }

    /// Read file content. Relative paths resolve against project root
    /// (matches TS `context.readFile('package.json')` convention).
    pub fn read_file(&self, path: &str) -> Option<String> {
        let full_path = if Path::new(path).is_absolute() {
            PathBuf::from(path)
        } else {
            self.project_root.join(path)
        };
        std::fs::read_to_string(full_path).ok()
    }
}

// ── Refs ─────────────────────────────────────────────────────────────

/// An unresolved reference from extraction — e.g. a route node that
/// references a handler function by name.
#[derive(Debug)]
pub struct UnresolvedRef {
    pub from_node_id: NodeId,
    pub reference_name: String,
    pub reference_kind: EdgeType,
    pub file_path: PathBuf,
    pub line: Option<u32>,
}

/// A resolved reference — the target node was found in the graph.
#[derive(Debug)]
pub struct ResolvedRef {
    pub target_node_id: NodeId,
    pub confidence: f64,
}

// ── FrameworkResolver trait ───────────────────────────────────────────
// Port of codegraph-colby's `FrameworkResolver` interface.
// `extract` mutates the graph directly (creates route/middleware nodes).
// `resolve` queries the snapshot context (no graph mutation).

pub trait FrameworkResolver: Send + Sync {
    fn name(&self) -> &'static str;

    /// Project-level detection: does this project use this framework?
    fn detect(&self, ctx: &ResolutionContext) -> bool;

    /// Per-file extraction: create framework-specific nodes (routes, etc.)
    /// and return unresolved references for the resolve pass.
    fn extract(&self, file_path: &Path, content: &str, graph: &mut CodeGraph)
        -> Vec<UnresolvedRef>;

    /// Resolve an unresolved ref to a target node using framework patterns.
    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef>;

    /// Cross-file finalization pass (e.g. NestJS route prefix propagation).
    /// Returns (node_id, node_type, updated_properties) for node updates.
    fn post_extract(&self, _ctx: &ResolutionContext) -> Vec<(NodeId, NodeType, PropertyMap)> {
        Vec::new()
    }
}
