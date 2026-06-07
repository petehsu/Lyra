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
            "Fetch a web URL.",
            Some("web_fetch"),
        ),
    ]
}
