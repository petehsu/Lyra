use crate::provider::types::{AgentInferenceMessage, AgentInferenceMessageRole};

/// Maximum characters for a tool result before collapse summarization.
const COLLAPSE_THRESHOLD_CHARS: usize = 5000;

/// Check if context collapse is enabled via env var.
pub fn is_context_collapse_enabled() -> bool {
    std::env::var("LYRA_ENABLE_CONTEXT_COLLAPSE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Apply a collapsed view to messages before sending to the provider.
/// Does NOT modify the original messages — returns a new transformed vector.
///
/// Collapse rules:
/// 1. Consecutive Tool messages of the same tool are merged
/// 2. Oversized tool results (>5000 chars) are replaced with summary markers
/// 3. All System/User/Assistant messages remain intact
pub fn collapse_view(messages: &[AgentInferenceMessage]) -> Vec<AgentInferenceMessage> {
    collapse_view_with_override(messages, None)
}

pub fn collapse_view_with_override(
    messages: &[AgentInferenceMessage],
    enabled_override: Option<bool>,
) -> Vec<AgentInferenceMessage> {
    let enabled = enabled_override.unwrap_or_else(is_context_collapse_enabled);
    if !enabled || messages.is_empty() {
        return messages.to_vec();
    }

    let mut result = Vec::with_capacity(messages.len());
    let mut i = 0;

    while i < messages.len() {
        let msg = &messages[i];

        match msg.role {
            // System, User and Assistant messages are always preserved as-is
            AgentInferenceMessageRole::System
            | AgentInferenceMessageRole::User
            | AgentInferenceMessageRole::Assistant => {
                result.push(msg.clone());
                i += 1;
            }
            AgentInferenceMessageRole::Tool => {
                // Check for consecutive Tool messages from the same tool
                let tool_name = extract_tool_name(msg);
                let mut consecutive = vec![msg];
                let mut j = i + 1;

                while j < messages.len() {
                    if matches!(messages[j].role, AgentInferenceMessageRole::Tool)
                        && extract_tool_name(&messages[j]) == tool_name
                    {
                        consecutive.push(&messages[j]);
                        j += 1;
                    } else {
                        break;
                    }
                }

                if consecutive.len() > 1 {
                    // Merge consecutive same-type tool results
                    result.push(merge_consecutive_tools(&consecutive, &tool_name));
                } else {
                    // Single tool message — check size
                    if msg.content.len() > COLLAPSE_THRESHOLD_CHARS {
                        result.push(collapse_oversized_tool(msg));
                    } else {
                        result.push(msg.clone());
                    }
                }

                i = j;
            }
        }
    }

    result
}

/// Extract the tool name from a Tool message.
/// Tries to parse from content JSON, falls back to tool_call_id prefix.
fn extract_tool_name(msg: &AgentInferenceMessage) -> String {
    // Try parsing content as JSON to find the tool name
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&msg.content) {
        if let Some(name) = json.get("tool_name").and_then(|v| v.as_str()) {
            return name.to_string();
        }
        if let Some(name) = json.get("name").and_then(|v| v.as_str()) {
            return name.to_string();
        }
    }
    // Fallback: use tool_call_id or content length hash
    msg.tool_call_id
        .clone()
        .unwrap_or_else(|| format!("unknown_{}", msg.content.len()))
}

/// Merge multiple consecutive tool results from the same tool into one.
fn merge_consecutive_tools(
    msgs: &[&AgentInferenceMessage],
    tool_name: &str,
) -> AgentInferenceMessage {
    let total_chars: usize = msgs.iter().map(|m| m.content.len()).sum();
    let count = msgs.len();

    if total_chars <= COLLAPSE_THRESHOLD_CHARS {
        // Small enough to keep all, just concatenate
        let combined = msgs
            .iter()
            .enumerate()
            .map(|(i, m)| format!("--- Result {}/{} ---\n{}", i + 1, count, m.content))
            .collect::<Vec<_>>()
            .join("\n\n");

        AgentInferenceMessage {
            role: AgentInferenceMessageRole::Tool,
            content: combined,
            tool_call_id: msgs.first().and_then(|m| m.tool_call_id.clone()),
            tool_calls: Vec::new(),
        }
    } else {
        // Too large — summarize
        let previews: Vec<String> = msgs
            .iter()
            .map(|m| {
                let preview = m.content.chars().take(200).collect::<String>();
                format!("- {} chars: {}...", m.content.len(), preview)
            })
            .collect();
        let joined = previews.join("\n");

        AgentInferenceMessage {
            role: AgentInferenceMessageRole::Tool,
            content: format!(
                "<collapsed>{count} consecutive {tool_name} results ({total_chars} chars total)\n{joined}\n</collapsed>",
            ),
            tool_call_id: msgs.first().and_then(|m| m.tool_call_id.clone()),
            tool_calls: Vec::new(),
        }
    }
}

/// Replace an oversized tool result with a summary marker.
fn collapse_oversized_tool(msg: &AgentInferenceMessage) -> AgentInferenceMessage {
    let preview = msg.content.chars().take(300).collect::<String>();
    let omitted = msg.content.len().saturating_sub(300);

    AgentInferenceMessage {
        role: AgentInferenceMessageRole::Tool,
        content: format!(
            "<collapsed>Tool output: {preview}...\n[{omitted} chars omitted — use a narrower query or read specific ranges]</collapsed>"
        ),
        tool_call_id: msg.tool_call_id.clone(),
        tool_calls: Vec::new(),
    }
}
