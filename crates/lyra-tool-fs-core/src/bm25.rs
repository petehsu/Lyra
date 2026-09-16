//! Hermes-style BM25 catalog search plus budgeted deferred-tool listings.
//! Copied from 參考/hermes-agent/tools/tool_search_catalog.py (no Snowball stemmer).

use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

use crate::model::{ToolManifest, deferred_tool_name};

pub const CHARS_PER_TOKEN: f64 = 4.0;
const BM25_K1: f64 = 1.5;
const BM25_B: f64 = 0.75;

#[derive(Clone, Debug)]
pub struct CatalogEntry {
    pub name: String,
    pub description: String,
    pub source_name: String,
    pub tokens: Vec<String>,
}

fn token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[A-Za-z0-9]+").expect("token regex"))
}

fn first_sentence_end(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let ch = bytes[i];
        if matches!(ch, b'.' | b'!' | b'?') {
            let after = bytes.get(i + 1);
            if after.is_none_or(|next| next.is_ascii_whitespace()) {
                let before = &text[..i];
                if !(before.ends_with("e.g") || before.ends_with("i.e") || before.ends_with("etc"))
                {
                    return Some(i + 1);
                }
            }
        }
        i += 1;
    }
    None
}

pub fn tokenize(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    token_re()
        .find_iter(text)
        .map(|m| m.as_str().to_ascii_lowercase())
        .collect()
}

pub fn entry_search_text(
    name: &str,
    description: &str,
    source_label: &str,
    param_names: &str,
) -> String {
    let mut name_words = name.to_string();
    if let Some(rest) = name_words.strip_prefix("mcp__") {
        name_words = rest.to_string();
    }
    let name_words = name_words.replace(['_', '.', ':', '-'], " ");
    let extra = if !source_label.is_empty()
        && !name_words
            .split_whitespace()
            .any(|word| word.eq_ignore_ascii_case(source_label))
    {
        source_label
    } else {
        ""
    };
    format!("{name_words} {extra} {description} {param_names}")
}

pub fn manifest_search_text(manifest: &ToolManifest) -> String {
    let name = deferred_tool_name(manifest);
    let param_names = top_level_param_names(&manifest.input_schema).join(" ");
    let description = if manifest.description.is_empty() {
        manifest.summary.as_str()
    } else {
        manifest.description.as_str()
    };
    let mut blob = entry_search_text(&name, description, &manifest.domain, &param_names);
    for alias in &manifest.aliases {
        blob.push(' ');
        blob.push_str(alias);
    }
    blob.push(' ');
    blob.push_str(&manifest.title);
    blob
}

pub fn catalog_entry_from_manifest(manifest: &ToolManifest) -> CatalogEntry {
    let name = deferred_tool_name(manifest);
    let description = if manifest.summary.is_empty() {
        manifest.description.clone()
    } else {
        manifest.summary.clone()
    };
    let tokens = tokenize(&manifest_search_text(manifest));
    CatalogEntry {
        name,
        description,
        source_name: manifest.domain.clone(),
        tokens,
    }
}

fn top_level_param_names(schema: &Value) -> Vec<String> {
    schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| properties.keys().cloned().collect())
        .unwrap_or_default()
}

fn corpus_stats(catalog: &[CatalogEntry]) -> (Vec<usize>, f64, HashMap<String, usize>, usize) {
    let doc_lengths: Vec<usize> = catalog.iter().map(|entry| entry.tokens.len()).collect();
    let avg_dl = if doc_lengths.is_empty() {
        0.0
    } else {
        doc_lengths.iter().sum::<usize>() as f64 / doc_lengths.len() as f64
    };
    let mut doc_freq: HashMap<String, usize> = HashMap::new();
    for entry in catalog {
        let mut seen = std::collections::HashSet::new();
        for token in &entry.tokens {
            if seen.insert(token.clone()) {
                *doc_freq.entry(token.clone()).or_insert(0) += 1;
            }
        }
    }
    (doc_lengths, avg_dl, doc_freq, catalog.len())
}

fn bm25_score(
    query_tokens: &[String],
    doc_tokens: &[String],
    doc_freq: &HashMap<String, usize>,
    n_docs: usize,
    avg_dl: f64,
) -> f64 {
    let dl = doc_tokens.len() as f64;
    let mut tf: HashMap<&str, usize> = HashMap::new();
    for token in doc_tokens {
        *tf.entry(token.as_str()).or_insert(0) += 1;
    }
    let mut score = 0.0;
    for query in query_tokens {
        let df = *doc_freq.get(query).unwrap_or(&0);
        let term_tf = *tf.get(query.as_str()).unwrap_or(&0);
        if df > 0 && term_tf > 0 {
            let idf = (1.0 + (n_docs as f64 - df as f64 + 0.5) / (df as f64 + 0.5)).ln();
            let tf = term_tf as f64;
            score += idf * tf * (BM25_K1 + 1.0)
                / (tf + BM25_K1 * (1.0 - BM25_B + BM25_B * dl / avg_dl.max(1.0)));
        }
    }
    score
}

fn gate_token<'a>(
    query_tokens: &'a [String],
    doc_freq: &HashMap<String, usize>,
    n_docs: usize,
) -> &'a str {
    query_tokens
        .iter()
        .max_by(|left, right| {
            let idf = |token: &str| {
                let df = *doc_freq.get(token).unwrap_or(&0);
                (1.0 + (n_docs as f64 - df as f64 + 0.5) / (df as f64 + 0.5)).ln()
            };
            idf(left)
                .partial_cmp(&idf(right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(String::as_str)
        .unwrap_or("")
}

pub fn search_catalog<'a>(
    catalog: &'a [CatalogEntry],
    query: &str,
    limit: usize,
) -> Vec<&'a CatalogEntry> {
    let query_tokens = if catalog.is_empty() || limit == 0 {
        Vec::new()
    } else {
        tokenize(query)
    };
    if query_tokens.is_empty() {
        return Vec::new();
    }
    let (doc_lengths, avg_dl, doc_freq, n_docs) = corpus_stats(catalog);
    let _ = doc_lengths;
    let gate = gate_token(&query_tokens, &doc_freq, n_docs);
    let exact_name = query.trim().to_ascii_lowercase();
    let mut scored: Vec<(f64, &CatalogEntry)> = catalog
        .iter()
        .filter(|entry| {
            entry.name.to_ascii_lowercase() == exact_name
                || entry.tokens.iter().any(|token| token == gate)
        })
        .map(|entry| {
            let score = if entry.name.to_ascii_lowercase() == exact_name {
                f64::INFINITY
            } else {
                bm25_score(&query_tokens, &entry.tokens, &doc_freq, n_docs, avg_dl)
            };
            (score, entry)
        })
        .collect();
    scored.sort_by(|left, right| {
        right
            .0
            .partial_cmp(&left.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.1.name.cmp(&right.1.name))
    });
    scored
        .into_iter()
        .take(limit)
        .map(|(_, entry)| entry)
        .collect()
}

pub fn short_desc(description: &str, max_chars: usize) -> String {
    let text = description.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = if let Some(end) = first_sentence_end(&text) {
        text[..end].to_string()
    } else {
        text
    };
    if text.chars().count() <= max_chars {
        return text;
    }
    let clipped: String = text.chars().take(max_chars).collect();
    let clipped = clipped
        .rsplit_once(' ')
        .map(|(head, _)| head.to_string())
        .unwrap_or(clipped);
    format!("{}…", clipped.trim_end_matches([',', ';', ':', ' ']))
}

pub fn listing_group_label(source_name: &str) -> String {
    source_name
        .strip_prefix("mcp-")
        .unwrap_or(source_name)
        .to_string()
}

fn estimate_tokens(text: &str) -> usize {
    ((text.len() as f64) / CHARS_PER_TOKEN).ceil() as usize
}

/// Hermes listing degradation: full → names → mixed/groups → none.
pub fn build_catalog_listing(
    entries: &[CatalogEntry],
    max_tokens: usize,
    search_tool_name: &str,
) -> (Option<String>, String) {
    let mut groups: std::collections::BTreeMap<String, Vec<(String, String)>> =
        std::collections::BTreeMap::new();
    for entry in entries {
        let label = listing_group_label(&entry.source_name);
        let label = if label.is_empty() {
            "other".to_string()
        } else {
            label
        };
        groups
            .entry(label)
            .or_default()
            .push((entry.name.clone(), short_desc(&entry.description, 60)));
    }
    if groups.is_empty() {
        return (None, "none".to_string());
    }
    for group in groups.values_mut() {
        group.sort_by(|left, right| left.0.cmp(&right.0));
    }
    let header = format!(
        "Deferred tool catalog (load schemas via `{search_tool_name}`, then call the tool by name):"
    );
    let render_group = |label: &str, mode: &str| -> String {
        let tools = &groups[label];
        if mode == "summary" {
            return format!(
                "{label} ({} tools — names not listed; discover via `{search_tool_name}`)",
                tools.len()
            );
        }
        let mut lines = vec![format!("{label} tools ({}):", tools.len())];
        if mode == "full" {
            lines.extend(tools.iter().map(|(name, desc)| {
                if desc.is_empty() {
                    format!("- {name}")
                } else {
                    format!("- {name}: {desc}")
                }
            }));
        } else {
            lines.push(
                tools
                    .iter()
                    .map(|(name, _)| name.as_str())
                    .collect::<Vec<_>>()
                    .join(", "),
            );
        }
        lines.join("\n")
    };
    let assemble = |modes: &HashMap<String, String>| -> Option<String> {
        let mut parts = vec![header.clone()];
        for label in groups.keys() {
            parts.push(render_group(
                label,
                modes.get(label).map(String::as_str).unwrap_or("full"),
            ));
        }
        let text = parts.join("\n");
        (estimate_tokens(&text) <= max_tokens).then_some(text)
    };
    for mode in ["full", "names"] {
        let modes = groups
            .keys()
            .map(|label| (label.clone(), mode.to_string()))
            .collect::<HashMap<_, _>>();
        if let Some(text) = assemble(&modes) {
            return (Some(text), mode.to_string());
        }
    }
    let mut modes = groups
        .keys()
        .map(|label| (label.clone(), "names".to_string()))
        .collect::<HashMap<_, _>>();
    let mut labels: Vec<String> = groups.keys().cloned().collect();
    labels.sort_by(|left, right| {
        let left_len = render_group(left, "names").len();
        let right_len = render_group(right, "names").len();
        right_len.cmp(&left_len).then_with(|| left.cmp(right))
    });
    for label in labels {
        modes.insert(label, "summary".to_string());
        if let Some(text) = assemble(&modes) {
            let form = if modes.values().all(|mode| mode == "summary") {
                "groups"
            } else {
                "mixed"
            };
            return (Some(text), form.to_string());
        }
    }
    (None, "none".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_name_ranks_first() {
        let catalog = vec![
            CatalogEntry {
                name: "web_search".to_string(),
                description: "search the public web".to_string(),
                source_name: "web".to_string(),
                tokens: tokenize("web search public"),
            },
            CatalogEntry {
                name: "memory_search".to_string(),
                description: "search memory".to_string(),
                source_name: "memory".to_string(),
                tokens: tokenize("memory search"),
            },
        ];
        let hits = search_catalog(&catalog, "web_search", 5);
        assert_eq!(hits[0].name, "web_search");
    }

    #[test]
    fn listing_fits_full_form_for_small_catalog() {
        let catalog = vec![CatalogEntry {
            name: "web_search".to_string(),
            description: "Search the public web.".to_string(),
            source_name: "web".to_string(),
            tokens: Vec::new(),
        }];
        let (text, form) = build_catalog_listing(&catalog, 4000, "ToolSearch");
        assert_eq!(form, "full");
        assert!(text.unwrap().contains("web_search: Search the public web."));
    }
}
