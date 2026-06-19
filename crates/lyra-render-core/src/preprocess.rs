/// Normalize common AI markdown glitches before parsing.
pub fn fix_common_markdown_issues(content: &str) -> String {
    let mut result = content.replace('｜', "|");
    result = convert_display_math_fences(&result);
    result = separate_run_on_block_markers(&result);
    let fence_count = result
        .lines()
        .filter(|line| line.trim_start().starts_with("```"))
        .count();
    if fence_count % 2 != 0 {
        result.push_str("\n```");
    }
    if result.matches("**").count() % 2 != 0 {
        result.push_str("**");
    }
    result
}

/// Models frequently emit "run-on" markdown where a block-level marker is glued
/// to the preceding prose on the same line — e.g. `行内代码。##引用` or
/// `## 代码块```python`. Strict CommonMark (correctly) treats these as inline
/// text, collapsing the document into one paragraph. This pass restores the
/// block boundaries that the author obviously intended:
///
/// 1. An ATX heading marker (`#`..`######`) that appears mid-line is split onto
///    its own line, and a missing space after the `#` run is inserted.
/// 2. A fenced code block opener (```` ``` ````) glued to the tail of a line is
///    moved onto its own line.
///
/// Content already inside a fenced code block is left untouched so real source
/// code is never rewritten. Conservative on purpose: ambiguous cases such as
/// run-on table rows or ordered-list items are intentionally not touched.
fn separate_run_on_block_markers(content: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut in_fence = false;

    // Each source line, once outside a fence, may be split into several emitted
    // lines — and one of those emitted lines can itself open a fence (e.g.
    // `## 代码块```python` becomes `## 代码块` + ```` ```python ````). The fence
    // state machine must therefore run over the *emitted* lines, not the raw
    // source lines, or it loses track and swallows everything after the block.
    // A work queue so that content split off a fence line (a glued next block,
    // or a second fence in a ```` ``````python ```` run) is re-fed through the
    // same state machine instead of bypassing it.
    let mut queue: std::collections::VecDeque<String> =
        content.split('\n').map(str::to_string).collect();

    while let Some(raw_line) = queue.pop_front() {
        if in_fence {
            // Inside a fence, only a closing fence ends it; everything else is
            // verbatim code and must not be rewritten.
            if raw_line.trim_start().starts_with("```") {
                let (fence, rest) = split_fence_marker(&raw_line);
                out.push(fence);
                in_fence = false;
                if !rest.trim().is_empty() {
                    // `rest` may be a glued block or another fence opener; push
                    // it back so the state machine re-evaluates it.
                    queue.push_front(rest);
                    out.push(String::new());
                }
            } else {
                out.push(raw_line);
            }
            continue;
        }

        // Outside a fence: first split run-on block markers on this line.
        let emitted = split_line_block_markers(&raw_line);
        for (offset, line) in emitted.iter().enumerate() {
            if line.trim_start().starts_with("```") {
                // An opening fence. Keep the bare ```lang opener; if extra
                // backticks were glued (```` ``````python ````), peel them.
                let (fence, rest) = split_fence_marker(line);
                out.push(fence);
                in_fence = true;
                // Anything after this opener on the same emitted line, plus all
                // remaining emitted pieces, go back on the queue for re-eval.
                let mut tail: Vec<String> = Vec::new();
                if !rest.trim().is_empty() {
                    tail.push(rest);
                }
                tail.extend(emitted[offset + 1..].iter().cloned());
                for item in tail.into_iter().rev() {
                    queue.push_front(item);
                }
                break;
            }
            out.push(line.clone());
        }
    }

    out.join("\n")
}

/// Split a single (non-fence) line wherever a heading marker or a code-fence
/// opener is glued into the middle of it. Returns one or more output lines.
fn split_line_block_markers(line: &str) -> Vec<String> {
    // A thematic break (`---`, `***`, `___`) glued to surrounding content
    // (`文字---`, `---## 标题`, ```` ```--- ````) is pulled onto its own line.
    // Handled first because each side may itself contain further run-on markers.
    if let Some((before, rule, after)) = split_run_on_thematic_break(line) {
        let mut pieces = Vec::new();
        if !before.trim().is_empty() {
            pieces.extend(split_line_block_markers(&before));
            // A blank line is required between the preceding text and the rule;
            // without it `text\n---` is parsed as a setext H2 underline, which
            // would wrongly promote the text to a heading.
            pieces.push(String::new());
        }
        pieces.push(rule);
        if !after.trim().is_empty() {
            pieces.push(String::new());
            pieces.extend(split_line_block_markers(&after));
        }
        return pieces;
    }

    // Normalize a leading heading run that is missing its space (`##列表`).
    let line = normalize_leading_heading_space(line);

    // Normalize a leading list marker missing its space (`-嵌套` -> `- 嵌套`).
    let line = normalize_leading_list_marker_space(&line);

    // A leading heading whose text runs straight into body prose
    // (`# 标题这是正文。`) is split at the first sentence-ending punctuation:
    // a sentence terminator inside an ATX heading is a strong signal the
    // heading has already ended and the rest is a paragraph.
    if let Some((heading, body)) = split_run_on_leading_heading(&line) {
        let mut pieces = vec![heading];
        // The body may itself contain further run-on markers.
        pieces.extend(split_line_block_markers(&body));
        return pieces;
    }

    let chars: Vec<char> = line.chars().collect();
    let mut pieces: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut index = 0;

    while index < chars.len() {
        // A code-fence opener glued mid-line: break before it.
        if index > 0
            && chars[index] == '`'
            && chars.get(index + 1) == Some(&'`')
            && chars.get(index + 2) == Some(&'`')
            && !current.trim().is_empty()
        {
            pieces.push(std::mem::take(&mut current));
            // Emit the remainder (fence + info string + any trailing text) as
            // its own line and stop scanning this line.
            let rest: String = chars[index..].iter().collect();
            pieces.push(rest);
            return pieces;
        }

        // A heading marker glued mid-line: sit after real content, follow a
        // boundary char (not an alphanumeric — so `C#`/`a#b` are excluded), and
        // be a run of 2..=6 `#`. Restricting to >=2 hashes avoids false hits on
        // lone `#` used as text (e.g. `issue #1`); the screenshot's run-on
        // headings are all `##`/`###`.
        if chars[index] == '#'
            && index > 0
            && !chars[index - 1].is_alphanumeric()
            && chars[index - 1] != '#'
            && !current.trim().is_empty()
        {
            let mut hashes = 0;
            while chars.get(index + hashes) == Some(&'#') {
                hashes += 1;
            }
            let after = chars.get(index + hashes);
            let looks_like_heading = (2..=6).contains(&hashes)
                && matches!(after, Some(c) if *c != '#');
            if looks_like_heading {
                let kept = current.trim_end().to_string();
                if !kept.is_empty() {
                    pieces.push(kept);
                }
                // The heading occupies the rest of the line; normalize a missing
                // space after the `#` run (`##列表` -> `## 列表`).
                let rest: String = chars[index..].iter().collect();
                pieces.push(normalize_leading_heading_space(&rest));
                return pieces;
            }
        }

        current.push(chars[index]);
        index += 1;
    }

    if !current.is_empty() || pieces.is_empty() {
        pieces.push(current);
    }
    pieces
}

/// Insert the missing space in a leading heading run (`##列表` -> `## 列表`).
/// Only touches lines whose first non-whitespace content is a `#` run of length
/// 1..=6 immediately followed by a non-space, non-`#` character.
fn normalize_leading_heading_space(line: &str) -> String {
    let indent_len = line.len() - line.trim_start().len();
    let (indent, rest) = line.split_at(indent_len);
    let hashes = rest.chars().take_while(|&c| c == '#').count();
    if hashes == 0 || hashes > 6 {
        return line.to_string();
    }
    let after: String = rest.chars().skip(hashes).collect();
    let first = after.chars().next();
    match first {
        Some(c) if c != ' ' && c != '#' => {
            format!("{indent}{} {after}", "#".repeat(hashes))
        }
        _ => line.to_string(),
    }
}

/// If `line` is a leading ATX heading (`# ...`) whose text contains a
/// sentence-ending punctuation mark with more content after it, split it into
/// `(heading_line, body)`. Returns `None` when the line is not a leading
/// heading or has no in-heading sentence break.
///
/// Headings legitimately never contain a `。`/`. `-style sentence break with
/// trailing prose, so this is a high-confidence signal that a paragraph was
/// glued onto the heading.
fn split_run_on_leading_heading(line: &str) -> Option<(String, String)> {
    let indent_len = line.len() - line.trim_start().len();
    let rest = &line[indent_len..];
    let hashes = rest.chars().take_while(|&c| c == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    // Require the normalized `# ` form (a space after the run).
    let after: String = rest.chars().skip(hashes).collect();
    if !after.starts_with(' ') {
        return None;
    }
    let title_text = &after[1..];

    // Sentence terminators that should not appear inside a heading.
    const TERMINATORS: &[char] = &['。', '！', '？', '.', '!', '?'];
    let chars: Vec<char> = title_text.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if !TERMINATORS.contains(&c) {
            continue;
        }
        // For ASCII `.`/`!`/`?`, require it to be followed by a non-space so we
        // do not split on a heading that merely ends with punctuation, and to
        // avoid abbreviations like "v1.2" we also require the next char to not
        // be a digit.
        let next = chars.get(i + 1).copied();
        let is_cjk = matches!(c, '。' | '！' | '？');
        let has_trailing_content = chars[i + 1..].iter().any(|c| !c.is_whitespace());
        if !has_trailing_content {
            return None;
        }
        if !is_cjk {
            match next {
                Some(n) if n.is_whitespace() || n.is_ascii_digit() => continue,
                None => return None,
                _ => {}
            }
        }
        let heading_part: String = chars[..=i].iter().collect();
        let body_part: String = chars[i + 1..].iter().collect();
        let heading_line = format!("{}{} {}", &line[..indent_len], "#".repeat(hashes), heading_part);
        return Some((heading_line, body_part.trim_start().to_string()));
    }
    None
}

/// Split a fence line into a bare three-backtick fence and any trailing content
/// glued onto it. Handles three run-on shapes models produce:
///   ```` ```--- ````        -> ("```", "---")            (block glued to close)
///   ```` ``````python ````   -> ("```", "```python")       (close + next open)
///   ```` ```python ````      -> ("```python", "")          (clean opener, kept)
///
/// The fence marker itself is normalized to exactly three backticks. Extra
/// backticks beyond three are treated as the start of the next (glued) fence and
/// returned in the remainder. A lone `lang` info string after exactly three
/// backticks is preserved as part of the opener.
fn split_fence_marker(line: &str) -> (String, String) {
    let indent_len = line.len() - line.trim_start().len();
    let (indent, rest) = line.split_at(indent_len);
    let ticks = rest.chars().take_while(|&c| c == '`').count();
    let after: String = rest.chars().skip(ticks).collect();

    if ticks > 3 {
        // e.g. ``````python = close (```) + open (```python). Keep the close
        // bare; the remaining backticks + info become the next fence.
        let leftover_ticks = "`".repeat(ticks - 3);
        let remainder = format!("{leftover_ticks}{after}");
        return (format!("{indent}```"), remainder);
    }

    // Exactly three (or fewer, treated as three) backticks. If an info string is
    // glued without other punctuation it's an opener (```python) and stays put;
    // if the trailing content looks like a different block (starts with `-`,
    // `#`, etc.) it's a glued next block on a close.
    let trimmed_after = after.trim();
    // A language info string must start with a letter (`python`, `c++`, `bash`),
    // never punctuation — so `---`/`##` glued onto a close are not mistaken for
    // one.
    let is_info_string = trimmed_after
        .chars()
        .next()
        .is_some_and(|c| c.is_alphabetic())
        && trimmed_after
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '+' || c == '#');
    if trimmed_after.is_empty() || is_info_string {
        // Clean opener or clean close — keep the whole thing as the fence line.
        (format!("{indent}```{after}"), String::new())
    } else {
        // Close with a glued next block (```---, ```## x).
        (format!("{indent}```"), after)
    }
}

/// Insert the missing space after a leading list marker (`-嵌套` -> `- 嵌套`,
/// `*项` -> `* 项`). Only touches `-`/`*`/`+` followed immediately by a
/// non-space, non-marker character. Ordered markers (`1.步骤`) are handled
/// separately. Leaves real content like `*emphasis*` or `**bold**` untouched
/// because those start with two markers / have no following space requirement
/// at line start in the run-on cases we target.
fn normalize_leading_list_marker_space(line: &str) -> String {
    let indent_len = line.len() - line.trim_start().len();
    let (indent, rest) = line.split_at(indent_len);
    let mut chars = rest.chars();
    let Some(marker) = chars.next() else {
        return line.to_string();
    };
    if !matches!(marker, '-' | '+') {
        // `*` is intentionally excluded: a line starting with `*` is far more
        // often emphasis (`*斜体*`) than a space-less bullet, so rewriting it
        // risks corrupting inline formatting.
        return line.to_string();
    }
    let after: String = chars.collect();
    match after.chars().next() {
        // `--`/`-+` etc. could be a thematic break or signature, leave alone.
        Some(c) if c != ' ' && !matches!(c, '-' | '+' | '*') => {
            format!("{indent}{marker} {after}")
        }
        _ => line.to_string(),
    }
}

/// Detect a thematic break (`---`, `***`, `___`, length >= 3) that is glued to
/// other content on the same line and split it out. Returns
/// `(before, rule_line, after)`. Returns `None` when the line is a clean
/// standalone rule, a table delimiter row, or has no embedded rule.
fn split_run_on_thematic_break(line: &str) -> Option<(String, String, String)> {
    // Table delimiter rows (`|---|---|`) and lines that are already a clean
    // standalone rule must not be touched.
    let trimmed = line.trim();
    if trimmed.contains('|') {
        return None;
    }
    if is_standalone_thematic_break(trimmed) {
        return None;
    }

    let chars: Vec<char> = line.chars().collect();
    // Only `-`-based run-on rules are common in model output and safe to detect
    // (`***`/`___` glued mid-line are rare and more ambiguous). Find a run of
    // >= 3 `-` that has non-dash content on at least one side.
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '-' {
            let start = i;
            while i < chars.len() && chars[i] == '-' {
                i += 1;
            }
            let run = i - start;
            if run >= 3 {
                let before: String = chars[..start].iter().collect();
                let after: String = chars[i..].iter().collect();
                // Require glued content on at least one side; otherwise it's a
                // clean rule (already handled above) or indented oddly.
                let before_has = !before.trim().is_empty();
                let after_has = !after.trim().is_empty();
                if before_has || after_has {
                    return Some((before, "---".to_string(), after));
                }
            }
            continue;
        }
        i += 1;
    }
    None
}

/// True when the trimmed line is nothing but a valid thematic break: >= 3 of the
/// same marker char (`-`, `*`, `_`), optionally separated by spaces.
fn is_standalone_thematic_break(trimmed: &str) -> bool {
    for marker in ['-', '*', '_'] {
        let only_marker = !trimmed.is_empty()
            && trimmed
                .chars()
                .all(|c| c == marker || c == ' ');
        let count = trimmed.chars().filter(|&c| c == marker).count();
        if only_marker && count >= 3 {
            return true;
        }
    }
    false
}

fn convert_display_math_fences(content: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let mut cursor = 0;
    let bytes = content.as_bytes();

    while cursor < bytes.len() {
        if bytes[cursor] == b'$' && bytes.get(cursor + 1) == Some(&b'$') {
            let _open = cursor;
            let mut search = cursor + 2;
            let mut close = None;
            while search + 1 < bytes.len() {
                if bytes[search] == b'$' && bytes[search + 1] == b'$' {
                    close = Some(search);
                    break;
                }
                search += 1;
            }
            let Some(close) = close else {
                result.push_str(&content[cursor..]);
                break;
            };

            let body = content[cursor + 2..close].trim();
            if !body.is_empty() {
                result.push_str("```latex\n");
                result.push_str(body);
                if body.ends_with('\n') {
                    result.push_str("```\n\n");
                } else {
                    result.push_str("\n```\n\n");
                }
            }
            cursor = close + 2;
            continue;
        }

        let next = content[cursor..]
            .char_indices()
            .nth(1)
            .map(|(index, _)| cursor + index)
            .unwrap_or(content.len());
        result.push_str(&content[cursor..next]);
        cursor = next;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_display_math_to_fenced_latex_blocks() {
        let input = "Intro\n\n$$\nE = mc^2\n$$\n\nDone";
        let output = fix_common_markdown_issues(input);
        assert!(output.contains("```latex\nE = mc^2\n```"));
    }

    #[test]
    fn inserts_missing_space_after_leading_heading_run() {
        assert_eq!(normalize_leading_heading_space("##列表"), "## 列表");
        assert_eq!(normalize_leading_heading_space("# 标题"), "# 标题");
        assert_eq!(normalize_leading_heading_space("###链接与图片"), "### 链接与图片");
    }

    #[test]
    fn leaves_non_heading_hash_lines_untouched() {
        // Seven hashes is not a valid ATX heading.
        assert_eq!(normalize_leading_heading_space("####### nope"), "####### nope");
        // Mid-line hashes (e.g. C#) are not leading runs.
        assert_eq!(normalize_leading_heading_space("语言 C# 很流行"), "语言 C# 很流行");
    }

    #[test]
    fn splits_heading_marker_glued_mid_line() {
        let input = "这是一段文本。 ## 引用";
        let output = separate_run_on_block_markers(input);
        assert_eq!(output, "这是一段文本。\n## 引用");
    }

    #[test]
    fn splits_heading_glued_after_cjk_punctuation_without_space() {
        // Real screenshot case: `行内代码`。##列表
        let input = "还有 `行内代码`。##列表";
        let output = separate_run_on_block_markers(input);
        assert_eq!(output, "还有 `行内代码`。\n## 列表");
    }

    #[test]
    fn does_not_split_single_hash_as_text() {
        // A lone `#` (issue refs etc.) must not be treated as a heading split.
        let input = "see issue #1 for details";
        assert_eq!(separate_run_on_block_markers(input), input);
    }

    #[test]
    fn splits_code_fence_glued_to_heading() {
        let input = "## 代码块```python";
        let output = separate_run_on_block_markers(input);
        assert_eq!(output, "## 代码块\n```python");
    }

    #[test]
    fn does_not_rewrite_inside_code_fence() {
        let input = "```python\nx = 1  ## not a heading\nprint('a```b')\n```";
        let output = separate_run_on_block_markers(input);
        assert_eq!(output, input);
    }

    #[test]
    fn leaves_clean_markdown_unchanged() {
        let input = "# 标题\n\n正文一段。\n\n## 小节\n\n- 项 1\n- 项 2";
        assert_eq!(separate_run_on_block_markers(input), input);
    }

    #[test]
    fn fixes_run_on_heading_and_missing_space_end_to_end() {
        let input = "正文。##引用";
        let output = fix_common_markdown_issues(input);
        assert!(output.contains("正文。\n## 引用"), "got: {output:?}");
    }

    #[test]
    fn splits_leading_heading_with_inline_sentence_break() {
        let input = "# 概述。本文介绍渲染流程";
        let output = separate_run_on_block_markers(input);
        assert_eq!(output, "# 概述。\n本文介绍渲染流程");
    }

    #[test]
    fn keeps_heading_that_merely_ends_with_punctuation() {
        // Trailing period, nothing after it -> still a single heading.
        assert_eq!(separate_run_on_block_markers("# 标题。"), "# 标题。");
    }

    #[test]
    fn does_not_split_heading_on_decimal_or_abbreviation() {
        // ASCII period followed by a digit (version numbers) must not split.
        assert_eq!(
            separate_run_on_block_markers("# Release v1.2 notes"),
            "# Release v1.2 notes"
        );
    }

    #[test]
    fn leaves_heading_without_sentence_break_untouched() {
        // The hard screenshot case: title glued to body with no separator at
        // all. There is no reliable signal, so we intentionally do not touch it.
        let input = "# Markdown渲染测试这是一段测试用的内容";
        assert_eq!(separate_run_on_block_markers(input), input);
    }

    #[test]
    fn splits_thematic_break_glued_to_heading() {
        assert_eq!(
            separate_run_on_block_markers("---## 文本格式"),
            "---\n\n## 文本格式"
        );
    }

    #[test]
    fn splits_thematic_break_glued_to_trailing_text() {
        // A blank line is inserted before the rule so the preceding text is not
        // reinterpreted as a setext heading.
        assert_eq!(
            separate_run_on_block_markers("正文---"),
            "正文\n\n---"
        );
    }

    #[test]
    fn leaves_clean_thematic_break_untouched() {
        assert_eq!(separate_run_on_block_markers("---"), "---");
        assert_eq!(separate_run_on_block_markers("- - -"), "- - -");
    }

    #[test]
    fn does_not_touch_table_delimiter_row() {
        let input = "|------|------|--------|";
        assert_eq!(separate_run_on_block_markers(input), input);
    }

    #[test]
    fn does_not_treat_thematic_break_inside_code_fence() {
        let input = "```python\nx = 1\n# ---\n```";
        assert_eq!(separate_run_on_block_markers(input), input);
    }

    #[test]
    fn inserts_space_after_leading_dash_bullet() {
        assert_eq!(normalize_leading_list_marker_space("-嵌套子项 A"), "- 嵌套子项 A");
        assert_eq!(normalize_leading_list_marker_space("- 已有空格"), "- 已有空格");
    }

    #[test]
    fn leaves_emphasis_and_hr_dashes_alone() {
        // `*` lines (emphasis) are not rewritten.
        assert_eq!(normalize_leading_list_marker_space("*斜体*"), "*斜体*");
        // `--` (could be hr / signature) is not rewritten.
        assert_eq!(normalize_leading_list_marker_space("--多个"), "--多个");
    }

    #[test]
    fn splits_block_glued_to_closing_fence() {
        let input = "```python\ncode();\n```---\n\n## 表格";
        let output = separate_run_on_block_markers(input);
        assert_eq!(output, "```python\ncode();\n```\n\n---\n\n## 表格");
    }

    #[test]
    fn splits_adjacent_fences_glued_by_six_backticks() {
        // A closing fence glued straight to the next opener: ```` ``````python ````.
        let input = "```ts\na();\n``````python\nb()\n```";
        let output = separate_run_on_block_markers(input);
        // A blank line is inserted between the two fences so the renderer treats
        // them as two distinct code blocks.
        assert_eq!(output, "```ts\na();\n```\n\n```python\nb()\n```");
    }

    #[test]
    fn keeps_clean_opener_with_info_string() {
        let input = "```python\nx = 1\n```";
        assert_eq!(separate_run_on_block_markers(input), input);
    }

    #[test]
    fn does_not_break_setext_underline_into_rule() {
        // A standalone `---` underneath text is a valid setext H2 underline and
        // must remain a standalone line (not be re-split).
        let input = "标题\n---";
        assert_eq!(separate_run_on_block_markers(input), input);
    }
}