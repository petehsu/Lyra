//! Scoring primitives for Readability-like main-content selection.

use ego_tree::NodeRef;
use scraper::Node;
use scraper::node::Element;

/// Substrings that boost an element's likelihood of being main content.
const POSITIVE_HINTS: &[&str] = &[
    "article", "body", "content", "entry", "main", "page", "post", "text", "blog", "story",
    "column", "markdown", "prose",
];

/// Substrings that reduce an element's likelihood of being main content.
const NEGATIVE_HINTS: &[&str] = &[
    "combx", "comment", "contact", "foot", "footer", "footnote", "masthead", "media", "meta",
    "outbrain", "promo", "related", "scroll", "share", "shoutbox", "sidebar", "sponsor",
    "shopping", "tags", "widget", "nav", "menu", "banner", "ad-", "-ad", "advert",
];

/// Per-element class/id hint score (positive minus negative).
pub fn hint_score(element: &Element) -> f32 {
    let mut haystack = String::new();
    if let Some(id) = element.id() {
        haystack.push_str(id);
        haystack.push(' ');
    }
    for class in element.classes() {
        haystack.push_str(class);
        haystack.push(' ');
    }
    let lower = haystack.to_ascii_lowercase();
    let mut score = 0.0;
    if POSITIVE_HINTS.iter().any(|hint| lower.contains(hint)) {
        score += 25.0;
    }
    if NEGATIVE_HINTS.iter().any(|hint| lower.contains(hint)) {
        score -= 25.0;
    }
    score
}

/// Base score by tag name.
pub fn tag_base_score(tag: &str) -> f32 {
    match tag {
        "article" | "main" => 30.0,
        "section" => 12.0,
        "div" => 5.0,
        "pre" | "td" | "blockquote" => 3.0,
        "address" | "form" => -3.0,
        "ol" | "ul" | "dl" | "dd" | "dt" | "li" => -3.0,
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "th" => -5.0,
        _ => 0.0,
    }
}

/// Total text length within a subtree (whitespace-collapsed character count).
pub fn text_len(node: NodeRef<'_, Node>) -> usize {
    let mut len = 0usize;
    for descendant in node.descendants() {
        if let Node::Text(text) = descendant.value() {
            len += text.split_whitespace().map(str::len).sum::<usize>();
            // Account for inter-word spaces roughly.
            len += text.split_whitespace().count().saturating_sub(1);
        }
    }
    len
}

/// Length of text that sits inside `<a>` anchors within a subtree.
pub fn link_text_len(node: NodeRef<'_, Node>) -> usize {
    let mut len = 0usize;
    for descendant in node.descendants() {
        if descendant
            .value()
            .as_element()
            .is_some_and(|el| el.name() == "a")
        {
            len += text_len(descendant);
        }
    }
    len
}

/// Ratio of anchor text to total text in `[0, 1]`.
pub fn link_density(node: NodeRef<'_, Node>) -> f32 {
    let total = text_len(node);
    if total == 0 {
        return 0.0;
    }
    (link_text_len(node) as f32 / total as f32).clamp(0.0, 1.0)
}

/// Number of `<p>` descendants — a strong content signal.
#[allow(dead_code)]
pub fn paragraph_count(node: NodeRef<'_, Node>) -> usize {
    node.descendants()
        .filter(|n| n.value().as_element().is_some_and(|el| el.name() == "p"))
        .count()
}

/// Count commas in the subtree text (proxy for prose density).
pub fn comma_count(node: NodeRef<'_, Node>) -> usize {
    let mut count = 0usize;
    for descendant in node.descendants() {
        if let Node::Text(text) = descendant.value() {
            count += text.matches(',').count();
            count += text.matches('，').count();
        }
    }
    count
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use scraper::Html;
    use scraper::selector::Selector;

    fn root(html: &str, css: &str) -> Html {
        let _ = css;
        Html::parse_fragment(html)
    }

    fn first<'a>(doc: &'a Html, css: &str) -> NodeRef<'a, Node> {
        let selector = Selector::parse(css).unwrap();
        *doc.select(&selector).next().unwrap()
    }

    #[test]
    fn link_density_high_for_link_list() {
        let doc = root(
            "<div><a href=\"#\">one</a> <a href=\"#\">two</a> <a href=\"#\">three</a></div>",
            "div",
        );
        let node = first(&doc, "div");
        assert!(link_density(node) > 0.8);
    }

    #[test]
    fn link_density_low_for_prose() {
        let doc = root(
            "<div>This is a long paragraph of prose with one <a href=\"#\">link</a> inside it and lots of other words around the link to dilute density.</div>",
            "div",
        );
        let node = first(&doc, "div");
        assert!(link_density(node) < 0.3);
    }

    #[test]
    fn hint_scores() {
        let doc = root("<div class=\"article-content\">x</div>", "div");
        let node = first(&doc, "div");
        let element = node.value().as_element().unwrap();
        assert!(hint_score(element) > 0.0);

        let doc2 = root("<div class=\"sidebar-widget\">x</div>", "div");
        let node2 = first(&doc2, "div");
        let element2 = node2.value().as_element().unwrap();
        assert!(hint_score(element2) < 0.0);
    }
}
