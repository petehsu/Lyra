//! GoFrame resolver — g.Meta struct tag route extraction.

use std::path::Path;

use super::helpers::{line_at, make_route_node};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct GoFrameResolver;

impl FrameworkResolver for GoFrameResolver {
    fn name(&self) -> &'static str { "goframe" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        ctx.read_file("go.mod").map(|c| c.contains("github.com/gogf/gf")).unwrap_or(false)
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("go") { return vec![]; }
        if !content.contains("g.Meta") { return vec![]; }

        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // type FooReq struct { g.Meta `path:"/x" method:"post"` }
        let re = regex::Regex::new(r#"type\s+(\w+)\s+struct\s*\{\s*g\.Meta\s+`([^`]*)`"#).unwrap();
        for cap in re.captures_iter(content) {
            let tag = &cap[2];
            let path = regex::Regex::new(r#"path:"([^"]+)""#).unwrap().captures(tag).map(|c| c[1].to_string());
            let method = regex::Regex::new(r#"method:"([^"]+)""#).unwrap().captures(tag).map(|c| c[1].to_uppercase()).unwrap_or_else(|| "ANY".to_string());
            if let Some(path) = path {
                let line = line_at(content, cap.get(0).unwrap().start());
                make_route_node(graph, &fp, line, &method, &path, "go");
            }
        }

        refs
    }

    fn resolve(&self, _reference: &UnresolvedRef, _ctx: &ResolutionContext) -> Option<ResolvedRef> {
        None
    }
}