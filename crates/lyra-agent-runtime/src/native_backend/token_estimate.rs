use serde_json::Value;

pub(crate) fn estimate_messages_tokens(messages: &[Value]) -> usize {
    messages.iter().map(estimate_message_tokens).sum()
}

pub(crate) fn estimate_message_tokens(message: &Value) -> usize {
    estimate_tokens(
        &serde_json::to_string(&strip_inline_image_data_for_token_estimate(message.clone()))
            .unwrap_or_default(),
    )
}

pub(crate) fn estimate_tokens(text: &str) -> usize {
    (text.chars().count() / 4).max(1)
}

fn strip_inline_image_data_for_token_estimate(mut message: Value) -> Value {
    if let Some(images) = message
        .pointer_mut("/metadata/inlineImages")
        .and_then(Value::as_array_mut)
    {
        for image in images.iter_mut() {
            if let Some(object) = image.as_object_mut() {
                object.remove("data");
            }
        }
    }
    if let Some(blocks) = message.get_mut("blocks").and_then(Value::as_array_mut) {
        for block in blocks.iter_mut() {
            if block.get("type").and_then(Value::as_str) == Some("image")
                && let Some(object) = block.as_object_mut()
            {
                object.remove("data");
            }
        }
    }
    message
}
