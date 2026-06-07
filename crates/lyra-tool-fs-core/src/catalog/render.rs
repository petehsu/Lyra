use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![super::s(
        "/tools/render/surface",
        "render",
        "surface",
        "Render surface",
        "Create an inline render surface.",
        Some("render_surface"),
    )]
}
