use super::clarification_gate::evaluate_clarification_gate;
use super::events::emit_store_event;
use super::reference_resolution::resolve_turn_references;
use super::*;
use crate::storage::{
    CreateIntentEnvelopeInput, CreateIntentTargetBindingInput, CreateRuntimeDecisionRecordInput,
    InlineReference, IntentAmbiguityFlag,
};
use rusqlite::{params, OptionalExtension};

pub(crate) struct IntentClassification {
    pub envelope: CreateIntentEnvelopeInput,
    pub target_bindings: Vec<CreateIntentTargetBindingInput>,
    pub high_risk: bool,
    pub hard_block_reason: Option<String>,
}

pub(crate) struct RuntimeIntakeOutcome {
    pub hard_blocked: bool,
}

pub(crate) fn prepare_runtime_intake(
    store: &AiStore,
    session: &AgentSession,
    turn_id: &str,
    user_message_id: &str,
    input: &RuntimeTurnInput,
    options: &RuntimeThreadOptions,
) -> Result<RuntimeIntakeOutcome> {
    let reference_outcome =
        resolve_turn_references(store, session, turn_id, user_message_id, input)?;
    for resolution in &reference_outcome.resolutions {
        emit_store_event(
            store,
            &session.id,
            Some(turn_id),
            if resolution.status == "resolved" {
                "reference_resolution_completed"
            } else {
                "reference_resolution_failed"
            },
            json!({
                "sessionId": session.id,
                "turnId": turn_id,
                "inlineReferenceId": resolution.inline_reference_id,
                "resolutionId": resolution.resolution_id,
                "kind": resolution.kind,
                "targetRef": resolution.target_ref,
                "status": resolution.status,
                "reason": resolution.reason,
            }),
        )?;
    }

    let classification = classify_user_intent(
        store,
        session,
        turn_id,
        user_message_id,
        input,
        options,
        &reference_outcome.references,
    )?;
    let envelope = store.create_user_intent_envelope(classification.envelope.clone())?;
    for binding in classification.target_bindings.iter() {
        let mut binding = binding.clone();
        binding.intent_id = envelope.intent_id.clone();
        store.create_intent_target_binding(binding)?;
    }
    let decision = store.create_runtime_decision_record(CreateRuntimeDecisionRecordInput {
        session_id: session.id.clone(),
        runtime_turn_id: turn_id.to_string(),
        user_message_id: user_message_id.to_string(),
        intent_id: Some(envelope.intent_id.clone()),
        kind: "intent_classification".to_string(),
        status: if classification.hard_block_reason.is_some() {
            "needs_clarification".to_string()
        } else {
            "recorded".to_string()
        },
        summary: format!(
            "Classified user message as {} with confidence {:.2}.",
            envelope.kind, envelope.confidence
        ),
        reason: json!({
            "kind": envelope.kind,
            "confidence": envelope.confidence,
            "modeCandidate": envelope.mode_candidate,
            "ambiguityFlags": envelope.ambiguity_flags,
            "hardBlockReason": classification.hard_block_reason,
            "highRisk": classification.high_risk,
        }),
        evidence_refs: envelope.classification_evidence_refs.clone(),
    })?;
    emit_store_event(
        store,
        &session.id,
        Some(turn_id),
        "runtime_decision_recorded",
        json!({
            "sessionId": session.id,
            "turnId": turn_id,
            "decisionId": decision.decision_id,
            "kind": decision.kind,
            "status": decision.status,
            "intentId": envelope.intent_id,
        }),
    )?;

    let gate = evaluate_clarification_gate(
        store,
        &session.id,
        turn_id,
        user_message_id,
        &envelope,
        &classification,
        &reference_outcome.references,
    )?;
    Ok(RuntimeIntakeOutcome {
        hard_blocked: gate.hard_blocked,
    })
}

pub(crate) fn classify_user_intent(
    store: &AiStore,
    session: &AgentSession,
    turn_id: &str,
    user_message_id: &str,
    input: &RuntimeTurnInput,
    options: &RuntimeThreadOptions,
    references: &[InlineReference],
) -> Result<IntentClassification> {
    let text = input.text.trim();
    let lowered = text.to_lowercase();
    let mode_candidate = options
        .collaboration_mode
        .as_deref()
        .map(|mode| normalize_collaboration_mode(Some(mode)));
    let mut evidence_refs = Vec::new();
    let mut ambiguity_flags = Vec::new();
    let mut target_bindings = Vec::new();
    let mut hard_block_reason = None;
    let mut kind = "chat".to_string();
    let mut confidence = 0.72_f64;
    let mut high_risk = contains_high_risk_action(&lowered);

    if let Some(ui_action) = input.ui_action.as_ref() {
        evidence_refs.push("ui_action_present".to_string());
        let freshness = ui_action_freshness(store, &session.id, ui_action)?;
        kind = ui_action_intent_kind(&ui_action.kind);
        confidence = if freshness == "fresh" { 0.98 } else { 0.42 };
        if freshness == "fresh" {
            target_bindings.push(CreateIntentTargetBindingInput {
                intent_id: String::new(),
                session_id: session.id.clone(),
                runtime_turn_id: turn_id.to_string(),
                target_kind: ui_action.target_kind.clone(),
                target_id: ui_action.target_id.clone(),
                freshness_status: freshness,
                confidence,
                evidence_refs: vec!["ui_action_target_fresh".to_string()],
            });
        } else {
            ambiguity_flags.push(IntentAmbiguityFlag {
                code: "stale_ui_action_target".to_string(),
                severity: "hard_block".to_string(),
                detail: format!(
                    "{} target {} is {}",
                    ui_action.target_kind, ui_action.target_id, freshness
                ),
            });
            hard_block_reason = Some("ui_action_target_not_fresh".to_string());
            high_risk = true;
        }
    } else if mode_candidate.as_deref() == Some("plan") || requests_plan(&lowered) {
        evidence_refs.push("mode_or_text_requests_planning".to_string());
        kind = "planning_request".to_string();
        confidence = if mode_candidate.as_deref() == Some("plan") {
            0.9
        } else {
            0.8
        };
    } else if requests_continuation(&lowered) {
        evidence_refs.push("continuation_language".to_string());
        kind = "multi_turn_continuation".to_string();
        confidence = 0.78;
    } else if lowered.contains("rollback") || lowered.contains("revert") || lowered.contains("回滚")
    {
        evidence_refs.push("rollback_language".to_string());
        kind = "message_rollback".to_string();
        confidence = if references.is_empty() { 0.62 } else { 0.82 };
        high_risk = true;
    } else if is_explicit_pending_resolution(store, &session.id, &lowered)? {
        evidence_refs.push("short_pending_resolution_text".to_string());
        kind = "approval_resolution".to_string();
        confidence = 0.76;
    } else if looks_like_task(&lowered) || references.is_empty() == false {
        evidence_refs.push("task_language_or_references".to_string());
        kind = "task_execution".to_string();
        confidence = if references.is_empty() { 0.74 } else { 0.84 };
    }

    if references.is_empty() == false {
        evidence_refs.push("inline_references_present".to_string());
    }
    if mode_candidate.is_some() {
        evidence_refs.push("mode_candidate_present".to_string());
    }
    if high_risk && references.is_empty() && input.ui_action.is_none() {
        ambiguity_flags.push(IntentAmbiguityFlag {
            code: "high_risk_target_unclear".to_string(),
            severity: "hard_block".to_string(),
            detail: "High-risk action has no fresh target binding or inline reference.".to_string(),
        });
        hard_block_reason = Some("high_risk_target_unclear".to_string());
    }
    if ambiguous_it_request(&lowered) && references.is_empty() && input.ui_action.is_none() {
        ambiguity_flags.push(IntentAmbiguityFlag {
            code: "ambiguous_change_target".to_string(),
            severity: "hard_block".to_string(),
            detail: "The request asks to change/fix/optimize an unclear target.".to_string(),
        });
        hard_block_reason = Some("ambiguous_change_target".to_string());
    }
    if confidence < 0.5 {
        kind = "unknown".to_string();
    }

    Ok(IntentClassification {
        envelope: CreateIntentEnvelopeInput {
            session_id: session.id.clone(),
            conversation_id: session.id.clone(),
            user_message_id: user_message_id.to_string(),
            runtime_turn_id: turn_id.to_string(),
            kind,
            confidence,
            mode_candidate,
            source_message_ref: Some(user_message_id.to_string()),
            ui_action_id: input
                .ui_action
                .as_ref()
                .map(|action| action.action_id.clone()),
            raw_text_ref: Some(format!("session_dialog:{user_message_id}:content_raw")),
            segment_refs: input
                .parts
                .iter()
                .enumerate()
                .map(|(index, _)| format!("part:{index}"))
                .collect(),
            inline_reference_ids: references
                .iter()
                .map(|reference| reference.inline_reference_id.clone())
                .collect(),
            constraints: json!({
                "hasInlineReferences": references.is_empty() == false,
                "hasUiAction": input.ui_action.is_some(),
                "pendingObjectMustBeExplicit": true,
                "highRisk": high_risk
            }),
            classification_evidence_refs: evidence_refs,
            ambiguity_flags,
        },
        target_bindings,
        high_risk,
        hard_block_reason,
    })
}

fn ui_action_intent_kind(kind: &str) -> String {
    match kind.trim() {
        "plan_approval" | "plan.approve" => "plan_approval",
        "plan_rejection" | "plan.reject" => "plan_rejection",
        "approval_resolution" | "approval.resolve" => "approval_resolution",
        "clarification_answer" | "clarification.resolve" => "clarification_answer",
        "message_rollback" | "rollback.execute" | "rollback.preview" => "message_rollback",
        other if other.contains("plan") => "plan_annotation",
        _ => "unknown",
    }
    .to_string()
}

fn ui_action_freshness(
    store: &AiStore,
    session_id: &str,
    action: &RuntimeTurnUiAction,
) -> Result<String> {
    store.with_session_conn(session_id, |conn| match action.target_kind.as_str() {
        "approval_ticket" => {
            let status: Option<String> = conn
                .query_row(
                    "SELECT status FROM approval_ticket
                         WHERE session_id = ?1 AND approval_ticket_id = ?2",
                    params![session_id, action.target_id],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(match status.as_deref() {
                Some("pending_user") => "fresh".to_string(),
                Some(status) => status.to_string(),
                None => "missing".to_string(),
            })
        }
        "plan" | "planning_session" => {
            let status: Option<String> = conn
                .query_row(
                    "SELECT status FROM planning_session
                         WHERE session_id = ?1 AND planning_session_id = ?2",
                    params![session_id, action.target_id],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(match status.as_deref() {
                Some("pending_review") => "fresh".to_string(),
                Some(status) => status.to_string(),
                None => "missing".to_string(),
            })
        }
        "question_ticket" => {
            let status: Option<String> = conn
                .query_row(
                    "SELECT status FROM question_ticket
                         WHERE session_id = ?1 AND question_ticket_id = ?2",
                    params![session_id, action.target_id],
                    |row| row.get(0),
                )
                .optional()?;
            Ok(match status.as_deref() {
                Some("open") => "fresh".to_string(),
                Some(status) => status.to_string(),
                None => "missing".to_string(),
            })
        }
        _ => Ok("unknown_target_kind".to_string()),
    })
}

fn is_explicit_pending_resolution(
    store: &AiStore,
    session_id: &str,
    lowered: &str,
) -> Result<bool> {
    let terse = lowered.split_whitespace().count() <= 6;
    if !terse
        || !(lowered.contains("approve")
            || lowered.contains("reject")
            || lowered.contains("deny")
            || lowered.contains("批准")
            || lowered.contains("拒绝"))
    {
        return Ok(false);
    }
    let pending = store.read_pending_approval_interactions(session_id)?;
    Ok(pending.is_empty() == false || store.read_planning_summary(session_id)?.is_some())
}

fn looks_like_task(value: &str) -> bool {
    [
        "implement",
        "fix",
        "change",
        "update",
        "create",
        "delete",
        "run",
        "test",
        "refactor",
        "optimize",
        "apply",
        "完成",
        "实现",
        "修复",
        "修改",
        "优化",
        "创建",
        "删除",
    ]
    .iter()
    .any(|token| value.contains(token))
}

fn requests_plan(value: &str) -> bool {
    value.contains("plan") || value.contains("规划") || value.contains("计划")
}

fn requests_continuation(value: &str) -> bool {
    value.contains("continue") || value.contains("resume") || value.contains("继续")
}

fn contains_high_risk_action(value: &str) -> bool {
    [
        "delete", "remove", "rollback", "revert", "reset", "drop", "rm -rf", "删除", "回滚", "重置",
    ]
    .iter()
    .any(|token| value.contains(token))
}

fn ambiguous_it_request(value: &str) -> bool {
    let asks_change = [
        "fix", "change", "optimize", "refactor", "修改", "修复", "优化",
    ]
    .iter()
    .any(|token| value.contains(token));
    asks_change
        && [" it", " this", " that", "它", "这个", "那个"]
            .iter()
            .any(|token| value.contains(token))
}
