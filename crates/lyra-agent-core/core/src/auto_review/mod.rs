//! AutoReview review decides whether an `on-request` approval should be granted
//! automatically instead of shown to the user.
//!
//! High-level approach:
//! 1. Reconstruct a compact transcript that preserves user intent plus the most
//!    relevant recent assistant and tool context.
//! 2. Ask a dedicated auto_review review session to assess the exact planned
//!    action and return strict JSON.
//!    The auto_review clones the parent config, so it inherits any managed
//!    network proxy / allowlist that the parent turn already had.
//! 3. Fail closed on timeout, execution failure, or malformed output.
//! 4. Apply the auto_review's explicit allow/deny outcome.

mod approval_request;
mod prompt;
mod review;
mod review_session;

use std::time::Duration;

use lyra_protocol::protocol::AutoReviewAssessmentDecisionSource;
use serde::Deserialize;
use serde::Serialize;

pub(crate) use approval_request::AutoReviewApprovalRequest;
pub(crate) use approval_request::AutoReviewMcpAnnotations;
pub(crate) use review::auto_review_rejection_message;
pub(crate) use review::auto_review_timeout_message;
pub(crate) use review::is_auto_reviewer_source;
pub(crate) use review::new_auto_review_id;
pub(crate) use review::review_approval_request;
pub(crate) use review::review_approval_request_with_cancel;
pub(crate) use review::routes_approval_to_auto_review;
pub(crate) use review_session::AutoReviewSessionManager;

const AUTO_REVIEW_PREFERRED_MODEL: &str = "lyra-auto-review";
pub(crate) const AUTO_REVIEW_TIMEOUT: Duration = Duration::from_secs(90);
pub(crate) const AUTO_REVIEW_AGENT_NAME: &str = "auto_review";
const AUTO_REVIEW_MAX_MESSAGE_TRANSCRIPT_TOKENS: usize = 10_000;
const AUTO_REVIEW_MAX_TOOL_TRANSCRIPT_TOKENS: usize = 10_000;
const AUTO_REVIEW_MAX_MESSAGE_ENTRY_TOKENS: usize = 2_000;
const AUTO_REVIEW_MAX_TOOL_ENTRY_TOKENS: usize = 1_000;
const AUTO_REVIEW_MAX_ACTION_STRING_TOKENS: usize = 16_000;
const AUTO_REVIEW_RECENT_ENTRY_LIMIT: usize = 40;
const TRUNCATION_TAG: &str = "truncated";

/// Final allow/deny outcome returned by the auto_review reviewer.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AutoReviewAssessmentOutcome {
    Allow,
    Deny,
}

/// Structured output contract that the auto_review reviewer must satisfy.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct AutoReviewAssessment {
    pub(crate) risk_level: lyra_protocol::protocol::AutoReviewRiskLevel,
    pub(crate) user_authorization: lyra_protocol::protocol::AutoReviewUserAuthorization,
    pub(crate) outcome: AutoReviewAssessmentOutcome,
    pub(crate) rationale: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AutoReviewRejection {
    pub(crate) rationale: String,
    pub(crate) source: AutoReviewAssessmentDecisionSource,
}
