//! Express resolver — route extraction + handler/middleware resolution.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{
    extract_tail_ident, line_at, make_ref, make_route_node, pkg_json_has_dep,
    resolve_by_name_and_kind,
};
use crate::resolution::types::{
    FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef,
};

pub struct ExpressResolver;

impl FrameworkResolver for ExpressResolver {
    fn name(&self) -> &'static str {
        "express"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if pkg_json_has_dep(ctx, |d| {
            d == "express" || d == "fastify" || d == "koa" || d == "hapi"
        }) {
            return true;
        }
        // Fallback: files in routes/controllers/middleware with express patterns.
        ctx.get_all_files()
            .iter()
            .filter(|f| {
                f.contains("routes") || f.contains("controllers") || f.contains("middleware")
            })
            .take(20)
            .any(|f| {
                ctx.read_file(f)
                    .map(|c| c.contains("express") || c.contains("app.get") || c.contains("router.get"))
                    .unwrap_or(false)
            })
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        let Some(ext) = file_path.extension().and_then(|e| e.to_str()) else {
            return vec![];
        };
        if !matches!(ext, "js" | "ts" | "jsx" | "tsx" | "mjs" | "cjs") {
            return vec![];
        }
        let lang = super::helpers::detect_lang(file_path);
        let mut refs = Vec::new();

        // ponytail: no comment stripping. Ceiling: comments may cause false
        // route matches. Upgrade path: port stripCommentsForRegex.
        let re = regex::Regex::new(
            r#"\b(app|router)\.(get|post|put|patch|delete|all|use)\s*\(\s*['"]([^'"]+)['"]\s*,"#,
        ).unwrap();
        let fp = file_path.to_string_lossy();
        for cap in re.captures_iter(content) {
            let method = &cap[2];
            let route_path = &cap[3];
            if method == "use" && !route_path.starts_with('/') {
                continue;
            }
            let line = line_at(content, cap.get(0).unwrap().start());
            let upper = method.to_uppercase();
            let node_id = make_route_node(graph, &fp, line, &upper, route_path, lang);

            // Find the handler: look at the rest of the call args after the route path.
            let after_path = &content[cap.get(0).unwrap().end()..];
            // Last comma-separated arg before closing paren.
            if let Some(close) = after_path.find(')') {
                let args = &after_path[..close];
                if let Some(arrow) = args.find("=>") {
                    // Inline arrow handler — extract calls from body.
                    let body = &args[arrow + 2..];
                    let call_re = regex::Regex::new(r"\b([A-Za-z_$][\w$]*)\s*\(").unwrap();
                    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
                    for cm in call_re.captures_iter(body) {
                        let name = cm[1].to_string();
                        if seen.contains(&name) || RESERVED_CALLS.contains(&name.as_str()) {
                            continue;
                        }
                        seen.insert(name.clone());
                        refs.push(make_ref(node_id, name, EdgeType::Calls, file_path, line));
                    }
                } else {
                    // Named handler — last comma-separated arg.
                    let parts: Vec<&str> = args.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
                    if let Some(last) = parts.last() {
                        if let Some(name) = extract_tail_ident(last) {
                            refs.push(make_ref(node_id, name, EdgeType::References, file_path, line));
                        }
                    }
                }
            }
        }
        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;

        // Controller.method pattern
        if let Some(cap) = regex::Regex::new(r"^(\w+)Controller\.(\w+)$").unwrap().captures(name) {
            let controller = &cap[1];
            let method = &cap[2];
            let candidates = ctx.get_nodes_by_name(method);
            let target = candidates.iter().find(|n| {
                (n.kind == "method" || n.kind == "function") && n.path.to_lowercase().contains(&controller.to_lowercase())
            });
            if let Some(t) = target {
                return Some(ResolvedRef { target_node_id: t.id, confidence: 0.85 });
            }
        }

        // Service/helper pattern
        if let Some(cap) = regex::Regex::new(r"^(\w+)(Service|Helper|Utils?)\.(\w+)$").unwrap().captures(name) {
            let method = &cap[3];
            if let Some(id) = resolve_by_name_and_kind(method, &["method", "function"], &[], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.8 });
            }
        }

        // Middleware pattern
        if is_middleware_name(name) {
            if let Some(id) = resolve_by_name_and_kind(name, &["function"], &["/middleware/", "/middlewares/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.8 });
            }
            // Try without Middleware suffix
            let base = name.strip_suffix("Middleware").unwrap_or(name);
            if base != name {
                if let Some(id) = resolve_by_name_and_kind(base, &["function"], &["/middleware/"], ctx) {
                    return Some(ResolvedRef { target_node_id: id, confidence: 0.75 });
                }
            }
        }

        None
    }
}

const RESERVED_CALLS: &[&str] = &[
    "json", "jsonp", "send", "sendStatus", "sendFile", "status", "end", "redirect",
    "render", "set", "get", "header", "type", "next", "then", "catch", "finally",
    "resolve", "reject", "map", "filter", "forEach", "reduce", "find", "push", "pop",
    "slice", "splice", "includes", "keys", "values", "entries", "assign", "parse",
    "stringify", "log", "error", "warn", "info", "require",
];

fn is_middleware_name(name: &str) -> bool {
    name.ends_with("Middleware")
        || matches!(
            name.to_lowercase().as_str(),
            "auth" | "authenticate" | "authorization" | "cors" | "helmet" | "logger" | "errorhandler" | "notfound"
        )
        || name.starts_with("validate")
        || name.starts_with("sanitize")
        || name.starts_with("rateLimit")
}