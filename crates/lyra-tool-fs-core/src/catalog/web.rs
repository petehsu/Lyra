use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/web/search",
            "web",
            "search",
            "Web search",
            "Search the web — GitHub, docs, community discussions, error solutions, API references. Use before writing code to find how others solved similar problems.",
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
        super::s(
            "/tools/web/map",
            "web",
            "map",
            "Map site URLs",
            "Discover same-origin URLs from a seed page and optional sitemap before selective fetch.",
            Some("web_map"),
        ),
        super::s(
            "/tools/web/batch",
            "web",
            "batch",
            "Batch fetch URLs",
            "Fetch multiple URLs synchronously or as a background job with session progress events.",
            Some("web_batch"),
        ),
    ]
}
