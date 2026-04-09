use serde_json::{json, Value};
use std::collections::HashMap;

/// Maximum characters per tool result before budget enforcement kicks in.
/// Mirrors Claude Code's per-message tool result budget — keeps context
/// from being dominated by a single large grep/glob/read output.
const DEFAULT_PER_RESULT_CHAR_BUDGET: usize = 30_000;

/// When a result exceeds the budget, it is replaced with this stub.
const BUDGET_EXCEEDED_STUB: &str = "[Tool output truncated — exceeded per-result budget of {budget} chars. Use a narrower query or read specific line ranges.]";

/// Tool names exempt from budget enforcement (their results are always needed).
const EXEMPT_TOOL_NAMES: &[&str] = &[];

/// Track which tool results have already been budget-truncated across turns.
/// Once a result is truncated, we keep the same stub to maintain prompt cache stability.
#[derive(Default)]
pub struct ToolResultBudgetState {
    /// Maps tool_call_id → the truncated stub we already emitted.
    /// On subsequent turns, we re-apply the same stub to avoid changing
    /// the cached prefix of the prompt.
    seen_truncations: HashMap<String, String>,
}

impl ToolResultBudgetState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Enforce the per-message tool result budget.
    ///
    /// For each tool result in the message list:
    /// - If the tool_call_id was previously truncated, re-apply the same stub (cache-stable)
    /// - If the result exceeds the budget, truncate it and record the stub
    /// - Exempt tools are never truncated
    ///
    /// Returns the (possibly modified) tool result content.
    pub fn enforce(&mut self, tool_call_id: &str, tool_name: &str, content: &str) -> String {
        // Re-apply previously recorded truncation for cache stability
        if let Some(stub) = self.seen_truncations.get(tool_call_id) {
            return stub.clone();
        }

        // Exempt tools bypass the budget
        if EXEMPT_TOOL_NAMES.contains(&tool_name) {
            return content.to_string();
        }

        let budget = get_per_result_budget();
        if content.len() <= budget {
            return content.to_string();
        }

        // Truncate and record the stub
        let stub = BUDGET_EXCEEDED_STUB.replace("{budget}", &budget.to_string());
        self.seen_truncations
            .insert(tool_call_id.to_string(), stub.clone());
        stub
    }

    /// Clone the truncation state for forked/sub-agent contexts.
    pub fn clone(&self) -> Self {
        Self {
            seen_truncations: self.seen_truncations.clone(),
        }
    }
}

/// Get the per-result character budget. Can be overridden via env var.
fn get_per_result_budget() -> usize {
    std::env::var("LYRA_TOOL_RESULT_BUDGET_CHARS")
        .ok()
        .and_then(|v| v.parse().ok())
        .filter(|&v| v > 0)
        .unwrap_or(DEFAULT_PER_RESULT_CHAR_BUDGET)
}

/// Estimate the token count of a string.
/// Uses a conservative 4-chars-per-token heuristic (same as Claude Code's rough estimation).
pub fn estimate_token_count(text: &str) -> usize {
    text.len().div_ceil(4)
}

/// Format a truncated tool result with a preview of the beginning.
pub fn format_truncated_result(original: &str, budget: usize) -> Value {
    let preview_len = 500.min(budget / 10);
    let preview = if original.len() > preview_len {
        format!(
            "{}…",
            &original.chars().take(preview_len).collect::<String>()
        )
    } else {
        original.to_string()
    };

    json!({
        "ok": false,
        "truncated": true,
        "reason": "output exceeded per-result budget",
        "preview": preview,
        "original_size_chars": original.len(),
        "budget_chars": budget,
        "hint": "Use a narrower query, increase limit, or read specific line ranges."
    })
}
