//! Stateful scrubber for inline `<think>…</think>` reasoning blocks in streamed
//! OpenAI-compatible assistant content.
//!
//! Some OpenAI-compatible reasoning models (DeepSeek / Qwen / MiniMax / Kimi …)
//! do NOT return reasoning in a dedicated `reasoning_content` field. Instead they
//! inline it into the visible `content` as `<think>…</think>` (or `<thinking>`,
//! `<reasoning>`, `<thought>`). Without scrubbing, the reasoning — and stray
//! `</think>` close tags — leak into the user-visible assistant message, and the
//! leaked prose also poisons downstream "did the model forget to call a tool?"
//! heuristics. Anthropic avoids this entirely by streaming reasoning on a
//! separate `thinking_delta` channel; this scrubber gives the OpenAI path the
//! same clean separation.
//!
//! Unlike a whole-string regex, this is a per-delta state machine: a tag split
//! across two stream chunks (`"<thi"` + `"nk>"`) is held back until the next
//! `feed` resolves it. Text *inside* a block is routed to `reasoning`, not
//! discarded, so the reasoning is preserved on its own channel.
//!
//! Block-boundary rule for opens: an unterminated opening tag is only treated as
//! a reasoning opener at a block boundary (start of stream, after a newline, or
//! when only whitespace precedes it on the current line). This prevents prose
//! that merely *mentions* `<think>` from being suppressed. A fully closed
//! `<think>X</think>` pair is always treated as reasoning regardless of
//! boundary — a closed pair is an intentional, bounded construct.

/// Reasoning tag base names handled (case-insensitive). Materialized into
/// concrete `<tag>` / `</tag>` strings so the hot path does string ops, not
/// regex compilation per `feed`.
const OPEN_TAG_NAMES: &[&str] = &["think", "thinking", "reasoning", "thought"];

fn open_tags() -> Vec<String> {
    OPEN_TAG_NAMES
        .iter()
        .map(|name| format!("<{name}>"))
        .collect()
}

fn close_tags() -> Vec<String> {
    OPEN_TAG_NAMES
        .iter()
        .map(|name| format!("</{name}>"))
        .collect()
}

fn max_tag_len() -> usize {
    OPEN_TAG_NAMES
        .iter()
        .map(|name| name.len() + 3) // "</" + name + ">"
        .max()
        .unwrap_or(0)
}

/// One delta's worth of scrubbed output: visible prose and reasoning, each on
/// its own channel. Either may be empty for a given `feed`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct ScrubbedDelta {
    pub(crate) visible: String,
    pub(crate) reasoning: String,
}

/// Stateful streaming scrubber. Construct once per assistant message, `feed`
/// each content delta, then `flush` at end of stream.
#[derive(Debug, Clone)]
pub(crate) struct StreamingThinkScrubber {
    open_tags: Vec<String>,
    close_tags: Vec<String>,
    max_tag_len: usize,
    /// True while inside an opened block (text routed to reasoning) awaiting a
    /// close tag.
    in_block: bool,
    /// Held-back partial-tag tail, resolved on the next `feed` or `flush`.
    buf: String,
    /// True iff the most recent visible emission ended with `\n` (or nothing has
    /// been emitted yet — start of stream counts as a boundary).
    last_emitted_ended_newline: bool,
}

impl Default for StreamingThinkScrubber {
    fn default() -> Self {
        Self {
            open_tags: open_tags(),
            close_tags: close_tags(),
            max_tag_len: max_tag_len(),
            in_block: false,
            buf: String::new(),
            last_emitted_ended_newline: true,
        }
    }
}

impl StreamingThinkScrubber {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Feed one content delta; returns the visible and reasoning portions. The
    /// entire delta may be reasoning (visible empty), or held back pending a
    /// partial tag at the boundary (both empty).
    pub(crate) fn feed(&mut self, text: &str) -> ScrubbedDelta {
        let mut result = ScrubbedDelta::default();
        if text.is_empty() {
            return result;
        }
        let mut buf = std::mem::take(&mut self.buf);
        buf.push_str(text);

        loop {
            if buf.is_empty() {
                break;
            }
            if self.in_block {
                match find_first_tag(&buf, &self.close_tags) {
                    Some((close_idx, close_len)) => {
                        // Block content up to the close tag is reasoning.
                        result.reasoning.push_str(&buf[..close_idx]);
                        buf = buf[close_idx + close_len..].to_string();
                        self.in_block = false;
                    }
                    None => {
                        // No close yet — hold back a potential partial close-tag
                        // suffix as reasoning-in-progress; route the rest to
                        // reasoning now.
                        let held = max_partial_suffix(&buf, &self.close_tags, self.max_tag_len);
                        if held > 0 {
                            let split = buf.len() - held;
                            result.reasoning.push_str(&buf[..split]);
                            self.buf = buf[split..].to_string();
                        } else {
                            result.reasoning.push_str(&buf);
                            self.buf.clear();
                        }
                        return result;
                    }
                }
                continue;
            }

            // Not in a block. Priority 1: a fully closed pair anywhere.
            let pair = find_earliest_closed_pair(&buf, &self.open_tags, &self.close_tags);
            // Priority 2: an unterminated open tag at a block boundary.
            let open = find_open_at_boundary(
                &buf,
                &self.open_tags,
                &result.visible,
                self.last_emitted_ended_newline,
            );

            if let Some((start_idx, end_idx, open_len)) = pair {
                if open.is_none_or(|(open_idx, _)| start_idx <= open_idx) {
                    let preceding = &buf[..start_idx];
                    self.push_visible(&mut result, preceding);
                    // Inner content (between open tag end and close tag start) is
                    // reasoning.
                    let inner_start = start_idx + open_len;
                    let inner_end = end_idx - close_tag_len_at(&buf, end_idx, &self.close_tags);
                    if inner_start <= inner_end {
                        result.reasoning.push_str(&buf[inner_start..inner_end]);
                    }
                    buf = buf[end_idx..].to_string();
                    continue;
                }
            }

            if let Some((open_idx, open_len)) = open {
                let preceding = &buf[..open_idx];
                self.push_visible(&mut result, preceding);
                self.in_block = true;
                buf = buf[open_idx + open_len..].to_string();
                continue;
            }

            // No resolvable tag structure: hold back any partial open/close tag
            // prefix at the tail, emit the rest as visible.
            let held_open = max_partial_suffix(&buf, &self.open_tags, self.max_tag_len);
            let held_close = max_partial_suffix(&buf, &self.close_tags, self.max_tag_len);
            let held = held_open.max(held_close);
            if held > 0 {
                let split = buf.len() - held;
                let emit = buf[..split].to_string();
                self.push_visible(&mut result, &emit);
                self.buf = buf[split..].to_string();
            } else {
                let emit = buf.clone();
                self.push_visible(&mut result, &emit);
                self.buf.clear();
            }
            return result;
        }

        result
    }

    /// End-of-stream flush. An unterminated open block discards its held-back
    /// tail (leaking partial reasoning is worse than truncating it). Otherwise
    /// the held-back partial-tag tail turned out not to be a real tag and is
    /// surfaced as visible text.
    pub(crate) fn flush(&mut self) -> ScrubbedDelta {
        let mut result = ScrubbedDelta::default();
        if self.in_block {
            // Surface whatever reasoning was held back, drop block state.
            result.reasoning.push_str(&std::mem::take(&mut self.buf));
            self.in_block = false;
            return result;
        }
        let tail = std::mem::take(&mut self.buf);
        if !tail.is_empty() {
            let stripped = strip_orphan_close_tags(&tail, &self.close_tags);
            self.push_visible(&mut result, &stripped);
        }
        result
    }

    fn push_visible(&mut self, result: &mut ScrubbedDelta, text: &str) {
        if text.is_empty() {
            return;
        }
        let cleaned = strip_orphan_close_tags(text, &self.close_tags);
        if cleaned.is_empty() {
            return;
        }
        self.last_emitted_ended_newline = cleaned.ends_with('\n');
        result.visible.push_str(&cleaned);
    }
}

/// One-shot scrub of a complete string (non-streaming path). Returns the
/// visible prose with `<think>…</think>` reasoning removed, and the extracted
/// reasoning. Equivalent to feeding the whole string then flushing.
pub(crate) fn scrub_think_blocks(text: &str) -> ScrubbedDelta {
    let mut scrubber = StreamingThinkScrubber::new();
    let mut out = scrubber.feed(text);
    let tail = scrubber.flush();
    out.visible.push_str(&tail.visible);
    out.reasoning.push_str(&tail.reasoning);
    out
}

/// Earliest case-insensitive match of any `tags` entry: `(byte_index, len)`.
fn find_first_tag(buf: &str, tags: &[String]) -> Option<(usize, usize)> {
    let lower = buf.to_ascii_lowercase();
    let mut best: Option<(usize, usize)> = None;
    for tag in tags {
        if let Some(idx) = lower.find(&tag.to_ascii_lowercase())
            && best.is_none_or(|(b, _)| idx < b)
        {
            best = Some((idx, tag.len()));
        }
    }
    best
}

/// Earliest fully closed `<tag>…</tag>` pair: `(start_idx, end_idx, open_len)`.
/// The open tag that appears earliest wins; the nearest following close tag of
/// the same variant bounds it (non-greedy).
fn find_earliest_closed_pair(
    buf: &str,
    open_tags: &[String],
    close_tags: &[String],
) -> Option<(usize, usize, usize)> {
    let lower = buf.to_ascii_lowercase();
    let mut best: Option<(usize, usize, usize)> = None;
    for (open_tag, close_tag) in open_tags.iter().zip(close_tags.iter()) {
        let open_lower = open_tag.to_ascii_lowercase();
        let close_lower = close_tag.to_ascii_lowercase();
        let Some(open_idx) = lower.find(&open_lower) else {
            continue;
        };
        let Some(close_rel) = lower[open_idx + open_lower.len()..].find(&close_lower) else {
            continue;
        };
        let close_idx = open_idx + open_lower.len() + close_rel;
        let end_idx = close_idx + close_lower.len();
        if best.is_none_or(|(b, _, _)| open_idx < b) {
            best = Some((open_idx, end_idx, open_tag.len()));
        }
    }
    best
}

/// Length of the close tag that ends at `end_idx` (so callers can locate the
/// inner-content boundary).
fn close_tag_len_at(buf: &str, end_idx: usize, close_tags: &[String]) -> usize {
    let lower = buf.to_ascii_lowercase();
    for tag in close_tags {
        let tag_lower = tag.to_ascii_lowercase();
        if end_idx >= tag_lower.len() && lower[..end_idx].ends_with(&tag_lower) {
            return tag.len();
        }
    }
    0
}

/// Earliest block-boundary unterminated open tag: `(idx, len)`.
fn find_open_at_boundary(
    buf: &str,
    open_tags: &[String],
    emitted_visible: &str,
    last_emitted_ended_newline: bool,
) -> Option<(usize, usize)> {
    let lower = buf.to_ascii_lowercase();
    let mut best: Option<(usize, usize)> = None;
    for tag in open_tags {
        let tag_lower = tag.to_ascii_lowercase();
        let mut search_start = 0;
        while let Some(rel) = lower[search_start..].find(&tag_lower) {
            let idx = search_start + rel;
            if is_block_boundary(buf, idx, emitted_visible, last_emitted_ended_newline) {
                if best.is_none_or(|(b, _)| idx < b) {
                    best = Some((idx, tag.len()));
                }
                break;
            }
            search_start = idx + 1;
        }
    }
    best
}

/// True iff `idx` in `buf` sits at a block boundary (start, or only whitespace
/// since the previous newline / prior emission).
fn is_block_boundary(
    buf: &str,
    idx: usize,
    emitted_visible: &str,
    last_emitted_ended_newline: bool,
) -> bool {
    if idx == 0 {
        return if emitted_visible.is_empty() {
            last_emitted_ended_newline
        } else {
            emitted_visible.ends_with('\n')
        };
    }
    let preceding = &buf[..idx];
    match preceding.rfind('\n') {
        Some(nl) => preceding[nl + 1..].trim().is_empty(),
        None => {
            let prior_newline = if emitted_visible.is_empty() {
                last_emitted_ended_newline
            } else {
                emitted_visible.ends_with('\n')
            };
            prior_newline && preceding.trim().is_empty()
        }
    }
}

/// Longest suffix of `buf` that is a strict prefix of any tag (case-insensitive).
/// Used to hold back a tag split across delta boundaries.
fn max_partial_suffix(buf: &str, tags: &[String], max_tag_len: usize) -> usize {
    if buf.is_empty() {
        return 0;
    }
    let lower = buf.to_ascii_lowercase();
    let max_check = lower.len().min(max_tag_len.saturating_sub(1));
    for i in (1..=max_check).rev() {
        // Only split on a char boundary so slicing is valid UTF-8.
        if !buf.is_char_boundary(buf.len() - i) {
            continue;
        }
        let suffix = &lower[lower.len() - i..];
        for tag in tags {
            let tag_lower = tag.to_ascii_lowercase();
            if tag_lower.len() > i && tag_lower.starts_with(suffix) {
                return i;
            }
        }
    }
    0
}

/// Remove orphan close tags (no matching open in current state) plus trailing
/// whitespace, so surrounding prose flows naturally.
fn strip_orphan_close_tags(text: &str, close_tags: &[String]) -> String {
    if !text.contains("</") {
        return text.to_string();
    }
    let lower = text.to_ascii_lowercase();
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        if !text.is_char_boundary(i) {
            // Should not happen, but stay safe.
            i += 1;
            continue;
        }
        let mut matched = false;
        if lower[i..].starts_with("</") {
            for tag in close_tags {
                let tag_lower = tag.to_ascii_lowercase();
                if lower[i..].starts_with(&tag_lower) {
                    let mut j = i + tag_lower.len();
                    while j < bytes.len() && matches!(bytes[j], b' ' | b'\t' | b'\n' | b'\r') {
                        j += 1;
                    }
                    i = j;
                    matched = true;
                    break;
                }
            }
        }
        if !matched {
            let ch = text[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_all(chunks: &[&str]) -> ScrubbedDelta {
        let mut scrubber = StreamingThinkScrubber::new();
        let mut acc = ScrubbedDelta::default();
        for chunk in chunks {
            let out = scrubber.feed(chunk);
            acc.visible.push_str(&out.visible);
            acc.reasoning.push_str(&out.reasoning);
        }
        let tail = scrubber.flush();
        acc.visible.push_str(&tail.visible);
        acc.reasoning.push_str(&tail.reasoning);
        acc
    }

    #[test]
    fn strips_closed_pair_and_routes_inner_to_reasoning() {
        let out = feed_all(&["<think>weighing options</think>The answer is 42."]);
        assert_eq!(out.visible, "The answer is 42.");
        assert_eq!(out.reasoning, "weighing options");
    }

    #[test]
    fn handles_tag_split_across_deltas() {
        // The exact MiniMax/Kimi failure mode: tag split across chunks.
        let out = feed_all(&["<thi", "nk>", "reasoning here", "</thi", "nk>", "visible"]);
        assert_eq!(out.visible, "visible");
        assert_eq!(out.reasoning, "reasoning here");
    }

    #[test]
    fn strips_orphan_close_tag_from_visible() {
        // ordinal-107 shape: a stray </think> in the middle of prose.
        let out = feed_all(&["好，这次我来发。先找到输入框。</think>需要重新操作。"]);
        assert_eq!(out.visible, "好，这次我来发。先找到输入框。需要重新操作。");
        assert_eq!(out.reasoning, "");
    }

    #[test]
    fn plain_text_passes_through_untouched() {
        let out = feed_all(&["Just a normal answer with no tags."]);
        assert_eq!(out.visible, "Just a normal answer with no tags.");
        assert_eq!(out.reasoning, "");
    }

    #[test]
    fn unterminated_block_discards_visible_keeps_reasoning() {
        let out = feed_all(&["<think>still thinking when stream died"]);
        assert_eq!(out.visible, "");
        assert_eq!(out.reasoning, "still thinking when stream died");
    }

    #[test]
    fn mention_of_tag_midline_is_not_stripped() {
        // Prose that mentions the tag name mid-line is not a block boundary.
        let out = feed_all(&["use the <think> tag in your prompt"]);
        assert_eq!(out.visible, "use the <think> tag in your prompt");
        assert_eq!(out.reasoning, "");
    }

    #[test]
    fn streaming_visible_after_block_emits_incrementally() {
        let mut scrubber = StreamingThinkScrubber::new();
        let first = scrubber.feed("<think>plan</think>Hello");
        assert_eq!(first.visible, "Hello");
        assert_eq!(first.reasoning, "plan");
        let second = scrubber.feed(" world");
        assert_eq!(second.visible, " world");
    }
}
