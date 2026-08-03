//! Python resolvers — Django, Flask, FastAPI.

use std::path::Path;

use codegraph::EdgeType;

use super::helpers::{line_at, make_ref, make_route_node, resolve_by_name_and_kind};
use crate::resolution::types::{FrameworkResolver, ResolutionContext, ResolvedRef, UnresolvedRef};

// ── Django ─────────────────────────────────────────────────────────────

pub struct DjangoResolver;

impl FrameworkResolver for DjangoResolver {
    fn name(&self) -> &'static str {
        "django"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        for f in &["requirements.txt", "setup.py", "pyproject.toml"] {
            if let Some(c) = ctx.read_file(f) {
                if c.to_lowercase().contains("django") {
                    return true;
                }
            }
        }
        ctx.file_exists("manage.py")
    }

    fn extract(
        &self,
        file_path: &Path,
        content: &str,
        graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("py") {
            return vec![];
        }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // path('url', handler), re_path(r'...', handler), url(r'...', handler)
        let re = regex::Regex::new(
            r#"\b(?:path|re_path|url)\s*\(\s*r?['"]([^'"]+)['"]\s*,\s*([\w.]+(?:\s*\([^)]*\))?)"#,
        )
        .unwrap();
        for cap in re.captures_iter(content) {
            let url_path = &cap[1];
            let handler = &cap[2];
            let line = line_at(content, cap.get(0).unwrap().start());
            let node_id = make_route_node(graph, &fp, line, "", url_path, "python");
            if let Some(name) = parse_handler_name(handler) {
                refs.push(make_ref(
                    node_id,
                    name,
                    EdgeType::References,
                    file_path,
                    line,
                ));
            }
        }

        // DRF router.register(r'articles', ArticleViewSet)
        let router_re =
            regex::Regex::new(r#"\.register\s*\(\s*r?['"]([^'"]+)['"]\s*,\s*([\w.]+)"#).unwrap();
        for cap in router_re.captures_iter(content) {
            let prefix = &cap[1];
            let viewset = cap[2].rsplit('.').next().unwrap_or(&cap[2]);
            if !viewset.ends_with("View") && !viewset.ends_with("ViewSet") {
                continue;
            }
            let line = line_at(content, cap.get(0).unwrap().start());
            let route_name = format!(
                "VIEWSET /{}",
                prefix.trim_start_matches('^').trim_end_matches("$/")
            );
            let node_id = make_route_node(graph, &fp, line, "", &route_name, "python");
            refs.push(make_ref(
                node_id,
                viewset.to_string(),
                EdgeType::References,
                file_path,
                line,
            ));
        }

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;
        if name.ends_with("Model")
            || (name
                .chars()
                .next()
                .map(|c| c.is_ascii_uppercase())
                .unwrap_or(false)
                && !name.contains('_'))
        {
            if let Some(id) =
                resolve_by_name_and_kind(name, &["class"], &["/models/", "/app/models/"], ctx)
            {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.8,
                });
            }
        }
        if name.ends_with("View") || name.ends_with("ViewSet") {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["class", "function"],
                &["/views/", "/app/views/"],
                ctx,
            ) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.8,
                });
            }
        }
        None
    }
}

fn parse_handler_name(expr: &str) -> Option<String> {
    // include('module.path')
    if let Some(cap) = regex::Regex::new(r##"^include\s*\(\s*['"]([^'"]+)['"]"##)
        .unwrap()
        .captures(expr)
    {
        return Some(cap[1].to_string());
    }
    // Strip .as_view(...) and trailing method calls.
    let head = regex::Regex::new(r"\.\w+\s*\([^)]*\)\s*$")
        .unwrap()
        .replace_all(expr, "");
    let head = head.replace(".as_view", "");
    head.rsplit('.')
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

// ── Flask ──────────────────────────────────────────────────────────────

pub struct FlaskResolver;

impl FrameworkResolver for FlaskResolver {
    fn name(&self) -> &'static str {
        "flask"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        for f in &["requirements.txt", "pyproject.toml", "Pipfile", "setup.py"] {
            if let Some(c) = ctx.read_file(f) {
                if c.to_lowercase().contains("flask") {
                    return true;
                }
            }
        }
        // Entrypoint files importing Flask.
        ctx.get_all_files()
            .iter()
            .filter(|f| {
                matches!(
                    f.rsplit('/').next(),
                    Some("app.py") | Some("main.py") | Some("wsgi.py") | Some("__init__.py")
                )
            })
            .take(20)
            .any(|f| {
                ctx.read_file(f)
                    .map(|c| {
                        c.contains("Flask(")
                            && (c.contains("import flask") || c.contains("from flask"))
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
        if file_path.extension().and_then(|e| e.to_str()) != Some("py") {
            return vec![];
        }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // @app.route('/path', methods=[...]) or @bp.route('/path')
        let re = regex::Regex::new(
            r#"@(\w+)\.route\s*\(\s*['"]([^'"]*)['"](?:\s*,\s*methods\s*=\s*[\[(]([^)\]]+)[\])])?\s*\)"#,
        ).unwrap();
        for cap in re.captures_iter(content) {
            let route_path = &cap[2];
            let line = line_at(content, cap.get(0).unwrap().start());
            let method = cap
                .get(3)
                .and_then(|m| {
                    regex::Regex::new(r#"['"]([A-Z]+)['"]"#)
                        .unwrap()
                        .captures(m.as_str())
                        .map(|c| c[1].to_string())
                })
                .unwrap_or_else(|| "GET".to_string());
            let node_id = make_route_node(graph, &fp, line, &method, route_path, "python");
            // Find the next def after the decorator.
            let after = &content[cap.get(0).unwrap().end()..];
            if let Some(m) = regex::Regex::new(r"\n\s*(?:async\s+)?def\s+(\w+)")
                .unwrap()
                .captures(after)
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

        // Flask-RESTful: api.add_resource(ResourceClass, '/path')
        let restful_re = regex::Regex::new(
            r#"\.add\w*[Rr]esource\s*\(\s*(\w+)\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)"#,
        )
        .unwrap();
        for cap in restful_re.captures_iter(content) {
            let class_name = &cap[1];
            let line = line_at(content, cap.get(0).unwrap().start());
            // Extract all path strings from the second arg.
            for path_cap in regex::Regex::new(r#"['"]([^'"]+)['"]"#)
                .unwrap()
                .captures_iter(&cap[2])
            {
                let route_path = &path_cap[1];
                let node_id = make_route_node(graph, &fp, line, "ANY", route_path, "python");
                refs.push(make_ref(
                    node_id,
                    class_name.to_string(),
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
        if name.ends_with("_bp") || name.ends_with("_blueprint") {
            if let Some(id) = resolve_by_name_and_kind(name, &["variable"], &[], ctx) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.8,
                });
            }
        }
        None
    }
}

// ── FastAPI ────────────────────────────────────────────────────────────

pub struct FastApiResolver;

impl FrameworkResolver for FastApiResolver {
    fn name(&self) -> &'static str {
        "fastapi"
    }

    fn detect(&self, ctx: &ResolutionContext) -> bool {
        for f in &["requirements.txt", "pyproject.toml"] {
            if let Some(c) = ctx.read_file(f) {
                if c.to_lowercase().contains("fastapi") {
                    return true;
                }
            }
        }
        for f in &["app.py", "main.py", "api.py"] {
            if let Some(c) = ctx.read_file(f) {
                if c.contains("FastAPI(") {
                    return true;
                }
            }
        }
        false
    }

    fn extract(
        &self,
        file_path: &Path,
        content: &str,
        graph: &mut codegraph::CodeGraph,
    ) -> Vec<UnresolvedRef> {
        if file_path.extension().and_then(|e| e.to_str()) != Some("py") {
            return vec![];
        }
        let fp = file_path.to_string_lossy();
        let mut refs = Vec::new();

        // @router.get('/path'), @app.post('/path')
        let re = regex::Regex::new(
            r##"@(\w+)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]*)['"]"##,
        )
        .unwrap();
        for cap in re.captures_iter(content) {
            let method = &cap[2];
            let route_path = &cap[3];
            let line = line_at(content, cap.get(0).unwrap().start());
            let upper = method.to_uppercase();
            let node_id = make_route_node(graph, &fp, line, &upper, route_path, "python");
            let after = &content[cap.get(0).unwrap().end()..];
            if let Some(m) = regex::Regex::new(r"\n\s*(?:async\s+)?def\s+(\w+)")
                .unwrap()
                .captures(after)
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

        refs
    }

    fn resolve(&self, reference: &UnresolvedRef, ctx: &ResolutionContext) -> Option<ResolvedRef> {
        let name = &reference.reference_name;
        if name.ends_with("_router") || name == "router" {
            if let Some(id) = resolve_by_name_and_kind(
                name,
                &["variable"],
                &["/routers/", "/api/", "/routes/"],
                ctx,
            ) {
                return Some(ResolvedRef {
                    target_node_id: id,
                    confidence: 0.8,
                });
            }
        }
        None
    }
}
