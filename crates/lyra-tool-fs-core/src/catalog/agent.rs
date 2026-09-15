use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![super::s(
        "/tools/agent/spawn",
        "agent",
        "spawn",
        "Spawn a worker agent",
        "Launch an isolated child agent with a self-contained prompt. Use explore for read-only search and generalPurpose for multi-step work. Depth is 1.",
        Some("agent_spawn"),
    )]
}
