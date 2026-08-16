use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};
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
    (remaining, recovered)
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
}
