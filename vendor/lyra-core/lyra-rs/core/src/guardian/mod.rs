//! Guardian review decides whether an `on-request` approval should be granted
//! automatically instead of shown to the user.
//!
//! High-level approach:
//! 1. Reconstruct a compact transcript that preserves user intent plus the most
//!    relevant recent assistant and tool context.
//! 2. Ask a dedicated guardian review session to assess the exact planned
//!    action and return strict JSON.
//!    The guardian clones the parent config, so it inherits any managed
//!    network proxy / allowlist that the parent turn already had.
//! 3. Fail closed on timeout, execution failure, or malformed output.
//! 4. Apply the guardian's explicit allow/deny outcome.

mod approval_request;
mod prompt;
mod review;
mod review_session;

use std::time::Duration;

use lyra_protocol::protocol::GuardianAssessmentDecisionSource;
use serde::Deserialize;
use serde::Serialize;

pub(crate) use approval_request::GuardianApprovalRequest;
pub(crate) use approval_request::GuardianMcpAnnotations;
pub(crate) use review::guardian_rejection_message;
pub(crate) use review::guardian_timeout_message;
pub(crate) use review::is_guardian_reviewer_source;
pub(crate) use review::new_guardian_review_id;
pub(crate) use review::review_approval_request;
pub(crate) use review::review_approval_request_with_cancel;
pub(crate) use review::routes_approval_to_guardian;
pub(crate) use review_session::GuardianReviewSessionManager;

const GUARDIAN_PREFERRED_MODEL: &str = "lyra-auto-review";
pub(crate) const GUARDIAN_REVIEW_TIMEOUT: Duration = Duration::from_secs(90);
pub(crate) const GUARDIAN_REVIEWER_NAME: &str = "guardian";
const GUARDIAN_MAX_MESSAGE_TRANSCRIPT_TOKENS: usize = 10_000;
const GUARDIAN_MAX_TOOL_TRANSCRIPT_TOKENS: usize = 10_000;
const GUARDIAN_MAX_MESSAGE_ENTRY_TOKENS: usize = 2_000;
const GUARDIAN_MAX_TOOL_ENTRY_TOKENS: usize = 1_000;
const GUARDIAN_MAX_ACTION_STRING_TOKENS: usize = 16_000;
const GUARDIAN_RECENT_ENTRY_LIMIT: usize = 40;
const TRUNCATION_TAG: &str = "truncated";

/// Final allow/deny outcome returned by the guardian reviewer.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum GuardianAssessmentOutcome {
    Allow,
    Deny,
}

/// Structured output contract that the guardian reviewer must satisfy.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct GuardianAssessment {
    pub(crate) risk_level: lyra_protocol::protocol::GuardianRiskLevel,
    pub(crate) user_authorization: lyra_protocol::protocol::GuardianUserAuthorization,
    pub(crate) outcome: GuardianAssessmentOutcome,
    pub(crate) rationale: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GuardianRejection {
    pub(crate) rationale: String,
    pub(crate) source: GuardianAssessmentDecisionSource,
}
