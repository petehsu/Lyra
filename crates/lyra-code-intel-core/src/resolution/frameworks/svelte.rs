//! Svelte/SvelteKit resolver — route extraction + component/store/rune resolution.

use std::path::Path;

use super::helpers::{make_route_node, pkg_json_has_dep, resolve_by_name_and_kind};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct SvelteResolver;

impl FrameworkResolver for SvelteResolver {
    fn name(&self) -> &'static str { "svelte" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if pkg_json_has_dep(ctx, |d| d == "svelte" || d == "@sveltejs/kit") { return true; }
        ctx.get_all_files().iter().any(|f| f.ends_with(".svelte"))
    }

    fn extract(&self, file_path: &Path, _content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        let fp = file_path.to_string_lossy();
        let fp_norm = fp.replace('\\', "/");
        // SvelteKit route files: +page.svelte, +layout.svelte, +server.ts, etc.
        let base = fp_norm.rsplit('/').next().unwrap_or("");
        if !is_sveltekit_route_file(base) { return vec![]; }
        if let Some(route) = sveltekit_route_path(&fp_norm) {
            let lang = if fp_norm.ends_with(".svelte") { "svelte" } else { "typescript" };
            make_route_node(graph, &fp, 1, "", &route, lang);
        }
        vec![]
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;

        // Svelte runes — compiler-provided, self-resolve.
        if is_rune(name) {
            return Some(ResolvedRef { target_node_id: reference.from_node_id, confidence: 1.0 });
        }

        // Store auto-subscriptions ($storeName).
        if let Some(store) = name.strip_prefix('$') {
            if !store.starts_with('$') {
                if let Some(id) = resolve_by_name_and_kind(store, &["variable", "constant"], &[], ctx) {
                    return Some(ResolvedRef { target_node_id: id, confidence: 0.85 });
                }
            }
        }

        // PascalCase component reference.
        if is_pascal_case(name) {
            if let Some(id) = resolve_by_name_and_kind(name, &["component"], &[], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.8 });
            }
        }

        None
    }
}

fn is_sveltekit_route_file(base: &str) -> bool {
    matches!(base, "+page.svelte" | "+page.ts" | "+page.js" | "+page.server.ts" | "+page.server.js"
        | "+layout.svelte" | "+layout.ts" | "+layout.js" | "+server.ts" | "+server.js"
        | "+error.svelte")
}

fn sveltekit_route_path(fp: &str) -> Option<String> {
    let idx = fp.find("/routes/")?;
    let after = &fp[idx + 8..];
    let dir = after.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
    let route = dir
        .replace("[...", "*").replace("[", ":").replace("]", "");
    Some(if route.is_empty() { "/".to_string() } else { format!("/{route}") })
}

fn is_rune(name: &str) -> bool {
    matches!(name, "$state" | "$derived" | "$effect" | "$props" | "$bindable" | "$inspect" | "$host")
}

fn is_pascal_case(s: &str) -> bool {
    s.chars().next().map(|c| c.is_ascii_uppercase()).unwrap_or(false) && s.chars().all(|c| c.is_ascii_alphanumeric())
}