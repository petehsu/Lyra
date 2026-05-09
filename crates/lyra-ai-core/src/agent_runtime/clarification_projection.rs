use super::*;
use crate::storage::QuestionTicket;

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
            .map(|summary| {
                summary
                    .recent_answered
                    .iter()
                    .map(answered_clarification_prompt_value)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        "safeAssumptions": detail
            .assumption_summary
            .as_ref()
            .map(|summary| summary.active.clone())
            .unwrap_or_default(),
    })
}

pub(crate) fn clarification_resume_context_message(
    detail: &AgentSessionDetail,
    turn_id: &str,
) -> Option<ChatMessage> {
    let answers = answered_clarifications_for_turn(detail, turn_id);
    if answers.is_empty() {
        return None;
    }
    Some(ChatMessage {
        role: "system".to_string(),
        content: format!(
            "Runtime clarification answers for this resumed turn are already available. Use these answers as user-provided requirements and continue execution; do not reopen a clarification panel for the same blocker.\n{}",
            serde_json::to_string(&answers).unwrap_or_else(|_| "[]".to_string())
        ),
    })
}

pub(crate) fn answered_clarification_tool_result_message(
    detail: &AgentSessionDetail,
    turn_id: &str,
) -> String {
    let answers = answered_clarifications_for_turn(detail, turn_id);
    format!(
        "Runtime clarification result. The requester already answered blocking clarification for this turn. Use these answers and continue execution instead of opening another clarification panel for the same blocker.\n{}",
        serde_json::to_string(&answers).unwrap_or_else(|_| "[]".to_string())
    )
}

pub(crate) fn has_answered_blocking_clarification_for_turn(
    detail: &AgentSessionDetail,
    turn_id: &str,
) -> bool {
    detail
        .clarification_summary
        .as_ref()
        .is_some_and(|summary| {
            summary.recent_answered.iter().any(|ticket| {
                ticket.runtime_turn_id == turn_id && ticket.blocking_level == "hard_block"
            })
        })
}

fn answered_clarifications_for_turn(detail: &AgentSessionDetail, turn_id: &str) -> Vec<Value> {
    detail
        .clarification_summary
        .as_ref()
        .map(|summary| {
            summary
                .recent_answered
                .iter()
                .filter(|ticket| ticket.runtime_turn_id == turn_id)
                .map(answered_clarification_prompt_value)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn answered_clarification_prompt_value(ticket: &QuestionTicket) -> Value {
    json!({
        "questionTicketId": ticket.question_ticket_id.clone(),
        "runtimeTurnId": ticket.runtime_turn_id.clone(),
        "status": ticket.status.clone(),
        "blockingLevel": ticket.blocking_level.clone(),
        "title": ticket.title.clone(),
        "question": ticket.question.clone(),
        "why": ticket.why.clone(),
        "targetSummary": ticket.target_summary.clone(),
        "selectedOptionId": ticket.selected_option_id.clone(),
        "answerText": ticket.answer_text.clone(),
        "questionType": ticket.target_bindings.get("questionType").cloned().unwrap_or(Value::Null),
        "reasonCode": ticket.target_bindings.get("reasonCode").cloned().unwrap_or(Value::Null),
        "answeredAt": ticket.answered_at,
    })
}
