use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![super::s(
        "/tools/design/reference",
        "design",
        "read",
        "Design reference library",
        "List and read curated DESIGN.md design system documents (colors, typography, spacing, patterns) from real production websites.",
        Some("design_reference"),
    )]
}
