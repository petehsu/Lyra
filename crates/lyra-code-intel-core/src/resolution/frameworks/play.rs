//! Play Framework resolver — conf/routes file parsing.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{line_at, make_ref, make_route_node};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct PlayResolver;

impl FrameworkResolver for PlayResolver {
    fn name(&self) -> &'static str { "play" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if let Some(c) = ctx.read_file("build.sbt") {
            if c.contains("playframework") || c.contains("\"play\"") || c.contains("PlayScala") || c.contains("PlayJava") { return true; }
        }
        ctx.file_exists("conf/routes") || ctx.file_exists("conf/application.conf")
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        // ponytail: original TS checks `isPlayRoutesFile(filePath)` — we approximate
        // by checking if the path ends with `routes` or `.routes`.
        let fp = file_path.to_string_lossy();
        let base = fp.rsplit('/').next().unwrap_or(&fp);
        if base != "routes" && !base.ends_with(".routes") { return vec![]; }

        let mut refs = Vec::new();
        let re = regex::Regex::new(r"^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+(.+)$").unwrap();

        for (i, line) in content.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("->") { continue; }
            let Some(cap) = re.captures(trimmed) else { continue; };
            let method = &cap[1];
            let route_path = &cap[2];
            let action = &cap[3];
            // Parse handler: `controllers.Application.list(p: Int ?= 0)` → `Application.list`
            let fqn = action.split('(').next().unwrap_or(action).trim();
            let parts: Vec<&str> = fqn.split('.').filter(|s| !s.is_empty()).collect();
            if parts.len() < 2 { continue; }
            let handler = format!("{}.{}", parts[parts.len()-2], parts[parts.len()-1]);
            let line_num = (i + 1) as u32;
            let node_id = make_route_node(graph, &fp, line_num, method, route_path, "scala");
            refs.push(make_ref(node_id, handler, EdgeType::References, file_path, line_num));
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;
        // Controller.method pattern
        if let Some(cap) = regex::Regex::new(r"^(\w+)\.(\w+)$").unwrap().captures(name) {
            let class_name = &cap[1];
            let method_name = &cap[2];
            for cls in ctx.get_nodes_by_name(class_name).iter().filter(|n| n.kind == "class") {
                let nodes = ctx.get_nodes_in_file(&cls.path);
                if let Some(n) = nodes.iter().find(|n| (n.kind == "method" || n.kind == "function") && n.name == method_name) {
                    return Some(ResolvedRef { target_node_id: n.id, confidence: 0.9 });
                }
            }
        }
        None
    }
}