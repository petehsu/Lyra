use serde_json::Value;

/// OpenAI-style high-detail ballpark for one raster image. Used so provider
/// `image_url` data URLs are not BPE-tokenized as text (a 2.8MB JPEG was
/// counted as ~5.1M tokens and blocked the turn for minutes).
const VISION_TOKENS_PER_IMAGE: usize = 1_600;

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
    let image_count = vision_image_count(message);
    let text_tokens = estimate_tokens(&conversation_visible_text(message));
    text_tokens.saturating_add(image_count.saturating_mul(VISION_TOKENS_PER_IMAGE))
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
        let delta =
            estimate_message_tokens(&with_image).abs_diff(estimate_message_tokens(&without_image));
        assert!(
            (1_500..1_800).contains(&delta),
            "image bytes must be stripped and replaced with a vision stub, delta={delta}"
        );
    }

    #[test]
    fn provider_image_url_data_is_not_bpe_tokenized() {
        let data = format!("data:image/jpeg;base64,{}", "A".repeat(400_000));
        let message = json!({
            "role": "user",
            "content": [
                { "type": "image_url", "image_url": { "url": data } },
                { "type": "text", "text": "这是什么" }
            ]
        });
        let started = std::time::Instant::now();
        let tokens = estimate_message_tokens(&message);
        assert!(
            started.elapsed().as_millis() < 500,
            "tiktoken must not run on image payload bytes"
        );
        assert!(
            (1_600..3_000).contains(&tokens),
            "vision stub should dominate, got {tokens}"
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

    #[test]
    fn short_user_question_is_not_inflated_by_frozen_runtime_metadata() {
        let question = "zcode是不是开源了";
        let clean = json!({ "role": "user", "text": question });
        let bloated = json!({
            "role": "user",
            "text": question,
            "metadata": {
                "providerContext": {
                    "version": 1,
                    "renderedTail": "x".repeat(80_000)
                }
            }
        });
        let clean_tokens = estimate_message_tokens(&clean);
        let bloated_tokens = estimate_message_tokens(&bloated);
        assert_eq!(
            clean_tokens, bloated_tokens,
            "persisted runtime tails must not count as the user's words"
        );
        assert!(
            clean_tokens < 40,
            "a short question should stay near its own size, got {clean_tokens}"
        );
    }
}

fn conversation_visible_text(message: &Value) -> String {
    let mut chunks = Vec::new();
    if let Some(role) = message.get("role").and_then(Value::as_str) {
        chunks.push(role.to_string());
    }
    if let Some(name) = message.get("name").and_then(Value::as_str) {
        chunks.push(name.to_string());
    }
    if let Some(tool_call_id) = message
        .get("tool_call_id")
        .or_else(|| message.get("toolCallId"))
        .and_then(Value::as_str)
    {
        chunks.push(tool_call_id.to_string());
    }
    if let Some(content) = message.get("content") {
        chunks.push(visible_content_text(content));
    } else if let Some(text) = message.get("text").and_then(Value::as_str) {
        chunks.push(text.to_string());
    }
    if let Some(blocks) = message.get("blocks").and_then(Value::as_array) {
        for block in blocks {
            if let Some(text) = block.get("text").and_then(Value::as_str) {
                chunks.push(text.to_string());
            }
        }
    }
    chunks.join("\n")
}

fn visible_content_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(visible_part_text)
            .collect::<Vec<_>>()
            .join("\n"),
        other => other.as_str().unwrap_or_default().to_string(),
    }
}

fn visible_part_text(part: &Value) -> Option<String> {
    if content_part_is_image(part) {
        return None;
    }
    part.get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            part.get("content")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

fn vision_image_count(message: &Value) -> usize {
    let content_images = count_provider_content_images(message.get("content"));
    if content_images > 0 {
        return content_images;
    }
    let block_images = message
        .get("blocks")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("image"))
                .count()
        })
        .unwrap_or(0);
    if block_images > 0 {
        return block_images;
    }
    message
        .pointer("/metadata/inlineImages")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0)
}

fn count_provider_content_images(content: Option<&Value>) -> usize {
    match content {
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|part| content_part_is_image(part))
            .count(),
        Some(part) if content_part_is_image(part) => 1,
        _ => 0,
    }
}

fn content_part_is_image(part: &Value) -> bool {
    match part.get("type").and_then(Value::as_str) {
        Some("image_url" | "image" | "input_image") => true,
        _ => part.get("image_url").is_some(),
    }
}
