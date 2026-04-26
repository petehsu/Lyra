use std::sync::Arc;

use lyra_protocol::config_types::ApprovalsReviewer;
use lyra_protocol::protocol::AskForApproval;
use lyra_protocol::protocol::AutoReviewAssessmentDecisionSource;
use lyra_protocol::protocol::AutoReviewAssessmentEvent;
use lyra_protocol::protocol::AutoReviewAssessmentStatus;
use lyra_protocol::protocol::AutoReviewRiskLevel;
use lyra_protocol::protocol::AutoReviewUserAuthorization;
use lyra_protocol::protocol::EventMsg;
use lyra_protocol::protocol::ReviewDecision;
use lyra_protocol::protocol::SubAgentSource;
use lyra_protocol::protocol::WarningEvent;
use tokio_util::sync::CancellationToken;

use crate::session::session::Session;
use crate::session::turn_context::TurnContext;

use super::AUTO_REVIEW_AGENT_NAME;
use super::AutoReviewApprovalRequest;
use super::AutoReviewAssessment;
use super::AutoReviewAssessmentOutcome;
use super::AutoReviewRejection;
use super::approval_request::auto_review_assessment_action;
use super::approval_request::auto_review_request_target_item_id;
use super::approval_request::auto_review_request_turn_id;
use super::prompt::auto_review_output_schema;
use super::prompt::parse_auto_review_assessment;
use super::review_session::AutoReviewSessionOutcome;
use super::review_session::AutoReviewSessionParams;
use super::review_session::build_auto_review_session_config;

const AUTO_REVIEW_REJECTION_INSTRUCTIONS: &str = concat!(
    "The agent must not attempt to achieve the same outcome via workaround, ",
    "indirect execution, or policy circumvention. ",
    "Proceed only with a materially safer alternative, ",
    "or if the user explicitly approves the action after being informed of the risk. ",
    "Otherwise, stop and request user input.",
);

const AUTO_REVIEW_TIMEOUT_INSTRUCTIONS: &str = concat!(
    "The automatic permission approval review did not finish before its deadline. ",
    "Do not assume the action is unsafe based on the timeout alone. ",
    "You may retry once, or ask the user for guidance or explicit approval.",
);

pub(crate) fn new_auto_review_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(crate) async fn auto_review_rejection_message(session: &Session, review_id: &str) -> String {
    let rejection = session
        .services
        .auto_review_rejections
        .lock()
        .await
        .remove(review_id)
        .filter(|rejection| !rejection.rationale.trim().is_empty())
        .unwrap_or_else(|| AutoReviewRejection {
            rationale: "Auto-reviewer denied the action without a specific rationale.".to_string(),
            source: AutoReviewAssessmentDecisionSource::Agent,
        });
    match rejection.source {
        AutoReviewAssessmentDecisionSource::Agent => format!(
            "This action was rejected due to unacceptable risk.\nReason: {}\n{}",
            rejection.rationale.trim(),
            AUTO_REVIEW_REJECTION_INSTRUCTIONS
        ),
    }
}

pub(crate) fn auto_review_timeout_message() -> String {
    AUTO_REVIEW_TIMEOUT_INSTRUCTIONS.to_string()
}

#[derive(Debug)]
pub(super) enum AutoReviewOutcome {
    Completed(anyhow::Result<AutoReviewAssessment>),
    TimedOut,
    Aborted,
}

fn auto_review_risk_level_str(level: AutoReviewRiskLevel) -> &'static str {
    match level {
        AutoReviewRiskLevel::Low => "low",
        AutoReviewRiskLevel::Medium => "medium",
        AutoReviewRiskLevel::High => "high",
        AutoReviewRiskLevel::Critical => "critical",
    }
}

/// Whether this turn should route `on-request` approval prompts through the
/// auto reviewer instead of surfacing them to the user. ARC may still
/// block actions earlier in the flow.
pub(crate) fn routes_approval_to_auto_review(turn: &TurnContext) -> bool {
    turn.approval_policy.value() == AskForApproval::OnRequest
        && turn.config.approvals_reviewer == ApprovalsReviewer::AutoReview
}

pub(crate) fn is_auto_reviewer_source(
    session_source: &lyra_protocol::protocol::SessionSource,
) -> bool {
    matches!(
        session_source,
        lyra_protocol::protocol::SessionSource::SubAgent(SubAgentSource::Other(name))
            if name == AUTO_REVIEW_AGENT_NAME
    )
}

/// This function always fails closed: timeouts, review-session failures, and
/// parse failures all block execution, but timeouts are still surfaced to the
/// caller as distinct from explicit auto_review denials.
async fn run_auto_review(
    session: Arc<Session>,
    turn: Arc<TurnContext>,
    review_id: String,
    request: AutoReviewApprovalRequest,
    retry_reason: Option<String>,
    external_cancel: Option<CancellationToken>,
) -> ReviewDecision {
    let target_item_id = auto_review_request_target_item_id(&request).map(str::to_string);
    let assessment_turn_id = auto_review_request_turn_id(&request, &turn.sub_id).to_string();
    let action_summary = auto_review_assessment_action(&request);
    session
        .send_event(
            turn.as_ref(),
            EventMsg::AutoReviewAssessment(AutoReviewAssessmentEvent {
                id: review_id.clone(),
                target_item_id: target_item_id.clone(),
                turn_id: assessment_turn_id.clone(),
                status: AutoReviewAssessmentStatus::InProgress,
                risk_level: None,
                user_authorization: None,
                rationale: None,
                decision_source: None,
                action: action_summary.clone(),
            }),
        )
        .await;

    if external_cancel
        .as_ref()
        .is_some_and(CancellationToken::is_cancelled)
    {
        session
            .send_event(
                turn.as_ref(),
                EventMsg::AutoReviewAssessment(AutoReviewAssessmentEvent {
                    id: review_id,
                    target_item_id,
                    turn_id: assessment_turn_id,
                    status: AutoReviewAssessmentStatus::Aborted,
                    risk_level: None,
                    user_authorization: None,
                    rationale: None,
                    decision_source: Some(AutoReviewAssessmentDecisionSource::Agent),
                    action: action_summary,
                }),
            )
            .await;
        return ReviewDecision::Abort;
    }

    let schema = auto_review_output_schema();
    let terminal_action = action_summary.clone();
    let outcome = Box::pin(run_auto_review_session(
        session.clone(),
        turn.clone(),
        request,
        retry_reason,
        schema,
        external_cancel,
    ))
    .await;

    let assessment = match outcome {
        AutoReviewOutcome::Completed(Ok(assessment)) => assessment,
        AutoReviewOutcome::Completed(Err(err)) => AutoReviewAssessment {
            risk_level: AutoReviewRiskLevel::High,
            user_authorization: AutoReviewUserAuthorization::Unknown,
            outcome: AutoReviewAssessmentOutcome::Deny,
            rationale: format!("Automatic approval review failed: {err}"),
        },
        AutoReviewOutcome::TimedOut => {
            let rationale =
                "Automatic approval review timed out while evaluating the requested approval."
                    .to_string();
            session
                .send_event(
                    turn.as_ref(),
                    EventMsg::Warning(WarningEvent {
                        message: rationale.clone(),
                    }),
                )
                .await;
            session
                .send_event(
                    turn.as_ref(),
                    EventMsg::AutoReviewAssessment(AutoReviewAssessmentEvent {
                        id: review_id,
                        target_item_id,
                        turn_id: assessment_turn_id,
                        status: AutoReviewAssessmentStatus::TimedOut,
                        risk_level: None,
                        user_authorization: None,
                        rationale: Some(rationale),
                        decision_source: Some(AutoReviewAssessmentDecisionSource::Agent),
                        action: terminal_action,
                    }),
                )
                .await;
            return ReviewDecision::TimedOut;
        }
        AutoReviewOutcome::Aborted => {
            session
                .send_event(
                    turn.as_ref(),
                    EventMsg::AutoReviewAssessment(AutoReviewAssessmentEvent {
                        id: review_id,
                        target_item_id,
                        turn_id: assessment_turn_id,
                        status: AutoReviewAssessmentStatus::Aborted,
                        risk_level: None,
                        user_authorization: None,
                        rationale: None,
                        decision_source: Some(AutoReviewAssessmentDecisionSource::Agent),
                        action: action_summary,
                    }),
                )
                .await;
            return ReviewDecision::Abort;
        }
    };

    let approved = match assessment.outcome {
        AutoReviewAssessmentOutcome::Allow => true,
        AutoReviewAssessmentOutcome::Deny => false,
    };
    let verdict = if approved { "approved" } else { "denied" };
    let user_authorization = match assessment.user_authorization {
        AutoReviewUserAuthorization::Unknown => "unknown",
        AutoReviewUserAuthorization::Low => "low",
        AutoReviewUserAuthorization::Medium => "medium",
        AutoReviewUserAuthorization::High => "high",
    };
    let warning = format!(
        "Automatic approval review {verdict} (risk: {}, authorization: {user_authorization}): {}",
        auto_review_risk_level_str(assessment.risk_level),
        assessment.rationale
    );
    session
        .send_event(
            turn.as_ref(),
            EventMsg::Warning(WarningEvent { message: warning }),
        )
        .await;
    let status = if approved {
        AutoReviewAssessmentStatus::Approved
    } else {
        AutoReviewAssessmentStatus::Denied
    };
    {
        let mut rationales = session.services.auto_review_rejections.lock().await;
        if approved {
            rationales.remove(&review_id);
        } else {
            let rejection = AutoReviewRejection {
                rationale: assessment.rationale.clone(),
                source: AutoReviewAssessmentDecisionSource::Agent,
            };
            rationales.insert(review_id.clone(), rejection);
        }
    }
    session
        .send_event(
            turn.as_ref(),
            EventMsg::AutoReviewAssessment(AutoReviewAssessmentEvent {
                id: review_id,
                target_item_id,
                turn_id: assessment_turn_id,
                status,
                risk_level: Some(assessment.risk_level),
                user_authorization: Some(assessment.user_authorization),
                rationale: Some(assessment.rationale.clone()),
                decision_source: Some(AutoReviewAssessmentDecisionSource::Agent),
                action: terminal_action,
            }),
        )
        .await;

    if approved {
        ReviewDecision::Approved
    } else {
        ReviewDecision::Denied
    }
}

/// Public entrypoint for approval requests that should be reviewed by auto_review.
pub(crate) async fn review_approval_request(
    session: &Arc<Session>,
    turn: &Arc<TurnContext>,
    review_id: String,
    request: AutoReviewApprovalRequest,
    retry_reason: Option<String>,
) -> ReviewDecision {
    // Box the delegated review future so callers do not inline the entire
    // auto_review session state machine into their own async stack.
    Box::pin(run_auto_review(
        Arc::clone(session),
        Arc::clone(turn),
        review_id,
        request,
        retry_reason,
        /*external_cancel*/ None,
    ))
    .await
}

pub(crate) async fn review_approval_request_with_cancel(
    session: &Arc<Session>,
    turn: &Arc<TurnContext>,
    review_id: String,
    request: AutoReviewApprovalRequest,
    retry_reason: Option<String>,
    cancel_token: CancellationToken,
) -> ReviewDecision {
    Box::pin(run_auto_review(
        Arc::clone(session),
        Arc::clone(turn),
        review_id,
        request,
        retry_reason,
        Some(cancel_token),
    ))
    .await
}

/// Runs the auto_review in a locked-down reusable review session.
///
/// The auto_review itself should not mutate state or trigger further approvals, so
/// it is pinned to a read-only sandbox with `approval_policy = never` and
/// nonessential agent features disabled. When the cached trunk session is idle,
/// later approvals append onto that same auto_review conversation to preserve a
/// stable prompt-cache key. If the trunk is already busy, the review runs in an
/// ephemeral fork from the last committed trunk rollout so parallel approvals
/// do not block each other or mutate the cached thread. The trunk is recreated
/// when the effective review-session config changes, and any future compaction
/// must continue to preserve the auto_review policy as exact top-level developer
/// context. It may still reuse the parent's managed-network allowlist for
/// read-only checks, but it intentionally runs without inherited exec-policy
/// rules.
pub(super) async fn run_auto_review_session(
    session: Arc<Session>,
    turn: Arc<TurnContext>,
    request: AutoReviewApprovalRequest,
    retry_reason: Option<String>,
    schema: serde_json::Value,
    external_cancel: Option<CancellationToken>,
) -> AutoReviewOutcome {
    let live_network_config = match session.services.network_proxy.as_ref() {
        Some(network_proxy) => match network_proxy.proxy().current_cfg().await {
            Ok(config) => Some(config),
            Err(err) => return AutoReviewOutcome::Completed(Err(err)),
        },
        None => None,
    };
    let available_models = session
        .services
        .models_manager
        .list_models(lyra_models_manager::manager::RefreshStrategy::Offline)
        .await;
    let preferred_reasoning_effort = |supports_low: bool, fallback| {
        if supports_low {
            Some(lyra_protocol::openai_models::ReasoningEffort::Low)
        } else {
            fallback
        }
    };
    let preferred_model = available_models
        .iter()
        .find(|preset| preset.model == super::AUTO_REVIEW_PREFERRED_MODEL);
    let (auto_review_model, auto_review_reasoning_effort) = if let Some(preset) = preferred_model {
        let reasoning_effort = preferred_reasoning_effort(
            preset
                .supported_reasoning_efforts
                .iter()
                .any(|effort| effort.effort == lyra_protocol::openai_models::ReasoningEffort::Low),
            Some(preset.default_reasoning_effort),
        );
        (
            super::AUTO_REVIEW_PREFERRED_MODEL.to_string(),
            reasoning_effort,
        )
    } else {
        let reasoning_effort = preferred_reasoning_effort(
            turn.model_info
                .supported_reasoning_levels
                .iter()
                .any(|preset| preset.effort == lyra_protocol::openai_models::ReasoningEffort::Low),
            turn.reasoning_effort
                .or(turn.model_info.default_reasoning_level),
        );
        (turn.model_info.slug.clone(), reasoning_effort)
    };
    let auto_review_config = build_auto_review_session_config(
        turn.config.as_ref(),
        live_network_config.clone(),
        auto_review_model.as_str(),
        auto_review_reasoning_effort,
    );
    let auto_review_config = match auto_review_config {
        Ok(config) => config,
        Err(err) => return AutoReviewOutcome::Completed(Err(err)),
    };

    match Box::pin(
        session
            .auto_review_session
            .run_review(AutoReviewSessionParams {
                parent_session: Arc::clone(&session),
                parent_turn: turn.clone(),
                spawn_config: auto_review_config,
                request,
                retry_reason,
                schema,
                model: auto_review_model,
                reasoning_effort: auto_review_reasoning_effort,
                reasoning_summary: turn.reasoning_summary,
                external_cancel,
            }),
    )
    .await
    {
        AutoReviewSessionOutcome::Completed(Ok(last_agent_message)) => {
            AutoReviewOutcome::Completed(parse_auto_review_assessment(
                last_agent_message.as_deref(),
            ))
        }
        AutoReviewSessionOutcome::Completed(Err(err)) => AutoReviewOutcome::Completed(Err(err)),
        AutoReviewSessionOutcome::TimedOut => AutoReviewOutcome::TimedOut,
        AutoReviewSessionOutcome::Aborted => AutoReviewOutcome::Aborted,
    }
}
