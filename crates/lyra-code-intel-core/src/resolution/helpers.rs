//! Shared helpers for framework resolvers.
//!
//! Centralizes the common operations every resolver needs:
//! line-number calculation, route-node creation, name+kind resolution,
//! path joining, and tail-identifier extraction.

use std::path::Path;

use codegraph::{CodeGraph, EdgeType, NodeId, NodeType, PropertyMap};

use super::types::{kind_matches, NodeInfo, ResolutionContext, UnresolvedRef};

/// 1-based line number at `byte_offset` within `content`.
pub fn line_at(content: &str, byte_offset: usize) -> u32 {
    content[..byte_offset].matches('\n').count() as u32 + 1
}

/// Detect language string from file extension.
pub fn detect_lang(path: &Path) -> &str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("ts") | Some("tsx") => "typescript",
        Some("js") | Some("jsx") | Some("mjs") | Some("cjs") => "javascript",
        Some("py") => "python",
        Some("rb") => "ruby",
        Some("java") => "java",
        Some("kt") => "kotlin",
        Some("go") => "go",
        Some("rs") => "rust",
        Some("cs") => "csharp",
        Some("swift") => "swift",
        Some("m") | Some("mm") => "objc",
        Some("php") => "php",
        Some("vue") => "vue",
        Some("svelte") => "svelte",
        Some("astro") => "astro",
        Some("scala") => "scala",
        _ => "unknown",
    }
}

/// Create a synthetic route node and return its ID.
/// ponytail: uses NodeType::Generic + properties["kind"]="route" since NodeType
/// has no Route variant. Ceiling: callers filtering by NodeType::Function won't
/// see routes. Upgrade path: add Route to NodeType enum.
pub fn make_route_node(
    graph: &mut CodeGraph,
    file_path: &str,
    line: u32,
    method: &str,
    route_path: &str,
    language: &str,
) -> NodeId {
    let name = if method.is_empty() {
        route_path.to_string()
    } else {
        format!("{method} {route_path}")
    };
    let props = PropertyMap::new()
        .with("kind", "route")
        .with("name", name.clone())
        .with("path", file_path)
        .with("language", language)
        .with(
            "qualifiedName",
            format!("{file_path}::{method}:{route_path}"),
        )
        .with("startLine", line as i64)
        .with("endLine", line as i64);
    graph.add_node(NodeType::Generic, props).unwrap_or(0)
}

/// Create a synthetic node of arbitrary kind.
pub fn make_synthetic_node(
    graph: &mut CodeGraph,
    kind: &str,
    name: &str,
    file_path: &str,
    line: u32,
    language: &str,
) -> NodeId {
    let node_type = match kind {
        "function" | "method" => NodeType::Function,
        "class" | "struct" | "component" => NodeType::Class,
        "module" => NodeType::Module,
        "variable" | "constant" | "property" => NodeType::Variable,
        "interface" | "protocol" | "trait" => NodeType::Interface,
        _ => NodeType::Generic,
    };
    let props = PropertyMap::new()
        .with("kind", kind)
        .with("name", name)
        .with("path", file_path)
        .with("language", language)
        .with("qualifiedName", format!("{file_path}::{name}"))
        .with("startLine", line as i64)
        .with("endLine", line as i64);
    graph.add_node(node_type, props).unwrap_or(0)
}

/// Create an UnresolvedRef from `from_node_id` to `reference_name`.
pub fn make_ref(
    from_node_id: NodeId,
    reference_name: String,
    reference_kind: EdgeType,
    file_path: &Path,
    line: u32,
) -> UnresolvedRef {
    UnresolvedRef {
        from_node_id,
        reference_name,
        reference_kind,
        file_path: file_path.to_path_buf(),
        line: Some(line),
    }
}

/// Resolve a symbol by name, filtering by kind, preferring nodes in
/// conventional directories. Returns the first match.
pub fn resolve_by_name_and_kind(
    name: &str,
    expected_kinds: &[&str],
    preferred_dirs: &[&str],
    ctx: &ResolutionContext,
) -> Option<NodeId> {
    let candidates = ctx.get_nodes_by_name(name);
    if candidates.is_empty() {
        return None;
    }
    let kind_filtered: Vec<&NodeInfo> = candidates
        .iter()
        .filter(|n| expected_kinds.iter().any(|k| kind_matches(&n.kind, k)))
        .collect();
    if kind_filtered.is_empty() {
        return None;
    }
    // Prefer conventional directories.
    if !preferred_dirs.is_empty() {
        let preferred = kind_filtered
            .iter()
            .find(|n| preferred_dirs.iter().any(|d| n.path.contains(d)));
        if let Some(n) = preferred {
            return Some(n.id);
        }
    }
    Some(kind_filtered[0].id)
}

/// Join URL path segments: `join_path("api", "users")` → `/api/users`.
pub fn join_path(prefix: &str, sub: &str) -> String {
    let parts: Vec<&str> = [prefix, sub]
        .iter()
        .map(|p| p.trim_matches('/'))
        .filter(|p| !p.is_empty())
        .collect();
    if parts.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", parts.join("/"))
    }
}

/// Extract the last identifier from an expression like `pkg.Sub.handler` or `handler`.
pub fn extract_tail_ident(expr: &str) -> Option<String> {
    let cleaned = expr.trim().replace([' ', '\t'], "");
    let cleaned = cleaned.strip_suffix("()").unwrap_or(&cleaned);
    let last = cleaned.rsplit(['.', ':']).next()?;
    if last
        .chars()
        .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
        && !last.is_empty()
    {
        Some(last.to_string())
    } else {
        None
    }
}

/// Read package.json and check if any dependency key matches `check`.
pub fn pkg_json_has_dep(ctx: &ResolutionContext, check: impl Fn(&str) -> bool) -> bool {
    let Some(content) = ctx.read_file("package.json") else {
        return false;
    };
    // ponytail: regex over JSON instead of serde_json::from_str. Ceiling: won't
    // handle escaped keys. Upgrade path: parse with serde_json.
    let re = regex::Regex::new(r#""([^"]+)"\s*:'"#).ok();
    let Some(re) = re else { return false };
    for cap in re.captures_iter(&content) {
        if check(&cap[1]) {
            return true;
        }
    }
    false
}
