//! Expo Modules resolver — Function/AsyncFunction/Property DSL on Swift/Kotlin.

use std::path::Path;

use super::helpers::{detect_lang, line_at, make_synthetic_node};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct ExpoModulesResolver;

impl FrameworkResolver for ExpoModulesResolver {
    fn name(&self) -> &'static str {
        "expo-modules"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if super::helpers::pkg_json_has_dep(ctx, |d| d == "expo-modules-core") {
            return true;
        }
        ctx.get_all_files().iter().take(200).any(|f| {
            if f.ends_with(".swift") || f.ends_with(".kt") {
                ctx.read_file(f)
                    .map(|c| {
                        regex::Regex::new(r"class\s+\w+\s*:\s*Module\b")
                            .unwrap()
                            .is_match(&c)
                            && regex::Regex::new(r#"\b(Function|AsyncFunction|Property)\s*\("#)
                                .unwrap()
                                .is_match(&c)
                    })
                    .unwrap_or(false)
            } else {
                false
            }
        })
    }

    fn extract(
        &self,
        file_path: &Path,
        content: &str,
        graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        let lang = detect_lang(file_path);
        if !matches!(lang, "swift" | "kotlin") {
            return vec![];
        }
        // Gate: must be an Expo Module source.
        let class_re = regex::Regex::new(r"class\s+\w+\s*:\s*Module\b").unwrap();
        if !class_re.is_match(content) {
            return vec![];
        }

        let fp = file_path.to_string_lossy();
        let decl_re = regex::Regex::new(
            r#"\b(Function|AsyncFunction|Property|Constants)\s*(?:<[^(]*>)?\s*\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']"#,
        ).unwrap();
        for cap in decl_re.captures_iter(content) {
            let method_name = &cap[2];
            let line = line_at(content, cap.get(0).unwrap().start());
            make_synthetic_node(graph, "method", method_name, &fp, line, lang);
        }

        vec![]
    }

    fn resolve(&self, _reference: &UnresolvedRef, _ctx: &ResolutionContext) -> Option<ResolvedRef> {
        None
    }
}
