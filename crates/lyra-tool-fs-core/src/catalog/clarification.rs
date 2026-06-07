use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![super::s(
        "/tools/clarification/ask",
        "clarification",
        "ask",
        "Ask user",
        "Ask a structured clarification question.",
        Some("ask_user"),
    )]
}
