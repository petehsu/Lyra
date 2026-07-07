use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![super::s(
        "/tools/shell/run",
        "shell",
        "run",
        "Run shell command",
        "Run a bounded shell command for inspection, tests, builds, or validation.",
        Some("exec_command"),
    )]
}
