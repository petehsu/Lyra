use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/design/search_styles",
            "design",
            "search_styles",
            "Search design styles",
            "Search Lyra design references.",
            Some("design_search_styles"),
        ),
        super::s(
            "/tools/design/get_style_details",
            "design",
            "get_style_details",
            "Get design style details",
            "Read one design reference.",
            Some("design_get_style_details"),
        ),
    ]
}
