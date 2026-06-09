//! Final whitespace normalization for rendered markdown.

/// Normalize block spacing in assembled markdown:
/// - trim trailing whitespace on each line,
/// - collapse 3+ consecutive blank lines down to one,
/// - ensure the document ends with exactly one trailing newline.
///
/// Lines inside fenced code blocks are passed through untouched (their internal
/// whitespace is significant), except for a trailing-CR strip.
pub fn normalize(markdown: &str) -> String {
    let mut out = String::with_capacity(markdown.len());
    let mut blank_run = 0usize;
    let mut in_fence = false;

    for line in markdown.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        let trimmed_start = line.trim_start();
        let is_fence = trimmed_start.starts_with("```") || trimmed_start.starts_with("~~~");
        if is_fence {
            in_fence = !in_fence;
        }

        if in_fence || is_fence {
            // Inside (or on) a fence: keep the line verbatim.
            out.push_str(line);
            out.push('\n');
            blank_run = 0;
            continue;
        }

        let cleaned_line;
        let line = if contains_tracking_whitespace(line) {
            cleaned_line = strip_tracking_whitespace(line);
            cleaned_line.as_str()
        } else {
            line
        };
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                out.push('\n');
            }
        } else {
            blank_run = 0;
            out.push_str(trimmed);
            out.push('\n');
        }
    }

    let trimmed = out.trim_end_matches('\n');
    let mut result = trimmed.to_string();
    if !result.is_empty() {
        result.push('\n');
    }
    result
}

fn contains_tracking_whitespace(line: &str) -> bool {
    line.chars().any(is_tracking_whitespace)
}

fn strip_tracking_whitespace(line: &str) -> String {
    line.chars()
        .filter(|ch| !is_tracking_whitespace(*ch))
        .collect()
}

fn is_tracking_whitespace(ch: char) -> bool {
    matches!(
        ch,
        '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collapses_blank_runs() {
        let input = "a\n\n\n\nb";
        assert_eq!(normalize(input), "a\n\nb\n");
    }

    #[test]
    fn trims_trailing_spaces() {
        assert_eq!(normalize("a   \nb\t"), "a\nb\n");
    }

    #[test]
    fn preserves_code_block_indentation() {
        let input = "```\n    indented\n\n\n    code\n```";
        let out = normalize(input);
        assert!(out.contains("    indented"));
        assert!(out.contains("    code"));
        // Blank line inside fence preserved.
        assert!(out.contains("indented\n\n\n    code"));
    }

    #[test]
    fn single_trailing_newline() {
        assert_eq!(normalize("a\n\n\n"), "a\n");
        assert_eq!(normalize(""), "");
    }

    #[test]
    fn removes_tracking_whitespace_outside_code() {
        assert_eq!(normalize("a\u{200B}b\u{FEFF}c"), "abc\n");
    }

    #[test]
    fn preserves_tracking_whitespace_inside_code() {
        let input = "```\na\u{200B}b\n```\n\nc\u{200B}d";
        let out = normalize(input);
        assert!(out.contains("a\u{200B}b"));
        assert!(out.contains("cd"));
    }

    #[test]
    fn preserves_tracking_whitespace_inside_tilde_code_fence() {
        let input = "~~~\na\u{200B}b\n~~~\n\nc\u{200B}d";
        let out = normalize(input);
        assert!(out.contains("a\u{200B}b"));
        assert!(out.contains("cd"));
    }
}
