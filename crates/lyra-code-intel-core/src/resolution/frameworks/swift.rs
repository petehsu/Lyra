//! Swift resolvers — SwiftUI, UIKit, Vapor.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{line_at, make_ref, make_route_node, make_synthetic_node, resolve_by_name_and_kind};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

// ── SwiftUI ────────────────────────────────────────────────────────────

pub struct SwiftUiResolver;

impl FrameworkResolver for SwiftUiResolver {
    fn name(&self) -> &'static str { "swiftui" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        ctx.get_all_files().iter().filter(|f| f.ends_with(".swift")).take(50).any(|f| {
            ctx.read_file(f).map(|c| c.contains("import SwiftUI")).unwrap_or(false)
        })
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("swift") { return vec![]; }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // struct ContentView: View { ... }
        let re = regex::Regex::new(r"struct\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*View").unwrap();
        for cap in re.captures_iter(content) {
            let view_name = &cap[1];
            let line = line_at(content, cap.get(0).unwrap().start());
            make_synthetic_node(graph, "component", view_name, &fp, line, "swift");
        }

        // @main struct MyApp: App
        let app_re = regex::Regex::new(r"@main\s+struct\s+(\w+)\s*:\s*App").unwrap();
        for cap in app_re.captures_iter(content) {
            let app_name = &cap[1];
            let line = line_at(content, cap.get(0).unwrap().start());
            make_synthetic_node(graph, "class", app_name, &fp, line, "swift");
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;
        if name.ends_with("View") && name.chars().next().map(|c| c.is_ascii_uppercase()).unwrap_or(false) {
            if let Some(id) = resolve_by_name_and_kind(name, &["struct", "component", "class"], &["/Views/", "/Screens/", "/Components/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.85 });
            }
        }
        if name.ends_with("ViewModel") || name.ends_with("Store") || name.ends_with("Manager") {
            if let Some(id) = resolve_by_name_and_kind(name, &["class"], &["/ViewModels/", "/Stores/", "/Managers/", "/Services/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.85 });
            }
        }
        None
    }
}

// ── UIKit ──────────────────────────────────────────────────────────────

pub struct UiKitResolver;

impl FrameworkResolver for UiKitResolver {
    fn name(&self) -> &'static str { "uikit" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        ctx.get_all_files().iter().filter(|f| f.ends_with(".swift")).take(50).any(|f| {
            ctx.read_file(f).map(|c| c.contains("import UIKit") || c.contains("UIViewController") || c.contains("UIView")).unwrap_or(false)
        })
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("swift") { return vec![]; }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // class FooViewController: UIViewController
        let vc_re = regex::Regex::new(r"class\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*UIViewController").unwrap();
        for cap in vc_re.captures_iter(content) {
            let line = line_at(content, cap.get(0).unwrap().start());
            make_synthetic_node(graph, "class", &cap[1], &fp, line, "swift");
        }

        // class FooView: UIView (not ViewController)
        let view_re = regex::Regex::new(r"class\s+(\w+)\s*:\s*(?:\w+\s*,\s*)*UIView[^C]").unwrap();
        for cap in view_re.captures_iter(content) {
            let line = line_at(content, cap.get(0).unwrap().start());
            make_synthetic_node(graph, "class", &cap[1], &fp, line, "swift");
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;
        if name.ends_with("ViewController") {
            if let Some(id) = resolve_by_name_and_kind(name, &["class"], &["/ViewControllers/", "/Controllers/", "/Screens/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.85 });
            }
        }
        if name.ends_with("View") && !name.ends_with("ViewController") {
            if let Some(id) = resolve_by_name_and_kind(name, &["class"], &["/Views/", "/UI/", "/Components/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.8 });
            }
        }
        if name.ends_with("Cell") {
            if let Some(id) = resolve_by_name_and_kind(name, &["class"], &["/Cells/", "/Views/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.85 });
            }
        }
        None
    }
}

// ── Vapor ──────────────────────────────────────────────────────────────

pub struct VaporResolver;

impl FrameworkResolver for VaporResolver {
    fn name(&self) -> &'static str { "vapor" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if let Some(c) = ctx.read_file("Package.swift") {
            if c.contains("vapor") { return true; }
        }
        ctx.get_all_files().iter().filter(|f| f.ends_with(".swift")).take(50).any(|f| {
            ctx.read_file(f).map(|c| c.contains("import Vapor")).unwrap_or(false)
        })
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("swift") { return vec![]; }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // routes.get("path", use: handler) or routes.get(use: handler)
        // ponytail: group prefix tracking skipped for MVP. Ceiling: grouped
        // routes lose their prefix. Upgrade path: port group var tracking.
        let re = regex::Regex::new(
            r#"\b(\w+)\.(get|post|put|patch|delete|head|options)\s*\(\s*(?:([^,)]*),\s*)?use:\s*([A-Za-z_][\w.]*)"#,
        ).unwrap();
        for cap in re.captures_iter(content) {
            let method = &cap[2];
            let segs = cap.get(3).map(|m| m.as_str()).unwrap_or("");
            let handler_expr = &cap[4];
            // Build path from string segments before `use:`
            let mut path = String::new();
            for str_cap in regex::Regex::new(r#""([^"]*)""#).unwrap().captures_iter(segs) {
                path.push('/');
                path.push_str(&str_cap[1]);
            }
            if path.is_empty() { path = "/".to_string(); }
            let line = line_at(content, cap.get(0).unwrap().start());
            let upper = method.to_uppercase();
            let node_id = make_route_node(graph, &fp, line, &upper, &path, "swift");
            let handler = handler_expr.rsplit('.').next().unwrap_or(handler_expr);
            refs.push(make_ref(node_id, handler.to_string(), EdgeType::References, file_path, line));
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;
        if name.ends_with("Controller") {
            if let Some(id) = resolve_by_name_and_kind(name, &["class", "struct"], &["/Controllers/", "/Routes/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.85 });
            }
        }
        if is_pascal_case(name) {
            if let Some(id) = resolve_by_name_and_kind(name, &["class", "struct"], &["/Models/", "/Entities/", "/Database/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.75 });
            }
        }
        None
    }
}

fn is_pascal_case(s: &str) -> bool {
    s.chars().next().map(|c| c.is_ascii_uppercase()).unwrap_or(false) && s.chars().all(|c| c.is_ascii_alphanumeric())
}