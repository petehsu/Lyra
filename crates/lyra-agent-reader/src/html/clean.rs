//! HTML noise removal and URL normalization.
//!
//! Rather than mutating the (read-mostly) scraper DOM in place, cleaning
//! produces a [`CleanPlan`]: a set of node ids to skip and the resolved base
//! URL. Downstream extraction and rendering consult the plan and walk only the
//! retained nodes.

use std::collections::HashSet;

use ego_tree::NodeId;
use scraper::selector::Selector;
use url::Url;

use crate::errors::ReaderError;
use crate::html::parse::ParsedHtml;
use crate::types::{ReaderCleaningDebug, ReaderSelectorRemovalDebug};

/// Tags whose entire subtree is dropped as non-content noise.
const DROP_TAGS: &[&str] = &[
    "script", "style", "noscript", "template", "svg", "canvas", "form", "button", "input",
    "select", "textarea",
];

/// Tags that are structural noise (nav chrome) and dropped by default.
const CHROME_TAGS: &[&str] = &["nav", "header", "footer", "aside"];

/// Substrings in class/id that strongly indicate non-content blocks.
const NEGATIVE_HINTS: &[&str] = &[
    "nav",
    "menu",
    "sidebar",
    "footer",
    "header",
    "breadcrumb",
    "advert",
    "ads",
    "ad-",
    "-ad",
    "promo",
    "banner",
    "cookie",
    "consent",
    "newsletter",
    "subscribe",
    "social",
    "share",
    "comment",
    "related",
    "recommend",
    "popup",
    "modal",
    "skip-link",
    "pagination",
];

/// The outcome of cleaning: which nodes to skip and the resolved base URL.
pub struct CleanPlan {
    /// Node ids to skip during extraction/rendering (subtree-excluded).
    pub excluded: HashSet<NodeId>,
    /// Base URL for resolving relative links, if any.
    pub base: Option<Url>,
    /// Redacted cleaning statistics for optional debug traces.
    pub debug: ReaderCleaningDebug,
}

impl CleanPlan {
    /// Whether `id` (or an ancestor) was excluded.
    pub fn is_excluded(&self, id: NodeId) -> bool {
        self.excluded.contains(&id)
    }
}

/// Build a [`CleanPlan`] from a parsed document and optional base URL.
///
/// `drop_chrome` controls whether nav/header/footer/aside are removed; the
/// readability extractor disables it so it can score those regions itself.
#[cfg(test)]
#[allow(clippy::expect_used)]
pub fn plan(parsed: &ParsedHtml, base_url: Option<&str>, drop_chrome: bool) -> CleanPlan {
    plan_with_removals(parsed, base_url, drop_chrome, &[]).expect("empty selector list is valid")
}

/// Build a [`CleanPlan`] with additional caller-supplied removal selectors.
#[allow(dead_code)]
pub fn plan_with_removals(
    parsed: &ParsedHtml,
    base_url: Option<&str>,
    drop_chrome: bool,
    remove_selectors: &[String],
) -> Result<CleanPlan, ReaderError> {
    plan_with_filters(parsed, base_url, drop_chrome, remove_selectors, &[], &[])
}

/// Build a [`CleanPlan`] with selector removals plus include/exclude tag filters.
pub fn plan_with_filters(
    parsed: &ParsedHtml,
    base_url: Option<&str>,
    drop_chrome: bool,
    remove_selectors: &[String],
    include_tags: &[String],
    exclude_tags: &[String],
) -> Result<CleanPlan, ReaderError> {
    let base = resolve_base(parsed, base_url);
    let mut excluded = HashSet::new();
    let mut default_removed = 0usize;
    let include_tags = normalized_tag_set(include_tags);
    let exclude_tags = normalized_tag_set(exclude_tags);

    for node in parsed.document.tree.nodes() {
        let Some(element) = node.value().as_element() else {
            continue;
        };
        let tag = element.name();
        if DROP_TAGS.contains(&tag)
            || exclude_tags.contains(tag)
            || should_exclude_by_include_filter(&node, &include_tags)
            || (drop_chrome && CHROME_TAGS.contains(&tag))
            || is_hidden(element)
            || (drop_chrome && has_negative_hint(element))
        {
            if excluded.insert(node.id()) {
                default_removed += 1;
            }
        }
    }

    let mut caller_selector_removed = 0usize;
    let mut caller_selector_matched = 0usize;
    let mut remove_selector_debug = Vec::new();
    for raw_selector in remove_selectors {
        let selector = Selector::parse(raw_selector)
            .map_err(|error| ReaderError::Parse(format!("invalid selector: {error}")))?;
        let mut matched_nodes = 0usize;
        let mut newly_excluded_nodes = 0usize;
        for element in parsed.document.select(&selector) {
            matched_nodes += 1;
            if excluded.insert(element.id()) {
                newly_excluded_nodes += 1;
            }
        }
        caller_selector_matched += matched_nodes;
        caller_selector_removed += newly_excluded_nodes;
        remove_selector_debug.push(ReaderSelectorRemovalDebug {
            selector: raw_selector.clone(),
            matched_nodes,
            newly_excluded_nodes,
        });
    }

    let removed_total = excluded.len();
    Ok(CleanPlan {
        excluded,
        base,
        debug: ReaderCleaningDebug {
            removed_total,
            default_removed,
            caller_selector_removed,
            caller_selector_matched,
            remove_selectors: remove_selector_debug,
        },
    })
}

fn normalized_tag_set(tags: &[String]) -> HashSet<String> {
    tags.iter()
        .map(|tag| tag.trim().trim_start_matches('<').trim_end_matches('>'))
        .filter(|tag| !tag.is_empty())
        .map(str::to_ascii_lowercase)
        .collect()
}

fn should_exclude_by_include_filter(
    node: &ego_tree::NodeRef<'_, scraper::node::Node>,
    include_tags: &HashSet<String>,
) -> bool {
    if include_tags.is_empty() {
        return false;
    }
    let Some(element) = node.value().as_element() else {
        return false;
    };
    let tag = element.name();
    if include_tags.contains(tag)
        || matches!(
            tag,
            "html" | "body" | "main" | "article" | "section" | "div"
        )
    {
        return false;
    }
    !node
        .descendants()
        .filter_map(|descendant| descendant.value().as_element())
        .any(|descendant| include_tags.contains(descendant.name()))
}

/// Resolve the effective base URL: an explicit `<base href>` overrides the
/// caller-supplied base.
fn resolve_base(parsed: &ParsedHtml, base_url: Option<&str>) -> Option<Url> {
    let caller_base = base_url.and_then(|value| Url::parse(value).ok());
    let base_selector = Selector::parse("base[href]").ok();
    let doc_base = base_selector.and_then(|selector| {
        parsed
            .document
            .select(&selector)
            .next()
            .and_then(|element| element.value().attr("href"))
            .and_then(|href| match &caller_base {
                Some(base) => base.join(href).ok(),
                None => Url::parse(href).ok(),
            })
    });
    doc_base.or(caller_base)
}

fn is_hidden(element: &scraper::node::Element) -> bool {
    if element.attr("hidden").is_some() {
        return true;
    }
    if element
        .attr("aria-hidden")
        .is_some_and(|value| value.eq_ignore_ascii_case("true"))
    {
        return true;
    }
    element.attr("style").is_some_and(|style| {
        let lower = style.to_ascii_lowercase();
        lower.contains("display:none")
            || lower.contains("display: none")
            || lower.contains("visibility:hidden")
            || lower.contains("visibility: hidden")
    })
}

fn has_negative_hint(element: &scraper::node::Element) -> bool {
    let mut haystack = String::new();
    if let Some(id) = element.id() {
        haystack.push_str(id);
        haystack.push(' ');
    }
    for class in element.classes() {
        haystack.push_str(class);
        haystack.push(' ');
    }
    if let Some(role) = element.attr("role") {
        if matches!(role, "navigation" | "banner" | "complementary" | "search") {
            return true;
        }
    }
    let lower = haystack.to_ascii_lowercase();
    NEGATIVE_HINTS.iter().any(|hint| lower.contains(hint))
}

/// Resolve a possibly-relative URL against the plan's base.
pub fn resolve_url(plan: &CleanPlan, raw: &str) -> String {
    let trimmed = raw.trim();
    match &plan.base {
        Some(base) => base
            .join(trimmed)
            .map(|url| url.to_string())
            .unwrap_or_else(|_| trimmed.to_string()),
        None => trimmed.to_string(),
    }
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::html::parse::parse_str;

    fn excluded_tags(html: &str, drop_chrome: bool) -> Vec<String> {
        let parsed = parse_str(html);
        let plan = plan(&parsed, Some("https://x.test/"), drop_chrome);
        parsed
            .document
            .tree
            .nodes()
            .filter(|node| plan.is_excluded(node.id()))
            .filter_map(|node| node.value().as_element().map(|el| el.name().to_string()))
            .collect()
    }

    #[test]
    fn drops_script_and_style() {
        let tags = excluded_tags(
            "<html><body><script>x</script><style>y</style><p>hi</p></body></html>",
            true,
        );
        assert!(tags.contains(&"script".to_string()));
        assert!(tags.contains(&"style".to_string()));
        assert!(!tags.contains(&"p".to_string()));
    }

    #[test]
    fn drops_chrome_when_requested() {
        let tags = excluded_tags(
            "<html><body><nav>n</nav><footer>f</footer><p>hi</p></body></html>",
            true,
        );
        assert!(tags.contains(&"nav".to_string()));
        assert!(tags.contains(&"footer".to_string()));
    }

    #[test]
    fn keeps_chrome_when_not_requested() {
        let tags = excluded_tags("<html><body><nav>n</nav><p>hi</p></body></html>", false);
        assert!(!tags.contains(&"nav".to_string()));
    }

    #[test]
    fn negative_class_hint_excluded() {
        let tags = excluded_tags(
            "<html><body><div class=\"cookie-banner\">x</div><p>hi</p></body></html>",
            true,
        );
        assert!(tags.contains(&"div".to_string()));
    }

    #[test]
    fn resolves_relative_url_against_base() {
        let parsed = parse_str("<html><head></head><body></body></html>");
        let plan = plan(&parsed, Some("https://x.test/docs/"), true);
        assert_eq!(resolve_url(&plan, "../img.png"), "https://x.test/img.png");
    }

    #[test]
    fn base_tag_overrides_caller_base() {
        let parsed =
            parse_str("<html><head><base href=\"https://cdn.test/a/\"></head><body></body></html>");
        let plan = plan(&parsed, Some("https://x.test/"), true);
        assert_eq!(resolve_url(&plan, "b.png"), "https://cdn.test/a/b.png");
    }
}
