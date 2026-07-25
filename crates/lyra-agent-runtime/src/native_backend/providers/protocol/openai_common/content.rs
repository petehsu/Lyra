use serde_json::Value;

pub(crate) fn message_content(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Array(parts)) => {
            let text = parts
                .iter()
                .filter_map(|part| {
                    part.get("text")
                        .and_then(Value::as_str)
                        .or_else(|| part.get("content").and_then(Value::as_str))
                })
                .collect::<Vec<_>>()
                .join("");
            (!text.trim().is_empty()).then_some(text)
        }
        _ => None,
    }
}

pub(crate) fn message_reasoning_text(message: &Value) -> Option<String> {
    [
        "reasoning",
        "reasoning_content",
        "thinking",
        "reasoning_text",
    ]
    .iter()
    .find_map(|field| message.get(*field).and_then(Value::as_str))
    .filter(|value| !value.trim().is_empty())
    .map(str::to_string)
    .or_else(|| {
        message
            .get("reasoning_details")
            .filter(|value| !value.is_null())
            .map(|value| serde_json::to_string(value).unwrap_or_default())
            .filter(|value| !value.trim().is_empty())
    })
}

/// Return the native OpenAI-compatible reasoning field without normalizing its
/// value. Presence matters: several thinking-model gateways require an empty
/// `reasoning_content` to be replayed on assistant tool-call messages.
pub(crate) fn message_reasoning_field(message: &Value) -> Option<(&'static str, Value)> {
    [
        "reasoning",
        "reasoning_content",
        "reasoning_details",
        "reasoning_text",
    ]
    .into_iter()
    .find_map(|field| message.get(field).map(|value| (field, value.clone())))
}

pub(crate) fn content_to_plain_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.get("content").and_then(Value::as_str))
            })
            .collect::<Vec<_>>()
            .join(""),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn content_helpers_join_openai_text_parts() {
        let content = json!([
            { "type": "text", "text": "Hel" },
            { "type": "output_text", "text": "lo" }
        ]);

        assert_eq!(message_content(Some(&content)).as_deref(), Some("Hello"));
        assert_eq!(content_to_plain_text(&content), "Hello");
    }

    #[test]
    fn reasoning_field_preserves_present_empty_value() {
        let message = serde_json::json!({ "reasoning_content": "" });
        let (field, value) = message_reasoning_field(&message).expect("present field");
        assert_eq!(field, "reasoning_content");
        assert_eq!(value, "");
    }
}
