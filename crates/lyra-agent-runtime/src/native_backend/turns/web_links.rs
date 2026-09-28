use serde_json::{Value, json};

// Presentation metadata only: keep token boundaries without changing model text.
pub(super) fn apply_web_links(message: &mut Value, text: &str, payload: &Value) {
    let Some(links) = payload.get("webLinks").and_then(Value::as_array) else {
        return;
    };
    let text: Vec<u16> = text.encode_utf16().collect();
    let mut end_of_previous = 0;
    let accepted: Vec<Value> = links
        .iter()
        .take(512)
        .filter_map(|link| {
            let start = usize::try_from(link.get("start")?.as_u64()?).ok()?;
            let end = usize::try_from(link.get("end")?.as_u64()?).ok()?;
            let target = link.get("url")?.as_str()?;
            if start < end_of_previous || start >= end || end > text.len() {
                return None;
            }
            let parsed = url::Url::parse(target).ok()?;
            if !matches!(parsed.scheme(), "http" | "https")
                || target.split_once("://").is_none()
                || target.chars().any(char::is_whitespace)
                || !text[start..end].iter().copied().eq(target.encode_utf16())
            {
                return None;
            }
            end_of_previous = end;
            Some(json!({"start": start, "end": end, "url": target}))
        })
        .collect();
    if !accepted.is_empty() {
        if !message.get("metadata").is_some_and(Value::is_object) {
            message["metadata"] = json!({});
        }
        message["metadata"]["webLinks"] = json!(accepted);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_exact_unicode_link_boundaries_without_rewriting_text() {
        let url = "https://example.com/中文?q=a%2Fb#段落";
        let text = format!("🙂{url}把这个项目克隆下来");
        let mut message = json!({"text": text, "metadata": {"existing": true}});
        let links = json!([{"start": 2, "end": 2 + url.encode_utf16().count(), "url": url}]);
        apply_web_links(&mut message, &text, &json!({"webLinks": links}));
        assert_eq!(message["text"], text);
        assert_eq!(message["metadata"]["existing"], true);
        assert_eq!(message["metadata"]["webLinks"], links);
        let restored: Value = serde_json::from_str(&message.to_string()).unwrap();
        assert_eq!(restored["metadata"]["webLinks"], links);
    }

    #[test]
    fn rejects_forged_unsafe_overlapping_and_out_of_range_links() {
        let url = "https://example.com";
        let mut message = json!({});
        apply_web_links(
            &mut message,
            url,
            &json!({"webLinks": [
                {"start": 0, "end": url.len(), "url": "https://forged.test"},
                {"start": 0, "end": 999, "url": url},
                {"start": -1, "end": url.len(), "url": url},
                {"start": 0, "end": url.len(), "url": url},
                {"start": 0, "end": url.len(), "url": url}
            ]}),
        );
        assert_eq!(message["metadata"]["webLinks"].as_array().unwrap().len(), 1);
        let mut unsafe_message = json!({});
        let unsafe_url = "javascript:alert(1)";
        apply_web_links(
            &mut unsafe_message,
            unsafe_url,
            &json!({"webLinks": [
                {"start": 0, "end": unsafe_url.len(), "url": unsafe_url}
            ]}),
        );
        assert!(unsafe_message.get("metadata").is_none());
    }
}
