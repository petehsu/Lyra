use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/web/search",
            "web",
            "search",
            "Web search",
            "Search the web.",
            Some("web_search"),
        ),
        super::s(
            "/tools/web/fetch",
            "web",
            "fetch",
            "Fetch URL",
            "Fetch a URL and return agent-friendly markdown, metadata, chunks, links, images, and recommendations.",
            Some("web_fetch"),
        ),
        super::s(
            "/tools/web/research",
            "web",
            "research",
            "Web research",
            "Search the web and deep-read top results into an agent-friendly research bundle.",
            Some("web_research"),
        ),
    ]
}
