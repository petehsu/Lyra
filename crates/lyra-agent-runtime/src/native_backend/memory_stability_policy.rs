use super::*;
use chrono::{Duration, Utc};

#[derive(Clone, Debug)]
pub(crate) struct StabilityPolicy {
    pub(crate) window_hours: i64,
    pub(crate) requires_evidence_recheck: bool,
}

pub(crate) fn stability_policy_for_mutation(
    mutation: &MemoryCandidateMutation,
) -> Option<StabilityPolicy> {
    if mutation.source_type == "user_declaration" {
        return None;
    }
    let value_class = mutation.value_class.as_deref().unwrap_or(VALUE_SEMANTIC);
    let hours = match value_class {
        VALUE_EXECUTION_EVIDENCE => {
            if mutation.confidence >= EXECUTION_EVIDENCE_MIN_CONFIDENCE {
                return None;
            }
            48
        }
        VALUE_CONTEXT => 12,
        _ => match mutation.source_type.as_str() {
            "inferred" | "agent_inference" => 72,
            "tool_observation" | "tool_evidence" => 36,
            _ if mutation.confidence < 0.85 => 24,
            _ => return None,
        },
    };
    Some(StabilityPolicy {
        window_hours: hours,
        requires_evidence_recheck: value_class == VALUE_EXECUTION_EVIDENCE,
    })
}

pub(crate) fn should_delay_promotion(mutation: &MemoryCandidateMutation) -> bool {
    stability_policy_for_mutation(mutation).is_some()
}

pub(crate) fn stability_window_hours_for_mutation(
    mutation: &MemoryCandidateMutation,
) -> Option<i64> {
    stability_policy_for_mutation(mutation).map(|policy| policy.window_hours)
}

pub(crate) fn stability_review_at_for_mutation(
    mutation: &MemoryCandidateMutation,
) -> Option<String> {
    let policy = stability_policy_for_mutation(mutation)?;
    Some(
        (Utc::now() + Duration::hours(policy.window_hours))
            .to_rfc3339_opts(SecondsFormat::Secs, true),
    )
}
