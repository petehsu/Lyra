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
    // Delegates to the shared reader estimator, which runs a real BPE tokenizer
    // (o200k_base) thanks to the `tokenizer-tiktoken` feature this crate enables.
    // Accurate counts here keep context-window trimming and memory checkpoints
    // from under-counting CJK text and code.
    lyra_agent_reader::estimate_tokens(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cjk_is_not_under_counted() {
        // The old chars/4 heuristic would report ~5 tokens for this 20-char
        // string; the real BPE tokenizer counts substantially more.
        let text = "这是一段中文测试文本用于验证分词器的真实开销";
        let heuristic = text.chars().count() / 4;
        assert!(
            estimate_tokens(text) > heuristic,
            "BPE estimate should exceed the chars/4 heuristic for CJK"
        );
    }

    #[test]
    fn message_estimate_ignores_inline_image_data() {
        let with_image = json!({
            "blocks": [
                { "type": "text", "text": "hello" },
                { "type": "image", "data": "AAAA".repeat(1000) }
            ]
        });
        let without_image = json!({
            "blocks": [ { "type": "text", "text": "hello" } ]
        });
        // Stripping image data keeps the base64 blob from inflating the count, so
        // the two should land close together rather than thousands apart.
        let delta =
            estimate_message_tokens(&with_image).abs_diff(estimate_message_tokens(&without_image));
        assert!(delta < 50, "inline image data should be stripped, delta={delta}");
    }
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
