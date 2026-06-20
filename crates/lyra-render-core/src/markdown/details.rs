use crate::ast::{InlineNode, LyraRenderDocument, RenderBlock};

use crate::markdown::parser::parse_markdown_plain;

pub fn parse_markdown_with_details(content: &str) -> LyraRenderDocument {
    let mut document = LyraRenderDocument::default();
    let mut cursor = 0usize;
    let bytes = content.as_bytes();

    while cursor < bytes.len() {
        let Some(open_rel) = find_ascii_ci(&content[cursor..], "<details") else {
            document
                .blocks
                .extend(parse_markdown_plain(&content[cursor..]).blocks);
            break;
        };
        let open = cursor + open_rel;
        if open > cursor {
            document
                .blocks
                .extend(parse_markdown_plain(&content[cursor..open]).blocks);
        }

        let Some(close_rel) = find_ascii_ci(&content[open..], "</details>") else {
            document
                .blocks
                .extend(parse_markdown_plain(&content[open..]).blocks);
            break;
        };
        let close = open + close_rel;
        let end = close + "</details>".len();
        let raw = &content[open..end];
        document.blocks.push(parse_details_block(raw));
        cursor = end;
    }

    document
}

fn parse_details_block(raw: &str) -> RenderBlock {
    let inner = strip_ascii_ci_prefix(raw, "<details")
        .and_then(|value| strip_ascii_ci_suffix(value.trim(), "</details>"))
        .unwrap_or_default()
        .trim()
        .to_string();

    let (summary_source, body_source) = extract_summary(&inner);
    let summary = inline_nodes_from_markdown(&summary_source);
    let children = parse_markdown_plain(&body_source).blocks;

    RenderBlock::Details { summary, children }
}

fn extract_summary(inner: &str) -> (String, String) {
    let open = find_ascii_ci(inner, "<summary").unwrap_or(0);
    let after_open = &inner[open..];
    let content_start = after_open
        .find('>')
        .map(|index| open + index + 1)
        .unwrap_or(inner.len());
    let after_content = &inner[content_start..];
    let close_rel = find_ascii_ci(after_content, "</summary>").unwrap_or(after_content.len());
    let summary = inner[content_start..content_start + close_rel]
        .trim()
        .to_string();
    let body_start = content_start + close_rel + "</summary>".len();
    let body = inner
        .get(body_start..)
        .unwrap_or_default()
        .trim()
        .to_string();
    (summary, body)
}

fn inline_nodes_from_markdown(content: &str) -> Vec<InlineNode> {
    if content.trim().is_empty() {
        return Vec::new();
    }
    let document = parse_markdown_plain(content);
    let mut nodes = Vec::new();
    for block in document.blocks {
        match block {
            RenderBlock::Paragraph { children } => nodes.extend(children),
            RenderBlock::Heading { children, .. } => nodes.extend(children),
            other => nodes.push(InlineNode::Text {
                value: block_plain_text(&other),
            }),
        }
    }
    nodes
}

fn block_plain_text(block: &RenderBlock) -> String {
    match block {
        RenderBlock::Paragraph { children } | RenderBlock::Heading { children, .. } => children
            .iter()
            .filter_map(|node| match node {
                InlineNode::Text { value } => Some(value.as_str()),
                InlineNode::Code { value } => Some(value.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join(""),
        RenderBlock::CodeBlock { source, .. } => source.clone(),
        _ => String::new(),
    }
}

fn find_ascii_ci(haystack: &str, needle: &str) -> Option<usize> {
    if needle.is_empty() {
        return None;
    }
    let h = haystack.as_bytes();
    let n = needle.as_bytes();
    if h.len() < n.len() {
        return None;
    }
    'outer: for index in 0..=h.len() - n.len() {
        for (offset, &byte) in n.iter().enumerate() {
            if h[index + offset].to_ascii_lowercase() != byte.to_ascii_lowercase() {
                continue 'outer;
            }
        }
        return Some(index);
    }
    None
}

fn strip_ascii_ci_prefix<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    let index = find_ascii_ci(value, prefix)?;
    let after = value[index..].find('>')? + index + 1;
    Some(value.get(after..)?)
}

fn strip_ascii_ci_suffix<'a>(value: &'a str, suffix: &str) -> Option<&'a str> {
    let index = find_ascii_ci(value, suffix)?;
    Some(value.get(..index)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::InlineNode;

    #[test]
    fn parses_details_block_with_markdown_body() {
        let input =
            "Intro\n\n<details>\n<summary>点击展开</summary>\n\n- one\n- two\n</details>\n\nDone";
        let doc = parse_markdown_with_details(input);
        let details = doc
            .blocks
            .iter()
            .find_map(|block| match block {
                RenderBlock::Details { summary, children } => Some((summary, children)),
                _ => None,
            })
            .expect("details block");
        assert!(matches!(
            &details.0[0],
            InlineNode::Text { value } if value == "点击展开"
        ));
        assert!(details
            .1
            .iter()
            .any(|block| matches!(block, RenderBlock::List { .. })));
    }
}
