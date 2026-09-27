use serde_json::{Value, json};

use crate::native_backend::{
    reasoning_replay_items, replay_reasoning_value, valid_reasoning_value,
};

/// Read repair for sessions written before null stream deltas were ignored.
/// Called only after the provider/route/protocol/model origin check. Recover
/// existing bytes from the same response; never invent thought text, borrow it
/// from a neighboring step, or reconstruct opaque signatures from UI text.
pub(super) fn restore_chat_reasoning(
    assistant: &mut Value,
    protocol: &Value,
    source: &Value,
    current_step: bool,
) {
    if protocol
        .pointer("/replay/protocol")
        .and_then(Value::as_str)
        .is_some_and(|protocol| protocol != "openai_chat_completions")
    {
        assistant
            .as_object_mut()
            .unwrap()
            .remove("lyraProviderReplay");
        return;
    }
    let mut values = serde_json::Map::new();
    for item in protocol
        .pointer("/replay/items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let (Some(field), Some(value)) =
            (item.get("field").and_then(Value::as_str), item.get("value"))
            && valid_reasoning_value(field, value)
        {
            values.insert(field.to_string(), value.clone());
        }
    }
    let owner = source.pointer("/metadata/providerProtocol");
    let same_step_origin = owner.is_some_and(|owner| {
        owner.get("origin") == protocol.get("origin")
            && owner.get("turnId") == protocol.get("turnId")
    });
    if same_step_origin {
        let candidates = source
            .pointer("/metadata/providerTranscript")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|item| matching_assistant(item, assistant))
            .collect::<Vec<_>>();
        if let [original] = candidates.as_slice() {
            for field in [
                "reasoning",
                "reasoning_content",
                "reasoning_details",
                "reasoning_text",
            ] {
                if !values.contains_key(field)
                    && let Some(value) = replay_reasoning_value(original, field)
                {
                    values.insert(field.to_string(), value);
                }
            }
        }
        // UI reasoning belongs only to this exact response. A merged message
        // containing priorSteps may display reasoning from multiple responses.
        if current_step
            && protocol
                .get("priorSteps")
                .and_then(Value::as_array)
                .is_none_or(Vec::is_empty)
            && let Some(text) = source
                .get("reasoningContent")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
        {
            for item in protocol
                .pointer("/replay/items")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(field @ ("reasoning" | "reasoning_content" | "reasoning_text")) =
                    item.get("field").and_then(Value::as_str)
                    && !values.contains_key(field)
                {
                    values.insert(field.to_string(), json!(text));
                }
            }
        }
    }
    let items = reasoning_replay_items(&Value::Object(values.clone()));
    for (field, value) in values {
        assistant[field] = value;
    }
    if items.is_empty() {
        assistant
            .as_object_mut()
            .unwrap()
            .remove("lyraProviderReplay");
    } else {
        assistant["lyraProviderReplay"] =
            json!({"protocol":"openai_chat_completions","items":items});
    }
}

fn matching_assistant(candidate: &Value, assistant: &Value) -> bool {
    if candidate.get("role").and_then(Value::as_str) != Some("assistant")
        || candidate.get("content") != assistant.get("content")
    {
        return false;
    }
    let ids = |message: &Value| {
        message
            .get("tool_calls")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|call| call.get("id").and_then(Value::as_str).map(str::to_string))
            .collect::<Vec<_>>()
    };
    ids(candidate) == ids(assistant)
}
