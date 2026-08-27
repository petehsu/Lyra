use serde_json::Value;

/// Count tokens across all messages, skipping those excluded from the
/// provider context (`excludeFromProviderContext`, API-error, provider-error).
///
/// The UI context-usage meter derives from this count. After a non-loss
/// compression, the original messages stay in storage (for scroll-back
/// display) but are marked excluded — counting them here would keep the
/// ring pinned at red even though the model only sees the small compression
/// block summary. Excluding them makes the meter reflect what the model
/// actually receives, so the ring drops to the true post-compression size.
pub(crate) fn estimate_messages_tokens(messages: &[Value]) -> usize {
    messages
        .iter()
        .filter(|m| !crate::context_builder::excludes_provider_context(m))
        .map(estimate_message_tokens)
        .sum()
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
        assert!(
            delta < 50,
            "inline image data should be stripped, delta={delta}"
        );
    }

    #[test]
    fn excluded_messages_are_not_counted() {
        // After a non-loss compression, archived messages are marked
        // excludeFromProviderContext but kept in storage for scroll-back
        // display. The UI token meter must skip them — otherwise the ring
        // stays red even though the model only sees the small summary block.
        let live = json!({ "role": "assistant", "text": "hello world" });
        let archived = json!({
            "role": "assistant",
            "text": "this is a very long archived message that should not be counted",
            "metadata": { "excludeFromProviderContext": true }
        });
        let only_live = estimate_messages_tokens(&[live.clone()]);
        let both = estimate_messages_tokens(&[live.clone(), archived]);

        assert_eq!(
            only_live, both,
            "excluded messages must not contribute to the token estimate"
        );
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
