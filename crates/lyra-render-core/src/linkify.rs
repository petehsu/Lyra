use once_cell::sync::Lazy;
use regex::Regex;

use crate::ast::InlineNode;
use crate::link::{normalize_link_display_text, normalize_link_href};
use crate::safety::is_safe_link_url;

static LINKIFY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)(?:https?://|ftp://|mailto:|//|www\.)[^\s<>\[\](){}"']+"#)
        .expect("valid linkify regex")
});

/// Split plain text into text/link inline nodes (markdown-it `linkify` core rule).
pub fn linkify_text(value: &str) -> Vec<InlineNode> {
    if !LINKIFY_RE.is_match(value) {
        return vec![InlineNode::Text {
            value: value.to_string(),
        }];
    }

    let mut nodes = Vec::new();
    let mut last = 0usize;

    for capture in LINKIFY_RE.find_iter(value) {
        let start = capture.start();
        let end = capture.end();
        if start > last {
            nodes.push(InlineNode::Text {
                value: value[last..start].to_string(),
            });
        }
        let raw_match = trim_trailing_url_punctuation(&value[start..end]);
        if let Some(link) = link_node_from_match(raw_match) {
            nodes.push(link);
        } else {
            nodes.push(InlineNode::Text {
                value: raw_match.to_string(),
            });
        }
        last = start + raw_match.len();
    }

    if last < value.len() {
        nodes.push(InlineNode::Text {
            value: value[last..].to_string(),
        });
    }

    if nodes.is_empty() {
        vec![InlineNode::Text {
            value: value.to_string(),
        }]
    } else {
        nodes
    }
}

fn link_node_from_match(raw: &str) -> Option<InlineNode> {
    let href = linkify_href(raw);
    let normalized_href = normalize_link_href(&href);
    if !is_safe_link_url(&normalized_href) {
        return None;
    }
    let display_source = linkify_display_text(raw, &href);
    let display = normalize_link_display_text(&display_source);
    Some(InlineNode::Link {
        href: normalized_href,
        title: None,
        children: vec![InlineNode::Text { value: display }],
    })
}

fn linkify_href(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("ftp://")
        || lower.starts_with("mailto:")
        || lower.starts_with("//")
    {
        return raw.to_string();
    }
    format!("http://{raw}")
}

fn linkify_display_text(raw: &str, href: &str) -> String {
    if href.starts_with("http://") && !raw.to_ascii_lowercase().starts_with("http") {
        href.strip_prefix("http://").unwrap_or(raw).to_string()
    } else {
        raw.to_string()
    }
}

fn trim_trailing_url_punctuation(url: &str) -> &str {
    let mut end = url.len();
    while end > 0 {
        let ch = url[..end].chars().last().unwrap();
        match ch {
            '.' | ',' | ';' | '!' | '?' => {
                end -= ch.len_utf8();
            }
            ':' => {
                let prefix = &url[..end];
                if prefix.to_ascii_lowercase().starts_with("mailto:")
                    && prefix.matches('@').count() <= 1
                {
                    break;
                }
                end -= ch.len_utf8();
            }
            ')' => {
                let open = url[..end].chars().filter(|&c| c == '(').count();
                let close = url[..end].chars().filter(|&c| c == ')').count();
                if close > open {
                    end -= ch.len_utf8();
                    continue;
                }
                break;
            }
            _ => break,
        }
    }
    &url[..end]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ast::InlineNode;

    #[test]
    fn linkifies_https_url_in_plain_text() {
        let nodes = linkify_text("Visit https://example.com/path today.");
        assert!(nodes.iter().any(|node| matches!(
            node,
            InlineNode::Link { href, .. } if href == "https://example.com/path"
        )));
    }

    #[test]
    fn prepends_http_for_www_urls() {
        let nodes = linkify_text("See www.example.com for docs.");
        let link = nodes
            .iter()
            .find_map(|node| match node {
                InlineNode::Link { href, .. } => Some(href.clone()),
                _ => None,
            })
            .expect("link");
        assert_eq!(link, "http://www.example.com");
    }

    #[test]
    fn trims_trailing_punctuation_from_detected_url() {
        let nodes = linkify_text("Go to https://example.com.");
        let link = nodes
            .iter()
            .find_map(|node| match node {
                InlineNode::Link { href, .. } => Some(href.clone()),
                _ => None,
            })
            .expect("link");
        assert_eq!(link, "https://example.com");
    }

    #[test]
    fn skips_unsafe_linkified_urls() {
        let nodes = linkify_text("bad javascript:alert(1) tail");
        assert!(nodes
            .iter()
            .all(|node| !matches!(node, InlineNode::Link { .. })));
    }
}
