//! Astro resolver — src/pages/ file-based routing + component/global resolution.

use std::path::Path;

use super::helpers::{make_route_node, pkg_json_has_dep, resolve_by_name_and_kind};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct AstroResolver;

const ASTRO_VIRTUAL: &[&str] = &[
    "astro:content", "astro:assets", "astro:actions", "astro:env", "astro:i18n",
    "astro:middleware", "astro:transitions", "astro:components", "astro:schema",
];

impl FrameworkResolver for AstroResolver {
    fn name(&self) -> &'static str { "astro" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if pkg_json_has_dep(ctx, |d| d == "astro") { return true; }
        ctx.get_all_files().iter().any(|f| f.ends_with(".astro"))
    }

    fn extract(&self, file_path: &Path, _content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        let fp = file_path.to_string_lossy();
        let norm = fp.replace('\\', "/");
        if !norm.contains("/src/pages/") { return vec![]; }
        if !(norm.ends_with(".astro") || norm.ends_with(".ts") || norm.ends_with(".js") || norm.ends_with(".mjs")) {
            return vec![];
        }
        let base = norm.rsplit('/').next().unwrap_or("");
        if base.starts_with('_') || base.contains(".config.") { return vec![]; }

        if let Some(idx) = norm.find("/src/pages/") {
            let after = &norm[idx + 11..];
            let route = astro_route(after);
            let lang = if norm.ends_with(".astro") { "astro" } else { "typescript" };
            make_route_node(graph, &fp, 1, "", &route, lang);
        }
        vec![]
    }

    fn resolve(&self, reference: &UnresolvedRef, _ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;

        // `Astro` global — self-resolve.
        if name == "Astro" || name.starts_with("Astro.") {
            return Some(ResolvedRef { target_node_id: reference.from_node_id, confidence: 1.0 });
        }

        // astro:* virtual modules — self-resolve.
        if name.starts_with("astro:") && ASTRO_VIRTUAL.iter().any(|p| name.starts_with(p)) {
            return Some(ResolvedRef { target_node_id: reference.from_node_id, confidence: 1.0 });
        }

        // PascalCase component.
        if is_pascal_case(name) {
            if let Some(id) = resolve_by_name_and_kind(name, &["component"], &[], _ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.8 });
            }
        }

        None
    }
}

fn astro_route(after_pages: &str) -> String {
    let without_ext = after_pages
        .strip_suffix(".astro").or_else(|| after_pages.strip_suffix(".ts"))
        .or_else(|| after_pages.strip_suffix(".js")).or_else(|| after_pages.strip_suffix(".mjs"))
        .unwrap_or(after_pages);
    let without_index = without_ext.strip_suffix("/index").unwrap_or(without_ext);
    let route = without_index.replace("[...", "*").replace("[", ":").replace("]", "");
    if route.is_empty() { "/".to_string() } else { format!("/{route}") }
}

fn is_pascal_case(s: &str) -> bool {
    s.chars().next().map(|c| c.is_ascii_uppercase()).unwrap_or(false) && s.chars().all(|c| c.is_ascii_alphanumeric())
}