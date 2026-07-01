//! React resolver — React Router + Next.js route extraction, component/hook resolution.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{line_at, make_ref, make_route_node, pkg_json_has_dep, resolve_by_name_and_kind};
use crate::resolution::types::{
    FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef,
};

pub struct ReactResolver;

impl FrameworkResolver for ReactResolver {
    fn name(&self) -> &'static str { "react" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if pkg_json_has_dep(ctx, |d| d == "react" || d == "next" || d == "react-native") { return true; }
        ctx.get_all_files().iter().any(|f| f.ends_with(".jsx") || f.ends_with(".tsx"))
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        let Some(ext) = file_path.extension().and_then(|e| e.to_str()) else { return vec![]; };
        if !matches!(ext, "js" | "ts" | "jsx" | "tsx") { return vec![]; }
        let lang = if ext == "tsx" { "tsx" } else if ext == "jsx" { "jsx" } else { super::helpers::detect_lang(file_path) };
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // React Router: <Route path="/x" component={Comp}/> or element={<Comp/>}
        let route_re = regex::Regex::new(r"<Route\b").unwrap();
        for mat in route_re.find_iter(content) {
            let window = &content[mat.start()..(mat.start() + 400).min(content.len())];
            let path_cap = regex::Regex::new(r#"path\s*=\s*["']([^"']+)["']"#).unwrap();
            let Some(path_match) = path_cap.captures(window) else { continue; };
            let route_path = &path_match[1];
            let comp_re = regex::Regex::new(r#"(?:component|element)\s*=\s*\{?\s*<?\s*([A-Z][A-Za-z0-9_]*)"#).unwrap();
            let line = line_at(content, mat.start());
            let node_id = make_route_node(graph, &fp, line, "", route_path, lang);
            if let Some(cm) = comp_re.captures(window) {
                refs.push(make_ref(node_id, cm[1].to_string(), EdgeType::References, file_path, line));
            }
        }

        // Next.js pages directory convention.
        let fp_str = fp.replace('\\', "/");
        if (fp_str.contains("/pages/") || fp_str.contains("/app/")) && content.contains("export default") {
            if let Some(route) = file_path_to_next_route(&fp_str) {
                let line = content.find("export default").map(|i| line_at(content, i)).unwrap_or(1);
                make_route_node(graph, &fp, line, "", &route, lang);
            }
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;

        // PascalCase component reference.
        if is_pascal_case(name) && !is_builtin_type(name) {
            if let Some(id) = resolve_by_name_and_kind(name, &["component", "function", "class"], &["/components/", "/src/components/", "/pages/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.8 });
            }
        }

        // Hook reference (use*).
        if name.starts_with("use") && name.len() > 3 {
            if let Some(id) = resolve_by_name_and_kind(name, &["function"], &["/hooks/", "/src/hooks/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.85 });
            }
        }

        // Context/Provider reference.
        if name.ends_with("Context") || name.ends_with("Provider") {
            if let Some(id) = resolve_by_name_and_kind(name, &["function", "class", "variable"], &["/context/", "/contexts/", "/providers/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.8 });
            }
        }

        None
    }
}

fn is_pascal_case(s: &str) -> bool {
    s.chars().next().map(|c| c.is_ascii_uppercase()).unwrap_or(false) && s.chars().all(|c| c.is_ascii_alphanumeric())
}

fn is_builtin_type(name: &str) -> bool {
    matches!(name, "Array" | "Boolean" | "Date" | "Error" | "Function" | "JSON" | "Math" | "Number" | "Object" | "Promise" | "RegExp" | "String" | "Symbol" | "Map" | "Set" | "React" | "Component" | "Fragment" | "Suspense" | "StrictMode")
}

fn file_path_to_next_route(fp: &str) -> Option<String> {
    let base = fp.rsplit('/').next()?;
    if !base.ends_with(".tsx") && !base.ends_with(".ts") && !base.ends_with(".jsx") && !base.ends_with(".js") { return None; }
    if base.starts_with('_') || base.contains(".config.") { return None; }

    if let Some(idx) = fp.find("/pages/") {
        let after = &fp[idx + 7..];
        let route = after
            .replace("/index.tsx", "").replace("/index.ts", "").replace("/index.jsx", "").replace("/index.js", "")
            .replace(".tsx", "").replace(".ts", "").replace(".jsx", "").replace(".js", "")
            .replace("[", ":").replace("]", "");
        return Some(if route.is_empty() { "/".to_string() } else { format!("/{route}") });
    }
    if let Some(idx) = fp.find("/app/") {
        if !fp.contains("page.") { return None; }
        let after = &fp[idx + 5..];
        let route = after
            .replace("/page.tsx", "").replace("/page.ts", "").replace("/page.jsx", "").replace("/page.js", "")
            .replace("[", ":").replace("]", "");
        return Some(if route.is_empty() { "/".to_string() } else { format!("/{route}") });
    }
    None
}