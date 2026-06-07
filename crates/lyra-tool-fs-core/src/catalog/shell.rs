use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![super::s(
        "/tools/shell/run_command",
        "shell",
        "run",
        "Run command",
        "Run a bounded shell command.",
        Some("run_command"),
    )]
}
