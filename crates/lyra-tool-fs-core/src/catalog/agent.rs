use crate::model::ToolManifest;

pub(super) fn manifests() -> Vec<ToolManifest> {
    vec![
        super::s(
            "/tools/agent/send",
            "agent",
            "send",
            "Send Oma Agent message",
            "Queue a message in a target Agent's private Oma channel; the unified host executor runs it after the current turn.",
            Some("agent_send"),
        ),
        super::s(
            "/tools/agent/ask",
            "agent",
            "ask",
            "Ask Oma Agent",
            "Synchronously run one or more active Oma Agent packages in their private channels and return their real replies.",
            Some("agent_ask"),
        ),
        super::s(
            "/tools/agent/handoff",
            "agent",
            "handoff",
            "Handoff to Oma Agent",
            "Queue follow-up work in a target Agent's private channel without changing the user's active channel.",
            Some("agent_handoff"),
        ),
        super::s(
            "/tools/agent/team_plan",
            "agent",
            "team_plan",
            "Publish Oma Team Plan",
            "Lead-only: publish the one approval-gated Oma Team Plan with assigned work packages, dependencies, acceptance criteria, and deliverables.",
            Some("agent_team_plan"),
        ),
        super::s(
            "/tools/agent/create_role",
            "agent",
            "create_role",
            "Create Oma role",
            "Lead-only: execute an approved Lead staffing work package to add a temporary session role or save a local reusable role package. The host provider, tools, and permissions remain shared.",
            Some("agent_create_role"),
        ),
    ]
}
