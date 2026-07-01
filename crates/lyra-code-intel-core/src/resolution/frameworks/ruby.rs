//! Rails resolver — route extraction + controller/model/service resolution.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{line_at, make_ref, make_route_node, resolve_by_name_and_kind};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

pub struct RailsResolver;

const PLURAL_ACTIONS: &[&str] = &["index", "create", "new", "show", "edit", "update", "destroy"];
const SINGULAR_ACTIONS: &[&str] = &["create", "new", "show", "edit", "update", "destroy"];

fn restful_route(action: &str, res: &str) -> (&'static str, String) {
    match action {
        "index" => ("GET", format!("/{res}")),
        "create" => ("POST", format!("/{res}")),
        "new" => ("GET", format!("/{res}/new")),
        "show" => ("GET", format!("/{res}/:id")),
        "edit" => ("GET", format!("/{res}/:id/edit")),
        "update" => ("PATCH", format!("/{res}/:id")),
        "destroy" => ("DELETE", format!("/{res}/:id")),
        _ => ("GET", format!("/{res}")),
    }
}

impl FrameworkResolver for RailsResolver {
    fn name(&self) -> &'static str { "rails" }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        if let Some(c) = ctx.read_file("Gemfile") {
            if c.contains("'rails'") { return true; }
        }
        ctx.file_exists("config/application.rb")
            || ctx.file_exists("config/routes.rb")
            || ctx.file_exists("app/controllers/application_controller.rb")
    }

    fn extract(&self, file_path: &Path, content: &str, graph: &mut codegraph::CodeGraph) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("rb") { return vec![]; }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // get/post/put/patch/delete/match '/path', to: 'controller#action'
        let re = regex::Regex::new(
            r#"\b(get|post|put|patch|delete|match)\s+['"]([^'"]+)['"]\s*(?:,\s*to:\s*|=>\s*)['"]([^#'"]+)#([^'"]+)['""#,
        ).unwrap();
        for cap in re.captures_iter(content) {
            let method = &cap[1];
            let route_path = &cap[2];
            let ctrl = &cap[3];
            let action = &cap[4];
            let line = line_at(content, cap.get(0).unwrap().start());
            let upper = method.to_uppercase();
            let node_id = make_route_node(graph, &fp, line, &upper, route_path, "ruby");
            refs.push(make_ref(node_id, format!("{ctrl}#{action}"), EdgeType::References, file_path, line));
        }

        // resources :articles / resource :user
        let res_re = regex::Regex::new(r#"\b(resources?)\s+:(\w+)"#).unwrap();
        for cap in res_re.captures_iter(content) {
            let plural = &cap[1] == "resources";
            let res_name = &cap[2];
            let actions = if plural { PLURAL_ACTIONS } else { SINGULAR_ACTIONS };
            let ctrl = if plural { res_name.to_string() } else { pluralize(res_name) };
            let line = line_at(content, cap.get(0).unwrap().start());
            for &action in actions {
                let (verb, path) = restful_route(action, res_name);
                let node_id = make_route_node(graph, &fp, line, verb, &path, "ruby");
                refs.push(make_ref(node_id, format!("{ctrl}#{action}"), EdgeType::References, file_path, line));
            }
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;

        // controller#action pattern
        if let Some(cap) = regex::Regex::new(r"^([\w/]+)#(\w+)$").unwrap().captures(name) {
            let ctrl_path = &cap[1];
            let action = &cap[2];
            let direct = format!("app/controllers/{ctrl_path}_controller.rb");
            if ctx.file_exists(&direct) {
                let nodes = ctx.get_nodes_in_file(&direct);
                if let Some(n) = nodes.iter().find(|n| (n.kind == "method" || n.kind == "function") && n.name == action) {
                    return Some(ResolvedRef { target_node_id: n.id, confidence: 0.85 });
                }
            }
            let cls = camelize(ctrl_path.rsplit('/').next().unwrap_or("")) + "Controller";
            for ctrl in ctx.get_nodes_by_name(&cls).iter().filter(|n| n.kind == "class") {
                let nodes = ctx.get_nodes_in_file(&ctrl.path);
                if let Some(n) = nodes.iter().find(|n| (n.kind == "method" || n.kind == "function") && n.name == action) {
                    return Some(ResolvedRef { target_node_id: n.id, confidence: 0.85 });
                }
            }
            return None;
        }

        if is_pascal_case(name) {
            if let Some(id) = resolve_by_name_and_kind(name, &["class"], &["/models/", "/app/models/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.8 });
            }
        }
        if name.ends_with("Controller") {
            if let Some(id) = resolve_by_name_and_kind(name, &["class"], &["/controllers/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.85 });
            }
        }
        if name.ends_with("Service") || name.ends_with("Job") {
            if let Some(id) = resolve_by_name_and_kind(name, &["class"], &["/services/", "/jobs/", "/workers/"], ctx) {
                return Some(ResolvedRef { target_node_id: id, confidence: 0.8 });
            }
        }

        None
    }
}

fn pluralize(w: &str) -> String {
    if w.ends_with('y') && !["ay", "ey", "iy", "oy", "uy"].contains(&&w[w.len()-2..]) {
        format!("{}ies", &w[..w.len()-1])
    } else if w.ends_with('s') || w.ends_with('x') || w.ends_with('z') || w.ends_with("ch") || w.ends_with("sh") {
        format!("{w}es")
    } else {
        format!("{w}s")
    }
}

fn camelize(s: &str) -> String {
    s.split('_').map(|w| {
        let mut chars = w.chars();
        match chars.next() {
            Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
            None => String::new(),
        }
    }).collect()
}

fn is_pascal_case(s: &str) -> bool {
    s.chars().next().map(|c| c.is_ascii_uppercase()).unwrap_or(false) && s.chars().all(|c| c.is_ascii_alphanumeric())
}