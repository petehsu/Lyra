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
    message.contains("textual tool protocol leak") || message.contains("textual tool-call syntax")
}

pub(crate) fn is_missing_tool_call_reply_error(error: &AgentRuntimeError) -> bool {
    error
        .to_string()
        .contains("assistant promised tool use without structured tool_call")
}

pub(crate) fn is_tool_payload_leak_error(error: &AgentRuntimeError) -> bool {
    error
        .to_string()
        .contains("tool payload envelope in visible assistant text")
}

pub(crate) fn is_browser_anchor_without_tools_error(error: &AgentRuntimeError) -> bool {
    error.to_string().contains(
        "assistant completed a browser-anchored request without structured browser tool_call",
    )
}

pub(crate) fn protocol_leak_corrective_prompt() -> &'static str {
    "The previous assistant draft leaked Lyra internal tool placeholders or textual tool syntax into visible prose. Do not echo [Tool result ref:], [Tool call:], or similar internal markers. Emit a structured tool_call when a capability is required, otherwise answer with normal assistant text only."
}

pub(crate) const BROWSER_BLOCKED_CORRECTIVE_PROMPT: &str =
    "Browser automation is paused because the page has an active upload dialog, permission prompt, or OS file picker. Do not call more browser tools until the user closes it. Tell the user to close the dialog and retry.";

pub(crate) const TOOL_OUTPUT_ECHO_CORRECTIVE_PROMPT: &str =
    "The previous assistant draft pasted raw browser tool output into visible chat text. Do not echo map/see/read tool payloads. Summarize the outcome in a few sentences, or emit a structured tool_call if more browser evidence is required.";

pub(crate) const ACTION_TASK_WITHOUT_TOOLS_CORRECTIVE_PROMPT: &str =
    "The user anchored this request to a Workbench browser page via <lyra-page-cite> metadata, but no browser tool ran this turn. Emit the required structured browser tool_call now instead of claiming the page action is done.";

pub(crate) const TURN_FAILURE_BROWSER_BLOCKED: &str = "lyra_turn_failure:browser_blocked";
pub(crate) const TURN_FAILURE_EMPTY_RESPONSE: &str = "lyra_turn_failure:empty_response";
pub(crate) const TURN_FAILURE_TIMEOUT: &str = "lyra_turn_failure:timeout";
pub(crate) const TURN_FAILURE_CONTEXT_LENGTH: &str = "lyra_turn_failure:context_length";
pub(crate) const TURN_FAILURE_PROVIDER_AUTH: &str = "lyra_turn_failure:provider_auth";
pub(crate) const TURN_FAILURE_CANCELLED: &str = "lyra_turn_failure:cancelled";
pub(crate) const TURN_FAILURE_GENERIC: &str = "lyra_turn_failure:generic";

pub(crate) fn classify_turn_failure(message: &str) -> String {
    if message.starts_with("lyra_turn_failure:") {
        return message.to_string();
    }
    if super::activity::is_empty_model_reply_error(&AgentRuntimeError::Core(message.to_string())) {
        return TURN_FAILURE_EMPTY_RESPONSE.to_string();
    }
    if super::activity::is_context_length_error(message) {
        return TURN_FAILURE_CONTEXT_LENGTH.to_string();
    }
    let lower = message.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        return TURN_FAILURE_TIMEOUT.to_string();
    }
    if lower.contains("cancelled") || lower.contains("canceled") {
        return TURN_FAILURE_CANCELLED.to_string();
    }
    if lower.contains("unauthorized")
        || lower.contains("api key")
        || lower.contains("authentication")
        || lower.contains(" 401")
        || lower.contains(" 403")
    {
        return TURN_FAILURE_PROVIDER_AUTH.to_string();
    }
    TURN_FAILURE_GENERIC.to_string()
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
    contains_leaked_internal_protocol_markers(content)
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
    format!(
        "{trimmed}\n\n{TOOL_OUTPUT_TRUNCATED_MARKER}; full output retained in session evidence.]"
    )
}

pub(crate) fn is_browser_tool_name(name: &str) -> bool {
    matches!(
        name,
        "lyra_lumen" | "lyra_ax" | "browser" | "browser_interact" | "lyra_computer" | "computer"
    )
}

pub(crate) fn is_browser_tool_blocked_output(output: &Value) -> bool {
    if output.get("browserBlocked").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    if output.pointer("/raw/browserBlocked").and_then(Value::as_bool) == Some(true) {
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

pub(crate) fn latest_user_message<'a>(messages: &'a [Value]) -> Option<&'a Value> {
    messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
}

pub(crate) fn user_message_has_browser_page_anchor(message: &Value) -> bool {
    message
        .pointer("/metadata/pageCitations")
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty())
        || message
            .get("content")
            .and_then(Value::as_str)
            .is_some_and(|content| content.contains("<lyra-page-cite"))
}

pub(crate) fn tools_include_browser_capabilities(tools: &[Value]) -> bool {
    tools.iter().any(|tool| {
        tool.pointer("/function/name")
            .and_then(Value::as_str)
            .is_some_and(is_browser_tool_name)
    })
}

pub(crate) fn should_reject_browser_anchor_without_browser_tools(
    messages: &[Value],
    tools: &[Value],
    browser_tools_used_this_turn: usize,
    tool_calls_empty: bool,
) -> bool {
    if !tool_calls_empty || browser_tools_used_this_turn > 0 {
        return false;
    }
    if !tools_include_browser_capabilities(tools) {
        return false;
    }
    latest_user_message(messages).is_some_and(user_message_has_browser_page_anchor)
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

pub(crate) fn validate_visible_assistant_text_protocol(text: &str) -> Result<(), AgentRuntimeError> {
    if contains_leaked_tool_payload_in_assistant_text(text) {
        return Err(AgentRuntimeError::Core(
            "provider emitted tool payload envelope in visible assistant text instead of a structured Lyra tool_call"
                .to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn tool_outputs_by_id_from_session_tools(tools: &[Value]) -> HashMap<String, String> {
    let mut outputs = HashMap::new();
    for tool in tools {
        let Some(tool_id) = tool.get("id").and_then(Value::as_str) else {
            continue;
        };
        let status = tool
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or_default();
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
    // Collapse runs of spaces/tabs *within* each line, but preserve newlines so
    // markdown block structure (headings, lists, code fences, paragraphs)
    // survives. Using a plain `split_whitespace().join(" ")` here would flatten
    // every newline into a single space, turning multi-block assistant markdown
    // into one undifferentiated paragraph.
    text.split('\n')
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join("\n")
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
    fn preserves_markdown_newlines_while_collapsing_inline_whitespace() {
        let markdown = "# 标题\n\n这是一段   带多余空格的文本。\n\n## 列表\n\n- 项 1\n- 项 2";
        assert_eq!(
            sanitize_visible_assistant_text(markdown).as_deref(),
            Some("# 标题\n\n这是一段 带多余空格的文本。\n\n## 列表\n\n- 项 1\n- 项 2")
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
    fn should_retry_when_placeholder_leaks_without_tool_calls() {
        assert!(should_retry_missing_tool_call(
            Some("Follow-up context. [Tool result ref: call_abc]"),
            &[json!({"type": "function"})],
            true,
        ));
        assert!(!should_retry_missing_tool_call(
            Some("让我搜索一下黑盒安全测试相关的开源项目。"),
            &[json!({"type": "function"})],
            true,
        ));
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
    fn rejects_browser_anchor_without_tools_when_page_cite_present() {
        let messages = vec![json!({
            "role": "user",
            "content": "Please comment on this element.",
            "metadata": {
                "pageCitations": [{
                    "id": "page-cite-1",
                    "tabId": "browser-tab-1",
                    "pageUrl": "https://example.test/post"
                }]
            }
        })];
        let tools = vec![json!({
            "type": "function",
            "function": { "name": "lyra_lumen" }
        })];
        assert!(should_reject_browser_anchor_without_browser_tools(
            &messages,
            &tools,
            0,
            true,
        ));
    }

    #[test]
    fn classify_turn_failure_maps_runtime_errors_to_structured_codes() {
        assert_eq!(
            classify_turn_failure("provider returned no assistant text or tool call"),
            TURN_FAILURE_EMPTY_RESPONSE
        );
        assert_eq!(
            classify_turn_failure("context length exceeds maximum window"),
            TURN_FAILURE_CONTEXT_LENGTH
        );
        assert_eq!(
            classify_turn_failure(TURN_FAILURE_BROWSER_BLOCKED),
            TURN_FAILURE_BROWSER_BLOCKED
        );
        assert_eq!(
            classify_turn_failure("provider request timed out"),
            TURN_FAILURE_TIMEOUT
        );
    }

    #[test]
    fn does_not_reject_plain_text_without_browser_anchor() {
        let messages = vec![json!({
            "role": "user",
            "content": "请在说说下评论自我评价"
        })];
        let tools = vec![json!({
            "type": "function",
            "function": { "name": "lyra_lumen" }
        })];
        assert!(!should_reject_browser_anchor_without_browser_tools(
            &messages,
            &tools,
            0,
            true,
        ));
    }
}
