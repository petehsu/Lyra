//! React Native bridge resolver — JS ↔ native (ObjC/Java/Kotlin) method resolution.

use std::path::Path;

use super::helpers::{detect_lang, line_at, make_synthetic_node, pkg_json_has_dep};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct ReactNativeBridgeResolver;

const RN_EMITTER_BUILTINS: &[&str] = &[
    "addListener", "removeListeners", "remove", "invalidate", "startObserving", "stopObserving",
];

impl FrameworkResolver for ReactNativeBridgeResolver {
    fn name(&self) -> &'static str { "react-native-bridge" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if pkg_json_has_dep(ctx, |d| d == "react-native") { return true; }
        // Fallback: scan first ~200 files for RCT_EXPORT_MODULE or TurboModuleRegistry.
        ctx.get_all_files().iter().take(200).any(|f| {
            if f.ends_with(".mm") || f.ends_with(".m") {
                ctx.read_file(f).map(|c| c.contains("RCT_EXPORT_MODULE")).unwrap_or(false)
            } else if f.ends_with(".ts") || f.ends_with(".tsx") {
                ctx.read_file(f).map(|c| c.contains("TurboModuleRegistry.get")).unwrap_or(false)
            } else { false }
        })
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        let fp = file_path.to_string_lossy();
        if !(fp.ends_with(".m") || fp.ends_with(".mm")) { return vec![]; }
        if !content.contains("RCT_EXPORT_MODULE") { return vec![]; }

        let mut refs = Vec::new();
        let lang = "objc";

        // Find @implementation class name for default module name.
        let class_name = regex::Regex::new(r"@implementation\s+(\w+)").unwrap().captures(content).map(|c| c[1].to_string());
        let module_name = regex::Regex::new(r"RCT_EXPORT_MODULE\s*\(\s*(\w+)?\s*\)").unwrap().captures(content)
            .and_then(|c| c.get(1).map(|m| m.as_str().to_string()))
            .or_else(|| class_name.as_ref().map(|cn| cn.strip_prefix("RCT").unwrap_or(cn).to_string()));

        // RCT_EXPORT_METHOD(selectorFirstKw:...)
        let export_re = regex::Regex::new(r"RCT_EXPORT_METHOD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)").unwrap();
        for cap in export_re.captures_iter(content) {
            let js_name = &cap[1];
            if RN_EMITTER_BUILTINS.contains(&js_name) { continue; }
            let line = line_at(content, cap.get(0).unwrap().start());
            make_synthetic_node(graph, "method", js_name, &fp, line, lang);
        }

        // RCT_REMAP_METHOD(jsName, nativeSelector:...)
        let remap_re = regex::Regex::new(r"RCT_REMAP_METHOD\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)").unwrap();
        for cap in remap_re.captures_iter(content) {
            let js_name = &cap[1];
            if RN_EMITTER_BUILTINS.contains(&js_name) { continue; }
            let line = line_at(content, cap.get(0).unwrap().start());
            make_synthetic_node(graph, "method", js_name, &fp, line, lang);
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        // Only redirect JS callers.
        let lang = reference.file_path.extension().and_then(|e| e.to_str()).map(|e| match e {
            "ts" | "tsx" => "typescript",
            "js" | "jsx" | "mjs" => "javascript",
            _ => detect_lang(&reference.file_path),
        }).unwrap_or("unknown");

        if !matches!(lang, "typescript" | "javascript") { return None; }

        let name = &reference.reference_name;
        let bare = name.rsplit('.').next().unwrap_or(name);
        if RN_EMITTER_BUILTINS.contains(&bare) { return None; }

        // Look for native methods (ObjC or Java/Kotlin) with this name.
        let methods = ctx.get_nodes_by_name(bare);
        for m in methods.iter().filter(|n| n.kind == "method") {
            let is_native = m.path.ends_with(".m") || m.path.ends_with(".mm")
                || m.path.ends_with(".java") || m.path.ends_with(".kt");
            if is_native {
                return Some(ResolvedRef { target_node_id: m.id, confidence: 0.6 });
            }
        }

        None
    }
}