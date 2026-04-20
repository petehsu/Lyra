use crate::provider::types::{AgentInferenceMessage, AgentInferenceMessageRole};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

/// Tool names whose results are candidates for micro-compaction.
/// These tools tend to produce large, verbose output that ages poorly.
const MICRO_COMPACT_TOOLS: &[&str] = &["filesystem.list", "filesystem.glob", "filesystem.search"];

/// Minutes after which a tool result is considered "stale" for compaction.
const DEFAULT_AGE_MINUTES: u64 = 5;

/// Number of recent rounds whose tool results are never compacted.
const RECENT_ROUNDS_IMMUNE: u32 = 3;

/// Lines to keep at the beginning of a compacted result.
const KEEP_HEAD_LINES: usize = 20;

/// Lines to keep at the end of a compacted result.
const KEEP_TAIL_LINES: usize = 5;

/// Tracks when each tool result was created and which round it belongs to.
#[derive(Default)]
pub struct MicroCompactTracker {
    /// tool_call_id → (creation_timestamp_seconds, round_number)
    creation_times: HashMap<String, (u64, u32)>,
}

impl MicroCompactTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that a tool result was created in the current round.
    pub fn record_creation(&mut self, tool_call_id: &str, tool_name: &str, round: u32) {
        if MICRO_COMPACT_TOOLS.contains(&tool_name) {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            self.creation_times
                .insert(tool_call_id.to_string(), (now, round));
        }
    }

    /// Try to micro-compact stale tool results in the message list.
    /// Returns the number of messages compacted.
    pub fn try_compact(
        &mut self,
        messages: &mut Vec<AgentInferenceMessage>,
        current_round: u32,
    ) -> usize {
        let age_minutes = std::env::var("LYRA_MICRO_COMPACT_AGE_MINUTES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_AGE_MINUTES);

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut compacted = 0;

        for msg in messages.iter_mut() {
            // Only process Tool-role messages
            if !matches!(msg.role, AgentInferenceMessageRole::Tool) {
                continue;
            }

            let Some(tool_call_id) = &msg.tool_call_id else {
                continue;
            };

            // Check if this tool result has a recorded creation time
            let Some(&(created_at, round)) = self.creation_times.get(tool_call_id) else {
                continue;
            };

            // Immune: recent rounds
            if current_round.saturating_sub(round) < RECENT_ROUNDS_IMMUNE {
                continue;
            }

            // Check age
            let age_secs = now.saturating_sub(created_at);
            if age_secs < age_minutes * 60 {
                continue;
            }

            // Perform compaction
            let original = &msg.content;
            let compacted_content = compact_large_text(original);
            if compacted_content.len() < original.len() {
                msg.content = compacted_content;
                compacted += 1;
            }
        }

        compacted
    }

    /// Export tracked creation timestamps for checkpoint persistence.
    pub fn to_map(&self) -> HashMap<String, (u64, u32)> {
        self.creation_times.clone()
    }

    /// Restore tracked creation timestamps from checkpoint.
    pub fn from_map(map: HashMap<String, (u64, u32)>) -> Self {
        Self {
            creation_times: map,
        }
    }
}

/// Compact a large text by keeping head + tail lines.
fn compact_large_text(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let total_lines = lines.len();

    // Don't compact if the text is already small
    if total_lines <= KEEP_HEAD_LINES + KEEP_TAIL_LINES + 2 {
        return text.to_string();
    }

    let head: Vec<&str> = lines.iter().take(KEEP_HEAD_LINES).copied().collect();
    let tail: Vec<&str> = lines
        .iter()
        .skip(total_lines - KEEP_TAIL_LINES)
        .copied()
        .collect();
    let omitted = total_lines - KEEP_HEAD_LINES - KEEP_TAIL_LINES;

    let mut result = head.join("\n");
    result.push_str(&format!(
        "\n\n[... {omitted} lines omitted (micro-compacted) ...]\n\n"
    ));
    result.push_str(&tail.join("\n"));
    result
}

/// Estimate token savings from compacting a tool result.
pub fn estimate_compact_savings(original: &str) -> usize {
    let lines: Vec<&str> = original.lines().collect();
    let total = lines.len();
    if total <= KEEP_HEAD_LINES + KEEP_TAIL_LINES + 2 {
        return 0;
    }
    let omitted = total - KEEP_HEAD_LINES - KEEP_TAIL_LINES;
    let avg_line_chars = original.len() / total;
    (omitted * avg_line_chars) / 4
}
