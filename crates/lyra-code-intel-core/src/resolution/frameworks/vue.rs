//! Vue/Nuxt resolver — route extraction + component/macro resolution.

use std::path::Path;

use super::helpers::{make_route_node, pkg_json_has_dep, resolve_by_name_and_kind};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct VueResolver;

const VUE_MACROS: &[&str] = &[
    "defineProps",
    "defineEmits",
    "defineExpose",
    "defineOptions",
    "defineSlots",
    "defineModel",
    "withDefaults",
];

const NUXT_AUTO_IMPORTS: &[&str] = &[
    "useRoute",
    "useRouter",
    "navigateTo",
    "useFetch",
    "useAsyncData",
    "useState",
    "useHead",
    "useRuntimeConfig",
    "useNuxtApp",
    "useCookie",
    "useError",
    "createError",
    "definePageMeta",
    "defineNuxtConfig",
    "defineNuxtPlugin",
];

impl FrameworkResolver for VueResolver {
    fn name(&self) -> &'static str {
        "vue"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if pkg_json_has_dep(ctx, |d| d == "vue" || d == "nuxt" || d == "@nuxt/kit") {
            return true;
        }
        ctx.get_all_files().iter().any(|f| f.ends_with(".vue"))
    }

    fn extract(
        &self,
        file_path: &Path,
        _content: &str,
        graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        let fp = file_path.to_string_lossy();
        let norm = fp.replace('\\', "/");

        // Nuxt pages/ routes.
        if let Some(idx) = norm.find("/pages/") {
            if norm.ends_with(".vue") {
                if let Some(route) = nuxt_route(&norm[idx + 7..]) {
                    make_route_node(graph, &fp, 1, "", &route, "vue");
                }
            }
        }

        // Nuxt server/api routes.
        if let Some(idx) = norm.find("/server/api/") {
            let after = &norm[idx + 12..];
            let route_name = after.rsplit_once('.').map(|(n, _)| n).unwrap_or(after);
            let route = format!("/api/{route_name}");
            make_route_node(graph, &fp, 1, "", &route, "typescript");
        }

        vec![]
    }

    fn resolve(&self, reference: &UnresolvedRef, _ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;

        // Vue compiler macros — self-resolve.
        if VUE_MACROS.contains(&name.as_str()) || NUXT_AUTO_IMPORTS.contains(&name.as_str()) {
            return Some(ResolvedRef {
                target_node_id: reference.from_node_id,
                confidence: 1.0,
            });
        }

        // ponytail: Nuxt #imports and @/~ alias resolution skipped — requires
        // file-existence probing per candidate extension. Ceiling: ~10% of
        // Nuxt imports unresolved. Upgrade path: implement alias path probing.

        // PascalCase component — delegate to name-based lookup.
        if is_pascal_case(name) {
            if let Some(id) = resolve_by_name_and_kind(name, &["component"], &[], _ctx) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.8,
                });
            }
        }

        None
    }
}

fn nuxt_route(after_pages: &str) -> Option<String> {
    let without_ext = after_pages.strip_suffix(".vue")?;
    let without_index = without_ext.strip_suffix("/index").unwrap_or(without_ext);
    let route = without_index
        .replace("[...", "*")
        .replace("[", ":")
        .replace("]", "");
    Some(if route.is_empty() {
        "/".to_string()
    } else {
        format!("/{route}")
    })
}

fn is_pascal_case(s: &str) -> bool {
    s.chars()
        .next()
        .map(|c| c.is_ascii_uppercase())
        .unwrap_or(false)
        && s.chars().all(|c| c.is_ascii_alphanumeric())
}
