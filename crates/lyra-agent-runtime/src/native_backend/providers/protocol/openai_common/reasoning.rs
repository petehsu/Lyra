use serde_json::{Map, Value, json};

const FIELDS: [&str; 4] = [
    "reasoning",
    "reasoning_content",
    "reasoning_details",
    "reasoning_text",
];

/// Wire types are part of the replay contract. Null means no delta, not an
/// instruction to erase earlier content. Empty strings/arrays remain valid.
pub(crate) fn valid_reasoning_value(field: &str, value: &Value) -> bool {
    match field {
        "reasoning_details" => value.is_array(),
        "reasoning" | "reasoning_content" | "reasoning_text" => value.is_string(),
        _ => false,
    }
}

/// Retain every native field, including signed/opaque details returned alongside
/// display text. The request's provider policy selects which field goes on wire.
pub(crate) fn reasoning_replay_items(message: &Value) -> Vec<Value> {
    FIELDS
        .into_iter()
        .filter_map(|field| {
            let value = message
                .get(field)
                .filter(|value| valid_reasoning_value(field, value))?;
            Some(json!({ "field": field, "value": value }))
        })
        .collect()
}

#[derive(Clone, Debug, Default)]
pub(crate) struct ReasoningAccumulator(Map<String, Value>);

impl ReasoningAccumulator {
    pub(crate) fn push(&mut self, delta: &Value) {
        for field in FIELDS {
            let Some(incoming) = delta
                .get(field)
                .filter(|value| valid_reasoning_value(field, value))
            else {
                continue;
            };
            match (self.0.get_mut(field), incoming) {
                (Some(Value::String(current)), Value::String(fragment)) => {
                    current.push_str(fragment)
                }
                (Some(Value::Array(current)), Value::Array(fragment)) => {
                    current.extend(fragment.iter().cloned())
                }
                _ => {
                    self.0.insert(field.to_string(), incoming.clone());
                }
            }
        }
    }

    pub(crate) fn into_items(self) -> Vec<Value> {
        reasoning_replay_items(&Value::Object(self.0))
    }
}

/// Prefer valid native replay data over the display projection. In particular,
/// a JSON null must not shadow a valid value in the other representation, and a
/// text projection must never be cast into signed reasoning_details.
pub(crate) fn replay_reasoning_value(message: &Value, field: &str) -> Option<Value> {
    let native = message
        .get("lyraProviderReplay")
        .filter(|replay| {
            replay.get("protocol").and_then(Value::as_str) == Some("openai_chat_completions")
        })
        .and_then(|replay| replay.get("items"))
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                (item.get("field").and_then(Value::as_str) == Some(field))
                    .then(|| {
                        item.get("value")
                            .filter(|value| valid_reasoning_value(field, value))
                            .cloned()
                    })
                    .flatten()
            })
        });
    native.or_else(|| {
        message
            .get(field)
            .filter(|value| valid_reasoning_value(field, value))
            .cloned()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasoning_replay_null_and_wrong_types_never_erase_fragments() {
        for field in ["reasoning", "reasoning_content", "reasoning_text"] {
            let mut state = ReasoningAccumulator::default();
            for value in [
                json!(""),
                json!("think"),
                Value::Null,
                json!("ing"),
                json!([]),
                json!(false),
                Value::Null,
            ] {
                state.push(&json!({ field: value }));
            }
            assert_eq!(
                state.into_items(),
                vec![json!({"field":field,"value":"thinking"})]
            );
        }
    }

    #[test]
    fn reasoning_replay_preserves_parallel_text_and_opaque_details() {
        let mut state = ReasoningAccumulator::default();
        state.push(&json!({"reasoning":"text", "reasoning_details":[{"type":"reasoning.encrypted","data":"opaque","signature":"sig"}]}));
        state.push(&json!({"reasoning":null,"reasoning_details":null}));
        let items = state.into_items();
        assert_eq!(items.len(), 2);
        assert_eq!(items[1]["value"][0]["signature"], "sig");
        assert_eq!(
            reasoning_replay_items(&json!({"reasoning":null,"reasoning_content":""})),
            vec![json!({"field":"reasoning_content","value":""})]
        );
    }

    #[test]
    fn reasoning_replay_prefers_native_bytes_and_skips_null() {
        let mut message = json!({"reasoning_content":"display", "lyraProviderReplay":{
            "protocol":"openai_chat_completions","items":[{"field":"reasoning_content","value":" native "}]
        }});
        assert_eq!(
            replay_reasoning_value(&message, "reasoning_content"),
            Some(json!(" native "))
        );
        message["lyraProviderReplay"]["items"][0]["value"] = Value::Null;
        assert_eq!(
            replay_reasoning_value(&message, "reasoning_content"),
            Some(json!("display"))
        );
        assert_eq!(replay_reasoning_value(&message, "reasoning_details"), None);
    }
}
