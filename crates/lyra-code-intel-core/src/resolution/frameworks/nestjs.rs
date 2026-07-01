//! NestJS resolver — decorator-based HTTP/GraphQL/Microservice routes.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{line_at, make_ref, make_route_node, pkg_json_has_dep, resolve_by_name_and_kind};
use crate::resolution::types::{
    FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef,
};

pub struct NestjsResolver;

const HTTP_VERBS: &[&str] = &["Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "All"];

impl FrameworkResolver for NestjsResolver {
    fn name(&self) -> &'static str { "nestjs" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if pkg_json_has_dep(ctx, |d| d.starts_with("@nestjs/")) { return true; }
        ctx.get_all_files().iter().filter(|f| {
            f.ends_with(".controller.ts") || f.ends_with(".controller.js")
                || f.ends_with(".module.ts") || f.ends_with(".resolver.ts")
                || f.ends_with(".gateway.ts")
        }).take(20).any(|f| {
            ctx.read_file(f).map(|c| c.contains("@nestjs/") || c.contains("@Controller")).unwrap_or(false)
        })
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        let Some(ext) = file_path.extension().and_then(|e| e.to_str()) else { return vec![]; };
        if !matches!(ext, "js" | "ts" | "jsx" | "tsx" | "mjs" | "cjs") { return vec![]; }
        let lang = super::helpers::detect_lang(file_path);
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // Find @Controller prefix for class-level route prefix.
        let ctrl_re = regex::Regex::new(r#"@Controller\s*\(\s*['"`]([^'"`]*)['"`]"#).unwrap();
        let class_prefix = ctrl_re.captures(content).map(|c| c[1].to_string()).unwrap_or_default();

        // Method-level decorators: @Get('/path'), @Post(), etc.
        let verb_re = regex::Regex::new(
            &format!(r#"@(?:{})\s*(?:\(\s*['"`]([^'"`]*)['"`]\s*\))?"#, HTTP_VERBS.join("|")),
        ).unwrap();
        for cap in verb_re.captures_iter(content) {
            let verb = cap.get(0).unwrap().as_str();
            // Extract the decorator name (Get, Post, etc.)
            let deco_name = verb.split('(').next().unwrap_or("").trim_start_matches('@');
            let sub_path = cap.get(1).map(|m| m.as_str().to_string()).unwrap_or_default();
            let route_path = super::helpers::join_path(&class_prefix, &sub_path);
            let line = line_at(content, cap.get(0).unwrap().start());
            let upper = deco_name.to_uppercase();
            let node_id = make_route_node(graph, &fp, line, &upper, &route_path, lang);

            // Find the method name after the decorator.
            let after = &content[cap.get(0).unwrap().end()..];
            if let Some(m) = find_method_name(after) {
                refs.push(make_ref(node_id, m, EdgeType::References, file_path, line));
            }
        }

        // GraphQL: @Query/@Mutation/@Subscription inside @Resolver classes.
        let gql_re = regex::Regex::new(r#"@(Query|Mutation|Subscription)\s*(?:\(\s*['"`]([^'"`]*)['"`]\s*\))?"#).unwrap();
        for cap in gql_re.captures_iter(content) {
            let op = &cap[1];
            let name = cap.get(2).map(|m| m.as_str().to_string()).unwrap_or_default();
            let line = line_at(content, cap.get(0).unwrap().start());
            let node_id = make_route_node(graph, &fp, line, &op.to_uppercase(), &name, lang);
            let after = &content[cap.get(0).unwrap().end()..];
            if let Some(m) = find_method_name(after) {
                refs.push(make_ref(node_id, m, EdgeType::References, file_path, line));
            }
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;
        let conventions: &[(&str, &str)] = &[
            ("Service", ".service."),
            ("Controller", ".controller."),
            ("Resolver", ".resolver."),
            ("Gateway", ".gateway."),
            ("Repository", ".repository."),
            ("Guard", ".guard."),
        ];
        for (suffix, convention) in conventions {
            if name.ends_with(suffix) {
                if let Some(id) = resolve_by_name_and_kind(name, &["class"], &[convention], ctx) {
                    return Some(ResolvedRef { target_node_id: id, confidence: 0.85 });
                }
                // Fallback: any class with this name.
                if let Some(id) = resolve_by_name_and_kind(name, &["class"], &[], ctx) {
                    return Some(ResolvedRef { target_node_id: id, confidence: 0.7 });
                }
            }
        }
        None
    }
}

/// Find the method name following a decorator.
fn find_method_name(after: &str) -> Option<String> {
    // Skip stacked decorators and modifiers, then find `name(`.
    let re = regex::Regex::new(r#"(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|async|static)\s+)*(\w+)\s*\("#).unwrap();
    // Take a bounded window.
    let window = &after[..after.len().min(300)];
    re.captures(window).map(|c| c[1].to_string())
}