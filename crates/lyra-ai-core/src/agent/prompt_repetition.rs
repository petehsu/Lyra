use crate::agent::auto_compact::{get_auto_compact_threshold, get_effective_context_window};
use crate::agent::prompt_pipeline::estimate_tokens;

const LIVE_REPEAT_MARGIN_TOKENS: usize = 256;
const MIN_ANCHOR_TOKENS: usize = 24;
const MAX_ANCHOR_TOKENS: usize = 220;
const HARD_WINDOW_BUFFER_TOKENS: usize = 4_096;
const TRUNCATED_REPEAT_MARKER: &str = "[truncated repeat anchor]";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PromptRepetitionMode {
    FullDouble,
    AnchorOnly,
    Skipped,
}

impl PromptRepetitionMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FullDouble => "full_double",
            Self::AnchorOnly => "anchor_only",
            Self::Skipped => "skipped",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PromptRepetitionResult {
    pub transformed_input: String,
    pub mode: PromptRepetitionMode,
    pub original_tokens: usize,
    pub added_tokens: usize,
    pub anchor_tokens: usize,
}

pub fn build_live_repeated_user_input(
    input: &str,
    current_context_tokens: usize,
    model_hint: &str,
) -> PromptRepetitionResult {
    build_repeated_user_input(input, current_context_tokens, model_hint, true)
}

pub fn build_task_anchor_excerpt(input: &str, max_tokens: usize) -> String {
    build_anchor_excerpt_impl(input, max_tokens, true)
}

pub(crate) fn build_post_compact_user_input(
    input: &str,
    current_context_tokens: usize,
    model_hint: &str,
) -> PromptRepetitionResult {
    let trimmed = input.trim();
    let original_tokens = estimate_tokens(trimmed);
    if trimmed.is_empty() {
        return PromptRepetitionResult {
            transformed_input: String::new(),
            mode: PromptRepetitionMode::Skipped,
            original_tokens,
            added_tokens: 0,
            anchor_tokens: 0,
        };
    }

    let compact_threshold = get_auto_compact_threshold(model_hint);
    let effective_window = get_effective_context_window(model_hint);
    let hard_limit = effective_window.saturating_sub(HARD_WINDOW_BUFFER_TOKENS);
    let raw_total = current_context_tokens.saturating_add(original_tokens);
    if raw_total.saturating_add(64) <= compact_threshold && raw_total <= hard_limit {
        return PromptRepetitionResult {
            transformed_input: trimmed.to_string(),
            mode: PromptRepetitionMode::Skipped,
            original_tokens,
            added_tokens: 0,
            anchor_tokens: 0,
        };
    }

    let anchor_budget = compact_threshold
        .saturating_sub(current_context_tokens)
        .saturating_sub(LIVE_REPEAT_MARGIN_TOKENS)
        .max(MIN_ANCHOR_TOKENS)
        .min(MAX_ANCHOR_TOKENS);
    let anchor_excerpt = build_anchor_excerpt_impl(trimmed, anchor_budget, false);
    let transformed_input = format!("Current task anchor:\n{anchor_excerpt}");
    let added_tokens = estimate_tokens(&transformed_input);
    if current_context_tokens
        .saturating_add(added_tokens)
        .saturating_add(64)
        > compact_threshold
        || current_context_tokens.saturating_add(added_tokens) > hard_limit
    {
        return PromptRepetitionResult {
            transformed_input: "Current task anchor:\n[truncated repeat anchor]".to_string(),
            mode: PromptRepetitionMode::AnchorOnly,
            original_tokens,
            added_tokens: estimate_tokens("Current task anchor:\n[truncated repeat anchor]"),
            anchor_tokens: estimate_tokens(TRUNCATED_REPEAT_MARKER),
        };
    }

    PromptRepetitionResult {
        transformed_input,
        mode: PromptRepetitionMode::AnchorOnly,
        original_tokens,
        added_tokens,
        anchor_tokens: estimate_tokens(&anchor_excerpt),
    }
}

fn build_repeated_user_input(
    input: &str,
    current_context_tokens: usize,
    model_hint: &str,
    allow_full_double: bool,
) -> PromptRepetitionResult {
    let trimmed = input.trim();
    let original_tokens = estimate_tokens(trimmed);
    if trimmed.is_empty() {
        return PromptRepetitionResult {
            transformed_input: String::new(),
            mode: PromptRepetitionMode::Skipped,
            original_tokens,
            added_tokens: 0,
            anchor_tokens: 0,
        };
    }

    let compact_threshold = get_auto_compact_threshold(model_hint);
    let effective_window = get_effective_context_window(model_hint);
    let hard_limit = effective_window.saturating_sub(HARD_WINDOW_BUFFER_TOKENS);
    let separator_tokens = estimate_tokens("\n\n");
    let extra_full_tokens = original_tokens.saturating_add(separator_tokens);
    let double_total = current_context_tokens.saturating_add(extra_full_tokens);
    if allow_full_double
        && double_total.saturating_add(LIVE_REPEAT_MARGIN_TOKENS) <= compact_threshold
        && double_total <= hard_limit
    {
        return PromptRepetitionResult {
            transformed_input: format!("{trimmed}\n\n{trimmed}"),
            mode: PromptRepetitionMode::FullDouble,
            original_tokens,
            added_tokens: extra_full_tokens,
            anchor_tokens: 0,
        };
    }

    let anchor_budget = compact_threshold
        .saturating_sub(current_context_tokens)
        .saturating_sub(LIVE_REPEAT_MARGIN_TOKENS)
        .min(MAX_ANCHOR_TOKENS);
    if anchor_budget < MIN_ANCHOR_TOKENS {
        return PromptRepetitionResult {
            transformed_input: trimmed.to_string(),
            mode: PromptRepetitionMode::Skipped,
            original_tokens,
            added_tokens: 0,
            anchor_tokens: 0,
        };
    }

    let anchor_excerpt = build_anchor_excerpt_impl(trimmed, anchor_budget, false);
    let anchor_message = format!("Re-read the latest request carefully.\n{anchor_excerpt}");
    let transformed_input = format!("{trimmed}\n\n{anchor_message}");
    let added_tokens = estimate_tokens(&format!("\n\n{anchor_message}"));
    let total_tokens = current_context_tokens.saturating_add(added_tokens);
    if total_tokens.saturating_add(64) > compact_threshold || total_tokens > hard_limit {
        return PromptRepetitionResult {
            transformed_input: trimmed.to_string(),
            mode: PromptRepetitionMode::Skipped,
            original_tokens,
            added_tokens: 0,
            anchor_tokens: 0,
        };
    }

    PromptRepetitionResult {
        transformed_input,
        mode: PromptRepetitionMode::AnchorOnly,
        original_tokens,
        added_tokens,
        anchor_tokens: estimate_tokens(&anchor_excerpt),
    }
}

fn build_anchor_excerpt_impl(input: &str, max_tokens: usize, allow_full_copy: bool) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return "unknown".to_string();
    }
    if max_tokens == 0 {
        return TRUNCATED_REPEAT_MARKER.to_string();
    }
    if allow_full_copy && estimate_tokens(trimmed) <= max_tokens {
        return trimmed.to_string();
    }

    let label_tokens = estimate_tokens("Opening excerpt: \nClosing excerpt: \n")
        + estimate_tokens(TRUNCATED_REPEAT_MARKER);
    if max_tokens <= label_tokens {
        return TRUNCATED_REPEAT_MARKER.to_string();
    }

    let excerpt_tokens = max_tokens - label_tokens;
    let excerpt_chars = excerpt_tokens.saturating_mul(4);
    let head_chars = excerpt_chars / 2;
    let tail_chars = excerpt_chars.saturating_sub(head_chars);
    let head = take_chars(trimmed, head_chars);
    let tail = take_last_chars(trimmed, tail_chars);

    if head.is_empty() || tail.is_empty() {
        return TRUNCATED_REPEAT_MARKER.to_string();
    }

    format!("Opening excerpt: {head}\nClosing excerpt: {tail}\n{TRUNCATED_REPEAT_MARKER}")
}

fn take_chars(value: &str, limit: usize) -> String {
    value
        .chars()
        .take(limit)
        .collect::<String>()
        .trim()
        .to_string()
}

fn take_last_chars(value: &str, limit: usize) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    let start = chars.len().saturating_sub(limit);
    chars[start..].iter().collect::<String>().trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        build_live_repeated_user_input, build_post_compact_user_input, build_task_anchor_excerpt,
        PromptRepetitionMode, TRUNCATED_REPEAT_MARKER,
    };

    #[test]
    fn short_inputs_use_full_double() {
        let result = build_live_repeated_user_input("Fix the test", 2_000, "gpt-4o");
        assert_eq!(result.mode, PromptRepetitionMode::FullDouble);
        assert_eq!(result.transformed_input, "Fix the test\n\nFix the test");
        assert!(result.added_tokens > 0);
    }

    #[test]
    fn tight_budget_falls_back_to_anchor_only() {
        let result = build_live_repeated_user_input(&"x".repeat(6_000), 94_500, "gpt-4o");
        assert_eq!(result.mode, PromptRepetitionMode::AnchorOnly);
        assert!(result
            .transformed_input
            .contains("Re-read the latest request carefully."));
        assert!(result.transformed_input.contains(TRUNCATED_REPEAT_MARKER));
        assert!(result.anchor_tokens > 0);
    }

    #[test]
    fn extremely_tight_budget_skips_repetition() {
        let result = build_live_repeated_user_input("Inspect the logs", 94_900, "gpt-4o");
        assert_eq!(result.mode, PromptRepetitionMode::Skipped);
        assert_eq!(result.transformed_input, "Inspect the logs");
    }

    #[test]
    fn task_anchor_uses_full_copy_when_budget_allows() {
        let excerpt = build_task_anchor_excerpt("Short task", 64);
        assert_eq!(excerpt, "Short task");
    }

    #[test]
    fn task_anchor_truncates_to_head_and_tail() {
        let excerpt = build_task_anchor_excerpt(&"abcdef".repeat(80), 40);
        assert!(excerpt.contains("Opening excerpt:"));
        assert!(excerpt.contains("Closing excerpt:"));
        assert!(excerpt.contains(TRUNCATED_REPEAT_MARKER));
    }

    #[test]
    fn post_compact_path_never_full_doubles() {
        let result = build_post_compact_user_input("Ship the fix", 5_000, "gpt-4o");
        assert_ne!(result.mode, PromptRepetitionMode::FullDouble);
    }
}
