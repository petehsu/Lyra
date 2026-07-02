//! Spring resolver — annotation-based HTTP route extraction + DI resolution.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{join_path, line_at, make_ref, make_route_node, resolve_by_name_and_kind};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct SpringResolver;

impl FrameworkResolver for SpringResolver {
    fn name(&self) -> &'static str {
        "spring"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        for f in &["pom.xml", "build.gradle", "build.gradle.kts"] {
            if let Some(c) = ctx.read_file(f) {
                if c.contains("spring-boot") || c.contains("springframework") {
                    return true;
                }
            }
        }
        ctx.get_all_files()
            .iter()
            .filter(|f| f.ends_with(".java"))
            .take(30)
            .any(|f| {
                ctx.read_file(f)
                    .map(|c| {
                        c.contains("@SpringBootApplication")
                            || c.contains("@RestController")
                            || c.contains("@Service")
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
        let Some(ext) = file_path.extension().and_then(|e| e.to_str()) else {
            return vec![];
        };
        if !matches!(ext, "java" | "kt") {
            return vec![];
        }
        let lang = if ext == "kt" { "kotlin" } else { "java" };
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // Class-level @RequestMapping prefix
        let cls_re = regex::Regex::new(r#"@RequestMapping\s*\(\s*["']([^'"]*)['"]"#).unwrap();
        let class_prefix = content
            .find("@RequestMapping")
            .and_then(|_| {
                // Only treat as class prefix if followed by `class`
                let after = &content[content.find("@RequestMapping").unwrap()..];
                if after.contains("class") {
                    cls_re.captures(after).map(|c| c[1].to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        // @GetMapping/@PostMapping/etc.
        let verb_map = [
            ("GetMapping", "GET"),
            ("PostMapping", "POST"),
            ("PutMapping", "PUT"),
            ("PatchMapping", "PATCH"),
            ("DeleteMapping", "DELETE"),
        ];
        for (deco, verb) in verb_map {
            let re = regex::Regex::new(&format!(r#"@{deco}\s*(?:\(\s*["']([^'"]*)['"]\s*\))?"#))
                .unwrap();
            for cap in re.captures_iter(content) {
                let sub = cap
                    .get(1)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default();
                let route_path = join_path(&class_prefix, &sub);
                let line = line_at(content, cap.get(0).unwrap().start());
                let node_id = make_route_node(graph, &fp, line, verb, &route_path, lang);
                // Find method name after decorator.
                let after = &content[cap.get(0).unwrap().end()..];
                let window = &after[..after.len().min(400)];
                // Java: `retType name(` or Kotlin: `fun name(`
                let method_re = regex::Regex::new(r#"(?:fun\s+(\w+)\s*\(|(?:public|private|protected)\s+[\w<>,\s\[\]?.]+?\s+(\w+)\s*\()"#).unwrap();
                if let Some(m) = method_re.captures(window) {
                    let name = m.get(1).or(m.get(2)).map(|m| m.as_str().to_string());
                    if let Some(name) = name {
                        refs.push(make_ref(
                            node_id,
                            name,
                            EdgeType::References,
                            file_path,
                            line,
                        ));
                    }
                }
            }
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;

        if name.ends_with("Service") {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["class", "interface"],
                &["/service/", "/services/"],
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
                &["/repository/", "/repositories/"],
                ctx,
            ) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.85,
                });
            }
        }
        if name.ends_with("Controller") {
            if let Some(id) =
                resolve_by_name_and_kind(name, &["class"], &["/controller/", "/controllers/"], ctx)
            {
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
                &["/entity/", "/entities/", "/model/", "/domain/"],
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
