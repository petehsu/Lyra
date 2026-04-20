use crate::provider::types::{AgentInferenceMessage, AgentInferenceMessageRole};
use serde::{Deserialize, Serialize};

/// Minimum fraction of messages to retain when snipping.
/// 0.85 means we keep at least 85% of messages — very conservative.
const MIN_RETAIN_FRACTION: f64 = 0.85;

/// Maximum number of messages to remove in a single snip pass.
/// Keeps snipping gradual to avoid losing important context.
const MAX_SNIP_COUNT: usize = 3;

/// Minimum number of recent messages to always preserve, regardless of pressure.
/// Ensures the model always has the latest conversation context.
const MIN_RECENT_MESSAGES: usize = 10;

/// The marker inserted where messages were removed.
const SNIP_MARKER: &str =
    "<snipped>{count} older tool results omitted to conserve context capacity</snipped>";

/// State tracking snip history for the current session.
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct SnipState {
    /// Total messages snipped across all passes.
    pub total_snipped: usize,
    /// Number of snip passes performed.
    pub snip_passes: u32,
}

/// Try to snip older tool-result messages when context pressure is moderate.
///
/// This is a zero-LLM-cost operation: it simply removes the oldest eligible
/// messages from the middle of the conversation history, preserving:
/// - System instructions at the front of the context
/// - The most recent `MIN_RECENT_MESSAGES` messages
/// - All User and Assistant messages (only Tool messages are eligible)
///
/// Returns `true` if any messages were snipped.
pub fn try_snip(
    messages: &mut Vec<AgentInferenceMessage>,
    state: &mut SnipState,
    estimated_tokens: usize,
    context_window: usize,
) -> bool {
    // Trigger threshold: 70% of context window (earlier than auto-compact)
    let trigger_threshold = (context_window as f64 * 0.70) as usize;
    if estimated_tokens < trigger_threshold {
        return false;
    }

    // Calculate how many messages we can afford to snip
    let total = messages.len();
    let min_retain = (total as f64 * MIN_RETAIN_FRACTION).ceil() as usize;
    let max_removable = total.saturating_sub(min_retain);
    if max_removable == 0 {
        return false;
    }

    // Find eligible messages: Tool-role messages in the middle range
    // Skip the first few messages (system context) and the last MIN_RECENT_MESSAGES
    let protected_front = find_protected_front_count(messages);
    let protected_back = MIN_RECENT_MESSAGES.min(total.saturating_sub(protected_front));

    let snip_start = protected_front;
    let snip_end = total.saturating_sub(protected_back);

    if snip_start >= snip_end {
        return false;
    }

    // Collect indices of Tool-role messages in the snippable range
    let eligible_indices: Vec<usize> = (snip_start..snip_end)
        .filter(|&i| matches!(messages[i].role, AgentInferenceMessageRole::Tool))
        .collect();

    if eligible_indices.is_empty() {
        return false;
    }

    // Take the oldest eligible messages (lowest indices first)
    let to_snip = MAX_SNIP_COUNT
        .min(eligible_indices.len())
        .min(max_removable);
    let indices_to_remove: Vec<usize> = eligible_indices.into_iter().take(to_snip).collect();

    // Remove in reverse order to maintain index validity
    for &idx in indices_to_remove.iter().rev() {
        messages.remove(idx);
    }

    // Insert snip marker at the first removed position
    if let Some(&first_removed) = indices_to_remove.first() {
        let marker = SNIP_MARKER.replace("{count}", &to_snip.to_string());
        messages.insert(
            first_removed.min(messages.len()),
            AgentInferenceMessage {
                role: AgentInferenceMessageRole::User,
                content: marker,
                tool_call_id: None,
                tool_calls: Vec::new(),
            },
        );
    }

    state.total_snipped += to_snip;
    state.snip_passes += 1;
    true
}

/// Count how many messages at the front should be protected.
/// Protects initial System messages and the first User message.
fn find_protected_front_count(messages: &[AgentInferenceMessage]) -> usize {
    if messages.is_empty() {
        return 0;
    }
    let mut protected = 1;

    // Also protect initial System messages and the first User message if it's
    // not the first message.
    for (i, msg) in messages.iter().enumerate().skip(1) {
        if matches!(msg.role, AgentInferenceMessageRole::System) {
            protected = i + 1;
            continue;
        }
        if matches!(msg.role, AgentInferenceMessageRole::User) {
            protected = i + 1;
            break;
        }
        if i < 3 {
            // Protect first 3 messages regardless
            protected = i + 1;
        }
    }

    protected.min(5) // Cap at 5 protected front messages
}
