//! Lenient repair of malformed tool-call argument JSON.
//!
//! Models (notably local/Ollama-served ones such as GLM) sometimes emit
//! truncated or otherwise invalid JSON as `function.arguments`: trailing
//! commas, unclosed objects/arrays, bare control characters inside string
//! literals. Strict parsing turns these into `IncompleteToolCall` protocol
//! errors, which the model loop fails the whole turn on — even though the
//! arguments are usually recoverable with a few mechanical fixes.
//!
//! This module implements a bounded repair ladder aligned with the hermes
//! reference project's `_repair_tool_call_arguments`. It is a fallback:
//! callers parse with strict `serde_json` first and only invoke repair when
//! that fails, so well-formed JSON takes the fast path at zero extra cost.
//!
//! All repairs are best-effort. When nothing works the function returns
//! `None` and the caller decides how to surface the failure.

use serde_json::Value;

/// Attempt to repair malformed tool-call argument JSON.
///
/// Returns `Some(Value)` if any repair pass yields parseable JSON, otherwise
/// `None`. An empty/whitespace input is treated as an empty object.
pub(crate) fn repair_tool_arguments(raw: &str) -> Option<Value> {
    let text = raw.trim();
    if text.is_empty() {
        return Some(serde_json::json!({}));
    }

    // Pass 1: strip trailing commas before `}` / `]`.
    if let Some(v) = try_parse(&strip_trailing_commas(text)) {
        return Some(v);
    }

    // Pass 2: close unclosed objects/arrays by brace counting.
    if let Some(v) = try_parse(&close_unbalanced(text)) {
        return Some(v);
    }

    // Pass 3: remove excess trailing closers (bounded).
    if let Some(v) = trim_excess_closers(text) {
        return Some(v);
    }

    // Pass 4: escape bare control characters inside string literals.
    if let Some(v) = try_parse(&escape_control_chars_in_strings(text)) {
        return Some(v);
    }

    None
}

fn try_parse(text: &str) -> Option<Value> {
    serde_json::from_str(text).ok()
}

/// Remove commas that immediately precede a closing `}` or `]`, honoring
/// string literals so a comma inside a string is never touched.
fn strip_trailing_commas(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_string = false;
    let mut escape = false;
    let bytes: Vec<char> = input.chars().collect();

    for i in 0..bytes.len() {
        let c = bytes[i];
        if in_string {
            out.push(c);
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            ',' => {
                // Look ahead past whitespace for a closer; if found, drop the comma.
                let mut j = i + 1;
                while j < bytes.len() && bytes[j].is_whitespace() {
                    j += 1;
                }
                if j < bytes.len() && (bytes[j] == '}' || bytes[j] == ']') {
                    // skip the comma
                } else {
                    out.push(c);
                }
            }
            _ => out.push(c),
        }
    }
    out
}

/// Append the missing closers for any unclosed `{` / `[`, honoring string
/// literals. Counts net openers minus closers; a negative net (more closers
/// than openers) is left for `trim_excess_closers` to handle.
fn close_unbalanced(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    let mut stack: Vec<char> = Vec::new();
    let mut in_string = false;
    let mut escape = false;

    for c in input.chars() {
        out.push(c);
        if in_string {
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '{' | '[' => stack.push(c),
            '}' => pop_matching(&mut stack, '{'),
            ']' => pop_matching(&mut stack, '['),
            _ => {}
        }
    }
    while let Some(opener) = stack.pop() {
        out.push(match opener {
            '{' => '}',
            '[' => ']',
            _ => ' ',
        });
    }
    out
}

fn pop_matching(stack: &mut Vec<char>, opener: char) {
    // Only pop if the top matches; mismatched closers are left alone (best effort).
    if stack.last() == Some(&opener) {
        stack.pop();
    }
}

/// Repeatedly drop a single trailing `}` / `]` and re-parse, bounded so a
/// pathological input cannot loop forever.
fn trim_excess_closers(input: &str) -> Option<Value> {
    let mut current = input.trim_end().to_string();
    for _ in 0..50 {
        if current.is_empty() {
            return Some(serde_json::json!({}));
        }
        if let Some(v) = try_parse(&current) {
            return Some(v);
        }
        let last = current.chars().last()?;
        if last == '}' || last == ']' {
            current.pop();
            // keep trimming trailing whitespace so the next last-char check is meaningful
            let trimmed = current.trim_end();
            if trimmed.len() != current.len() {
                current = trimmed.to_string();
            }
        } else {
            return None;
        }
    }
    None
}

/// Escape bare control characters (tab, newline, carriage return) that
/// appear inside string literals — a common local-model fault. Walks the
/// string so only in-string characters are modified.
fn escape_control_chars_in_strings(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_string = false;
    let mut escape = false;

    for c in input.chars() {
        if in_string {
            if escape {
                escape = false;
                out.push(c);
                continue;
            }
            match c {
                '\\' => {
                    escape = true;
                    out.push(c);
                }
                '"' => {
                    in_string = false;
                    out.push(c);
                }
                '\t' => out.push_str("\\t"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                _ => out.push(c),
            }
            continue;
        }
        match c {
            '"' => {
                in_string = true;
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::repair_tool_arguments;
    use serde_json::json;

    #[test]
    fn valid_json_is_not_modified() {
        // The repair function is only called when strict parsing fails, but
        // confirm it still accepts valid input unchanged.
        let v = repair_tool_arguments(r#"{"path":"/x","args":{}}"#).expect("valid");
        assert_eq!(v["path"], "/x");
    }

    #[test]
    fn trailing_comma_is_stripped() {
        let v = repair_tool_arguments(r#"{"path":"/x","args":{},}"#).expect("repaired");
        assert_eq!(v["path"], "/x");
    }

    #[test]
    fn trailing_comma_in_array_is_stripped() {
        let v = repair_tool_arguments(r#"{"items":[1,2,3,]}"#).expect("repaired");
        assert_eq!(v["items"][2], 3);
    }

    #[test]
    fn unclosed_object_is_closed() {
        let v = repair_tool_arguments(r#"{"path":"/x""#).expect("repaired");
        assert_eq!(v["path"], "/x");
    }

    #[test]
    fn unclosed_nested_structures_are_closed() {
        let v = repair_tool_arguments(r#"{"args":{"deep":[1,2"#).expect("repaired");
        assert_eq!(v["args"]["deep"][1], 2);
    }

    #[test]
    fn excess_trailing_closers_are_trimmed() {
        let v = repair_tool_arguments(r#"{"path":"/x"}}}}"#).expect("repaired");
        assert_eq!(v["path"], "/x");
    }

    #[test]
    fn bare_control_chars_in_strings_are_escaped() {
        // A literal tab inside a string value breaks strict JSON.
        let raw = "{\"text\":\"hello\tworld\"}";
        let v = repair_tool_arguments(raw).expect("repaired");
        assert_eq!(v["text"], "hello\tworld");
    }

    #[test]
    fn comma_inside_string_is_preserved() {
        let v = repair_tool_arguments(r#"{"msg":"a,b,c"}"#).expect("repaired");
        assert_eq!(v["msg"], "a,b,c");
    }

    #[test]
    fn empty_input_yields_empty_object() {
        let v = repair_tool_arguments("").expect("empty -> object");
        assert!(v.is_object());
        assert!(v.as_object().unwrap().is_empty());
    }

    #[test]
    fn unrepairable_garbage_returns_none() {
        let v = repair_tool_arguments("not even close to json }}} }}} ");
        assert!(v.is_none(), "expected None for unrepairable input");
    }
}