//! Rust resolver — Actix-web/Rocket/Axum route extraction + handler/module resolution.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{line_at, make_ref, make_route_node, resolve_by_name_and_kind};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct RustResolver;

impl FrameworkResolver for RustResolver {
    fn name(&self) -> &'static str {
        "rust"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        ctx.file_exists("Cargo.toml")
    }

    fn extract(
        &self,
        file_path: &Path,
        content: &str,
        graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("rs") {
            return vec![];
        }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // Actix-web/Rocket attribute: #[get("/path")] fn handler(..)
        let attr_re = regex::Regex::new(
            r#"#\[(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']+)["'][^\]]*\)\]"#,
        )
        .unwrap();
        for cap in attr_re.captures_iter(content) {
            let method = &cap[1];
            let route_path = &cap[2];
            let line = line_at(content, cap.get(0).unwrap().start());
            let upper = method.to_uppercase();
            let node_id = make_route_node(graph, &fp, line, &upper, route_path, "rust");
            let after = &content[cap.get(0).unwrap().end()..];
            if let Some(m) = regex::Regex::new(r"\n\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)")
                .unwrap()
                .captures(after)
            {
                refs.push(make_ref(
                    node_id,
                    m[1].to_string(),
                    EdgeType::References,
                    file_path,
                    line,
                ));
            }
        }

        // Axum: .route("/path", get(h1).post(h2)…)
        let route_re = regex::Regex::new(r#"\.route\s*\(\s*"([^"]+)"\s*,\s*"#).unwrap();
        for mat in route_re.find_iter(content) {
            let route_path = regex::Regex::new(r#""([^"]+)""#)
                .unwrap()
                .captures(&content[mat.start()..mat.end()])
                .map(|c| c[1].to_string());
            let Some(route_path) = route_path else {
                continue;
            };
            let line = line_at(content, mat.start());
            // Look for method handlers in the rest of the call.
            let after = &content[mat.end()..];
            let mh_re =
                regex::Regex::new(r#"\b(get|post|put|patch|delete|head)\s*\(\s*([A-Za-z_][\w:]*)"#)
                    .unwrap();
            for mh in mh_re.captures_iter(&after[..after.len().min(200)]) {
                let upper = mh[1].to_uppercase();
                let handler = mh[2].rsplit("::").next().unwrap_or(&mh[2]);
                let node_id = make_route_node(graph, &fp, line, &upper, &route_path, "rust");
                refs.push(make_ref(
                    node_id,
                    handler.to_string(),
                    EdgeType::References,
                    file_path,
                    line,
                ));
            }
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;

        if name.ends_with("_handler") || name.starts_with("handle_") {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["function"],
                &["/handlers/", "/api/", "/routes/"],
                ctx,
            ) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.8,
                });
            }
        }
        if name.ends_with("Service") || name.ends_with("Repository") {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["struct", "trait", "class", "interface"],
                &["/services/", "/repository/", "/domain/"],
                ctx,
            ) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.8,
                });
            }
        }
        if is_pascal_case(name) {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["struct", "class"],
                &["/models/", "/entity/", "/domain/", "/types/"],
                ctx,
            ) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.7,
                });
            }
        }

        None
    }
}

fn is_pascal_case(s: &str) -> bool {
    s.chars()
        .next()
        .map(|c| c.is_ascii_uppercase())
        .unwrap_or(false)
        && s.chars().all(|c| c.is_ascii_alphanumeric())
}
