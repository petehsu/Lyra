//! Metadata extraction from `<head>`, meta tags, and JSON-LD.

use scraper::selector::Selector;
use serde_json::Value;

use crate::html::clean::{CleanPlan, resolve_url};
use crate::html::parse::ParsedHtml;
use crate::types::ReaderMetadata;

/// Extract document metadata.
pub fn extract(parsed: &ParsedHtml, plan: &CleanPlan) -> ReaderMetadata {
    let mut meta = ReaderMetadata {
        title: extract_title(parsed),
        language: extract_language(parsed),
        ..ReaderMetadata::default()
    };

    collect_meta_tags(parsed, &mut meta);
    collect_link_tags(parsed, plan, &mut meta);
    collect_json_ld(parsed, &mut meta);
    backfill_from_og(&mut meta);

    meta
}

fn select<'a>(parsed: &'a ParsedHtml, css: &str) -> Vec<scraper::ElementRef<'a>> {
    match Selector::parse(css) {
        Ok(selector) => parsed.document.select(&selector).collect(),
        Err(_) => Vec::new(),
    }
}

fn extract_title(parsed: &ParsedHtml) -> Option<String> {
    let title = select(parsed, "title")
        .first()
        .map(|element| normalize(&element.text().collect::<String>()))?;
    (!title.is_empty()).then_some(title)
}

fn extract_language(parsed: &ParsedHtml) -> Option<String> {
    select(parsed, "html[lang]")
        .first()
        .and_then(|element| element.value().attr("lang"))
        .map(|lang| lang.trim().to_string())
        .filter(|lang| !lang.is_empty())
}

fn collect_meta_tags(parsed: &ParsedHtml, meta: &mut ReaderMetadata) {
    for element in select(parsed, "meta") {
        let value = element.value();
        let content = match value.attr("content") {
            Some(content) if !content.trim().is_empty() => content.trim().to_string(),
            _ => continue,
        };
        let key = value
            .attr("name")
            .or_else(|| value.attr("property"))
            .or_else(|| value.attr("itemprop"))
            .map(str::to_ascii_lowercase);
        let Some(key) = key else { continue };

        match key.as_str() {
            "description" | "og:description" => set_if_empty(&mut meta.description, &content),
            "author" | "article:author" => set_if_empty(&mut meta.author, &content),
            "og:site_name" => set_if_empty(&mut meta.site_name, &content),
            "article:published_time" | "datepublished" | "publish-date" => {
                set_if_empty(&mut meta.published_time, &content)
            }
            "article:modified_time" | "datemodified" | "last-modified" => {
                set_if_empty(&mut meta.modified_time, &content)
            }
            _ => {}
        }

        if let Some(stripped) = key.strip_prefix("og:") {
            meta.open_graph
                .push((stripped.to_string(), content.clone()));
        } else if let Some(stripped) = key.strip_prefix("twitter:") {
            meta.twitter.push((stripped.to_string(), content));
        }
    }
}

fn collect_link_tags(parsed: &ParsedHtml, plan: &CleanPlan, meta: &mut ReaderMetadata) {
    for element in select(parsed, "link[rel=canonical][href]") {
        if let Some(href) = element.value().attr("href") {
            meta.canonical = Some(resolve_url(plan, href));
            break;
        }
    }
}

fn collect_json_ld(parsed: &ParsedHtml, meta: &mut ReaderMetadata) {
    for element in select(parsed, "script[type=\"application/ld+json\"]") {
        let raw = element.text().collect::<String>();
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            meta.json_ld.push(value);
        }
    }
}

/// Fill empty top-level fields from Open Graph values when available.
fn backfill_from_og(meta: &mut ReaderMetadata) {
    for (key, value) in &meta.open_graph {
        match key.as_str() {
            "title" if meta.title.is_none() => meta.title = Some(value.clone()),
            "description" => set_if_empty(&mut meta.description, value),
            "site_name" => set_if_empty(&mut meta.site_name, value),
            "locale" => set_if_empty(&mut meta.language, value),
            _ => {}
        }
    }
}

fn set_if_empty(slot: &mut Option<String>, value: &str) {
    if slot.is_none() {
        *slot = Some(value.to_string());
    }
}

fn normalize(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::html::clean::plan;
    use crate::html::parse::parse_str;

    fn meta_of(html: &str) -> ReaderMetadata {
        let parsed = parse_str(html);
        let clean = plan(&parsed, Some("https://x.test/page"), true);
        extract(&parsed, &clean)
    }

    #[test]
    fn extracts_core_fields() {
        let meta = meta_of(
            r#"<html lang="en"><head>
            <title>  Hello   World </title>
            <meta name="description" content="A page">
            <meta name="author" content="Jane">
            <meta property="og:site_name" content="X Site">
            <meta name="article:published_time" content="2026-01-01">
            <link rel="canonical" href="/canonical">
            </head><body></body></html>"#,
        );
        assert_eq!(meta.title.as_deref(), Some("Hello World"));
        assert_eq!(meta.description.as_deref(), Some("A page"));
        assert_eq!(meta.author.as_deref(), Some("Jane"));
        assert_eq!(meta.site_name.as_deref(), Some("X Site"));
        assert_eq!(meta.language.as_deref(), Some("en"));
        assert_eq!(meta.published_time.as_deref(), Some("2026-01-01"));
        assert_eq!(meta.canonical.as_deref(), Some("https://x.test/canonical"));
    }

    #[test]
    fn collects_og_and_twitter() {
        let meta = meta_of(
            r#"<html><head>
            <meta property="og:image" content="https://x.test/i.png">
            <meta name="twitter:card" content="summary">
            </head><body></body></html>"#,
        );
        assert!(meta.open_graph.iter().any(|(k, _)| k == "image"));
        assert!(
            meta.twitter
                .iter()
                .any(|(k, v)| k == "card" && v == "summary")
        );
    }

    #[test]
    fn parses_json_ld() {
        let meta = meta_of(
            r#"<html><head>
            <script type="application/ld+json">{"@type":"Article","headline":"H"}</script>
            </head><body></body></html>"#,
        );
        assert_eq!(meta.json_ld.len(), 1);
        assert_eq!(meta.json_ld[0]["headline"], "H");
    }

    #[test]
    fn og_title_backfills_missing_title() {
        let meta = meta_of(
            r#"<html><head><meta property="og:title" content="OG Title"></head><body></body></html>"#,
        );
        assert_eq!(meta.title.as_deref(), Some("OG Title"));
    }
}
