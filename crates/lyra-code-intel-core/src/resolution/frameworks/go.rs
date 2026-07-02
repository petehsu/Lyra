//! Go resolver — Gin/Echo/Fiber/Chi route extraction + handler/service resolution.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{
    extract_tail_ident, line_at, make_ref, make_route_node, resolve_by_name_and_kind,
};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct GoResolver;

impl FrameworkResolver for GoResolver {
    fn name(&self) -> &'static str {
        "go"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        ctx.read_file("go.mod").is_some() || ctx.get_all_files().iter().any(|f| f.ends_with(".go"))
    }

    fn extract(
        &self,
        file_path: &Path,
        content: &str,
        graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("go") {
            return vec![];
        }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // anyVar.METHOD("path", handler)
        let re = regex::Regex::new(
            r#"\b\w+\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Get|Post|Put|Patch|Delete|Handle|HandleFunc)\s*\(\s*"([^"]+)"\s*,\s*([^)]+)\)"#,
        ).unwrap();
        for cap in re.captures_iter(content) {
            let raw_method = &cap[1];
            let route_path = &cap[2];
            let handler_expr = &cap[3];
            let line = line_at(content, cap.get(0).unwrap().start());
            let method = if raw_method == "Handle" || raw_method == "HandleFunc" {
                "ANY".to_string()
            } else {
                raw_method.to_uppercase()
            };
            let node_id = make_route_node(graph, &fp, line, &method, route_path, "go");
            if let Some(name) = extract_tail_ident(handler_expr) {
                refs.push(make_ref(
                    node_id,
                    name,
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

        if name.ends_with("Handler") || name.starts_with("Handle") {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["function"],
                &["/handler/", "/api/", "/routes/"],
                ctx,
            ) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.8,
                });
            }
        }
        if name.ends_with("Service") || name.ends_with("Repository") || name.ends_with("Store") {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["struct", "interface", "class"],
                &["/service/", "/repository/", "/store/"],
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
                &["/model/", "/models/", "/entity/", "/domain/"],
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
