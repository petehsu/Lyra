use super::events::emit_store_event;
use super::intent_classifier::IntentClassification;
use super::*;
use crate::storage::{
    AgentResolveClarificationRequest, AgentResolveClarificationResult, CreateAssumptionRecordInput,
    CreateQuestionTicketInput, CreateRuntimeDecisionRecordInput, InlineReference,
    QuestionTicketOption, UserIntentEnvelope,
};
use crate::tools::{OpenClarificationOptionInput, OpenClarificationPanelInput};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClarificationResponse {
    pub answer: String,
    pub selected_option: Option<usize>,
}

pub(crate) struct ClarificationGateOutcome {
    pub hard_blocked: bool,
}

pub(crate) enum ModelClarificationPanelOutcome {
    Opened,
    AlreadyAnswered,
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
                    recommended: Some(true),
                },
                QuestionTicketOption {
                    id: "B".to_string(),
                    label: "Use a reference".to_string(),
                    description:
                        "Attach or mention the exact file, message, artifact, or tool result."
                            .to_string(),
                    recommended: None,
                },
                QuestionTicketOption {
                    id: "C".to_string(),
                    label: "Open planning".to_string(),
                    description: "Turn this into a planning request before execution.".to_string(),
                    recommended: None,
                },
                QuestionTicketOption {
                    id: "D".to_string(),
                    label: "Cancel request".to_string(),
                    description: "Do not execute this ambiguous action.".to_string(),
                    recommended: None,
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
                "panel": default_panel_binding(
                    "agent_runtime",
                    "modal",
                    true,
                    "Clarify target",
                    "Lyra needs a precise target before executing this request.",
                    Vec::new(),
                    turn_id,
                ),
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

pub(crate) fn open_model_clarification_panel(
    store: &AiStore,
    session_id: &str,
    turn_id: &str,
    tool_call: &ToolCall,
) -> Result<ModelClarificationPanelOutcome> {
    let input = serde_json::from_value::<OpenClarificationPanelInput>(tool_call.arguments.clone())
        .map_err(|error| anyhow!("invalid open_clarification_panel input: {error}"))?;
    validate_panel_input(&input)?;
    let detail = store
        .read_session_detail(session_id)?
        .ok_or_else(|| anyhow!("AI session not found: {session_id}"))?;
    if input.blocks_execution.unwrap_or(true)
        && has_answered_blocking_clarification_for_turn(&detail, turn_id)
    {
        emit_store_event(
            store,
            session_id,
            Some(turn_id),
            "clarification_panel_reopen_suppressed",
            json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "toolCallId": tool_call.id,
                "reason": "answered_blocking_clarification_exists",
            }),
        )?;
        return Ok(ModelClarificationPanelOutcome::AlreadyAnswered);
    }
    let user_message_id = detail
        .messages
        .iter()
        .find(|message| message.role == "user" && message.turn_id.as_deref() == Some(turn_id))
        .map(|message| message.id.clone())
        .ok_or_else(|| anyhow!("user message not found for turn: {turn_id}"))?;
    let panel_id = new_id("clarification_panel");
    let blocks_execution = input.blocks_execution.unwrap_or(true);
    let presentation = input
        .presentation
        .as_deref()
        .and_then(trim_to_string)
        .unwrap_or_else(|| {
            if blocks_execution {
                "modal".to_string()
            } else {
                "inline_card".to_string()
            }
        });
    let panel_title = input
        .title
        .as_deref()
        .and_then(trim_to_string)
        .unwrap_or_else(|| "Clarification required".to_string());
    let panel_description = input
        .description
        .as_deref()
        .and_then(trim_to_string)
        .unwrap_or_else(|| {
            "Lyra needs your answer before continuing the affected work.".to_string()
        });
    let mut tickets = Vec::new();
    for question in &input.questions {
        let ticket_title = question
            .title
            .as_deref()
            .and_then(trim_to_string)
            .unwrap_or_else(|| panel_title.clone());
        let ticket = store.create_question_ticket(CreateQuestionTicketInput {
            session_id: session_id.to_string(),
            runtime_turn_id: turn_id.to_string(),
            user_message_id: user_message_id.clone(),
            intent_id: None,
            blocking_level: if blocks_execution {
                "hard_block".to_string()
            } else {
                "soft_block".to_string()
            },
            title: ticket_title,
            question: required_text("question", &question.question)?,
            why: required_text("whyItMatters", &question.why_it_matters)?,
            target_summary: question.target_summary.as_deref().and_then(trim_to_string),
            options: normalize_tool_options(&question.options)?,
            allow_custom_answer: true,
            related_ids: input.blocked_operation_ids.clone(),
            target_bindings: json!({
                "source": "model_tool_call",
                "toolCallId": tool_call.id.clone(),
                "questionType": question.question_type.as_deref().and_then(trim_to_string),
                "reasonCode": question.reason_code.as_deref().and_then(trim_to_string),
                "panel": default_panel_binding(
                    "agent_runtime",
                    &presentation,
                    blocks_execution,
                    &panel_title,
                    &panel_description,
                    input.blocked_operation_ids.clone(),
                    turn_id,
                ),
                "panelId": panel_id.clone(),
            }),
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
                "panelId": panel_id.clone(),
                "source": "model_tool_call",
            }),
        )?;
        tickets.push(ticket);
    }
    emit_store_event(
        store,
        session_id,
        Some(turn_id),
        "clarification_panel_opened",
        json!({
            "sessionId": session_id,
            "turnId": turn_id,
            "panelId": panel_id,
            "questionTicketIds": tickets.iter().map(|ticket| ticket.question_ticket_id.clone()).collect::<Vec<_>>(),
            "blocksExecution": blocks_execution,
        }),
    )?;
    if blocks_execution {
        store.update_turn_status(
            session_id,
            turn_id,
            "paused",
            "paused_clarification",
            None,
            Some("Waiting for clarification response"),
        )?;
        emit_store_event(
            store,
            session_id,
            Some(turn_id),
            "runtime_turn_paused",
            json!({
                "turnId": turn_id,
                "reason": "clarification_needed",
                "panelId": panel_id,
            }),
        )?;
    }
    Ok(ModelClarificationPanelOutcome::Opened)
}

#[cfg(test)]
pub fn resolve_clarification(
    request: AgentResolveClarificationRequest,
) -> Result<AgentResolveClarificationResult> {
    submit_clarification_response(request)
}

pub fn submit_clarification_response(
    request: AgentResolveClarificationRequest,
) -> Result<AgentResolveClarificationResult> {
    let response = ClarificationResponse::from_request(&request);
    let storage_root = request.storage.storage_root.clone();
    let store = AiStore::open(storage_root.as_deref())?;
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
        response
            .selected_option
            .and_then(option_id_for_index)
            .or(request.selected_option_id)
            .as_deref(),
        request.custom_answer.as_deref(),
        Some(response.answer.as_str()),
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
    let has_remaining_blocking_questions = store
        .read_clarification_summary(&session_id)?
        .map(|summary| {
            summary.pending.iter().any(|pending| {
                pending.runtime_turn_id == ticket.runtime_turn_id
                    && pending.blocking_level == "hard_block"
            })
        })
        .unwrap_or(false);
    if ticket.selected_option_id.as_deref() == Some("D") {
        store.update_turn_status(
            &session_id,
            &ticket.runtime_turn_id,
            "cancelled",
            "clarification_cancelled",
            None,
            Some("User cancelled from clarification"),
        )?;
        emit_store_event(
            &store,
            &session_id,
            Some(&ticket.runtime_turn_id),
            "runtime_turn_cancelled",
            json!({
                "turnId": ticket.runtime_turn_id.clone(),
                "reason": "clarification_cancelled"
            }),
        )?;
    } else if has_remaining_blocking_questions {
        emit_store_event(
            &store,
            &session_id,
            Some(&ticket.runtime_turn_id),
            "clarification_waiting_for_remaining_answers",
            json!({
                "sessionId": session_id.clone(),
                "turnId": ticket.runtime_turn_id.clone(),
                "questionTicketId": ticket.question_ticket_id.clone(),
            }),
        )?;
    } else if turn_loop::resume_paused_turn(storage_root, &session_id, &ticket.runtime_turn_id)? {
        emit_store_event(
            &store,
            &session_id,
            Some(&ticket.runtime_turn_id),
            "clarification_turn_resumed",
            json!({
                "sessionId": session_id.clone(),
                "turnId": ticket.runtime_turn_id.clone(),
                "questionTicketId": ticket.question_ticket_id.clone(),
            }),
        )?;
    }
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

impl ClarificationResponse {
    fn from_request(request: &AgentResolveClarificationRequest) -> Self {
        Self {
            answer: request
                .answer_text
                .as_deref()
                .and_then(trim_to_string)
                .or_else(|| request.custom_answer.as_deref().and_then(trim_to_string))
                .or_else(|| {
                    request
                        .selected_option_id
                        .as_deref()
                        .and_then(trim_to_string)
                })
                .unwrap_or_default(),
            selected_option: request
                .selected_option_id
                .as_deref()
                .and_then(option_index_for_id),
        }
    }
}

fn option_id_for_index(index: usize) -> Option<String> {
    ["A", "B", "C", "D"]
        .get(index)
        .map(|value| (*value).to_string())
}

fn option_index_for_id(value: &str) -> Option<usize> {
    match value.trim() {
        "A" => Some(0),
        "B" => Some(1),
        "C" => Some(2),
        "D" => Some(3),
        _ => None,
    }
}

fn validate_panel_input(input: &OpenClarificationPanelInput) -> Result<()> {
    if input.questions.is_empty() || input.questions.len() > 3 {
        return Err(anyhow!(
            "open_clarification_panel requires 1 to 3 questions"
        ));
    }
    for question in &input.questions {
        required_text("question", &question.question)?;
        required_text("whyItMatters", &question.why_it_matters)?;
        normalize_tool_options(&question.options)?;
    }
    Ok(())
}

fn normalize_tool_options(
    options: &[OpenClarificationOptionInput],
) -> Result<Vec<QuestionTicketOption>> {
    if options.len() != 4 {
        return Err(anyhow!("clarification options must be exactly A/B/C/D"));
    }
    let mut normalized = Vec::new();
    for (index, option) in options.iter().enumerate() {
        let expected = ["A", "B", "C", "D"][index];
        if option.id.trim() != expected {
            return Err(anyhow!("clarification options must be ordered A/B/C/D"));
        }
        normalized.push(QuestionTicketOption {
            id: expected.to_string(),
            label: required_text("option.label", &option.label)?,
            description: required_text("option.description", &option.description)?,
            recommended: option.recommended,
        });
    }
    Ok(normalized)
}

fn required_text(name: &str, value: &str) -> Result<String> {
    trim_to_string(value).ok_or_else(|| anyhow!("{name} is required"))
}

fn default_panel_binding(
    source: &str,
    presentation: &str,
    blocks_execution: bool,
    title: &str,
    description: &str,
    blocked_operation_ids: Vec<String>,
    turn_id: &str,
) -> Value {
    json!({
        "schemaVersion": "v1",
        "source": source,
        "presentation": presentation,
        "blocksExecution": blocks_execution,
        "blockedOperationIds": blocked_operation_ids,
        "resumeToken": format!("runtime_turn:{turn_id}"),
        "title": title,
        "description": description,
    })
}
