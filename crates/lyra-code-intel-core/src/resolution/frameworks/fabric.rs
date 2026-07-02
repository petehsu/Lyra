//! React Native Fabric/Codegen resolver — view component spec extraction.

use std::path::Path;

use super::helpers::{detect_lang, line_at, make_synthetic_node, pkg_json_has_dep};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct FabricViewResolver;

impl FrameworkResolver for FabricViewResolver {
    fn name(&self) -> &'static str {
        "fabric-view"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if pkg_json_has_dep(ctx, |d| d == "react-native") {
            return true;
        }
        ctx.get_all_files().iter().take(200).any(|f| {
            if f.ends_with(".ts") || f.ends_with(".tsx") {
                ctx.read_file(f)
                    .map(|c| c.contains("codegenNativeComponent"))
                    .unwrap_or(false)
            } else if f.ends_with(".m") || f.ends_with(".mm") {
                ctx.read_file(f)
                    .map(|c| c.contains("RCT_EXPORT_VIEW_PROPERTY"))
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
        let fp = file_path.to_string_lossy();
        let lang = detect_lang(file_path);

        // TS/TSX: codegenNativeComponent<Props>('Name')
        if matches!(lang, "typescript") {
            if !content.contains("codegenNativeComponent") {
                return vec![];
            }
            let re = regex::Regex::new(
                r#"codegenNativeComponent\s*(?:<[^>]+>)?\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]"#,
            )
            .unwrap();
            for cap in re.captures_iter(content) {
                let name = &cap[1];
                let line = line_at(content, cap.get(0).unwrap().start());
                make_synthetic_node(graph, "component", name, &fp, line, lang);
            }
            // NativeProps interface — extract prop names.
            if let Some(body) = find_native_props_body(content) {
                for prop in extract_prop_names(&body) {
                    let line = content
                        .find(&prop)
                        .map(|i| line_at(content, i))
                        .unwrap_or(1);
                    make_synthetic_node(graph, "property", &prop, &fp, line, lang);
                }
            }
        }

        // ObjC: RCT_EXPORT_VIEW_PROPERTY(name, type) + @implementation class
        if lang == "objc" {
            if !content.contains("RCT_EXPORT_VIEW_PROPERTY")
                && !content.contains("RCT_CUSTOM_VIEW_PROPERTY")
            {
                return vec![];
            }
            if let Some(cap) = regex::Regex::new(r"@implementation\s+(\w+)")
                .unwrap()
                .captures(content)
            {
                let class_name = &cap[1];
                if class_name.ends_with("Manager") || class_name.ends_with("ViewManager") {
                    let component_name = derive_component_name(class_name);
                    let line = line_at(content, cap.get(0).unwrap().start());
                    make_synthetic_node(graph, "component", &component_name, &fp, line, lang);

                    let prop_re = regex::Regex::new(
                        r"RCT_(?:EXPORT|CUSTOM|REMAP)_VIEW_PROPERTY\s*\(\s*(\w+)",
                    )
                    .unwrap();
                    for prop_cap in prop_re.captures_iter(content) {
                        let prop_line = line_at(content, prop_cap.get(0).unwrap().start());
                        make_synthetic_node(graph, "property", &prop_cap[1], &fp, prop_line, lang);
                    }
                }
            }
        }

        vec![]
    }

    fn resolve(&self, _reference: &UnresolvedRef, _ctx: &ResolutionContext) -> Option<ResolvedRef> {
        None
    }
}

fn derive_component_name(class: &str) -> String {
    let name = class.strip_prefix("RCT").unwrap_or(class);
    if let Some(s) = name.strip_suffix("ViewManager") {
        s.to_string()
    } else if let Some(s) = name.strip_suffix("Manager") {
        s.to_string()
    } else {
        name.to_string()
    }
}

fn find_native_props_body(content: &str) -> Option<String> {
    let re = regex::Regex::new(r"export\s+interface\s+NativeProps\b[^{]*\{([\s\S]*?)\n\}").unwrap();
    re.captures(content).map(|c| c[1].to_string())
}

fn extract_prop_names(body: &str) -> Vec<String> {
    let re = regex::Regex::new(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\??\s*:").unwrap();
    re.captures_iter(body).map(|c| c[1].to_string()).collect()
}
