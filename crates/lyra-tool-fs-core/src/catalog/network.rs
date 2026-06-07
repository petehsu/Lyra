use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![super::s(
        "/tools/network/status",
        "network",
        "status",
        "Network status",
        "Read native network status.",
        None,
    )]
}
