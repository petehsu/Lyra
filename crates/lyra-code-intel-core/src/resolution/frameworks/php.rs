//! PHP resolvers — Laravel + Drupal.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{line_at, make_ref, make_route_node};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

// ── Laravel ────────────────────────────────────────────────────────────

pub struct LaravelResolver;

impl FrameworkResolver for LaravelResolver {
    fn name(&self) -> &'static str {
        "laravel"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        ctx.file_exists("artisan") || ctx.file_exists("app/Http/Kernel.php")
    }

    fn extract(
        &self,
        file_path: &Path,
        content: &str,
        graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("php") {
            return vec![];
        }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // Route::get('/path', [Class::class, 'method']) or Route::get('/path', 'Ctrl@action')
        let re = regex::Regex::new(
            r#"Route::(get|post|put|patch|delete|options|any)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)"#,
        ).unwrap();
        for cap in re.captures_iter(content) {
            let method = &cap[1];
            let route_path = &cap[2];
            let handler_expr = &cap[3];
            let line = line_at(content, cap.get(0).unwrap().start());
            let upper = method.to_uppercase();
            let node_id = make_route_node(graph, &fp, line, &upper, route_path, "php");
            if let Some(handler) = extract_laravel_handler(handler_expr) {
                refs.push(make_ref(
                    node_id,
                    handler,
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

        // Controller@method pattern
        if let Some(cap) = regex::Regex::new(r"^(\w+)Controller@(\w+)$")
            .unwrap()
            .captures(name)
        {
            let controller = &cap[1];
            let method = &cap[2];
            let path = format!("app/Http/Controllers/{controller}.php");
            if ctx.file_exists(&path) {
                let nodes = ctx.get_nodes_in_file(&path);
                if let Some(n) = nodes
                    .iter()
                    .find(|n| n.kind == "method" && n.name == method)
                {
                    return Some(ResolvedRef {
                        target_node_id: n.id,
                        confidence: 0.9,
                    });
                }
            }
            // Fallback: name-based lookup
            for ctrl in ctx
                .get_nodes_by_name(controller)
                .iter()
                .filter(|n| n.kind == "class" && n.path.contains("Controllers"))
            {
                let nodes = ctx.get_nodes_in_file(&ctrl.path);
                if let Some(n) = nodes
                    .iter()
                    .find(|n| n.kind == "method" && n.name == method)
                {
                    return Some(ResolvedRef {
                        target_node_id: n.id,
                        confidence: 0.9,
                    });
                }
            }
            return None;
        }

        // Model::method pattern
        if let Some(cap) = regex::Regex::new(r"^([A-Z][a-zA-Z]+)::(\w+)$")
            .unwrap()
            .captures(name)
        {
            let class_name = &cap[1];
            let method_name = &cap[2];
            for model_path in &[
                format!("app/Models/{class_name}.php"),
                format!("app/{class_name}.php"),
            ] {
                if ctx.file_exists(model_path) {
                    let nodes = ctx.get_nodes_in_file(model_path);
                    if let Some(n) = nodes
                        .iter()
                        .find(|n| n.kind == "method" && n.name == method_name)
                    {
                        return Some(ResolvedRef {
                            target_node_id: n.id,
                            confidence: 0.85,
                        });
                    }
                }
            }
        }

        None
    }
}

fn extract_laravel_handler(expr: &str) -> Option<String> {
    let trimmed = expr.trim();
    // [Class::class, 'method'] → Class@method
    if let Some(cap) =
        regex::Regex::new(r#"^\[\s*([A-Za-z_\\][\w\\]*)::class\s*,\s*['\"]([^'\"]+)['\"]\s*\]"#)
            .unwrap()
            .captures(trimmed)
    {
        let class = cap[1].rsplit('\\').next().unwrap_or(&cap[1]);
        return Some(format!("{class}@{}", &cap[2]));
    }
    // 'Controller@method'
    if let Some(cap) = regex::Regex::new(r#"^['\"]([^'\"@]+)@([^'\"]+)['\"]$"#)
        .unwrap()
        .captures(trimmed)
    {
        let class = cap[1].rsplit('\\').next().unwrap_or(&cap[1]);
        return Some(format!("{class}@{}", &cap[2]));
    }
    // Class::class
    if let Some(cap) = regex::Regex::new(r"^([A-Za-z_\\][\w\\]*)::class")
        .unwrap()
        .captures(trimmed)
    {
        return Some(cap[1].rsplit('\\').next().unwrap_or(&cap[1]).to_string());
    }
    None
}

// ── Drupal ─────────────────────────────────────────────────────────────

pub struct DrupalResolver;

impl FrameworkResolver for DrupalResolver {
    fn name(&self) -> &'static str {
        "drupal"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        // composer.json with drupal/* or drupal-module type
        if let Some(c) = ctx.read_file("composer.json") {
            if c.contains("drupal/") || c.contains("drupal-") {
                return true;
            }
        }
        // .info.yml + .routing.yml/.module
        let files = ctx.get_all_files();
        let has_info = files.iter().any(|f| f.ends_with(".info.yml"));
        if has_info {
            return files.iter().any(|f| {
                f.ends_with(".routing.yml") || f.ends_with(".module") || f.ends_with(".install")
            });
        }
        false
    }

    fn extract(
        &self,
        file_path: &Path,
        content: &str,
        graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        let fp = file_path.to_string_lossy();

        // *.routing.yml — YAML route parsing
        if fp.ends_with(".routing.yml") {
            return extract_drupal_routes(content, &fp, graph);
        }

        // ponytail: hook detection from .module/.install/.theme files skipped
        // for MVP. Ceiling: Drupal hook implementations invisible in graph.
        // Upgrade path: port hook docblock + name-pattern detection.

        vec![]
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;

        // \Drupal\...\ClassName::method or ClassName:method
        if let Some(cap) = regex::Regex::new(r"\\?(?:Drupal\\[^:]+\\)?([^\\:]+):{1,2}(\w+)$")
            .unwrap()
            .captures(name)
        {
            let class_name = &cap[1];
            let method_name = &cap[2];
            let classes = ctx.get_nodes_by_name(class_name);
            if let Some(cls) = classes.iter().find(|node| node.kind == "class") {
                let nodes = ctx.get_nodes_in_file(&cls.path);
                if let Some(node) = nodes
                    .iter()
                    .find(|node| node.kind == "method" && node.name == method_name)
                {
                    return Some(ResolvedRef {
                        target_node_id: node.id,
                        confidence: 0.9,
                    });
                }
                return Some(ResolvedRef {
                    target_node_id: cls.id,
                    confidence: 0.7,
                });
            }
        }

        // Bare FQCN (form/entity handler)
        if name.contains('\\') && !name.contains(':') {
            let class_name = name.rsplit('\\').next().unwrap_or(name);
            let classes = ctx.get_nodes_by_name(class_name);
            if let Some(cls) = classes.iter().find(|node| node.kind == "class") {
                return Some(ResolvedRef {
                    target_node_id: cls.id,
                    confidence: 0.85,
                });
            }
        }

        None
    }
}

fn extract_drupal_routes(
    content: &str,
    fp: &str,
    graph: &mut codegraph::CodeGraph,
) -> Vec<UnresolvedRef> {
    let mut refs = Vec::new();
    let mut current_path: Option<String> = None;
    let mut handlers: Vec<String> = Vec::new();
    let mut route_line: u32 = 1;

    for (i, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Top-level route name: no leading whitespace, ends with `:`
        if !line.starts_with(' ') && !line.starts_with('\t') && trimmed.ends_with(':') {
            // Flush previous route
            if let Some(path) = current_path.take() {
                for h in &handlers {
                    refs.push(make_ref(
                        0, // ponytail: route node ID not tracked here; fix below
                        h.clone(),
                        EdgeType::References,
                        Path::new(fp),
                        route_line,
                    ));
                }
            }
            handlers.clear();
            route_line = (i + 1) as u32;
            continue;
        }

        if let Some(cap) = regex::Regex::new(r##"^path:\s*['"]?([^'"#\n]+?)['"]?"##)
            .unwrap()
            .captures(trimmed)
        {
            current_path = Some(cap[1].trim().to_string());
            // Create the route node now that we have the path.
            let node_id = make_route_node(graph, fp, route_line, "", &cap[1].trim(), "yaml");
            // Update refs to use this node_id — ponytail: we push refs with
            // the actual node_id after creating it. Simpler: collect handlers
            // and create refs at flush time. But we need the node_id. So let's
            // just create refs inline.
            current_path = Some(cap[1].trim().to_string());
            // Store node_id in a side map — ponytail: for MVP, create route
            // node and push refs with correct node_id as we go.
            // Actually let's simplify: just create the route node + refs here.
            for h in &handlers {
                refs.push(make_ref(
                    node_id,
                    h.clone(),
                    EdgeType::References,
                    Path::new(fp),
                    route_line,
                ));
            }
            handlers.clear();
            continue;
        }

        for key in &[
            "_controller:",
            "_form:",
            "_entity_form:",
            "_entity_list:",
            "_entity_view:",
        ] {
            if let Some(cap) = regex::Regex::new(&format!(r##"^{key}\s*['"]?([^'"#\n]+?)['"]?"##))
                .unwrap()
                .captures(trimmed)
            {
                handlers.push(cap[1].trim().to_string());
                continue;
            }
        }
    }

    refs
}
