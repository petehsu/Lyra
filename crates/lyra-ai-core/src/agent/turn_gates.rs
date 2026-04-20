use std::collections::BTreeMap;

use napi::Result;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::agent::answer_quality::{
    record_session_patterns, run_intent_clarification_gate, run_quality_gate,
    IntentClarificationAction, IntentClarificationGateResult, QualityGateAction, QualityGateResult,
    QualityQuestionOption,
};
use crate::agent::interaction_manager::create_pending_interaction;
use crate::agent::runtime_events::{
    emit_event, emit_interaction_pending_event, emit_interaction_queue_updated,
};
use crate::agent::turn_guardrails::{
    grounding_guard_reason, grounding_retry_message, grounding_unmet_message,
    has_verification_evidence,
};
use crate::agent::types::{AgentPendingInteractionKind, AgentToolCall};
use crate::profile::types::StoredAiProviderProfile;
use crate::provider::types::{AgentInferenceMessage, AgentInferenceMessageRole};

#[derive(Clone, Copy, Debug, Default)]
pub struct QualityClarificationState {
    pub clarification_requested: bool,
    pub clarification_resolved: bool,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct IntentClarificationState {
    pub gate_checked: bool,
    pub clarification_requested: bool,
    pub clarification_resolved: bool,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct GroundingGateState {
    pub retry_injected: bool,
}

pub enum TurnGateAction {
    Continue,
    Retry,
    Pause {
        reason: String,
        include_assistant_prefix: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QualityGateFallbackPolicy {
    Balanced,
    Strict,
}

impl QualityGateFallbackPolicy {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Balanced => "balanced",
            Self::Strict => "strict",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum QualityFallbackRisk {
    Low,
    High,
}

impl QualityFallbackRisk {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::High => "high",
        }
    }
}

fn is_cjk_text(text: &str) -> bool {
    text.chars().any(|ch| {
        let code = ch as u32;
        (0x4E00..=0x9FFF).contains(&code)
            || (0x3400..=0x4DBF).contains(&code)
            || (0x3040..=0x30FF).contains(&code)
    })
}

fn default_intent_fallback_question(
    user_input: &str,
) -> (String, Vec<QualityQuestionOption>, Vec<String>) {
    if is_cjk_text(user_input) {
        (
            "开始前我需要先锁定一个关键方向：这次你希望我优先哪种交付方式？".to_string(),
            vec![
                QualityQuestionOption {
                    label: "先最小可用".to_string(),
                    description: "先给最小可运行结果，再迭代细化。".to_string(),
                },
                QualityQuestionOption {
                    label: "先完整方案".to_string(),
                    description: "先给完整方案，并显式写出采用的假设。".to_string(),
                },
                QualityQuestionOption {
                    label: "先确认标准".to_string(),
                    description: "先问我验收标准，再开始执行。".to_string(),
                },
            ],
            vec![
                "delivery_priority_unconfirmed".to_string(),
                "constraint_boundary_unconfirmed".to_string(),
                "acceptance_criteria_unconfirmed".to_string(),
            ],
        )
    } else {
        (
            "Before implementation, which delivery direction should I prioritize?".to_string(),
            vec![
                QualityQuestionOption {
                    label: "MVP first".to_string(),
                    description: "Ship a minimal working result first, then iterate.".to_string(),
                },
                QualityQuestionOption {
                    label: "Complete solution".to_string(),
                    description: "Deliver a fuller solution and state assumptions explicitly."
                        .to_string(),
                },
                QualityQuestionOption {
                    label: "Confirm acceptance first".to_string(),
                    description: "Ask for acceptance criteria first, then proceed.".to_string(),
                },
            ],
            vec![
                "delivery_priority_unconfirmed".to_string(),
                "constraint_boundary_unconfirmed".to_string(),
                "acceptance_criteria_unconfirmed".to_string(),
            ],
        )
    }
}

fn quality_gate_fallback_policy() -> QualityGateFallbackPolicy {
    match std::env::var("LYRA_QUALITY_GATE_FALLBACK_POLICY") {
        Ok(raw) if raw.trim().eq_ignore_ascii_case("strict") => QualityGateFallbackPolicy::Strict,
        _ => QualityGateFallbackPolicy::Balanced,
    }
}

fn infer_quality_fallback_risk(current_input: &str, assistant_text: &str) -> QualityFallbackRisk {
    let input_chars = current_input.chars().count();
    let input_lines = current_input
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    let answer_chars = assistant_text.chars().count();
    let code_like_symbols = current_input
        .chars()
        .filter(|ch| {
            matches!(
                ch,
                '{' | '}' | '[' | ']' | '(' | ')' | ':' | ';' | '/' | '\\'
            )
        })
        .count();
    let has_code_fence = current_input.contains("```") || assistant_text.contains("```");

    if has_code_fence
        || input_chars >= 260
        || input_lines >= 3
        || answer_chars >= 900
        || code_like_symbols >= 10
    {
        QualityFallbackRisk::High
    } else {
        QualityFallbackRisk::Low
    }
}

fn build_quality_fallback_pause_message(
    user_input: &str,
    policy: QualityGateFallbackPolicy,
    risk: QualityFallbackRisk,
) -> String {
    if is_cjk_text(user_input) {
        format!(
            "当前无法完成质量校验（policy={}, risk={}）。为避免误导性结论，请先补充一个关键约束后我再继续。",
            policy.as_str(),
            risk.as_str()
        )
    } else {
        format!(
            "Quality verification is unavailable (policy={}, risk={}). To avoid a misleading conclusion, share one blocking constraint and I will continue.",
            policy.as_str(),
            risk.as_str()
        )
    }
}

fn to_quality_question_options_json(options: &[QualityQuestionOption]) -> Value {
    let mapped = options
        .iter()
        .map(|option| {
            json!({
                "label": option.label,
                "description": option.description,
            })
        })
        .collect::<Vec<_>>();
    if mapped.len() >= 2 {
        Value::Array(mapped)
    } else {
        Value::Array(vec![
            json!({
                "label": "Provide context",
                "description": "Share the missing detail so I can answer accurately."
            }),
            json!({
                "label": "Best effort now",
                "description": "Proceed with your preferred assumption and state it clearly."
            }),
        ])
    }
}

fn request_blocking_clarification(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    tool_name: &str,
    source: &str,
    question: &str,
    options: &[QualityQuestionOption],
) -> Result<String> {
    let request_id = format!("quality-question-{}", Uuid::new_v4());
    let interaction = create_pending_interaction(
        storage_root,
        session_id,
        turn_id,
        &request_id,
        AgentPendingInteractionKind::UserQuestion,
        json!({
            "requestId": request_id,
            "toolCallId": request_id,
            "toolName": tool_name,
            "questions": [{
                "id": "quality_blocking_detail",
                "header": "Clarify",
                "question": question,
                "options": to_quality_question_options_json(options),
            }],
            "allowNote": true,
        }),
    )?;
    emit_interaction_pending_event(storage_root, &interaction)?;
    emit_interaction_queue_updated(storage_root, session_id, turn_id)?;
    emit_event(
        storage_root,
        session_id,
        turn_id,
        "plan_question_requested",
        json!({
            "requestId": request_id,
            "toolCallId": request_id,
            "toolName": tool_name,
            "questions": [{
                "id": "quality_blocking_detail",
                "header": "Clarify",
                "question": question,
                "options": to_quality_question_options_json(options),
            }],
            "allowNote": true,
            "source": source,
        }),
    )?;
    Ok(interaction.id)
}

pub fn apply_intent_clarification_gate(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    profile: &StoredAiProviderProfile,
    secrets: &BTreeMap<String, String>,
    system_message: &AgentInferenceMessage,
    current_input: &str,
    provider_messages: &mut Vec<AgentInferenceMessage>,
    state: &mut IntentClarificationState,
) -> Result<TurnGateAction> {
    if state.gate_checked {
        return Ok(TurnGateAction::Continue);
    }

    let gate_result = run_intent_clarification_gate(
        profile,
        secrets,
        system_message,
        current_input,
        provider_messages,
    );
    state.gate_checked = true;

    let gate = match gate_result {
        IntentClarificationGateResult::Disabled => return Ok(TurnGateAction::Continue),
        IntentClarificationGateResult::Outcome(gate) => gate,
        IntentClarificationGateResult::Failed(failure) => {
            let (question, options, blocking_unknowns) =
                default_intent_fallback_question(current_input);
            emit_event(
                storage_root,
                session_id,
                turn_id,
                "intent_clarification_fallback",
                json!({
                    "stage": failure.stage.as_str(),
                    "detail": failure.detail,
                    "policy": "ask_blocking",
                    "blockingUnknowns": blocking_unknowns.clone(),
                }),
            )?;

            if !state.clarification_requested {
                state.clarification_requested = true;
                let interaction_id = request_blocking_clarification(
                    storage_root,
                    session_id,
                    turn_id,
                    "intent_clarification_fallback",
                    "intent_gate_fallback",
                    &question,
                    &options,
                )?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "intent_clarification_requested",
                    json!({
                        "question": question,
                        "blockingUnknowns": blocking_unknowns,
                        "source": "fallback",
                        "interactionId": interaction_id,
                    }),
                )?;
            }

            return Ok(TurnGateAction::Pause {
                reason: "I still need one blocking clarification before implementation can start."
                    .to_string(),
                include_assistant_prefix: false,
            });
        }
    };

    let blocking_unknowns = gate.blocking_unknowns;
    match gate.action {
        IntentClarificationAction::Proceed => Ok(TurnGateAction::Continue),
        IntentClarificationAction::Ask { question, options } => {
            if !state.clarification_requested {
                state.clarification_requested = true;
                let interaction_id = request_blocking_clarification(
                    storage_root,
                    session_id,
                    turn_id,
                    "intent_clarification_gate",
                    "intent_gate",
                    &question,
                    &options,
                )?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "intent_clarification_requested",
                    json!({
                        "question": question,
                        "blockingUnknowns": blocking_unknowns,
                        "source": "model",
                        "interactionId": interaction_id,
                    }),
                )?;
            }
            Ok(TurnGateAction::Pause {
                reason: "I still need one blocking clarification before implementation can start."
                    .to_string(),
                include_assistant_prefix: false,
            })
        }
    }
}

pub fn apply_quality_gate(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    profile: &StoredAiProviderProfile,
    secrets: &BTreeMap<String, String>,
    system_message: &AgentInferenceMessage,
    current_input: &str,
    assistant_text: &mut String,
    tool_trace: &[AgentToolCall],
    _provider_messages: &mut Vec<AgentInferenceMessage>,
    state: &mut QualityClarificationState,
) -> Result<TurnGateAction> {
    if assistant_text.is_empty() || !tool_trace.is_empty() {
        return Ok(TurnGateAction::Continue);
    }

    let model_gate = run_quality_gate(
        profile,
        secrets,
        system_message,
        current_input,
        assistant_text,
        tool_trace,
    );
    let gate = match model_gate {
        QualityGateResult::Skipped => return Ok(TurnGateAction::Continue),
        QualityGateResult::Outcome(gate) => gate,
        QualityGateResult::Failed(failure) => {
            let policy = quality_gate_fallback_policy();
            let risk = infer_quality_fallback_risk(current_input, assistant_text);
            emit_event(
                storage_root,
                session_id,
                turn_id,
                "quality_gate_fallback",
                json!({
                    "stage": failure.stage.as_str(),
                    "detail": failure.detail,
                    "policy": policy.as_str(),
                    "risk": risk.as_str(),
                }),
            )?;

            if matches!(policy, QualityGateFallbackPolicy::Strict) {
                return Ok(TurnGateAction::Pause {
                    reason: build_quality_fallback_pause_message(current_input, policy, risk),
                    include_assistant_prefix: false,
                });
            }

            emit_event(
                storage_root,
                session_id,
                turn_id,
                "quality_gate_assumptions_recorded",
                json!({
                    "policy": policy.as_str(),
                    "risk": risk.as_str(),
                    "assumptions": [
                        "quality_gate_unavailable_best_effort",
                        "constraints_may_need_followup"
                    ],
                }),
            )?;
            return Ok(TurnGateAction::Continue);
        }
    };

    if let Some(summary) = gate.goal_model_summary.as_deref() {
        emit_event(
            storage_root,
            session_id,
            turn_id,
            "goal_model_built",
            json!({
                "summary": summary,
                "contradictions": gate.contradictions.clone(),
            }),
        )?;
    }
    if !gate.correction_patterns.is_empty() {
        record_session_patterns(session_id, &gate.correction_patterns);
        emit_event(
            storage_root,
            session_id,
            turn_id,
            "quality_pattern_memory_updated",
            json!({
                "patterns": gate.correction_patterns.clone(),
            }),
        )?;
    }

    match gate.action {
        QualityGateAction::Accept { revised_answer } => {
            if let Some(revised_answer) = revised_answer {
                *assistant_text = revised_answer;
            }
            Ok(TurnGateAction::Continue)
        }
        QualityGateAction::Ask { question, options } => {
            if !state.clarification_requested {
                state.clarification_requested = true;
                let interaction_id = request_blocking_clarification(
                    storage_root,
                    session_id,
                    turn_id,
                    "answer_quality_gate",
                    "quality_gate",
                    &question,
                    &options,
                )?;
                emit_event(
                    storage_root,
                    session_id,
                    turn_id,
                    "quality_clarification_requested",
                    json!({
                        "question": question,
                        "interactionId": interaction_id,
                    }),
                )?;
            }
            Ok(TurnGateAction::Pause {
                reason: "I still need one blocking clarification before I can answer accurately."
                    .to_string(),
                include_assistant_prefix: false,
            })
        }
    }
}

pub fn apply_grounding_gate(
    storage_root: &str,
    session_id: &str,
    turn_id: &str,
    current_input: &str,
    assistant_text: &str,
    tool_trace: &[AgentToolCall],
    provider_messages: &mut Vec<AgentInferenceMessage>,
    state: &mut GroundingGateState,
) -> Result<TurnGateAction> {
    if assistant_text.is_empty() || has_verification_evidence(tool_trace) {
        return Ok(TurnGateAction::Continue);
    }

    let Some(reason) = grounding_guard_reason(current_input, assistant_text) else {
        return Ok(TurnGateAction::Continue);
    };

    if !state.retry_injected {
        state.retry_injected = true;
        provider_messages.push(AgentInferenceMessage {
            role: AgentInferenceMessageRole::User,
            content: grounding_retry_message(),
            tool_call_id: None,
            tool_calls: Vec::new(),
        });
        emit_event(
            storage_root,
            session_id,
            turn_id,
            "grounding_retry_injected",
            json!({
                "reason": reason,
                "toolTraceCount": tool_trace.len(),
            }),
        )?;
        return Ok(TurnGateAction::Retry);
    }

    emit_event(
        storage_root,
        session_id,
        turn_id,
        "grounding_required_unmet",
        json!({
            "reason": reason,
            "toolTraceCount": tool_trace.len(),
        }),
    )?;
    Ok(TurnGateAction::Pause {
        reason: grounding_unmet_message(),
        include_assistant_prefix: true,
    })
}
