use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/design/reference",
            "design",
            "read",
            "Design reference library",
            "List and read curated DESIGN.md design system documents (colors, typography, spacing, patterns) from real production websites.",
            Some("design_reference"),
        ),
        super::s(
            "/tools/design/extract_reference",
            "design",
            "extract_reference",
            "Extract live design reference",
            "Render a reference URL and extract computed CSS tokens, layout bounds, component samples, and assets for UI or website work, including non-visual model fallback evidence.",
            Some("design_extract_reference"),
        ),
        super::s(
            "/tools/design/quality",
            "design",
            "quality",
            "Audit design quality",
            "List universal UI/UX quality rules or audit frontend source and rendered DOM/CSS for contextual design leads. Findings are advisory and require human review.",
            Some("design_quality"),
        ),
    ]
}
