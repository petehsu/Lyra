//! Citation numbering and reference-footer assembly.
//!
//! Citation numbers are assigned during rendering (so markers land in the exact
//! text position); this module owns the shared numbering state and renders the
//! `## References` / `## Images` / `## Media` footers.

use std::collections::HashMap;

use crate::markdown::CapturedLink;
use crate::types::{
    CitationFormat, ImageRetention, LinkRetention, MediaRetention, ReaderImage, ReaderMedia,
};

/// Assigns stable `[n]` numbers to URLs in first-seen order.
#[derive(Default)]
pub struct CitationState {
    order: Vec<String>,
    index: HashMap<String, usize>,
}

impl CitationState {
    /// Get or assign the 1-based citation number for `url`.
    pub fn number_for(&mut self, url: &str) -> usize {
        let key = normalize(url);
        if let Some(existing) = self.index.get(&key) {
            return *existing;
        }
        self.order.push(url.to_string());
        let number = self.order.len();
        self.index.insert(key, number);
        number
    }

    /// Whether any citations were assigned.
    pub fn is_empty(&self) -> bool {
        self.order.is_empty()
    }

    /// The ordered list of cited URLs.
    pub fn urls(&self) -> &[String] {
        &self.order
    }
}

/// Normalize a URL for dedup: strip a trailing slash and lowercase the scheme+host.
fn normalize(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    trimmed.to_string()
}

/// Build a `## References` footer from cited URLs and captured link metadata.
///
/// Links to the same URL collapse to one entry; differing anchor texts are kept
/// as aliases.
pub fn references_footer(
    state: &CitationState,
    links: &[CapturedLink],
    format: CitationFormat,
) -> Option<String> {
    if state.is_empty() {
        return None;
    }
    let mut aliases: HashMap<String, Vec<String>> = HashMap::new();
    for link in links {
        let text = link.text.trim();
        if text.is_empty() {
            continue;
        }
        aliases
            .entry(normalize(&link.url))
            .or_default()
            .push(text.to_string());
    }

    let mut out = String::from("## References\n");
    for (position, url) in state.urls().iter().enumerate() {
        let number = position + 1;
        let marker = citation_marker(number, format);
        let alias = aliases
            .get(&normalize(url))
            .and_then(|texts| dominant_alias(texts));
        match alias {
            Some(text) => out.push_str(&format!("{marker} {text} — {url}\n")),
            None => out.push_str(&format!("{marker} {url}\n")),
        }
    }
    Some(out)
}

/// Render a citation marker in the selected public format.
pub fn citation_marker(number: usize, format: CitationFormat) -> String {
    match format {
        CitationFormat::Square => format!("[{number}]"),
        CitationFormat::Angle => format!("⟨{number}⟩"),
        CitationFormat::Source => format!("【{number}†source】"),
    }
}

/// Pick the most common alias text for a URL.
fn dominant_alias(texts: &[String]) -> Option<String> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for text in texts {
        *counts.entry(text.as_str()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(text, _)| text.to_string())
}

/// Build an `## Images` footer when images are retained as a summary.
pub fn images_footer(images: &[ReaderImage], retention: ImageRetention) -> Option<String> {
    if retention == ImageRetention::None || images.is_empty() {
        return None;
    }
    let mut seen = std::collections::HashSet::new();
    let mut lines = Vec::new();
    for image in images {
        let key = normalize(&image.url);
        if !seen.insert(key) {
            continue;
        }
        let alt = image.alt.as_deref().unwrap_or("").trim();
        if alt.is_empty() {
            lines.push(format!("- {}", image.url));
        } else {
            lines.push(format!("- {alt} — {}", image.url));
        }
    }
    if lines.is_empty() {
        return None;
    }
    Some(format!("## Images\n{}\n", lines.join("\n")))
}

/// Build a `## Media` footer when media embeds are retained as a summary.
pub fn media_footer(media: &[ReaderMedia], retention: MediaRetention) -> Option<String> {
    if retention != MediaRetention::Summary || media.is_empty() {
        return None;
    }
    let mut seen = std::collections::HashSet::new();
    let mut lines = Vec::new();
    for item in media {
        let Some(url) = item.url.as_deref() else {
            continue;
        };
        let key = normalize(url);
        if !seen.insert(key) {
            continue;
        }
        let label = item
            .title
            .as_deref()
            .or(item.text.as_deref())
            .unwrap_or(&item.kind)
            .trim();
        if label.is_empty() {
            lines.push(format!("- {url}"));
        } else {
            lines.push(format!("- {label} — {url}"));
        }
    }
    if lines.is_empty() {
        return None;
    }
    Some(format!("## Media\n{}\n", lines.join("\n")))
}

/// Whether the given link retention mode requests citation markers.
pub fn wants_citations(retention: LinkRetention, citations_enabled: bool) -> bool {
    matches!(retention, LinkRetention::Citations | LinkRetention::Summary)
        || (citations_enabled && retention == LinkRetention::All)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn link(url: &str, text: &str) -> CapturedLink {
        CapturedLink {
            url: url.to_string(),
            text: text.to_string(),
            title: None,
            rel: None,
            section: None,
            dom_path: None,
            source_offset: None,
        }
    }

    #[test]
    fn assigns_stable_numbers() {
        let mut state = CitationState::default();
        assert_eq!(state.number_for("https://a.test"), 1);
        assert_eq!(state.number_for("https://b.test"), 2);
        assert_eq!(state.number_for("https://a.test/"), 1); // dedup w/ trailing slash
    }

    #[test]
    fn footer_dedups_and_aliases() {
        let mut state = CitationState::default();
        state.number_for("https://a.test");
        state.number_for("https://b.test");
        let links = vec![
            link("https://a.test", "Alpha"),
            link("https://a.test/", "Alpha"),
            link("https://b.test", "Beta"),
        ];
        let footer = references_footer(&state, &links, CitationFormat::Square).expect("footer");
        assert!(footer.contains("[1] Alpha — https://a.test"));
        assert!(footer.contains("[2] Beta — https://b.test"));
        // Only two reference lines.
        assert_eq!(footer.matches('\n').count(), 3); // header + 2 lines
    }

    #[test]
    fn empty_state_no_footer() {
        let state = CitationState::default();
        assert!(references_footer(&state, &[], CitationFormat::Square).is_none());
    }
}
