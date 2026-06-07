use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![super::s(
        "/tools/shell/run_command",
        "shell",
        "run",
        "Run one-shot shell command",
        "Run a bounded non-interactive shell command in a local cwd. Defaults to the bound project root, or the user home directory when the session is unbound. Prefer this for one-shot checks like git config, pwd, tests, or file inspection when no persistent terminal is needed.",
        Some("run_command"),
    )]
}
