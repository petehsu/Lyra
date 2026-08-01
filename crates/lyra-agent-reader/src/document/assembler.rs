//! Assemble rendered content into `ReaderResult`s.

use chrono::Utc;
use sha2::{Digest, Sha256};

use crate::budget;
use crate::chunk;
use crate::document_formats;
use crate::errors::ReaderError;
use crate::types::{
    ChunkingMode, Detection, ExtractionMode, Frontmatter, ReaderDebugTrace, ReaderMedia,
    ReaderRequest, ReaderResult, ReaderTiming, ReaderWarning, WarningCode,
};

use super::cache;
use super::source::Source;

const DEFAULT_MAX_DOM_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_MAX_EXTRACTED_CHARS: usize = 1_000_000;
const DEFAULT_RESOURCE_LIMIT: usize = 500;

pub(super) fn assemble_rendered_document(
    request: &ReaderRequest,
    source: &Source,
    detection: Detection,
    rendered: document_formats::RenderedDocument,
    render_ms: u64,
) -> Result<ReaderResult, ReaderError> {
    let body = rendered.markdown.clone();
    assemble(
        request,
        source,
        detection,
        body,
        rendered.markdown,
        rendered.metadata,
        Vec::new(),
        Vec::new(),
        source.media.clone(),
        rendered.info,
        rendered.warnings,
        ProcessingTiming {
            render_ms,
            ..ProcessingTiming::default()
        },
        None,
    )
}

#[derive(Clone, Copy, Debug, Default)]
pub(super) struct ProcessingTiming {
    pub(super) parse_ms: u64,
    pub(super) extract_ms: u64,
    pub(super) render_ms: u64,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn assemble(
    request: &ReaderRequest,
    source: &Source,
    detection: Detection,
    mut body: String,
    mut markdown_with_citations: String,
    metadata: crate::types::ReaderMetadata,
    final_links: Vec<crate::types::ReaderLink>,
    final_images: Vec<crate::types::ReaderImage>,
    final_media: Vec<ReaderMedia>,
    info: crate::types::ExtractionInfo,
    mut warnings: Vec<ReaderWarning>,
    timing: ProcessingTiming,
    debug_trace: Option<ReaderDebugTrace>,
) -> Result<ReaderResult, ReaderError> {
    let options = &request.options;
    let max_extracted_chars = options
        .max_extracted_chars
        .unwrap_or(DEFAULT_MAX_EXTRACTED_CHARS);
    if markdown_with_citations.chars().count() > max_extracted_chars {
        markdown_with_citations =
            budget::apply(&markdown_with_citations, Some(max_extracted_chars)).text;
        body = budget::apply(&body, Some(max_extracted_chars)).text;
        warnings.push(ReaderWarning {
            code: WarningCode::Truncated,
            message: format!("extracted content capped at {max_extracted_chars} chars"),
        });
    }
    let plain_text = to_plain_text(&markdown_with_citations);
    let effective_limit =
        budget::effective_char_limit(options.max_chars, options.max_tokens, options.token_budget);
    let chunking_options;
    let chunking = if matches!(options.overflow, crate::types::OverflowMode::Chunks)
        && matches!(options.chunking.mode, ChunkingMode::Disabled)
    {
        let max_chars_per_chunk = effective_limit.unwrap_or(options.chunking.max_chars_per_chunk);
        chunking_options = crate::types::ChunkingOptions {
            mode: ChunkingMode::Block,
            max_chars_per_chunk,
            ..options.chunking.clone()
        };
        &chunking_options
    } else {
        &options.chunking
    };
    let mut final_links = final_links;
    let mut final_images = final_images;
    let mut final_media = final_media;
    limit_resources("links", &mut final_links, &mut warnings);
    limit_resources("images", &mut final_images, &mut warnings);
    limit_resources("media", &mut final_media, &mut warnings);
    let mut chunks = chunk::generate(&markdown_with_citations, chunking);
    attach_chunk_references(&mut chunks, &final_links, &final_images);
    let focus_query = options
        .query_focus
        .as_deref()
        .or(options.user_task.as_deref());
    let fit = chunk::fit_markdown(
        &markdown_with_citations,
        &chunks,
        focus_query,
        options.content_filter,
    );
    let fit_markdown = fit.markdown;
    let fit_chunks = fit.chunks;
    let filtered_out_summary = fit.filtered_out_summary;
    let fit_scoring_debug = fit.scoring_debug;

    let budgeted = budget::apply(&markdown_with_citations, effective_limit);
    if budgeted.truncated {
        if matches!(options.overflow, crate::types::OverflowMode::Error) {
            return Err(ReaderError::Budget(format!(
                "rendered output is {} chars, exceeding budget of {} chars",
                budgeted.total_chars,
                effective_limit.unwrap_or_default()
            )));
        }
        warnings.push(ReaderWarning {
            code: WarningCode::Truncated,
            message: format!(
                "output truncated to {} of {} chars",
                budgeted.text.chars().count(),
                budgeted.total_chars
            ),
        });
    }

    let title = metadata.title.clone();
    let language = metadata.language.clone();
    let token_estimate = budget::estimate_tokens(&markdown_with_citations);
    let retrieved_at = Utc::now().to_rfc3339();

    let frontmatter = Frontmatter {
        title,
        url: source.requested_url.clone(),
        source_url: source.final_url.clone(),
        retrieved_at: Some(retrieved_at),
        content_type: source
            .content_type
            .clone()
            .or_else(|| Some(detection.format.label().to_string())),
        language,
        extraction_method: Some(info.method.clone()),
        token_estimate,
        truncated: budgeted.truncated,
    };
    let compact_body_source = if fit_markdown.trim().is_empty() {
        markdown_with_citations.as_str()
    } else {
        fit_markdown.as_str()
    };
    let compact_body = budget::apply(compact_body_source, effective_limit).text;
    let compact_text = compact_text(&frontmatter, &compact_body);
    let recommended_next_action = recommended_next_action(budgeted.truncated, &warnings);
    let debug_trace = if debug_trace_requested(options) {
        Some(debug_trace.unwrap_or_else(|| basic_debug_trace(options, &info)))
    } else {
        None
    };

    let raw_source = include_raw_source(options, source);
    let cache_key = cache_key_for_result(request, source, &detection, &body);

    Ok(ReaderResult {
        format: detection.format,
        detected_by: detection.detected_by,
        mime_type: detection.mime_type.or_else(|| source.content_type.clone()),
        final_url: source.final_url.clone(),
        status: source.status,
        frontmatter,
        // raw_markdown is the full (untruncated) body; callers may truncate for
        // display while persisting the full text as an artifact.
        raw_markdown: body,
        markdown_with_citations,
        fit_markdown,
        compact_text,
        plain_text,
        metadata,
        links: final_links,
        images: final_images,
        media: final_media,
        ax_elements: source.ax_elements.clone(),
        chunks,
        fit_chunks,
        filtered_out_summary,
        fit_scoring_debug,
        artifacts: source.artifacts.clone(),
        warnings,
        truncated: budgeted.truncated,
        total_chars: budgeted.total_chars,
        has_more: budgeted.truncated,
        next_cursor: budgeted.next_cursor,
        recommended_next_action,
        extraction: info,
        timing: Some(ReaderTiming {
            fetch_ms: source.fetch_ms,
            parse_ms: timing.parse_ms,
            extract_ms: timing.extract_ms,
            render_ms: timing.render_ms,
            total_ms: 0,
        }),
        debug_trace,
        raw_source,
        cache_key,
        engine_used: None,
        engine_attempts: Vec::new(),
    })
}

fn include_raw_source(options: &crate::types::ReaderOptions, source: &Source) -> Option<String> {
    if !(options.include_raw
        || matches!(options.mode, ExtractionMode::Raw)
        || matches!(options.preset, crate::types::ReaderPreset::Raw))
    {
        return None;
    }
    let limit = options
        .max_dom_bytes
        .unwrap_or(DEFAULT_MAX_DOM_BYTES)
        .min(DEFAULT_MAX_DOM_BYTES);
    let text = String::from_utf8_lossy(&source.bytes).into_owned();
    Some(budget::apply(&text, Some(limit)).text)
}

fn cache_key_for_result(
    request: &ReaderRequest,
    source: &Source,
    detection: &Detection,
    body: &str,
) -> Option<String> {
    let source_id = source
        .requested_url
        .as_deref()
        .or(source.final_url.as_deref())
        .unwrap_or("");
    if source_id.is_empty() {
        return None;
    }
    let mut options_hasher = Sha256::new();
    options_hasher.update(format!(
        "{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}",
        request.options.preset,
        request.options.output_format,
        request.options.mode,
        request.options.target_selector,
        request.options.remove_selectors,
        request.options.include_tags,
        request.options.exclude_tags,
        request.options.query_focus,
        request.options.user_task,
        request.options.content_filter,
    ));
    let options_hash = hex_hash(options_hasher.finalize().as_slice());
    let mut content_hasher = Sha256::new();
    content_hasher.update(body.as_bytes());
    let content_hash = hex_hash(content_hasher.finalize().as_slice());
    let mut key_hasher = Sha256::new();
    key_hasher.update(source_id.as_bytes());
    if let Some(final_url) = source.final_url.as_ref() {
        key_hasher.update(final_url.as_bytes());
    }
    key_hasher.update(safe_header_fingerprint(&source.response_headers).as_bytes());
    key_hasher.update(detection.format.label().as_bytes());
    key_hasher.update(options_hash.as_bytes());
    key_hasher.update(content_hash.as_bytes());
    let final_hash = key_hasher.finalize();
    Some(format!(
        "reader:{}",
        cache::sha256_hex(&[final_hash.as_slice()])
    ))
}

fn safe_header_fingerprint(headers: &[(String, String)]) -> String {
    let mut safe = headers
        .iter()
        .filter(|(name, _)| {
            matches!(
                name.to_ascii_lowercase().as_str(),
                "content-type" | "content-length" | "content-language" | "last-modified" | "etag"
            )
        })
        .map(|(name, value)| format!("{}={}", name.to_ascii_lowercase(), value.trim()))
        .collect::<Vec<_>>();
    safe.sort();
    safe.join("|")
}

fn hex_hash(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

fn limit_resources<T>(label: &str, values: &mut Vec<T>, warnings: &mut Vec<ReaderWarning>) {
    if values.len() <= DEFAULT_RESOURCE_LIMIT {
        return;
    }
    let original = values.len();
    values.truncate(DEFAULT_RESOURCE_LIMIT);
    warnings.push(ReaderWarning {
        code: WarningCode::ResourceLimitExceeded,
        message: format!("{label} truncated to {DEFAULT_RESOURCE_LIMIT} of {original} items"),
    });
}

pub(super) fn debug_trace_requested(options: &crate::types::ReaderOptions) -> bool {
    options.include_debug_trace || debug_trace_env_enabled()
}

pub(super) fn debug_trace_enabled_by(options: &crate::types::ReaderOptions) -> String {
    if options.include_debug_trace {
        "request".to_string()
    } else {
        "environment".to_string()
    }
}

fn debug_trace_env_enabled() -> bool {
    std::env::var("LYRA_AGENT_READER_DEBUG")
        .ok()
        .as_deref()
        .is_some_and(debug_trace_env_value_enabled)
}

fn debug_trace_env_value_enabled(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes"
    )
}

fn basic_debug_trace(
    options: &crate::types::ReaderOptions,
    info: &crate::types::ExtractionInfo,
) -> ReaderDebugTrace {
    ReaderDebugTrace {
        enabled_by: debug_trace_enabled_by(options),
        selected_extractor: info.method.clone(),
        fallback_reason: info
            .fallback_used
            .then(|| format!("{} fallback was used", info.method)),
        cleaning: None,
        extractor_candidates: Vec::new(),
    }
}

fn compact_text(frontmatter: &Frontmatter, body: &str) -> String {
    let title = frontmatter.title.as_deref().unwrap_or("");
    let source = frontmatter
        .source_url
        .as_deref()
        .or(frontmatter.url.as_deref())
        .unwrap_or("");
    let retrieved = frontmatter.retrieved_at.as_deref().unwrap_or("");
    let body = body.trim();
    if body.is_empty() {
        format!("Title: {title}\nURL Source: {source}\nRetrieved: {retrieved}")
    } else {
        format!("Title: {title}\nURL Source: {source}\nRetrieved: {retrieved}\n\n{body}")
    }
}

pub(super) fn recommended_next_action(
    truncated: bool,
    warnings: &[ReaderWarning],
) -> Option<String> {
    if truncated {
        return Some(
            "Use targetSelector/removeSelectors/queryFocus or overflow=chunks to narrow the read."
                .to_string(),
        );
    }
    if warnings
        .iter()
        .any(|warning| warning.code == WarningCode::BrowserRecommended)
    {
        return Some("Use a browser-rendered snapshot or browser path for this page.".to_string());
    }
    if warnings.iter().any(|warning| {
        matches!(
            warning.code,
            WarningCode::ExternalAdapterMissing | WarningCode::ExternalAdapterFailed
        )
    }) {
        return Some(
            "Install/configure LibreOffice for higher-fidelity Office conversion, or use the Rust fallback output."
                .to_string(),
        );
    }
    None
}

fn attach_chunk_references(
    chunks: &mut [crate::types::ReaderChunk],
    links: &[crate::types::ReaderLink],
    images: &[crate::types::ReaderImage],
) {
    for chunk in chunks {
        chunk.links = links
            .iter()
            .filter(|link| chunk.markdown.contains(&link.url))
            .cloned()
            .collect();
        chunk.images = images
            .iter()
            .filter(|image| {
                chunk.markdown.contains(&image.url)
                    || image
                        .srcset
                        .iter()
                        .any(|candidate| chunk.markdown.contains(candidate))
            })
            .cloned()
            .collect();
    }
}

/// Strip markdown syntax to a plain-text rendition (best-effort).
fn to_plain_text(markdown: &str) -> String {
    let mut out = String::with_capacity(markdown.len());
    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            continue;
        }
        let mut line = trimmed.trim_start_matches('#').trim_start().to_string();
        line = line.trim_start_matches('>').trim_start().to_string();
        line = line.replace("**", "").replace("~~", "").replace('`', "");
        if !line.is_empty() {
            out.push_str(&line);
            out.push('\n');
        }
    }
    out.trim_end().to_string()
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used, unused_imports)]
mod tests {
    use super::*;
    use crate::document::test_support::*;
    use crate::document::{run, run_with_browser};
    use crate::errors::ReaderError;
    use crate::types::{
        BrowserSnapshotInput, ChunkingMode, ChunkingOptions, CitationFormat, ContentFilterMode,
        ExtractionMode, Format, HeadingStyle, ImageRetention, LinkRetention, MediaRetention,
        OverflowMode, ReaderEngine, ReaderInput, ReaderOptions, ReaderRequest, WarningCode,
    };

    #[test]
    fn debug_trace_is_none_by_default() {
        let result = read_html(
            "<html><body><main><p>Plain content with no debug request.</p></main></body></html>",
            ReaderOptions::default(),
        );
        assert!(result.debug_trace.is_none());
    }

    #[test]
    fn debug_trace_records_cleaning_candidates_and_redacts_content() {
        let html = r#"<html><body>
                <nav>Navigation chrome</nav>
                <aside class="ad-slot">Advertisement chrome</aside>
                <article class="article-body">
                  <h1>Debug Article</h1>
                  <p>Secret Body Phrase alpha beta gamma delta epsilon zeta eta theta iota kappa lambda.</p>
                  <p>Second substantial paragraph with enough prose, commas, clauses, and useful words to score.</p>
                </article>
            </body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                include_debug_trace: true,
                remove_selectors: vec![".ad-slot".to_string()],
                ..ReaderOptions::default()
            },
        );
        let trace = result.debug_trace.expect("debug trace");
        assert_eq!(trace.enabled_by, "request");
        assert_eq!(trace.selected_extractor, "readability");
        assert!(
            trace
                .extractor_candidates
                .iter()
                .any(|candidate| candidate.selected)
        );
        let cleaning = trace.cleaning.as_ref().expect("cleaning debug");
        assert!(cleaning.removed_total >= 1);
        assert_eq!(cleaning.caller_selector_matched, 1);
        assert_eq!(cleaning.caller_selector_removed, 1);
        assert_eq!(cleaning.remove_selectors[0].selector, ".ad-slot");
        let serialized = serde_json::to_string(&trace).expect("trace json");
        assert!(!serialized.contains("Secret Body Phrase"));
        assert!(!serialized.contains("<article"));
        assert!(!result.compact_text.contains("debugTrace"));
    }

    #[test]
    fn debug_trace_records_fallback_reason() {
        let result = read_html(
            "<html><body><nav><a href=\"#\">only chrome</a></nav></body></html>",
            ReaderOptions {
                include_debug_trace: true,
                ..ReaderOptions::default()
            },
        );
        let trace = result.debug_trace.expect("debug trace");
        assert_eq!(trace.selected_extractor, "fallback");
        assert!(
            trace
                .fallback_reason
                .as_deref()
                .is_some_and(|reason| reason.contains("no main content candidate"))
        );
    }

    #[test]
    fn debug_trace_env_value_parser_accepts_expected_truthy_values() {
        for value in ["1", "true", "TRUE", "yes", " yes "] {
            assert!(debug_trace_env_value_enabled(value), "{value}");
        }
        for value in ["", "0", "false", "no", "debug"] {
            assert!(!debug_trace_env_value_enabled(value), "{value}");
        }
    }

    #[test]
    fn disabled_chunking_is_lazy_by_default() {
        let result = read_html(
            "<html><body><main><p>Plain content with no chunk request.</p></main></body></html>",
            ReaderOptions::default(),
        );
        assert!(result.chunks.is_empty());
    }

    #[test]
    fn links_and_images_are_limited_with_warning() {
        let mut html = String::from("<html><body><main>");
        for index in 0..510 {
            html.push_str(&format!(
                    r#"<p><a href="/link-{index}">link {index}</a><img src="/image-{index}.png" alt="image {index}"></p>"#
                ));
        }
        html.push_str("</main></body></html>");
        let result = read_html(
            &html,
            ReaderOptions {
                mode: ExtractionMode::Full,
                ..ReaderOptions::default()
            },
        );
        assert_eq!(result.links.len(), 500);
        assert_eq!(result.images.len(), 500);
        assert!(result.warnings.iter().any(|warning| {
            warning.code == WarningCode::ResourceLimitExceeded
                && warning.message.contains("links truncated")
        }));
        assert!(result.warnings.iter().any(|warning| {
            warning.code == WarningCode::ResourceLimitExceeded
                && warning.message.contains("images truncated")
        }));
    }

    #[test]
    fn budget_truncates_and_warns() {
        let mut html = String::from("<html><body><article>");
        for index in 0..50 {
            html.push_str(&format!("<p>Paragraph number {index} with some words.</p>"));
        }
        html.push_str("</article></body></html>");
        let options = ReaderOptions {
            max_chars: Some(120),
            ..ReaderOptions::default()
        };
        let result = read_html(&html, options);
        assert!(result.truncated);
        assert!(result.total_chars > 120);
        assert!(
            result
                .warnings
                .iter()
                .any(|w| w.code == WarningCode::Truncated)
        );
        assert!(result.next_cursor.is_some());
        assert!(result.recommended_next_action.is_some());
    }

    #[test]
    fn compact_text_includes_agent_header_and_body() {
        let html = r#"<html><head><title>Compact Title</title></head><body>
                <article><p>Readable body text for the compact output.</p></article>
            </body></html>"#;
        let result = read_html(html, ReaderOptions::default());
        assert!(result.compact_text.contains("Title: Compact Title"));
        assert!(result.compact_text.contains("URL Source: https://x.test/"));
        assert!(result.compact_text.contains("Retrieved: "));
        assert!(
            result
                .compact_text
                .contains("Readable body text for the compact output.")
        );
    }

    #[test]
    fn compact_text_truncates_without_truncating_full_markdown() {
        let html = r#"<html><body><article>
                <p>alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron</p>
            </article></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                max_chars: Some(24),
                ..ReaderOptions::default()
            },
        );
        assert!(result.truncated);
        assert!(result.markdown_with_citations.contains("omicron"));
        assert!(!result.compact_text.contains("omicron"));
    }

    #[test]
    fn compact_text_prefers_fit_markdown_when_available() {
        let html = r#"<html><body><main>
                <h1>Fruit</h1><p>Apples oranges bananas.</p>
                <h1>Rust</h1><p>Rust ownership borrowing lifetimes.</p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Heading,
                    ..ChunkingOptions::default()
                },
                query_focus: Some("ownership borrowing".to_string()),
                content_filter: ContentFilterMode::Bm25,
                ..ReaderOptions::default()
            },
        );
        assert!(result.compact_text.contains("Rust ownership"));
        assert!(!result.compact_text.contains("Apples oranges"));
    }

    #[test]
    fn token_budget_sets_truncation_cursor() {
        let html = "<html><body><article><p>alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron</p></article></body></html>";
        let result = read_html(
            html,
            ReaderOptions {
                max_chars: None,
                max_tokens: Some(6),
                ..ReaderOptions::default()
            },
        );
        assert!(result.truncated);
        assert!(result.has_more);
        assert!(result.total_chars > 24);
        assert!(result.next_cursor.is_some());
    }

    #[test]
    fn overflow_error_returns_budget_error() {
        let error = read_html_result(
                "<html><body><article><p>alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron</p></article></body></html>",
                ReaderOptions {
                    max_chars: Some(24),
                    overflow: OverflowMode::Error,
                    ..ReaderOptions::default()
                },
            )
            .expect_err("overflow=error should fail");
        assert!(matches!(error, ReaderError::Budget(_)));
    }

    #[test]
    fn overflow_chunks_keeps_full_markdown_and_returns_cursor() {
        let html = r#"<html><body><article>
                <h1>One</h1><p>alpha beta gamma delta epsilon.</p>
                <h1>Two</h1><p>zeta eta theta iota kappa lambda.</p>
            </article></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                max_chars: Some(32),
                overflow: OverflowMode::Chunks,
                ..ReaderOptions::default()
            },
        );
        assert!(result.truncated);
        assert!(result.has_more);
        assert!(result.next_cursor.is_some());
        assert!(result.markdown_with_citations.contains("# Two"));
        assert!(result.chunks.len() >= 2);
        assert!(
            result
                .chunks
                .iter()
                .all(|chunk| chunk.source_start_char.is_some())
        );
    }

    #[test]
    fn unsupported_format_errors_expose_recommendations() {
        let pdf_error = ReaderError::UnsupportedFormat {
            format: "pdf".to_string(),
            mime: "application/pdf".to_string(),
            final_url: Some("https://x.test/doc.pdf".to_string()),
        };
        assert!(
            pdf_error
                .recommended_next_action()
                .unwrap_or("")
                .contains("document reader")
        );

        let image_error = ReaderError::UnsupportedFormat {
            format: "image".to_string(),
            mime: "image/png".to_string(),
            final_url: Some("https://x.test/image.png".to_string()),
        };
        assert!(
            image_error
                .recommended_next_action()
                .unwrap_or("")
                .contains("image reader")
        );

        let office_error = ReaderError::UnsupportedFormat {
            format: "docx".to_string(),
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                .to_string(),
            final_url: Some("https://x.test/doc.docx".to_string()),
        };
        assert!(
            office_error
                .recommended_next_action()
                .unwrap_or("")
                .contains("Office adapter")
        );
    }

    #[test]
    fn heading_chunking_populates_stable_chunks() {
        let html = r#"<html><body><main>
                <h1>Guide</h1><p>Intro text.</p>
                <h2>Install</h2><p>Install text.</p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Heading,
                    ..ChunkingOptions::default()
                },
                ..ReaderOptions::default()
            },
        );
        assert_eq!(result.chunks[0].id, "chunk-1");
        assert_eq!(result.chunks[1].heading_path, vec!["Guide", "Install"]);
        assert!(result.chunks[0].source_start_char.is_some());
        assert!(result.chunks[0].source_end_char.is_some());
    }

    #[test]
    fn block_chunking_keeps_code_block_together() {
        let html = r#"<html><body><main>
                <p>Intro text.</p>
                <pre><code class="language-rust">fn main() {}</code></pre>
                <p>Outro text.</p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Block,
                    max_chars_per_chunk: 16,
                    ..ChunkingOptions::default()
                },
                ..ReaderOptions::default()
            },
        );
        assert!(result.chunks.iter().any(|chunk| {
            chunk.markdown.contains("```rust") && chunk.markdown.contains("fn main()")
        }));
    }

    #[test]
    fn chunk_overlap_carries_previous_block_but_not_source_range() {
        let html = r#"<html><body><main>
                <p>First paragraph with enough words.</p>
                <p>Second paragraph with enough words.</p>
                <p>Third paragraph with enough words.</p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Block,
                    max_chars_per_chunk: 38,
                    overlap_chars: 12,
                },
                ..ReaderOptions::default()
            },
        );
        assert!(result.chunks.len() >= 2);
        let second = &result.chunks[1];
        assert!(second.markdown.contains("First paragraph"));
        assert!(second.markdown.contains("Second paragraph"));
        let second_start = result
            .markdown_with_citations
            .find("Second paragraph")
            .expect("second paragraph source");
        assert_eq!(second.source_start_char, Some(second_start));
    }

    #[test]
    fn chunk_references_include_only_links_and_images_used_in_chunk() {
        let html = r#"<html><body><main>
                <p>First <a href="https://a.test/one">one</a> <img src="/one.png" alt="One"></p>
                <p>Second <a href="https://a.test/two">two</a> <img src="/two.png" alt="Two"></p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Block,
                    max_chars_per_chunk: 72,
                    ..ChunkingOptions::default()
                },
                ..ReaderOptions::default()
            },
        );
        assert!(result.chunks.len() >= 2);
        let first = &result.chunks[0];
        let second = &result.chunks[1];
        assert!(first.links.iter().any(|link| link.url.ends_with("/one")));
        assert!(!first.links.iter().any(|link| link.url.ends_with("/two")));
        assert!(
            first
                .images
                .iter()
                .any(|image| image.url.ends_with("/one.png"))
        );
        assert!(
            !first
                .images
                .iter()
                .any(|image| image.url.ends_with("/two.png"))
        );
        assert!(second.links.iter().any(|link| link.url.ends_with("/two")));
        assert!(
            second
                .images
                .iter()
                .any(|image| image.url.ends_with("/two.png"))
        );
    }

    #[test]
    fn bm25_fit_markdown_prefers_query_content() {
        let html = r#"<html><body><main>
                <h1>Fruit</h1><p>Apples oranges bananas.</p>
                <h1>Rust</h1><p>Rust ownership borrowing lifetimes.</p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Heading,
                    ..ChunkingOptions::default()
                },
                query_focus: Some("ownership borrowing".to_string()),
                content_filter: ContentFilterMode::Bm25,
                ..ReaderOptions::default()
            },
        );
        assert!(result.fit_markdown.contains("Rust ownership"));
        assert!(!result.fit_markdown.contains("Apples oranges"));
        assert_eq!(result.fit_chunks.len(), 1);
        assert_eq!(
            result
                .filtered_out_summary
                .as_ref()
                .expect("summary")
                .kept_chunks,
            1
        );
        assert!(!result.fit_scoring_debug.is_empty());
    }

    #[test]
    fn empty_query_focus_does_not_generate_fit_markdown() {
        let result = read_html(
            "<html><body><main><p>Rust ownership borrowing.</p></main></body></html>",
            ReaderOptions {
                query_focus: Some(" ".to_string()),
                content_filter: ContentFilterMode::Bm25,
                ..ReaderOptions::default()
            },
        );
        assert!(result.fit_markdown.is_empty());
        assert!(result.fit_chunks.is_empty());
        assert!(result.filtered_out_summary.is_none());
        assert!(result.fit_scoring_debug.is_empty());
    }

    #[test]
    fn none_content_filter_keeps_fit_fields_empty() {
        let result = read_html(
            "<html><body><main><p>Rust ownership borrowing.</p></main></body></html>",
            ReaderOptions {
                query_focus: Some("ownership".to_string()),
                content_filter: ContentFilterMode::None,
                ..ReaderOptions::default()
            },
        );
        assert!(result.fit_markdown.is_empty());
        assert!(result.fit_chunks.is_empty());
        assert!(result.filtered_out_summary.is_none());
        assert!(result.fit_scoring_debug.is_empty());
    }

    #[test]
    fn prune_fit_markdown_keeps_matching_chunks() {
        let html = r#"<html><body><main>
                <p>Apples oranges bananas.</p>
                <p>Rust ownership borrowing lifetimes.</p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Block,
                    max_chars_per_chunk: 32,
                    ..ChunkingOptions::default()
                },
                query_focus: Some("ownership".to_string()),
                content_filter: ContentFilterMode::Prune,
                ..ReaderOptions::default()
            },
        );
        assert!(result.fit_markdown.contains("Rust ownership"));
        assert!(!result.fit_markdown.contains("Apples oranges"));
        let summary = result.filtered_out_summary.as_ref().expect("summary");
        assert_eq!(summary.kept_chunks, 1);
        assert_eq!(summary.filtered_chunks, 1);
        assert_eq!(summary.matched_terms, vec!["ownership"]);
    }

    #[test]
    fn hybrid_fit_uses_link_signal() {
        let html = r#"<html><body><main>
                <p>General intro without the key term.</p>
                <p><a href="https://example.test/ownership">Ownership reference</a></p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Block,
                    max_chars_per_chunk: 48,
                    ..ChunkingOptions::default()
                },
                query_focus: Some("ownership".to_string()),
                content_filter: ContentFilterMode::Hybrid,
                ..ReaderOptions::default()
            },
        );
        assert!(result.fit_markdown.contains("Ownership reference"));
        assert!(
            result
                .fit_scoring_debug
                .iter()
                .any(|debug| debug.link_score > 0.0 && debug.kept)
        );
    }
}
