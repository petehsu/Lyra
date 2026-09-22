use serde_json::Value;

use crate::{AgentRuntimeError, ProviderProtocolFailureKind};

pub(crate) const TEXTUAL_TOOL_CALL_MARKER: &str = "[Tool call:";
pub(crate) const TEXTUAL_TOOL_RESULT_REF_MARKER: &str = "[Tool result ref:";
pub(crate) const TOOL_OUTPUT_TRUNCATED_MARKER: &str = "[Tool output truncated";
pub(crate) const TOOL_OUTPUT_OMITTED_SUMMARY: &str =
    "[Earlier tool output omitted from provider context; full result remains in session evidence.]";
pub(crate) const TOOL_OUTPUT_CLEARED_SUMMARY: &str = "[Old tool result content cleared]";

pub(crate) fn clip_chars_head_tail(text: &str, max_chars: usize, footer: &str) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= max_chars {
        return text.to_string();
    }
    let head = ((max_chars as f64) * 0.75) as usize;
    let head = head.max(1).min(max_chars);
    let tail = max_chars.saturating_sub(head);
    let head_text: String = chars[..head].iter().collect();
    if tail == 0 {
        return format!("{head_text}\n\n{footer}");
    }
    let tail_start = chars.len().saturating_sub(tail);
    let tail_text: String = chars[tail_start..].iter().collect();
    format!("{head_text}\n\n{footer}\n\n{tail_text}")
}

const MAX_MISSING_TOOL_RETRY: u8 = 2;
const MAX_PROTOCOL_LEAK_RETRY: u8 = 2;

pub(crate) fn max_missing_tool_retry() -> u8 {
    MAX_MISSING_TOOL_RETRY
}

pub(crate) fn max_protocol_leak_retry() -> u8 {
    MAX_PROTOCOL_LEAK_RETRY
}

pub(crate) fn strip_internal_protocol_markers(text: &str) -> String {
    strip_internal_protocol_markers_preserve_whitespace(text)
}

fn strip_internal_protocol_markers_preserve_whitespace(text: &str) -> String {
    let mut output = strip_incomplete_trailing_internal_marker(text);
    for marker in internal_protocol_markers() {
        while let Some(start) = find_ascii_case_insensitive(&output, marker, 0) {
            let end = output[start..]
                .find(']')
                .map(|offset| start + offset + 1)
                .unwrap_or(output.len());
            let replace_start = output[..start]
                .chars()
                .next_back()
                .filter(|ch| matches!(ch, ' ' | '\t'))
                .map(|ch| start - ch.len_utf8())
                .unwrap_or(start);
            output.replace_range(replace_start..end, "");
        }
    }
    output
}

fn strip_incomplete_trailing_internal_marker(text: &str) -> String {
    let Some(start) = text.rfind('[') else {
        return text.to_string();
    };
    let tail = &text[start..];
    if tail.contains(']') {
        return text.to_string();
    }
    let tail_lower = tail.to_ascii_lowercase();
    let looks_internal = internal_protocol_markers()
        .iter()
        .any(|marker| marker.to_ascii_lowercase().starts_with(&tail_lower))
        || tail_lower.starts_with("[tool");
    if looks_internal {
        text[..start].to_string()
    } else {
        text.to_string()
    }
}

pub(crate) fn sanitize_visible_assistant_text(text: &str) -> Option<String> {
    let sanitized = strip_internal_protocol_markers(text);
    let trimmed = sanitized.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

pub(crate) fn sanitize_truncated_assistant_text(text: &str) -> Option<String> {
    let sanitized = strip_internal_protocol_markers_preserve_whitespace(text);
    (!sanitized.trim().is_empty()).then_some(sanitized)
}

pub(crate) fn contains_leaked_internal_protocol_markers(text: &str) -> bool {
    internal_protocol_markers()
        .iter()
        .any(|marker| find_ascii_case_insensitive(text, marker, 0).is_some())
}

pub(crate) fn is_textual_protocol_leak_error(error: &AgentRuntimeError) -> bool {
    matches!(
        error,
        AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::TextualToolProtocolLeak,
            ..
        }
    )
}

pub(crate) fn is_missing_tool_call_reply_error(error: &AgentRuntimeError) -> bool {
    matches!(
        error,
        AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::IncompleteToolCall,
            ..
        }
    )
}

pub(crate) fn is_tool_payload_leak_error(error: &AgentRuntimeError) -> bool {
    matches!(
        error,
        AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::ToolPayloadLeak,
            ..
        }
    )
}

pub(crate) fn protocol_leak_corrective_prompt() -> &'static str {
    "The previous assistant draft leaked Lyra internal tool placeholders or textual tool syntax into visible prose. Do not echo [Tool result ref:], [Tool call:], or similar internal markers. Emit a structured tool_call when a capability is required, otherwise answer with normal assistant text only."
}

pub(crate) const BROWSER_BLOCKED_CORRECTIVE_PROMPT: &str = "Browser tools are paused because an OS dialog is in front of the page. Do not keep calling browser tools against that page. Complete or dismiss the dialog through computer capabilities, then continue.";

pub(crate) const TOOL_OUTPUT_ECHO_CORRECTIVE_PROMPT: &str = "The previous assistant draft pasted raw browser tool output into visible chat text. Do not echo map/see/read tool payloads. Summarize the outcome in a few sentences, or emit a structured tool_call if more browser evidence is required.";

pub(crate) const TURN_FAILURE_BROWSER_BLOCKED: &str = "lyra_turn_failure:browser_blocked";

pub(crate) fn no_tools_used_corrective_prompt(tools_available: bool) -> &'static str {
    if tools_available {
        "The previous assistant response described an upcoming tool action but did not emit a structured tool_call. Retry now: emit the required structured tool_call immediately. Do not put planning, chain-of-thought, or JSON tool arguments in assistant content. If a tool is required, the only valid output is a structured tool_call. Do not mention internal placeholders or pretend a tool already ran."
    } else {
        "The previous assistant response was incomplete. Continue the same user request with a direct answer. Do not reference internal tool placeholders."
    }
}

pub(crate) fn tool_activity_output_summary(output: &Value, max_chars: usize) -> String {
    let content = output
        .get("content")
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            output
                .pointer("/raw/summary")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| {
            serde_json::to_string_pretty(output)
                .ok()
                .filter(|text| !text.trim().is_empty())
        })
        .unwrap_or_else(|| "[Tool completed with no textual output.]".to_string());
    if max_chars == 0 || content.chars().count() <= max_chars {
        return content;
    }
    clip_chars_head_tail(
        &content,
        max_chars,
        &format!("{TOOL_OUTPUT_TRUNCATED_MARKER}; full output retained in session evidence.]"),
    )
}

pub(crate) fn is_browser_tool_name(name: &str) -> bool {
    matches!(
        name,
        "lyra_lumen" | "lyra_ax" | "browser" | "lyra_computer" | "computer"
    )
}

pub(crate) fn is_browser_tool_blocked_output(output: &Value) -> bool {
    if output.get("browserBlocked").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    if output
        .pointer("/raw/browserBlocked")
        .and_then(Value::as_bool)
        == Some(true)
    {
        return true;
    }
    if output.pointer("/raw/status").and_then(Value::as_str) == Some("blocked") {
        return true;
    }
    output
        .pointer("/raw/blockedRegions")
        .and_then(Value::as_array)
        .is_some_and(|regions| {
            regions.iter().any(|region| {
                region.get("kind").and_then(Value::as_str) == Some("permission-prompt")
            })
        })
}

fn value_is_host_tool_result_envelope(value: &Value) -> bool {
    let kind = value.get("kind").and_then(Value::as_str).unwrap_or("");
    if kind.starts_with("lyraLumen") || kind.starts_with("lyraAx") {
        return true;
    }
    value.get("semanticTree").is_some()
        || value.get("blockedRegions").is_some()
        || value.get("observationId").is_some()
        || value.get("browserBlocked").is_some()
}

fn tool_payload_envelope_markers() -> &'static [&'static str] {
    &[
        "\"semanticTree\"",
        "\"blockedRegions\"",
        "\"observationId\"",
        "\"mapEpoch\"",
        "\"targetRef\":\"lumen:",
        "\"kind\":\"lyraLumenMap\"",
        "\"kind\": \"lyraLumenMap\"",
        "\"kind\":\"lyraLumenSee\"",
        "\"kind\": \"lyraLumenSee\"",
        "\"kind\":\"lyraLumenActionResult\"",
        "\"kind\": \"lyraLumenActionResult\"",
        "\"browserBlocked\"",
        "\"elements\":[",
    ]
}

pub(crate) fn contains_leaked_tool_payload_in_assistant_text(text: &str) -> bool {
    if contains_leaked_internal_protocol_markers(text) {
        return true;
    }
    if serde_json::from_str::<Value>(text.trim())
        .ok()
        .is_some_and(|value| value_is_host_tool_result_envelope(&value))
    {
        return true;
    }
    if text.trim().chars().count() < 120 {
        return false;
    }
    tool_payload_envelope_markers()
        .iter()
        .any(|marker| find_ascii_case_insensitive(text, marker, 0).is_some())
}

pub(crate) fn validate_visible_assistant_text_protocol(
    text: &str,
) -> Result<(), AgentRuntimeError> {
    if contains_leaked_tool_payload_in_assistant_text(text) {
        return Err(AgentRuntimeError::ProviderProtocol {
            kind: ProviderProtocolFailureKind::ToolPayloadLeak,
            detail: "provider emitted a host-tool result envelope in visible assistant text"
                .to_string(),
        });
    }
    Ok(())
}

pub(crate) fn message_has_provider_transcript(message: &Value) -> bool {
    message
        .pointer("/metadata/providerTranscript")
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty())
}

fn internal_protocol_markers() -> &'static [&'static str] {
    &[
        TEXTUAL_TOOL_CALL_MARKER,
        TEXTUAL_TOOL_RESULT_REF_MARKER,
        "[Image omitted:",
        "[Tool output truncated",
    ]
}

pub(crate) fn find_ascii_case_insensitive(
    haystack: &str,
    needle: &str,
    from: usize,
) -> Option<usize> {
    if from >= haystack.len() {
        return None;
    }
    let haystack_lower = haystack[from..].to_ascii_lowercase();
    let needle_lower = needle.to_ascii_lowercase();
    haystack_lower
        .find(&needle_lower)
        .map(|offset| from + offset)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn strips_tool_result_ref_placeholders_from_visible_text() {
        let text = "让我搜索一下。 [Tool result ref: call_abc]";
        assert_eq!(
            sanitize_visible_assistant_text(text).as_deref(),
            Some("让我搜索一下。")
        );
    }

    #[test]
    fn sanitize_empty_when_only_protocol_marker_remains() {
        assert_eq!(
            sanitize_visible_assistant_text("[Tool result ref: call_abc]"),
            None
        );
    }

    #[test]
    fn sanitize_truncated_assistant_text_preserves_segment_edges() {
        assert_eq!(
            sanitize_truncated_assistant_text(" Hello ").as_deref(),
            Some(" Hello ")
        );
    }

    #[test]
    fn preserves_markdown_whitespace() {
        let markdown =
            "# 标题\n\n这是一段   带多余空格的文本。\n\n```python\n    return value\n```\n";
        assert_eq!(
            sanitize_visible_assistant_text(markdown).as_deref(),
            Some("# 标题\n\n这是一段   带多余空格的文本。\n\n```python\n    return value\n```")
        );
    }

    #[test]
    fn preserves_newlines_after_stripping_internal_marker() {
        let text = "# 标题\n\n正文。 [Tool result ref: call_abc]\n\n## 小节\n\n- 项";
        assert_eq!(
            sanitize_visible_assistant_text(text).as_deref(),
            Some("# 标题\n\n正文。\n\n## 小节\n\n- 项")
        );
    }

    #[test]
    fn detects_browser_blocked_output_from_map_payload() {
        let output = json!({
            "content": "map",
            "raw": {
                "browserBlocked": true,
                "blockedRegions": [{ "kind": "permission-prompt" }]
            }
        });
        assert!(is_browser_tool_blocked_output(&output));
    }

    #[test]
    fn detects_structural_tool_payload_leak_in_assistant_text() {
        let assistant = r#"{"kind":"lyraLumenMap","blockedRegions":[],"elements":[]}"#;
        assert!(contains_leaked_tool_payload_in_assistant_text(assistant));
    }

    #[test]
    fn clip_chars_head_tail_keeps_both_ends() {
        let text = format!("HEAD_MARK{}TAIL_MARK", "middle-padding".repeat(20));
        let clipped = clip_chars_head_tail(&text, 40, "[omitted]");
        assert!(clipped.contains("HEAD_MARK"), "{clipped}");
        assert!(clipped.contains("TAIL_MARK"), "{clipped}");
        assert!(clipped.contains("[omitted]"), "{clipped}");
        assert!(clipped.len() < text.len(), "{clipped}");
    }
}
