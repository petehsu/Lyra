use super::*;

pub(crate) fn project_intake_prompt_value(detail: &AgentSessionDetail) -> Option<Value> {
    let summary = detail.intent_summary.as_ref()?;
    Some(json!({
        "intentId": summary.intent_id,
        "kind": summary.kind,
        "confidence": summary.confidence,
        "modeCandidate": summary.mode_candidate,
        "targetBindings": summary.target_bindings,
        "ambiguityFlags": summary.ambiguity_flags,
    }))
}
