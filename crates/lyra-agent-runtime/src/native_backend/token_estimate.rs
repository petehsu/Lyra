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
    let stripped = strip_inline_image_data_for_token_estimate(message.clone());
    let text_tokens = estimate_tokens(&serde_json::to_string(&stripped).unwrap_or_default());
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
        Some(Value::Array(parts)) => parts.iter().filter(|part| content_part_is_image(part)).count(),
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
    strip_provider_content_images(message.get_mut("content"));
    message
}

fn strip_provider_content_images(content: Option<&mut Value>) {
    let Some(content) = content else {
        return;
    };
    match content {
        Value::Array(parts) => {
            for part in parts {
                strip_provider_content_part(part);
            }
        }
        other => strip_provider_content_part(other),
    }
}

fn strip_provider_content_part(part: &mut Value) {
    let Some(map) = part.as_object_mut() else {
        return;
    };
    if let Some(image_url) = map.get_mut("image_url") {
        blank_image_url_node(image_url);
    }
    match map.get("type").and_then(Value::as_str) {
        Some("image" | "input_image" | "image_url") => {
            map.remove("data");
            if let Some(Value::String(image)) = map.get_mut("image")
                && image.starts_with("data:image/")
            {
                image.clear();
                image.push_str("data:image/jpeg;base64,");
            }
        }
        _ => {}
    }
}

fn blank_image_url_node(image_url: &mut Value) {
    match image_url {
        Value::String(url) if url.starts_with("data:image/") => {
            url.clear();
            url.push_str("data:image/jpeg;base64,");
        }
        Value::Object(map) => {
            if let Some(Value::String(url)) = map.get_mut("url")
                && url.starts_with("data:image/")
            {
                url.clear();
                url.push_str("data:image/jpeg;base64,");
            }
        }
        _ => {}
    }
}
