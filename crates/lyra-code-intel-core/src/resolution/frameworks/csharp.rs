//! C# ASP.NET resolver — attribute route extraction + DI resolution.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{
    extract_tail_ident, join_path, line_at, make_ref, make_route_node, resolve_by_name_and_kind,
};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct AspNetResolver;

impl FrameworkResolver for AspNetResolver {
    fn name(&self) -> &'static str {
        "aspnet"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        // .csproj with ASP.NET references
        for f in ctx
            .get_all_files()
            .iter()
            .filter(|f| f.ends_with(".csproj"))
            .take(10)
        {
            if let Some(c) = ctx.read_file(f) {
                if c.contains("Microsoft.AspNetCore") || c.contains("Microsoft.NET.Sdk.Web") {
                    return true;
                }
            }
        }
        if ctx.file_exists("Startup.cs") {
            return true;
        }
        // Source-level detection
        ctx.get_all_files()
            .iter()
            .filter(|f| {
                f.ends_with("Controller.cs")
                    || f.ends_with("Program.cs")
                    || f.ends_with("Startup.cs")
            })
            .take(30)
            .any(|f| {
                ctx.read_file(f)
                    .map(|c| {
                        c.contains("ControllerBase")
                            || c.contains("WebApplication")
                            || c.contains("[HttpGet")
                            || c.contains("[Route")
                    })
                    .unwrap_or(false)
            })
    }

    fn extract(
        &self,
        file_path: &Path,
        content: &str,
        graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("cs") {
            return vec![];
        }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // Class-level [Route("api/[controller]")] prefix
        let cls_re = regex::Regex::new(r#"\[Route\s*\(\s*"([^"]+)"#).unwrap();
        let class_prefix = content
            .find("[Route")
            .and_then(|_| {
                let after = &content[content.find("[Route").unwrap()..];
                if after.contains("class") {
                    cls_re.captures(after).map(|c| c[1].to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        // [HttpGet], [HttpGet("path")], etc.
        let attrs = [
            ("HttpGet", "GET"),
            ("HttpPost", "POST"),
            ("HttpPut", "PUT"),
            ("HttpPatch", "PATCH"),
            ("HttpDelete", "DELETE"),
        ];
        for (attr, verb) in attrs {
            let re = regex::Regex::new(&format!(r#"\[{attr}(?:\s*\(\s*"([^"]*)"[^)]*\))?\s*\]"#))
                .unwrap();
            for cap in re.captures_iter(content) {
                let sub = cap
                    .get(1)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                let route_path = join_path(&class_prefix, &sub);
                let line = line_at(content, cap.get(0).unwrap().start());
                let node_id = make_route_node(graph, &fp, line, verb, &route_path, "csharp");
                let after = &content[cap.get(0).unwrap().end()..];
                let window = &after[..after.len().min(400)];
                if let Some(m) = regex::Regex::new(
                    r#"(?:public|private|protected|internal)\s+[\w<>,\s\[\]?.]+?\s+(\w+)\s*\("#,
                )
                .unwrap()
                .captures(window)
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
        }

        // Minimal APIs: app.MapGet("/path", handler)
        let min_re = regex::Regex::new(
            r#"\.Map(Get|Post|Put|Patch|Delete)\s*\(\s*"([^"]+)"\s*,\s*([^,)]+)"#,
        )
        .unwrap();
        for cap in min_re.captures_iter(content) {
            let verb = cap[1].to_uppercase();
            let route_path = &cap[2];
            let handler = &cap[3];
            let line = line_at(content, cap.get(0).unwrap().start());
            let node_id = make_route_node(graph, &fp, line, &verb, route_path, "csharp");
            if let Some(name) = extract_tail_ident(handler) {
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

        if name.ends_with("Controller") {
            if let Some(id) = resolve_by_name_and_kind(name, &["class"], &["/Controllers/"], ctx) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.85,
                });
            }
        }
        if name.ends_with("Service") || (name.starts_with('I') && name.len() > 1) {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["class", "interface"],
                &["/Services/", "/Application/"],
                ctx,
            ) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.85,
                });
            }
        }
        if name.ends_with("Repository") {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["class", "interface"],
                &["/Repositories/", "/Data/"],
                ctx,
            ) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.85,
                });
            }
        }
        if is_pascal_case(name) {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["class"],
                &["/Models/", "/Entities/", "/Domain/"],
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
