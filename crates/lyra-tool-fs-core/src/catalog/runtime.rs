use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![super::s(
        "/tools/runtime/artifact_read",
        "runtime",
        "read",
        "Read artifact",
        "Read a Lyra-owned artifact.",
        Some("artifact_read"),
    )]
}
