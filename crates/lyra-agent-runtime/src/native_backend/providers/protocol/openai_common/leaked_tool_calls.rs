use std::collections::{HashMap, HashSet};

use serde_json::{Value, json};
use uuid::Uuid;

use crate::native_backend::provider::ModelToolCall;

use super::tools::repair_tool_name;

const DSML_PREFIXES: &[&str] = &["｜｜DSML｜｜", "||DSML||", "｜DSML｜", "|DSML|"];

/// Recover DeepSeek DSML / XML `<tool_calls><invoke>` markup that some
/// OpenAI-compatible gateways leak into `message.content` instead of emitting
/// structured `tool_calls`.
pub(crate) fn extract_leaked_tool_calls(
    content: &str,
    allowed_tool_names: &HashSet<String>,
) -> (String, Vec<ModelToolCall>) {
    let mut remaining = content.to_string();
    let mut recovered = Vec::new();
    loop {
        let Some((start, end, inner)) = find_tool_calls_block(&remaining) else {
            break;
        };
        let calls = parse_invoke_calls(inner, allowed_tool_names);
        if calls.is_empty() {
            break;
        }
        recovered.extend(calls);
        remaining.replace_range(start..end, "");
    }
    let (remaining, json_calls) = extract_trailing_json_tool_calls(&remaining, allowed_tool_names);
    recovered.extend(json_calls);
    (remaining, recovered)
}

/// gpt-oss / Harmony-class models sometimes paste the next tool's JSON
/// arguments onto the end of a thinking monologue instead of emitting a
/// structured `tool_calls` array. Recover the suffix; leave the monologue
/// for the caller to hide.
fn extract_trailing_json_tool_calls(
    content: &str,
    allowed_tool_names: &HashSet<String>,
) -> (String, Vec<ModelToolCall>) {
    let Some((start, value)) = trailing_json_object(content) else {
        return (content.to_string(), Vec::new());
    };
    let Some(name) = infer_tool_name_from_args(&value, allowed_tool_names) else {
        return (content.to_string(), Vec::new());
    };
    (
        content[..start].to_string(),
        vec![ModelToolCall {
            id: format!("tool-{}", Uuid::new_v4()),
            name,
            arguments: value,
        }],
    )
}

fn trailing_json_object(content: &str) -> Option<(usize, Value)> {
    let trimmed = content.trim_end();
    if !trimmed.ends_with('}') {
        return None;
    }
    let mut search_from = 0;
    while let Some(rel) = trimmed[search_from..].find('{') {
        let start = search_from + rel;
        if let Ok(value) = serde_json::from_str::<Value>(&trimmed[start..]) {
            if value.is_object() {
                return Some((start, value));
            }
        }
        search_from = start + 1;
    }
    None
}

fn infer_tool_name_from_args(
    value: &Value,
    allowed_tool_names: &HashSet<String>,
) -> Option<String> {
    let obj = value.as_object()?;
    if obj.is_empty() || obj.contains_key("args") {
        return None;
    }
    let path = obj.get("path").and_then(Value::as_str).unwrap_or("");
    if path.starts_with("/tools/") {
        return None;
    }
    let has_path = obj.contains_key("path");
    let has_pattern = obj.contains_key("pattern");
    let has_command = obj.contains_key("command");
    if has_command && !has_pattern {
        return repair_tool_name("exec_command", allowed_tool_names);
    }
    if has_path && has_pattern {
        return repair_tool_name("grep", allowed_tool_names)
            .or_else(|| repair_tool_name("glob", allowed_tool_names));
    }
    if has_pattern {
        return repair_tool_name("glob", allowed_tool_names)
            .or_else(|| repair_tool_name("grep", allowed_tool_names));
    }
    None
}

pub(crate) fn leftover_is_planning_monologue(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return false;
    }
    const MARKERS: &[&str] = &[
        "Let's ",
        "Let us ",
        "Let me ",
        "I will ",
        "I'll ",
        "I need to ",
        "I should ",
        "The user ",
        "search for",
        "Searching ",
        "Looking at",
        "Looking for",
    ];
    MARKERS.iter().any(|marker| trimmed.contains(marker))
}

pub(crate) fn content_has_unmapped_trailing_tool_json(content: &str) -> bool {
    let Some((_, value)) = trailing_json_object(content) else {
        return false;
    };
    let Some(obj) = value.as_object() else {
        return false;
    };
    if obj.contains_key("args")
        || obj
            .get("path")
            .and_then(Value::as_str)
            .is_some_and(|path| path.starts_with("/tools/"))
    {
        return true;
    }
    (obj.contains_key("path") && obj.contains_key("pattern")) || obj.contains_key("command")
}

fn find_tool_calls_block(content: &str) -> Option<(usize, usize, &str)> {
    let mut search_from = 0;
    while let Some(open_rel) = content[search_from..].find('<') {
        let open = search_from + open_rel;
        let Some(tag) = parse_tag(content, open) else {
            search_from = open + 1;
            continue;
        };
        if tag.closing || canonical_tag_name(&tag.name) != "tool_calls" {
            search_from = tag.end;
            continue;
        }
        let mut close_from = tag.end;
        while let Some(close_rel) = content[close_from..].find("</") {
            let close = close_from + close_rel;
            let Some(close_tag) = parse_tag(content, close) else {
                close_from = close + 2;
                continue;
            };
            if close_tag.closing && canonical_tag_name(&close_tag.name) == "tool_calls" {
                return Some((open, close_tag.end, &content[tag.end..close]));
            }
            close_from = close_tag.end;
        }
        // Unclosed block: parse from the open tag to the end.
        return Some((open, content.len(), &content[tag.end..]));
    }
    None
}

fn parse_invoke_calls(inner: &str, allowed_tool_names: &HashSet<String>) -> Vec<ModelToolCall> {
    let mut calls = Vec::new();
    let mut search_from = 0;
    while let Some(open_rel) = inner[search_from..].find('<') {
        let open = search_from + open_rel;
        let Some(tag) = parse_tag(inner, open) else {
            search_from = open + 1;
            continue;
        };
        if tag.closing || canonical_tag_name(&tag.name) != "invoke" {
            search_from = tag.end;
            continue;
        }
        let raw_name = tag
            .attrs
            .get("name")
            .map(String::as_str)
            .unwrap_or("")
            .trim();
        let Some(name) = repair_tool_name(raw_name, allowed_tool_names) else {
            search_from = tag.end;
            continue;
        };
        let (body_end, body) = match find_matching_close(inner, tag.end, "invoke") {
            Some((end, body)) => (end, body),
            None => (inner.len(), &inner[tag.end..]),
        };
        let arguments = parse_parameters(body);
        calls.push(ModelToolCall {
            id: format!("tool-{}", Uuid::new_v4()),
            name,
            arguments,
        });
        search_from = body_end;
    }
    calls
}

fn find_matching_close<'a>(inner: &'a str, from: usize, name: &str) -> Option<(usize, &'a str)> {
    let mut search_from = from;
    while let Some(rel) = inner[search_from..].find("</") {
        let close = search_from + rel;
        let close_tag = parse_tag(inner, close)?;
        if close_tag.closing && canonical_tag_name(&close_tag.name) == name {
            return Some((close_tag.end, &inner[from..close]));
        }
        search_from = close_tag.end;
    }
    None
}

fn parse_parameters(body: &str) -> Value {
    let mut object = serde_json::Map::new();
    let mut search_from = 0;
    while let Some(open_rel) = body[search_from..].find('<') {
        let open = search_from + open_rel;
        let Some(tag) = parse_tag(body, open) else {
            search_from = open + 1;
            continue;
        };
        if tag.closing || canonical_tag_name(&tag.name) != "parameter" {
            search_from = tag.end;
            continue;
        }
        let key = tag
            .attrs
            .get("name")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let (body_end, value) = match find_matching_close(body, tag.end, "parameter") {
            Some((end, inner)) => (end, unescape_xml(inner.trim())),
            None => (body.len(), unescape_xml(body[tag.end..].trim())),
        };
        if let Some(key) = key {
            object.insert(key, json!(value));
        }
        search_from = body_end;
    }
    if object.is_empty() {
        let trimmed = body.trim();
        if trimmed.starts_with('{') {
            if let Ok(Value::Object(parsed)) = serde_json::from_str(trimmed) {
                return Value::Object(parsed);
            }
        }
        return json!({});
    }
    Value::Object(object)
}

fn canonical_tag_name(name: &str) -> &str {
    let trimmed = name.trim();
    for prefix in DSML_PREFIXES {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            return rest;
        }
    }
    trimmed
}

struct ParsedTag {
    end: usize,
    name: String,
    closing: bool,
    attrs: HashMap<String, String>,
}

fn parse_tag(source: &str, at: usize) -> Option<ParsedTag> {
    if !source[at..].starts_with('<') {
        return None;
    }
    let close = source[at + 1..].find('>')? + at + 1;
    let raw = source[at + 1..close].trim();
    if raw.is_empty() {
        return None;
    }
    let (raw, closing) = raw
        .strip_prefix('/')
        .map(|rest| (rest.trim(), true))
        .unwrap_or((raw, false));
    let raw = raw.strip_suffix('/').unwrap_or(raw).trim();
    let mut parts = raw.split_whitespace();
    let name = parts.next()?.to_string();
    let mut attrs = HashMap::new();
    let attr_src = raw[name.len()..].trim();
    let mut rest = attr_src;
    while !rest.is_empty() {
        let eq = match rest.find('=') {
            Some(index) => index,
            None => break,
        };
        let key = rest[..eq].trim();
        let after = rest[eq + 1..].trim_start();
        let (value, consumed) = parse_attr_value(after)?;
        if !key.is_empty() {
            attrs.insert(key.to_string(), value);
        }
        rest = after[consumed..].trim_start();
    }
    Some(ParsedTag {
        end: close + 1,
        name,
        closing,
        attrs,
    })
}

fn parse_attr_value(source: &str) -> Option<(String, usize)> {
    let quote = source.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let bytes = source.as_bytes();
    let mut index = 1;
    while index < bytes.len() {
        if bytes[index] == quote as u8 {
            let value = unescape_xml(&source[1..index]);
            return Some((value, index + 1));
        }
        index += 1;
    }
    None
}

fn unescape_xml(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(names: &[&str]) -> HashSet<String> {
        names.iter().map(|name| (*name).to_string()).collect()
    }

    #[test]
    fn extracts_xml_invoke_block() {
        let content = r#"好的，先看目录。

<tool_calls>
<invoke name="exec_command">
<parameter name="command">ls -la /tmp</parameter>
</invoke>
<invoke name="glob">
<parameter name="pattern">*</parameter>
<parameter name="path">/tmp</parameter>
</invoke>
</tool_calls>
"#;
        let (visible, calls) =
            extract_leaked_tool_calls(content, &allowed(&["exec_command", "glob"]));
        assert_eq!(visible.trim(), "好的，先看目录。");
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "exec_command");
        assert_eq!(calls[0].arguments["command"], "ls -la /tmp");
        assert_eq!(calls[1].name, "glob");
        assert_eq!(calls[1].arguments["path"], "/tmp");
    }

    #[test]
    fn extracts_dsml_special_token_block() {
        let content = r#"先看看结构和关键文件。

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="exec_command">
<｜｜DSML｜｜parameter name="command">ls -la /Users/petehsu/Documents/Lyra</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
<｜｜DSML｜｜invoke name="glob">
<｜｜DSML｜｜parameter name="pattern">*</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="path">/Users/petehsu/Documents/Lyra</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>
"#;
        let (visible, calls) =
            extract_leaked_tool_calls(content, &allowed(&["exec_command", "glob"]));
        assert_eq!(visible.trim(), "先看看结构和关键文件。");
        assert_eq!(calls.len(), 2);
        assert_eq!(
            calls[0].arguments["command"],
            "ls -la /Users/petehsu/Documents/Lyra"
        );
        assert_eq!(calls[1].arguments["pattern"], "*");
    }

    #[test]
    fn ignores_unknown_tool_names() {
        let content = r#"<tool_calls><invoke name="not_a_real_tool"><parameter name="x">1</parameter></invoke></tool_calls>"#;
        let (visible, calls) = extract_leaked_tool_calls(content, &allowed(&["exec_command"]));
        assert!(calls.is_empty());
        assert_eq!(visible, content);
    }

    #[test]
    fn leaves_ordinary_prose_alone() {
        let (visible, calls) =
            extract_leaked_tool_calls("这是一个较大的仓库。", &allowed(&["exec_command"]));
        assert!(calls.is_empty());
        assert_eq!(visible, "这是一个较大的仓库。");
    }

    #[test]
    fn extracts_trailing_path_pattern_json_as_grep() {
        let content = r#"Let's search for "description" in Cargo.toml.{"path":"~/Documents/Lyra/Cargo.toml","pattern":"description"}"#;
        let (visible, calls) = extract_leaked_tool_calls(content, &allowed(&["grep", "glob"]));
        assert_eq!(visible, r#"Let's search for "description" in Cargo.toml."#);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "grep");
        assert_eq!(calls[0].arguments["path"], "~/Documents/Lyra/Cargo.toml");
        assert_eq!(calls[0].arguments["pattern"], "description");
        assert!(leftover_is_planning_monologue(&visible));
    }

    #[test]
    fn extracts_trailing_command_json_as_exec_command() {
        let content = r#"I will list the workspace.{"command":"ls -la"}"#;
        let (visible, calls) = extract_leaked_tool_calls(content, &allowed(&["exec_command"]));
        assert_eq!(visible, "I will list the workspace.");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "exec_command");
        assert_eq!(calls[0].arguments["command"], "ls -la");
    }

    #[test]
    fn does_not_treat_tools_fs_json_as_grep() {
        let content = r#"{"path":"/tools/web/search","args":{"query":"Lyra"}}"#;
        let (visible, calls) = extract_leaked_tool_calls(content, &allowed(&["grep"]));
        assert!(calls.is_empty());
        assert_eq!(visible, content);
        assert!(content_has_unmapped_trailing_tool_json(content));
    }

    #[test]
    fn ordinary_json_object_is_not_a_tool_leak() {
        let content = r#"Here is the payload: {"hello":"world"}"#;
        let (visible, calls) = extract_leaked_tool_calls(content, &allowed(&["grep"]));
        assert!(calls.is_empty());
        assert_eq!(visible, content);
        assert!(!content_has_unmapped_trailing_tool_json(content));
    }
}
