use super::events::emit_store_event;
use super::intent_classifier::IntentClassification;
use super::*;
use crate::storage::{
    AgentResolveClarificationRequest, AgentResolveClarificationResult, CreateAssumptionRecordInput,
    CreateQuestionTicketInput, CreateRuntimeDecisionRecordInput, InlineReference,
    QuestionTicketOption, UserIntentEnvelope,
};

pub(crate) struct ClarificationGateOutcome {
    pub hard_blocked: bool,
}

pub(crate) fn evaluate_clarification_gate(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    user_message_id: &str,
    intent: &UserIntentEnvelope,
    classification: &IntentClassification,
    references: &[InlineReference],
) -> Result<ClarificationGateOutcome> {
    if let Some(reason) = classification.hard_block_reason.as_deref() {
        let ticket = store.create_question_ticket(CreateQuestionTicketInput {
            session_id: session_id.to_string(),
            runtime_turn_id: turn_id.to_string(),
            user_message_id: user_message_id.to_string(),
            intent_id: Some(intent.intent_id.clone()),
            blocking_level: "hard_block".to_string(),
            title: "Clarify target".to_string(),
            question: "Which target should Lyra use for this request?".to_string(),
            why: format!("Runtime blocked execution because {reason}."),
            target_summary: Some("No fresh target binding was available.".to_string()),
            options: vec![
                QuestionTicketOption {
                    id: "A".to_string(),
                    label: "Use latest thread context".to_string(),
                    description: "Proceed only if the current visible thread contains the target."
                        .to_string(),
                },
                QuestionTicketOption {
                    id: "B".to_string(),
                    label: "Use a reference".to_string(),
                    description:
                        "Attach or mention the exact file, message, artifact, or tool result."
                            .to_string(),
                },
                QuestionTicketOption {
                    id: "C".to_string(),
                    label: "Open planning".to_string(),
                    description: "Turn this into a planning request before execution.".to_string(),
                },
                QuestionTicketOption {
                    id: "D".to_string(),
                    label: "Cancel request".to_string(),
                    description: "Do not execute this ambiguous action.".to_string(),
                },
            ],
            allow_custom_answer: true,
            related_ids: references
                .iter()
                .map(|reference| reference.inline_reference_id.clone())
                .collect(),
            target_bindings: json!({
                "intentId": intent.intent_id,
                "ambiguityFlags": intent.ambiguity_flags,
            }),
        })?;
        store.create_runtime_decision_record(CreateRuntimeDecisionRecordInput {
            session_id: session_id.to_string(),
            runtime_turn_id: turn_id.to_string(),
            user_message_id: user_message_id.to_string(),
            intent_id: Some(intent.intent_id.clone()),
            kind: "clarification_gate".to_string(),
            status: "hard_block".to_string(),
            summary: "Created hard-block clarification ticket.".to_string(),
            reason: json!({
                "questionTicketId": ticket.question_ticket_id,
                "reason": reason,
                "modelAndToolExecutionBlocked": true
            }),
            evidence_refs: vec![ticket.question_ticket_id.clone()],
        })?;
        emit_store_event(
            store,
            session_id,
            Some(turn_id),
            "clarification_ticket_created",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "questionTicketId": ticket.question_ticket_id,
                "blockingLevel": ticket.blocking_level,
                "intentId": intent.intent_id,
            }),
        )?;
        return Ok(ClarificationGateOutcome { hard_blocked: true });
    }

    if intent.kind == "task_execution" && classification.high_risk == false {
        let assumption = store.create_assumption_record(CreateAssumptionRecordInput {
            session_id: session_id.to_string(),
            runtime_turn_id: turn_id.to_string(),
            user_message_id: user_message_id.to_string(),
            intent_id: Some(intent.intent_id.clone()),
            statement: "Use reversible project conventions for low-risk implementation details."
                .to_string(),
            basis: "project_convention".to_string(),
            risk_level: "low".to_string(),
            reversible: true,
            source_refs: vec![intent.intent_id.clone()],
        })?;
        store.create_runtime_decision_record(CreateRuntimeDecisionRecordInput {
            session_id: session_id.to_string(),
            runtime_turn_id: turn_id.to_string(),
            user_message_id: user_message_id.to_string(),
            intent_id: Some(intent.intent_id.clone()),
            kind: "assumption_recorded".to_string(),
            status: "non_blocking".to_string(),
            summary: "Recorded low-risk reversible assumption.".to_string(),
            reason: json!({
                "assumptionId": assumption.assumption_id,
                "basis": assumption.basis,
                "riskLevel": assumption.risk_level
            }),
            evidence_refs: vec![assumption.assumption_id.clone()],
        })?;
        return Ok(ClarificationGateOutcome {
            hard_blocked: false,
        });
    }

    Ok(ClarificationGateOutcome {
        hard_blocked: false,
    })
}

pub fn resolve_clarification(
    request: AgentResolveClarificationRequest,
) -> Result<AgentResolveClarificationResult> {
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err(anyhow!("sessionId is required"));
    }
    store
        .read_session_index(&session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    let ticket = store.resolve_question_ticket(
        &session_id,
        request.question_ticket_id.trim(),
        request.selected_option_id.as_deref(),
        request.custom_answer.as_deref(),
        request.answer_text.as_deref(),
    )?;
    emit_store_event(
        &store,
        &session_id,
        Some(&ticket.runtime_turn_id),
        "clarification_ticket_resolved",
        json!({
            "sessionId": session_id,
            "turnId": ticket.runtime_turn_id,
            "questionTicketId": ticket.question_ticket_id,
            "status": ticket.status,
            "selectedOptionId": ticket.selected_option_id,
        }),
    )?;
    let detail = store
        .read_session_detail(&session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    emit_store_event(
        &store,
        &session_id,
        Some(&ticket.runtime_turn_id),
        "session_updated",
        json!({ "detail": detail }),
    )?;
    let detail = store
        .read_session_detail(&session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    Ok(AgentResolveClarificationResult {
        session_id,
        question_ticket_id: ticket.question_ticket_id,
        status: "answered".to_string(),
        detail,
    })
}
