//! Readability-like main-content node selection.
//!
//! Approach (a pragmatic subset of Mozilla Readability): score candidate
//! container nodes from the text and paragraph density of their content, add
//! class/id and tag hints, penalize link density, and propagate paragraph
//! scores up to parents/grandparents. The highest-scoring container becomes the
//! main content root.

use std::collections::HashMap;

use ego_tree::{NodeId, NodeRef};
use scraper::Node;

use super::score;
use crate::html::clean::CleanPlan;
use crate::html::parse::ParsedHtml;
use crate::types::ReaderExtractorCandidateDebug;

/// The selected main-content node and a confidence in `[0, 1]`.
pub struct MainContent {
    /// Id of the chosen container node.
    pub node_id: NodeId,
    /// Confidence in the selection.
    pub confidence: f32,
}

/// Main-content selection plus optional redacted candidate debug data.
pub struct ReadabilitySelection {
    /// Selected main content, when a candidate was found.
    pub main: Option<MainContent>,
    /// Redacted candidate score summaries.
    pub candidates: Vec<ReaderExtractorCandidateDebug>,
}

/// Select the main content container, or `None` if nothing scores well.
#[cfg(test)]
pub fn select(parsed: &ParsedHtml, plan: &CleanPlan) -> Option<MainContent> {
    select_with_debug(parsed, plan, false).main
}

/// Select the main content container and optionally collect score debug data.
pub fn select_with_debug(
    parsed: &ParsedHtml,
    plan: &CleanPlan,
    include_debug: bool,
) -> ReadabilitySelection {
    // Prefer an explicit <article> or <main> when present and substantial.
    if let Some(explicit) = explicit_main(parsed, plan) {
        let candidates = if include_debug {
            parsed
                .document
                .tree
                .get(explicit.node_id)
                .and_then(|node| candidate_debug(node, 1, explicit.confidence, true))
                .into_iter()
                .collect()
        } else {
            Vec::new()
        };
        return ReadabilitySelection {
            main: Some(explicit),
            candidates,
        };
    }

    let mut scores: HashMap<NodeId, f32> = HashMap::new();
    for node in parsed.document.tree.nodes() {
        if plan.is_excluded(node.id()) {
            continue;
        }
        let Some(element) = node.value().as_element() else {
            continue;
        };
        if element.name() != "p" {
            continue;
        }
        let len = score::text_len(node);
        if len < 25 {
            continue;
        }
        // Base contribution: one point + length bonus + comma bonus.
        let contribution = 1.0 + (len as f32 / 100.0).min(3.0) + score::comma_count(node) as f32;
        add_score(&mut scores, node.parent(), contribution);
        add_score(
            &mut scores,
            node.parent().and_then(|p| p.parent()),
            contribution / 2.0,
        );
    }

    if scores.is_empty() {
        return ReadabilitySelection {
            main: None,
            candidates: Vec::new(),
        };
    }

    // Apply container-level adjustments (hints, tag base, link density).
    let mut best: Option<(NodeId, f32)> = None;
    let mut adjusted_scores: Vec<(NodeId, f32)> = Vec::new();
    for (id, base) in &scores {
        let Some(node) = parsed.document.tree.get(*id) else {
            continue;
        };
        let Some(element) = node.value().as_element() else {
            continue;
        };
        let mut value = *base;
        value += score::tag_base_score(element.name());
        value += score::hint_score(element);
        value *= 1.0 - score::link_density(node);
        adjusted_scores.push((*id, value));
        if best
            .as_ref()
            .is_none_or(|(_, best_value)| value > *best_value)
        {
            best = Some((*id, value));
        }
    }

    let Some((node_id, top)) = best else {
        return ReadabilitySelection {
            main: None,
            candidates: Vec::new(),
        };
    };
    let confidence = confidence_for(parsed, plan, node_id, top);
    let candidates = if include_debug {
        adjusted_scores.sort_by(|(_, left), (_, right)| {
            right.partial_cmp(left).unwrap_or(std::cmp::Ordering::Equal)
        });
        adjusted_scores
            .into_iter()
            .take(8)
            .enumerate()
            .filter_map(|(index, (id, value))| {
                parsed
                    .document
                    .tree
                    .get(id)
                    .and_then(|node| candidate_debug(node, index + 1, value, id == node_id))
            })
            .collect()
    } else {
        Vec::new()
    };
    ReadabilitySelection {
        main: Some(MainContent {
            node_id,
            confidence,
        }),
        candidates,
    }
}

fn explicit_main(parsed: &ParsedHtml, plan: &CleanPlan) -> Option<MainContent> {
    let mut best: Option<(NodeId, usize)> = None;
    for node in parsed.document.tree.nodes() {
        if plan.is_excluded(node.id()) {
            continue;
        }
        let Some(element) = node.value().as_element() else {
            continue;
        };
        if !matches!(element.name(), "article" | "main") {
            continue;
        }
        let len = score::text_len(node);
        if len < 140 {
            continue;
        }
        if best.as_ref().is_none_or(|(_, best_len)| len > *best_len) {
            best = Some((node.id(), len));
        }
    }
    best.map(|(node_id, _)| MainContent {
        node_id,
        confidence: 0.85,
    })
}

fn add_score(scores: &mut HashMap<NodeId, f32>, node: Option<NodeRef<'_, Node>>, value: f32) {
    if let Some(node) = node {
        if node.value().as_element().is_some() {
            *scores.entry(node.id()).or_insert(0.0) += value;
        }
    }
}

/// Derive a confidence in `[0, 1]` from the winning score and content share.
fn confidence_for(parsed: &ParsedHtml, plan: &CleanPlan, node_id: NodeId, top_score: f32) -> f32 {
    let Some(node) = parsed.document.tree.get(node_id) else {
        return 0.0;
    };
    let main_len = score::text_len(node) as f32;
    let body_len = body_text_len(parsed, plan).max(1.0);
    let share = (main_len / body_len).clamp(0.0, 1.0);
    let score_factor = (top_score / 60.0).clamp(0.0, 1.0);
    // Weighted blend: how much of the page it captured + how strongly it scored.
    (0.6 * share + 0.4 * score_factor).clamp(0.0, 1.0)
}

fn body_text_len(parsed: &ParsedHtml, plan: &CleanPlan) -> f32 {
    parsed
        .document
        .tree
        .nodes()
        .find(|node| {
            !plan.is_excluded(node.id())
                && node
                    .value()
                    .as_element()
                    .is_some_and(|el| el.name() == "body")
        })
        .map(|body| score::text_len(body) as f32)
        .unwrap_or_else(|| score::text_len(parsed.document.tree.root()) as f32)
}

fn candidate_debug(
    node: NodeRef<'_, Node>,
    rank: usize,
    value: f32,
    selected: bool,
) -> Option<ReaderExtractorCandidateDebug> {
    let element = node.value().as_element()?;
    Some(ReaderExtractorCandidateDebug {
        rank,
        tag_name: element.name().to_string(),
        id: element.id().map(str::to_string),
        classes: element.classes().take(6).map(str::to_string).collect(),
        score: value,
        text_len: score::text_len(node),
        link_density: score::link_density(node),
        selected,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::html::clean::plan;
    use crate::html::parse::parse_str;

    #[test]
    fn picks_article_over_nav() {
        let html = r##"<html><body>
            <nav><a href="#">a</a><a href="#">b</a><a href="#">c</a></nav>
            <div class="article-content">
                <p>This is a substantial paragraph of real article content, long enough to score well, with several commas, clauses, and words.</p>
                <p>A second paragraph that further increases the content score for this container, again with commas and prose.</p>
            </div>
            <footer>footer links</footer>
        </body></html>"##;
        let parsed = parse_str(html);
        // Chrome NOT dropped so readability must score it out itself.
        let clean = plan(&parsed, None, false);
        let main = select(&parsed, &clean).expect("main content");
        let node = parsed.document.tree.get(main.node_id).unwrap();
        let element = node.value().as_element().unwrap();
        let id_class: String = element.classes().collect::<Vec<_>>().join(" ");
        assert!(id_class.contains("article"), "got {id_class:?}");
        assert!(main.confidence > 0.3);
    }

    #[test]
    fn prefers_explicit_article_tag() {
        let html = r#"<html><body>
            <article><p>Article body paragraph one with enough length to count as substantial content here.</p>
            <p>Article body paragraph two with more substantial prose, commas, and clauses to score.</p></article>
        </body></html>"#;
        let parsed = parse_str(html);
        let clean = plan(&parsed, None, false);
        let main = select(&parsed, &clean).expect("main");
        let node = parsed.document.tree.get(main.node_id).unwrap();
        assert_eq!(node.value().as_element().unwrap().name(), "article");
    }

    #[test]
    fn returns_none_for_no_content() {
        let html = "<html><body><nav><a href=\"#\">x</a></nav></body></html>";
        let parsed = parse_str(html);
        let clean = plan(&parsed, None, false);
        assert!(select(&parsed, &clean).is_none());
    }
}
