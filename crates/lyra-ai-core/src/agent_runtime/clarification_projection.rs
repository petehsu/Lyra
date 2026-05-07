use super::*;

pub(crate) fn project_clarification_prompt_value(detail: &AgentSessionDetail) -> Value {
    json!({
        "openClarificationTickets": detail
            .clarification_summary
            .as_ref()
            .map(|summary| summary.pending.clone())
            .unwrap_or_default(),
        "recentAnsweredClarifications": detail
            .clarification_summary
            .as_ref()
            .map(|summary| summary.recent_answered.clone())
            .unwrap_or_default(),
        "safeAssumptions": detail
            .assumption_summary
            .as_ref()
            .map(|summary| summary.active.clone())
            .unwrap_or_default(),
    })
}
