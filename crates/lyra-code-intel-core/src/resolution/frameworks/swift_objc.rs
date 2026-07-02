//! Swift ↔ ObjC bridge resolver — cross-language method resolution.

use std::path::Path;

use super::helpers::detect_lang;
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct SwiftObjcBridgeResolver;

const GENERIC_NAMES: &[&str] = &[
    "init",
    "description",
    "hash",
    "isEqual",
    "copy",
    "class",
    "self",
    "count",
    "length",
    "value",
    "name",
    "data",
    "string",
    "add",
    "remove",
    "update",
    "load",
    "save",
    "reload",
    "cancel",
    "start",
    "stop",
    "close",
    "open",
    "show",
    "hide",
    "dealloc",
];

impl FrameworkResolver for SwiftObjcBridgeResolver {
    fn name(&self) -> &'static str {
        "swift-objc-bridge"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        let mut has_swift = false;
        let mut has_objc = false;
        for f in ctx.get_all_files() {
            if f.ends_with(".swift") {
                has_swift = true;
            }
            if f.ends_with(".m") || f.ends_with(".mm") {
                has_objc = true;
            }
            if has_swift && has_objc {
                return true;
            }
        }
        false
    }

    fn extract(
        &self,
        _file_path: &Path,
        _content: &str,
        _graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        vec![]
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;
        let lang = reference
            .file_path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| match e {
                "swift" => "swift",
                "m" | "mm" => "objc",
                _ => detect_lang(&reference.file_path),
            })
            .unwrap_or("unknown");

        match lang {
            "swift" => {
                // Swift call → ObjC method. Strip qualified prefix.
                let bare = name.rsplit('.').next().unwrap_or(name);
                if GENERIC_NAMES.contains(&bare) {
                    return None;
                }

                // Find ObjC methods whose first selector keyword matches.
                let methods = ctx.get_nodes_by_kind(&["method", "function"]);
                for m in methods {
                    if m.kind != "method" && m.kind != "function" {
                        continue;
                    }
                    // Check if it's an ObjC method (language property or file extension).
                    let is_objc = m.path.ends_with(".m") || m.path.ends_with(".mm");
                    if !is_objc {
                        continue;
                    }
                    // ObjC selector: `fooBar:baz:` — first keyword is before first `:`.
                    let first_kw = m.name.split(':').next().unwrap_or(&m.name);
                    if first_kw == bare {
                        return Some(ResolvedRef {
                            target_node_id: m.id,
                            confidence: 0.6,
                        });
                    }
                }
            }
            "objc" => {
                // ObjC call → Swift @objc method. Only handle selector-shape names.
                if !name.contains(':') {
                    return None;
                }
                // Derive candidate Swift base names from selector.
                let first_kw = name.split(':').next().unwrap_or(name);
                // Try the first keyword as a Swift method name.
                let methods = ctx.get_nodes_by_name(first_kw);
                for m in methods {
                    if m.kind != "method" && m.kind != "function" {
                        continue;
                    }
                    let is_swift = m.path.ends_with(".swift");
                    if !is_swift {
                        continue;
                    }
                    // ponytail: no @objc source-window check. Ceiling: false
                    // positives on non-@objc Swift methods with same name.
                    // Upgrade path: read source window and check for @objc.
                    return Some(ResolvedRef {
                        target_node_id: m.id,
                        confidence: 0.6,
                    });
                }
            }
            _ => {}
        }

        None
    }
}
