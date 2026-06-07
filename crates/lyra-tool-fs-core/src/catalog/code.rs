use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/code/search_project",
            "code",
            "project",
            "Search project",
            "Search workspace files and content.",
            None,
        ),
        super::s(
            "/tools/code/search_code",
            "code",
            "search_text",
            "Search code",
            "Search code text with structured snippets.",
            Some("search_code"),
        ),
        super::s(
            "/tools/code/search_symbol",
            "code",
            "search_symbol",
            "Search symbols",
            "Search source symbols.",
            Some("search_symbol"),
        ),
        super::s(
            "/tools/code/graph_expand",
            "code",
            "graph_expand",
            "Expand code graph",
            "Expand imports and related code.",
            None,
        ),
        super::s(
            "/tools/code/lsp_query",
            "code",
            "query",
            "Query LSP",
            "Query language server diagnostics or symbols.",
            Some("diagnostics"),
        ),
    ]
}
