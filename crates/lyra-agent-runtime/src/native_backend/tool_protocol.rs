use std::collections::HashMap;

use serde_json::Value;

use crate::AgentRuntimeError;

pub(crate) const TEXTUAL_TOOL_CALL_MARKER: &str = "[Tool call:";
pub(crate) const TEXTUAL_TOOL_RESULT_REF_MARKER: &str = "[Tool result ref:";
pub(crate) const TOOL_OUTPUT_TRUNCATED_MARKER: &str = "[Tool output truncated";
pub(crate) const TOOL_OUTPUT_OMITTED_SUMMARY: &str =
    "[Earlier tool output omitted from provider context; full result remains in session evidence.]";
pub(crate) const TOOL_OUTPUT_CLEARED_SUMMARY: &str = "[Old tool result content cleared]";

const MAX_MISSING_TOOL_RETRY: u8 = 2;
const MAX_PROTOCOL_LEAK_RETRY: u8 = 2;

pub(crate) fn max_missing_tool_retry() -> u8 {
    MAX_MISSING_TOOL_RETRY
}

pub(crate) fn max_protocol_leak_retry() -> u8 {
    MAX_PROTOCOL_LEAK_RETRY
}

pub(crate) fn strip_internal_protocol_markers(text: &str) -> String {
    let mut output = strip_incomplete_trailing_internal_marker(text);
    for marker in internal_protocol_markers() {
        while let Some(start) = find_ascii_case_insensitive(&output, marker, 0) {
            let end = output[start..]
                .find(']')
                .map(|offset| start + offset + 1)
                .unwrap_or(output.len());
            output.replace_range(start..end, "");
        }
    }
    collapse_visible_whitespace(&output)
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

pub(crate) fn contains_leaked_internal_protocol_markers(text: &str) -> bool {
    internal_protocol_markers()
        .iter()
        .any(|marker| find_ascii_case_insensitive(text, marker, 0).is_some())
}

pub(crate) fn is_textual_protocol_leak_error(error: &AgentRuntimeError) -> bool {
    let message = error.to_string();
    message.contains("textual tool protocol leak")
        || message.contains("textual tool-call syntax")
}

pub(crate) fn is_missing_tool_call_reply_error(error: &AgentRuntimeError) -> bool {
    error
        .to_string()
        .contains("assistant promised tool use without structured tool_call")
}

pub(crate) fn protocol_leak_corrective_prompt() -> &'static str {
    "The previous assistant draft leaked Lyra internal tool placeholders or textual tool syntax into visible prose. Do not echo [Tool result ref:], [Tool call:], or similar internal markers. Emit a structured tool_call when a capability is required, otherwise answer with normal assistant text only."
}

pub(crate) fn no_tools_used_corrective_prompt(tools_available: bool) -> &'static str {
    if tools_available {
        "The previous assistant response described an upcoming tool action but did not emit a structured tool_call. Retry now: emit the required structured tool_call immediately, or answer directly if no tool is needed. Do not mention internal placeholders or pretend a tool already ran."
    } else {
        "The previous assistant response was incomplete. Continue the same user request with a direct answer. Do not reference internal tool placeholders."
    }
}

pub(crate) fn should_retry_missing_tool_call(
    content: Option<&str>,
    tools: &[Value],
    tool_calls_empty: bool,
) -> bool {
    if !tool_calls_empty || tools.is_empty() {
        return false;
    }
    let Some(content) = content.filter(|text| !text.trim().is_empty()) else {
        return false;
    };
    if contains_leaked_internal_protocol_markers(content) {
        return true;
    }
    looks_like_tool_action_preamble(content)
}

pub(crate) fn looks_like_tool_action_preamble(content: &str) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 240 {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    const NEEDLES: &[&str] = &[
        "让我搜索",
        "让我查",
        "让我找",
        "我去搜",
        "我去查",
        "我来搜",
        "我来查",
        "先搜索",
        "先查",
        "search for",
        "searching for",
        "let me search",
        "let me look",
        "let me fetch",
        "let me check",
        "i'll search",
        "i will search",
        "i'll look",
        "i will look",
        "i'll fetch",
        "going to search",
        "use web_search",
        "use tool_fs",
        "call web_",
        "tool_call",
    ];
    NEEDLES.iter().any(|needle| lower.contains(needle))
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
    let trimmed = content.chars().take(max_chars).collect::<String>();
    format!("{trimmed}\n\n{TOOL_OUTPUT_TRUNCATED_MARKER}; full output retained in session evidence.]")
}

pub(crate) fn tool_outputs_by_id_from_session_tools(tools: &[Value]) -> HashMap<String, String> {
    let mut outputs = HashMap::new();
    for tool in tools {
        let Some(tool_id) = tool.get("id").and_then(Value::as_str) else {
            continue;
        };
        let status = tool.get("status").and_then(Value::as_str).unwrap_or_default();
        let summary = if status == "completed" {
            tool.get("output")
                .map(|output| tool_activity_output_summary(output, 4_000))
                .unwrap_or_else(|| "[Tool completed. Output unavailable.]".to_string())
        } else if status == "failed" {
            tool.get("output")
                .and_then(|output| output.get("content"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| "[Tool failed.]".to_string())
        } else {
            "[Tool did not finish; omitting output from provider context.]".to_string()
        };
        outputs.insert(tool_id.to_string(), summary);
    }
    outputs
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

fn collapse_visible_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub(crate) fn find_ascii_case_insensitive(haystack: &str, needle: &str, from: usize) -> Option<usize> {
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
    fn detects_missing_tool_call_preamble() {
        assert!(looks_like_tool_action_preamble(
            "让我搜索一下黑盒安全测试相关的开源项目。"
        ));
        assert!(!looks_like_tool_action_preamble(
            "这是 Shannon 的完整介绍，包含部署方式、限制和适用场景。"
        ));
    }

    #[test]
    fn should_retry_when_placeholder_leaks_without_tool_calls() {
        assert!(should_retry_missing_tool_call(
            Some("让我搜索一下。 [Tool result ref: call_abc]"),
            &[json!({"type": "function"})],
            true,
        ));
    }
}