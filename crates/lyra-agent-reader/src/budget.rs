//! Character budgeting and structural truncation.
//!
//! When a `max_chars` budget is set, the reader truncates at the nearest
//! structural boundary at or before the limit (a blank line between blocks, then
//! a line break, then a word boundary) so output never ends mid-construct.

/// The outcome of applying a budget.
pub struct Budgeted {
    /// Possibly-truncated text.
    pub text: String,
    /// Whether truncation occurred.
    pub truncated: bool,
    /// Total character count of the original (untruncated) text.
    pub total_chars: usize,
    /// Character cursor immediately after the budgeted slice, if truncated.
    pub next_cursor: Option<usize>,
}

/// Estimate the token count of `text`.
///
/// With the `tokenizer-tiktoken` feature enabled this runs a real BPE
/// tokenizer (OpenAI's `o200k_base`, used here as an offline proxy for Claude's
/// proprietary tokenizer — the rank tables are embedded in the binary, so this
/// never touches the network). The BPE table is initialized once and reused via
/// a process-wide singleton.
///
/// Without the feature it falls back to the cheap ~4 chars/token heuristic,
/// which badly under-counts CJK text and code.
pub fn estimate_tokens(text: &str) -> usize {
    #[cfg(feature = "tokenizer-tiktoken")]
    {
        if text.is_empty() {
            return 0;
        }
        let bpe = tiktoken_rs::o200k_base_singleton();
        return bpe.encode_with_special_tokens(text).len().max(1);
    }
    #[cfg(not(feature = "tokenizer-tiktoken"))]
    {
        estimate_tokens_heuristic(text)
    }
}

/// The character-count heuristic (~4 chars/token). Retained as the fallback for
/// builds without `tokenizer-tiktoken` and exposed for callers that explicitly
/// want the cheap estimate.
pub fn estimate_tokens_heuristic(text: &str) -> usize {
    let chars = text.chars().count();
    chars.div_ceil(4)
}

/// Apply an optional `max_chars` budget to `text`.
pub fn apply(text: &str, max_chars: Option<usize>) -> Budgeted {
    let total_chars = text.chars().count();
    let Some(limit) = max_chars else {
        return Budgeted {
            text: text.to_string(),
            truncated: false,
            total_chars,
            next_cursor: None,
        };
    };
    if total_chars <= limit {
        return Budgeted {
            text: text.to_string(),
            truncated: false,
            total_chars,
            next_cursor: None,
        };
    }

    let (cut, next_cursor) = truncate_at_boundary(text, limit);
    Budgeted {
        text: cut,
        truncated: true,
        total_chars,
        next_cursor: Some(next_cursor),
    }
}

/// Combine char and token options into a single effective char budget.
pub fn effective_char_limit(
    max_chars: Option<usize>,
    max_tokens: Option<usize>,
    token_budget: Option<usize>,
) -> Option<usize> {
    [
        max_chars,
        max_tokens.map(tokens_to_chars),
        token_budget.map(tokens_to_chars),
    ]
    .into_iter()
    .flatten()
    .min()
}

/// Find the best structural cut point at or before `limit` characters.
fn truncate_at_boundary(text: &str, limit: usize) -> (String, usize) {
    // Byte index of the `limit`-th character (the hard cap).
    let hard_cap = char_byte_index(text, limit);
    let window = &text[..hard_cap];

    // Prefer a paragraph boundary (blank line), then a single newline, then a
    // word boundary. Only accept a boundary that keeps a reasonable amount of
    // content (>= 50% of the window) to avoid cutting too aggressively.
    let min_keep = window.len() / 2;

    if let Some(index) = window.rfind("\n\n") {
        if index >= min_keep {
            return finish_cut(window, index);
        }
    }
    if let Some(index) = window.rfind('\n') {
        if index >= min_keep {
            return finish_cut(window, index);
        }
    }
    if let Some(index) = window.rfind(char::is_whitespace) {
        if index >= min_keep {
            return finish_cut(window, index);
        }
    }
    finish_cut(window, window.len())
}

/// Byte index of the `n`-th character (or end of string).
fn char_byte_index(text: &str, n: usize) -> usize {
    text.char_indices()
        .nth(n)
        .map(|(index, _)| index)
        .unwrap_or(text.len())
}

fn finish_cut(window: &str, byte_index: usize) -> (String, usize) {
    let trimmed = window[..byte_index].trim_end().to_string();
    let next_cursor = trimmed.chars().count();
    (trimmed, next_cursor)
}

fn tokens_to_chars(tokens: usize) -> usize {
    tokens.saturating_mul(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_budget_passthrough() {
        let b = apply("hello world", None);
        assert!(!b.truncated);
        assert_eq!(b.text, "hello world");
        assert_eq!(b.total_chars, 11);
        assert_eq!(b.next_cursor, None);
    }

    #[test]
    fn under_budget_passthrough() {
        let b = apply("short", Some(100));
        assert!(!b.truncated);
    }

    #[test]
    fn truncates_at_paragraph_boundary() {
        let text = "First paragraph here.\n\nSecond paragraph that goes well past the budget limit set below.";
        let b = apply(text, Some(40));
        assert!(b.truncated);
        assert_eq!(b.text, "First paragraph here.");
        assert_eq!(b.total_chars, text.chars().count());
        assert_eq!(b.next_cursor, Some("First paragraph here.".chars().count()));
    }

    #[test]
    fn truncates_at_word_boundary_when_no_newline() {
        let text = "alpha beta gamma delta epsilon zeta eta theta";
        let b = apply(text, Some(20));
        assert!(b.truncated);
        assert!(!b.text.ends_with("gam")); // not mid-word
        assert!(b.text.chars().count() <= 20);
    }

    #[test]
    fn token_estimate_heuristic() {
        assert_eq!(estimate_tokens_heuristic("abcd"), 1);
        assert_eq!(estimate_tokens_heuristic("abcde"), 2);
        assert_eq!(estimate_tokens_heuristic(""), 0);
    }

    #[cfg(feature = "tokenizer-tiktoken")]
    #[test]
    fn token_estimate_bpe_beats_heuristic_for_cjk() {
        // CJK encodes to roughly one-or-more tokens per character, far above the
        // chars/4 heuristic. This guards the under-counting bug the BPE path fixes.
        let chinese = "这是一段中文测试文本用于验证分词器";
        let bpe = estimate_tokens(chinese);
        let heuristic = estimate_tokens_heuristic(chinese);
        assert!(
            bpe > heuristic,
            "expected BPE estimate {bpe} to exceed heuristic {heuristic}"
        );
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn effective_limit_uses_strictest_budget() {
        assert_eq!(effective_char_limit(Some(100), Some(10), None), Some(40));
        assert_eq!(effective_char_limit(None, Some(10), Some(4)), Some(16));
        assert_eq!(effective_char_limit(None, None, None), None);
    }
}
