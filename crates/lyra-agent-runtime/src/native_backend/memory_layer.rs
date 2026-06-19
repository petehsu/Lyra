use super::{LongTermMemoryRecord, MemoryCandidateMutation, RankedMemoryRecord, Value};

pub(crate) const LAYER_LIVE: &str = "live";
pub(crate) const LAYER_CUT: &str = "cut";
pub(crate) const LAYER_SHARED: &str = "shared";
pub(crate) const LAYER_FROZEN: &str = "frozen";

pub(crate) const MEMORY_LAYERS: &[&str] = &[LAYER_LIVE, LAYER_CUT, LAYER_SHARED, LAYER_FROZEN];

pub(crate) const VALUE_SEMANTIC: &str = "semantic";
pub(crate) const VALUE_CONTEXT: &str = "context";
pub(crate) const VALUE_EXECUTION_EVIDENCE: &str = "execution_evidence";

pub(crate) const EXECUTION_EVIDENCE_MIN_CONFIDENCE: f64 = 0.82;

const FROZEN_CONTENT_KINDS: &[&str] = &[
    "contact_email",
    "phone",
    "address",
    "full_name",
    "account_id",
    "legal_name",
    "date_of_birth",
];

pub(crate) fn is_frozen_sensitive(content: &Value, category: &str) -> bool {
    if category == "user_profile" {
        return true;
    }
    if content
        .get("sensitivity")
        .and_then(Value::as_str)
        .is_some_and(|value| matches!(value, "personal" | "sensitive"))
    {
        return true;
    }
    content
        .get("kind")
        .and_then(Value::as_str)
        .is_some_and(|kind| FROZEN_CONTENT_KINDS.contains(&kind))
}

pub(crate) fn resolve_memory_layer(
    category: &str,
    content: &Value,
    requires_confirmation: bool,
) -> String {
    if is_frozen_sensitive(content, category) || requires_confirmation {
        LAYER_FROZEN.to_string()
    } else {
        LAYER_SHARED.to_string()
    }
}

pub(crate) fn resolve_value_class(event_type: Option<&str>) -> String {
    match event_type {
        Some("tool_call_completed") | Some("file_change_recorded") => {
            VALUE_EXECUTION_EVIDENCE.to_string()
        }
        Some("decision_recorded") => VALUE_CONTEXT.to_string(),
        _ => VALUE_SEMANTIC.to_string(),
    }
}

pub(crate) fn promotion_gate_passes(
    value_class: &str,
    confidence: f64,
    has_evidence: bool,
) -> bool {
    match value_class {
        VALUE_EXECUTION_EVIDENCE => confidence >= EXECUTION_EVIDENCE_MIN_CONFIDENCE && has_evidence,
        VALUE_CONTEXT => confidence >= 0.65,
        _ => confidence >= 0.55,
    }
}

pub(crate) fn frozen_auto_overwrite_blocked(
    existing: &LongTermMemoryRecord,
    candidate: &MemoryCandidateMutation,
) -> bool {
    existing.layer == LAYER_FROZEN
        && candidate.source_type != "user_declaration"
        && candidate.confidence < 0.98
}

pub(crate) fn layer_rank_boost(layer: &str) -> f64 {
    if layer == LAYER_FROZEN { 0.12 } else { 0.0 }
}

pub(crate) fn memory_abstract_text(fact: &str) -> String {
    let trimmed = fact.trim();
    if trimmed.chars().count() <= 120 {
        trimmed.to_string()
    } else {
        format!("{}…", trimmed.chars().take(117).collect::<String>())
    }
}

fn injection_depth_for_score(score: f64) -> &'static str {
    if score >= 0.72 {
        "L2"
    } else if score >= 0.48 {
        "L1"
    } else {
        "L0"
    }
}

pub(crate) fn format_ranked_memory_injection_line(
    index: usize,
    ranked: &RankedMemoryRecord,
) -> String {
    let record = &ranked.record;
    let depth = injection_depth_for_score(ranked.score);
    match depth {
        "L2" => format!(
            "{}. [L2/detail] layer={} valueClass={} id={} scope={} category={} priority={} confidence={} source_type={} fact={} content={}",
            index + 1,
            record.layer,
            record.value_class,
            record.id,
            record.scope,
            record.category,
            record.priority,
            record.confidence,
            record.source_type,
            record.fact,
            serde_json::to_string(&record.content).unwrap_or_else(|_| "null".to_string())
        ),
        "L1" => format!(
            "{}. [L1/overview] layer={} valueClass={} id={} scope={} category={} confidence={} fact={} overview={}",
            index + 1,
            record.layer,
            record.value_class,
            record.id,
            record.scope,
            record.category,
            record.confidence,
            record.fact,
            record
                .abstract_text
                .as_deref()
                .unwrap_or(record.fact.as_str())
        ),
        _ => format!(
            "{}. [L0/abstract] layer={} valueClass={} id={} scope={} category={} abstract={}",
            index + 1,
            record.layer,
            record.value_class,
            record.id,
            record.scope,
            record.category,
            record
                .abstract_text
                .as_deref()
                .unwrap_or(record.fact.as_str())
        ),
    }
}

pub(crate) fn apply_layer_fields_to_candidate(mutation: &mut MemoryCandidateMutation) {
    let requires_confirmation = mutation
        .content
        .get("requiresConfirmation")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    mutation.layer = Some(resolve_memory_layer(
        &mutation.category,
        &mutation.content,
        requires_confirmation,
    ));
    if mutation.value_class.is_none() {
        mutation.value_class = Some(VALUE_SEMANTIC.to_string());
    }
    if mutation.abstract_text.is_none() {
        mutation.abstract_text = Some(memory_abstract_text(&mutation.fact));
    }
}

pub(crate) fn apply_layer_fields_to_record(record: &mut LongTermMemoryRecord) {
    if record.layer.is_empty() {
        let requires_confirmation = record
            .content
            .get("requiresConfirmation")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        record.layer =
            resolve_memory_layer(&record.category, &record.content, requires_confirmation);
    }
    if record.value_class.is_empty() {
        record.value_class = VALUE_SEMANTIC.to_string();
    }
    if record.abstract_text.is_none() {
        record.abstract_text = Some(memory_abstract_text(&record.fact));
    }
}
