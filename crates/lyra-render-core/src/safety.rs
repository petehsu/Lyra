use crate::ast::InlineNode;
use crate::link::normalize_link_href;

const BLOCKED_SCHEMES: &[&str] = &["javascript:", "vbscript:", "file:", "data:"];

const ALLOWED_DATA_IMAGE_PREFIXES: &[&str] = &[
    "data:image/gif;",
    "data:image/png;",
    "data:image/jpeg;",
    "data:image/webp;",
];

/// Returns true when a URL is safe to use as a clickable link target.
///
/// Rules mirror markdown-it `validateLink`: block dangerous schemes, allow only
/// whitelisted `data:image/*` payloads when `data:` is used.
pub fn is_safe_link_url(url: &str) -> bool {
    is_safe_url(url)
}

/// Returns true when a URL is safe to use as an image source.
pub fn is_safe_image_src(src: &str) -> bool {
    is_safe_url(src)
}

pub fn sanitize_link_href(href: &str) -> Option<String> {
    let normalized = normalize_link_href(href);
    if is_safe_link_url(&normalized) {
        Some(normalized)
    } else {
        None
    }
}

pub fn sanitize_image_src(src: &str) -> Option<String> {
    let normalized = normalize_link_href(src);
    if is_safe_image_src(&normalized) {
        Some(normalized)
    } else {
        None
    }
}

pub fn flatten_inline_to_plain_text(nodes: &[InlineNode]) -> String {
    let mut parts = Vec::new();
    flatten_inline_to_plain_text_inner(nodes, &mut parts);
    parts.join("")
}

pub fn link_fallback_text(children: &[InlineNode]) -> String {
    let flattened = flatten_inline_to_plain_text(children);
    if flattened.is_empty() {
        return String::new();
    }
    flattened
}

pub fn image_fallback_text(alt: &str) -> String {
    let trimmed = alt.trim();
    if trimmed.is_empty() {
        "[image]".to_string()
    } else {
        format!("[{trimmed}]")
    }
}

fn flatten_inline_to_plain_text_inner(nodes: &[InlineNode], parts: &mut Vec<String>) {
    for node in nodes {
        match node {
            InlineNode::Text { value } | InlineNode::Code { value } => {
                parts.push(value.clone());
            }
            InlineNode::Strong { children }
            | InlineNode::Emphasis { children }
            | InlineNode::Strikethrough { children }
            | InlineNode::Link { children, .. } => {
                flatten_inline_to_plain_text_inner(children, parts);
            }
            InlineNode::Image { alt, .. } => {
                parts.push(image_fallback_text(alt));
            }
            InlineNode::MathInline { latex, .. } => {
                parts.push(format!("${latex}$"));
            }
            InlineNode::SoftBreak | InlineNode::HardBreak => {
                parts.push(" ".to_string());
            }
        }
    }
}

fn is_safe_url(url: &str) -> bool {
    let normalized = url.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    if matches_blocked_scheme(&normalized) {
        return matches_allowed_data_image(&normalized);
    }
    true
}

fn matches_blocked_scheme(normalized: &str) -> bool {
    BLOCKED_SCHEMES
        .iter()
        .any(|scheme| normalized.starts_with(scheme))
}

fn matches_allowed_data_image(normalized: &str) -> bool {
    ALLOWED_DATA_IMAGE_PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_javascript_links() {
        assert!(!is_safe_link_url("javascript:alert(1)"));
        assert!(!is_safe_link_url("JavaScript:alert(1)"));
    }

    #[test]
    fn blocks_file_and_vbscript_links() {
        assert!(!is_safe_link_url("file:///etc/passwd"));
        assert!(!is_safe_link_url("vbscript:msgbox(1)"));
    }

    #[test]
    fn blocks_unsafe_data_urls() {
        assert!(!is_safe_link_url(
            "data:text/html,<script>alert(1)</script>"
        ));
    }

    #[test]
    fn allows_safe_http_and_relative_links() {
        assert!(is_safe_link_url("https://example.com"));
        assert!(is_safe_link_url("/tmp/readme.md"));
        assert!(is_safe_link_url("#section"));
        assert!(is_safe_link_url("mailto:user@example.com"));
    }

    #[test]
    fn allows_whitelisted_data_image_urls() {
        assert!(is_safe_image_src(
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
        ));
        assert!(is_safe_image_src("data:image/webp;base64,AAAA"));
    }

    #[test]
    fn flattens_nested_link_children() {
        let nodes = vec![InlineNode::Strong {
            children: vec![
                InlineNode::Text {
                    value: "click".to_string(),
                },
                InlineNode::Code {
                    value: " me".to_string(),
                },
            ],
        }];
        assert_eq!(flatten_inline_to_plain_text(&nodes), "click me");
    }
}
