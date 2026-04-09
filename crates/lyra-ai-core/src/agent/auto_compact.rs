use serde_json::json;
use std::collections::BTreeMap;

/// Reserved tokens for the compact summary output.
/// Based on Claude Code's MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000.
/// p99.99 of compact summary output is ~17,387 tokens.
const MAX_OUTPUT_TOKENS_FOR_SUMMARY: usize = 20_000;

/// Buffer tokens between the context window and the auto-compact trigger threshold.
/// Claude Code uses 13_000 — gives enough room for the compact API call's output.
pub const AUTOCOMPACT_BUFFER_TOKENS: usize = 13_000;

/// Warning threshold: show a warning when context usage reaches this close to the limit.
pub const WARNING_THRESHOLD_BUFFER_TOKENS: usize = 20_000;

/// Error threshold: block new queries when context reaches this close to the limit.
pub const ERROR_THRESHOLD_BUFFER_TOKENS: usize = 20_000;

/// Max consecutive compact failures before the circuit breaker stops retrying.
/// Prevents wasting API calls on irrecoverably over-limit contexts.
const MAX_CONSECUTIVE_COMPACT_FAILURES: u32 = 3;

/// Default context window size when the model doesn't report it.
/// Conservative estimate for common models.
const DEFAULT_CONTEXT_WINDOW: usize = 128_000;

/// Estimated token overhead for system prompt + tool definitions.
const SYSTEM_OVERHEAD_TOKENS: usize = 5_000;

/// ---- Configuration ----

/// Whether auto-compact is enabled. Can be disabled via env var.
pub fn is_auto_compact_enabled() -> bool {
    std::env::var("LYRA_DISABLE_AUTO_COMPACT")
        .map(|v| v != "1" && v != "true")
        .unwrap_or(true)
}

/// Get the effective context window for a given model.
/// Uses env var override if set.
pub fn get_effective_context_window(model: &str) -> usize {
    // Check for explicit override
    if let Ok(override_val) = std::env::var("LYRA_CONTEXT_WINDOW") {
        if let Ok(val) = override_val.parse::<usize>() {
            return val;
        }
    }

    // Model-specific defaults
    match model.to_lowercase().as_str() {
        s if s.contains("sonnet") || s.contains("claude") => 200_000,
        s if s.contains("opus") => 200_000,
        s if s.contains("haiku") => 200_000,
        s if s.contains("gpt-4") => 128_000,
        s if s.contains("gemini") => 1_000_000,
        _ => DEFAULT_CONTEXT_WINDOW,
    }
}

/// The token threshold at which auto-compact triggers.
/// effective_window - buffer = trigger point
pub fn get_auto_compact_threshold(model: &str) -> usize {
    let effective = get_effective_context_window(model);
    let reserved = MAX_OUTPUT_TOKENS_FOR_SUMMARY.min(effective / 4);
    let usable = effective - reserved;
    usable.saturating_sub(AUTOCOMPACT_BUFFER_TOKENS)
}

/// Calculate the current token usage state.
pub struct TokenWarningState {
    pub percent_left: f64,
    pub is_above_warning: bool,
    pub is_above_error: bool,
    pub should_auto_compact: bool,
    pub is_blocking: bool,
}

pub fn calculate_token_warning_state(current_tokens: usize, model: &str) -> TokenWarningState {
    let effective = get_effective_context_window(model);
    let reserved = MAX_OUTPUT_TOKENS_FOR_SUMMARY.min(effective / 4);
    let usable = effective - reserved;
    let threshold = if is_auto_compact_enabled() {
        get_auto_compact_threshold(model)
    } else {
        usable
    };

    let percent_left = if threshold > 0 {
        ((threshold as f64 - current_tokens as f64) / threshold as f64 * 100.0).max(0.0)
    } else {
        0.0
    };

    let warning_at = usable.saturating_sub(WARNING_THRESHOLD_BUFFER_TOKENS);
    let error_at = usable.saturating_sub(ERROR_THRESHOLD_BUFFER_TOKENS);
    let compact_at = get_auto_compact_threshold(model);

    TokenWarningState {
        percent_left,
        is_above_warning: current_tokens >= warning_at,
        is_above_error: current_tokens >= error_at,
        should_auto_compact: is_auto_compact_enabled() && current_tokens >= compact_at,
        is_blocking: current_tokens >= usable.saturating_sub(3_000),
    }
}

/// ---- Compact Prompt Template ----

/// The 9-section structured compact prompt, adapted from Claude Code's BASE_COMPACT_PROMPT.
/// Uses <analysis> as a scratchpad (stripped in post-processing) and <summary> for the final output.
pub const BASE_COMPACT_PROMPT: &str = r#"You are Lyra's internal compaction module, summarizing a software engineering conversation.
The conversation involves Lyra helping a user with coding tasks.

Produce a detailed summary using the following structure. Every section must be present, even if empty.

<analysis>
First, think through the conversation carefully. Identify the key requests, technical decisions,
errors encountered, fixes applied, and the current state of work. This is your scratchpad — it
will be removed from the final output.
</analysis>

<summary>
## Primary Request and Intent
What did the user explicitly ask for? What was their goal?

## Key Technical Concepts
What technologies, frameworks, libraries, or patterns were discussed?

## Files and Code Sections
List every file that was read or modified. Include relevant code snippets and describe what changed.

## Errors and Fixes
What errors occurred? How were they fixed? Include user feedback that guided corrections.

## Problem Solving
What problems were solved? What troubleshooting steps were taken?

## All User Messages
List every non-tool-result message from the user verbatim or closely paraphrased.

## Pending Tasks
What tasks remain incomplete? What did the agent say it would do next?

## Current Work
What was the agent working on immediately before this summary? Be specific — include file names,
function names, and code snippets.

## Optional Next Step
What is the most logical next action? Only suggest something directly tied to the user's last request.
Quote the user's most recent relevant message.
</summary>"#;

/// Prefix to ensure the model responds with text only, not tool calls.
const NO_TOOLS_PREAMBLE: &str =
    "CRITICAL: You are Lyra's compaction module. Respond with TEXT ONLY. Do NOT call any tools.";

/// Trailer to reinforce the no-tools constraint.
const NO_TOOLS_TRAILER: &str = "REMINDER: Do NOT call tools. Output only the summary text.";

/// Build the full compact prompt, optionally with custom instructions.
pub fn build_compact_prompt(custom_instructions: Option<&str>) -> String {
    let mut prompt = String::with_capacity(2048);
    prompt.push_str(NO_TOOLS_PREAMBLE);
    prompt.push_str("\n\n");
    prompt.push_str(BASE_COMPACT_PROMPT);
    if let Some(instructions) = custom_instructions {
        prompt.push_str("\n\n");
        prompt.push_str(instructions);
    }
    prompt.push_str("\n\n");
    prompt.push_str(NO_TOOLS_TRAILER);
    prompt
}

/// Parse the compact summary from the model's response.
/// Strips the <analysis> scratchpad and extracts the <summary> content.
pub fn parse_compact_summary(response: &str) -> String {
    // Try to extract from <summary> tags
    if let Some(start) = response.find("<summary>") {
        if let Some(end) = response.find("</summary>") {
            if end > start {
                return response[start + 9..end].trim().to_string();
            }
        }
    }
    // Fallback: return the whole response (minus analysis if present)
    if let Some(start) = response.find("</analysis>") {
        return response[start + 11..].trim().to_string();
    }
    response.trim().to_string()
}

/// Estimate token count for a message string using the 4-chars-per-token heuristic.
pub fn estimate_message_tokens(text: &str) -> usize {
    text.len().div_ceil(4)
}

/// ---- Compact Boundary Marker ----

/// Creates a compact boundary marker to inject into the message history.
/// This marks where the old conversation was summarized.
pub fn create_compact_boundary_marker(trigger: &str, pre_compact_tokens: usize) -> String {
    json!({
        "type": "compact_boundary",
        "trigger": trigger,
        "preCompactTokens": pre_compact_tokens,
        "note": "Earlier conversation was summarized to preserve context."
    })
    .to_string()
}

/// ---- Compact Result ----

pub struct CompactResult {
    /// The summary text generated by the compact agent.
    pub summary: String,
    /// Estimated tokens before compaction.
    pub pre_compact_tokens: usize,
    /// Estimated tokens after compaction.
    pub post_compact_tokens: usize,
    /// Tokens saved by compaction.
    pub tokens_saved: usize,
}

/// ---- Circuit Breaker State ----

#[derive(Default, Clone)]
pub struct CompactCircuitBreaker {
    pub consecutive_failures: u32,
    pub last_failure_reason: String,
}

impl CompactCircuitBreaker {
    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.last_failure_reason.clear();
    }

    pub fn record_failure(&mut self, reason: &str) {
        self.consecutive_failures += 1;
        self.last_failure_reason = reason.to_string();
    }

    pub fn is_open(&self) -> bool {
        self.consecutive_failures >= MAX_CONSECUTIVE_COMPACT_FAILURES
    }

    pub fn can_compact(&self) -> bool {
        !self.is_open()
    }

    pub fn new() -> Self {
        Self::default()
    }
}

/// ---- Run Auto Compact ----

/// Execute the auto-compact process: run inference with the compact prompt
/// and return the summary text. This mirrors Claude Code's forked agent approach.
///
/// Uses the same provider profile but with no tools and a max-turns=1 constraint.
pub fn run_auto_compact(
    profile: &crate::profile::types::AiProviderProfile,
    secrets: &BTreeMap<String, String>,
    provider_messages: &[crate::provider::types::AgentInferenceMessage],
    _original_user_input: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    use crate::provider;
    use crate::provider::types::AgentInferenceMessage;
    use crate::provider::types::AgentInferenceMessageRole;

    // Build compact messages: replay conversation + append compact prompt
    let mut compact_messages: Vec<AgentInferenceMessage> = provider_messages.to_vec();

    // Append the compact prompt as a user message
    compact_messages.push(AgentInferenceMessage {
        role: AgentInferenceMessageRole::User,
        content: build_compact_prompt(None),
        tool_call_id: None,
        tool_calls: Vec::new(),
    });

    // Run inference with no tools — pure summarization
    let inference = provider::run_agent_inference(
        profile,
        secrets,
        &compact_messages,
        &[], // No tools for compact
        None::<&mut dyn FnMut(&str)>,
        None::<&mut dyn FnMut(&str)>,
    )?;

    // Parse the summary from the response
    let summary = parse_compact_summary(&inference.assistant_text);

    if summary.is_empty() {
        return Err("Auto-compact produced an empty summary".into());
    }

    Ok(summary)
}
