use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/code/explore",
            "code",
            "explore",
            "Code graph explore",
            "Search the code graph: returns relevant symbols, call paths, and blast radius in one call.",
            Some("codegraph_explore"),
        ),
        super::s(
            "/tools/code/callers",
            "code",
            "callers",
            "Find callers",
            "Find all functions that call the given symbol.",
            Some("codegraph_callers"),
        ),
        super::s(
            "/tools/code/callees",
            "code",
            "callees",
            "Find callees",
            "Find all functions called by the given symbol.",
            Some("codegraph_callees"),
        ),
        super::s(
            "/tools/code/impact",
            "code",
            "impact",
            "Impact analysis",
            "Analyze the blast radius of changing a symbol.",
            Some("codegraph_impact"),
        ),
        super::s(
            "/tools/code/context",
            "code",
            "context",
            "Project context",
            "Get an overview of the project: entry points, key modules, architecture.",
            Some("codegraph_context"),
        ),
    ]
}