//! Format detection and rendering dispatch for resolved reader sources.

use std::time::Instant;

use crate::citation;
use crate::detect;
use crate::document_formats;
use crate::errors::ReaderError;
use crate::extract;
use crate::html::{clean, metadata, parse};
use crate::links;
use crate::markdown::Renderer;
#[cfg(test)]
use crate::types::DetectedBy;
use crate::types::{
    Detection, ExtractionMode, Format, ReaderDebugTrace, ReaderRequest, ReaderResult,
    ReaderWarning, WarningCode,
};

use super::assembler::{
    ProcessingTiming, assemble, assemble_rendered_document, debug_trace_enabled_by,
    debug_trace_requested,
};
use super::elapsed_ms;
use super::external::libreoffice;
use super::source::{Source, SourceKind};

const DEFAULT_MAX_DOM_BYTES: usize = 16 * 1024 * 1024;
const SPA_SHELL_MIN_TEXT_CHARS: usize = 80;

pub(super) fn render_source(
    request: &ReaderRequest,
    source: &Source,
) -> Result<ReaderResult, ReaderError> {
    let detection = detect::detect(
        &source.bytes,
        source.content_type.as_deref(),
        source.detect_hint.as_deref(),
    );

    match detection.format {
        Format::Html | Format::Xml | Format::Rss | Format::Atom => {
            render_html(request, source, detection)
        }
        Format::Pdf => render_pdf(request, source, detection),
        Format::Docx | Format::Xlsx | Format::Pptx => render_office(request, source, detection),
        Format::Image => render_image(request, source, detection),
        // Markdown / text / json / csv: pass through as a code-free body.
        Format::Markdown | Format::Text | Format::Json | Format::Csv => {
            render_plain(request, source, detection)
        }
        _ => Err(ReaderError::UnsupportedFormat {
            format: detection.format.label().to_string(),
            mime: detection
                .mime_type
                .clone()
                .or_else(|| source.content_type.clone())
                .unwrap_or_default(),
            final_url: source.final_url.clone(),
        }),
    }
}

pub(super) fn render_html(
    request: &ReaderRequest,
    source: &Source,
    detection: Detection,
) -> Result<ReaderResult, ReaderError> {
    let options = &request.options;
    let max_dom_bytes = options.max_dom_bytes.unwrap_or(DEFAULT_MAX_DOM_BYTES);
    if source.bytes.len() > max_dom_bytes {
        return Err(ReaderError::Budget(format!(
            "HTML/DOM source is {} bytes, exceeding maxDomBytes of {max_dom_bytes}",
            source.bytes.len()
        )));
    }
    let include_debug = debug_trace_requested(options);
    let parse_start = Instant::now();
    let parsed = parse::parse_bytes(&source.bytes, source.content_type.as_deref());
    let parse_ms = elapsed_ms(parse_start);

    let extract_start = Instant::now();
    // Metadata is extracted against a chrome-dropping plan so head/link/meta are
    // always available regardless of body cleaning.
    let meta_plan = clean::plan_with_filters(
        &parsed,
        source.base_url.as_deref(),
        true,
        &options.remove_selectors,
        &options.include_tags,
        &options.exclude_tags,
    )?;
    let mut metadata = if options.include_metadata {
        metadata::extract(&parsed, &meta_plan)
    } else {
        crate::types::ReaderMetadata::default()
    };
    if metadata.title.is_none() {
        metadata.title = source.browser_title.clone();
    }

    // For Main mode keep chrome in the plan so readability can score it out;
    // for Full/Text drop chrome up front.
    let drop_chrome = !matches!(options.mode, ExtractionMode::Main);
    let render_plan = clean::plan_with_filters(
        &parsed,
        source.base_url.as_deref(),
        drop_chrome,
        &options.remove_selectors,
        &options.include_tags,
        &options.exclude_tags,
    )?;
    let extracted = extract::extract(
        &parsed,
        &render_plan,
        options.mode,
        options.target_selector.as_deref(),
        include_debug,
    )?;
    let mut extraction_info = extracted.info;
    if matches!(options.mode, ExtractionMode::Raw) {
        extraction_info.method = "raw".to_string();
        extraction_info.main_content_confidence = 1.0;
        extraction_info.fallback_used = false;
    }
    if matches!(source.source_kind, SourceKind::Browser) {
        extraction_info.method = "browser".to_string();
        extraction_info.fallback_used = false;
    }
    let debug_trace = if include_debug {
        Some(ReaderDebugTrace {
            enabled_by: debug_trace_enabled_by(options),
            selected_extractor: extraction_info.method.clone(),
            fallback_reason: extracted.fallback_reason.clone(),
            cleaning: Some(render_plan.debug.clone()),
            extractor_candidates: extracted.debug_candidates.clone(),
        })
    } else {
        None
    };
    let extract_ms = elapsed_ms(extract_start);

    let render_start = Instant::now();
    let root = parsed
        .document
        .tree
        .get(extracted.root_id)
        .ok_or_else(|| ReaderError::Parse("extraction root vanished".to_string()))?;

    let emit_citations = citation::wants_citations(options.retain_links, options.citations);
    let renderer = Renderer::new(
        &render_plan,
        &options.markdown,
        options.retain_links,
        options.retain_images,
        options.retain_media,
        options.citation_format,
        options.include_media,
        emit_citations,
    );
    let rendered = renderer.render(root);

    let raw_body = if matches!(options.mode, ExtractionMode::Raw) {
        String::from_utf8_lossy(&source.bytes).into_owned()
    } else if rendered.markdown.trim().is_empty() {
        source
            .browser_body_text
            .clone()
            .unwrap_or(rendered.markdown)
    } else {
        rendered.markdown
    };
    let mut cited_body = raw_body.clone();
    if options.citations {
        if let Some(footer) = citation::references_footer(
            &rendered.citations,
            &rendered.links,
            options.citation_format,
        ) {
            cited_body.push_str("\n\n");
            cited_body.push_str(&footer);
        }
    }
    if let Some(footer) = citation::images_footer(&rendered.images, options.retain_images) {
        cited_body.push_str("\n\n");
        cited_body.push_str(&footer);
    }
    let mut rendered_media = rendered.media.clone();
    rendered_media.extend(source.media.iter().cloned());
    let final_media = links::finalize_media(&rendered_media);
    if let Some(footer) = citation::media_footer(&final_media, options.retain_media) {
        cited_body.push_str("\n\n");
        cited_body.push_str(&footer);
    }

    let final_links = links::finalize_links(&rendered.links);
    let final_images = links::finalize_images(&rendered.images);
    let render_ms = elapsed_ms(render_start);

    let mut warnings = parsed.warnings.clone();
    warnings.extend(source.fetch_warnings.iter().cloned());
    warnings.extend(extracted.warnings);
    if looks_like_spa_shell(&source.bytes, &cited_body) {
        warnings.push(ReaderWarning {
            code: WarningCode::BrowserRecommended,
            message: "page looks like a client-rendered app shell; browser rendering may be needed"
                .to_string(),
        });
    }

    assemble(
        request,
        source,
        detection,
        raw_body,
        cited_body,
        metadata,
        final_links,
        final_images,
        final_media,
        extraction_info,
        warnings,
        ProcessingTiming {
            parse_ms,
            extract_ms,
            render_ms,
        },
        debug_trace,
    )
}

fn render_plain(
    request: &ReaderRequest,
    source: &Source,
    detection: Detection,
) -> Result<ReaderResult, ReaderError> {
    let render_start = Instant::now();
    let text = match std::str::from_utf8(&source.bytes) {
        Ok(value) => value.to_string(),
        Err(_) => String::from_utf8_lossy(&source.bytes).into_owned(),
    };
    let render_ms = elapsed_ms(render_start);
    let info = crate::types::ExtractionInfo {
        method: "passthrough".to_string(),
        main_content_confidence: 1.0,
        fallback_used: false,
    };
    assemble(
        request,
        source,
        detection,
        text.clone(),
        text,
        crate::types::ReaderMetadata::default(),
        Vec::new(),
        Vec::new(),
        source.media.clone(),
        info,
        source.fetch_warnings.clone(),
        ProcessingTiming {
            render_ms,
            ..ProcessingTiming::default()
        },
        None,
    )
}

fn render_pdf(
    request: &ReaderRequest,
    source: &Source,
    detection: Detection,
) -> Result<ReaderResult, ReaderError> {
    let render_start = Instant::now();
    let rendered = document_formats::render_pdf(
        &source.bytes,
        source
            .content_type
            .as_deref()
            .or(detection.mime_type.as_deref()),
        source.final_url.as_deref(),
    )?;
    assemble_rendered_document(
        request,
        source,
        detection,
        rendered,
        elapsed_ms(render_start),
    )
}

fn render_office(
    request: &ReaderRequest,
    source: &Source,
    detection: Detection,
) -> Result<ReaderResult, ReaderError> {
    let adapter = libreoffice::try_libreoffice_html(&source.bytes, detection.format);
    if let Some(html) = adapter.html {
        let html_source = Source {
            bytes: html.into_bytes(),
            content_type: Some("text/html".to_string()),
            base_url: source.base_url.clone(),
            final_url: source.final_url.clone(),
            requested_url: source.requested_url.clone(),
            status: source.status,
            response_headers: source.response_headers.clone(),
            detect_hint: Some("text/html".to_string()),
            fetch_warnings: {
                let mut warnings = source.fetch_warnings.clone();
                warnings.extend(adapter.warnings);
                warnings
            },
            fetch_ms: source.fetch_ms,
            source_kind: source.source_kind,
            browser_title: source.browser_title.clone(),
            browser_body_text: source.browser_body_text.clone(),
            browser_viewport: source.browser_viewport.clone(),
            browser_selected_element: source.browser_selected_element.clone(),
            browser_frames: source.browser_frames.clone(),
            browser_shadow_roots: source.browser_shadow_roots.clone(),
            ax_elements: source.ax_elements.clone(),
            media: source.media.clone(),
            artifacts: source.artifacts.clone(),
        };
        return render_html(
            request,
            &html_source,
            Detection {
                format: Format::Html,
                mime_type: Some("text/html".to_string()),
                detected_by: detection.detected_by,
                confidence: detection.confidence,
            },
        );
    }

    let render_start = Instant::now();
    let rendered = document_formats::render_office_fallback(
        detection.format.label(),
        &source.bytes,
        source.final_url.as_deref(),
    )?;
    let mut result = assemble_rendered_document(
        request,
        source,
        detection,
        rendered,
        elapsed_ms(render_start),
    )?;
    result.warnings.extend(adapter.warnings);
    Ok(result)
}

pub(super) fn render_image(
    request: &ReaderRequest,
    source: &Source,
    detection: Detection,
) -> Result<ReaderResult, ReaderError> {
    let render_start = Instant::now();
    let rendered = document_formats::render_image(
        &source.bytes,
        source
            .content_type
            .as_deref()
            .or(detection.mime_type.as_deref()),
        source.final_url.as_deref(),
        request.options.use_ocr,
        request.options.use_caption,
    );
    assemble_rendered_document(
        request,
        source,
        detection,
        rendered,
        elapsed_ms(render_start),
    )
}

fn looks_like_spa_shell(bytes: &[u8], markdown: &str) -> bool {
    let readable_chars = markdown
        .chars()
        .filter(|ch| ch.is_alphanumeric() || ch.is_whitespace())
        .count();
    if readable_chars > 240 {
        return false;
    }
    let html = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    let has_app_root = html.contains("id=\"root\"")
        || html.contains("id='root'")
        || html.contains("id=\"app\"")
        || html.contains("id='app'")
        || html.contains("data-reactroot")
        || html.contains("ng-version");
    let has_next_root = html.contains("id=\"__next\"") || html.contains("id='__next'");
    let script_count = html.matches("<script").count();
    let has_bundle = html.contains(".js")
        || html.contains("/assets/")
        || html.contains("vite")
        || html.contains("_next/static/");
    if has_app_root && script_count > 0 && has_bundle {
        return true;
    }
    let has_rsc_streaming = html.contains("self.__next_f.push")
        || html.contains("self.__next_f(")
        || html.contains("__next_router_state_tree");
    if has_next_root
        && script_count > 0
        && (readable_chars < SPA_SHELL_MIN_TEXT_CHARS
            || (has_rsc_streaming && readable_chars < 120))
    {
        return true;
    }
    false
}

/// Build the `DetectedBy::Default`-style detection for raw inputs. Currently
/// unused outside tests but kept for symmetry with `detect`.
#[cfg(test)]
fn html_detection() -> Detection {
    Detection {
        format: Format::Html,
        mime_type: Some("text/html".to_string()),
        detected_by: DetectedBy::MimeType,
        confidence: 1.0,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, unused_imports)]
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
    fn full_pipeline_renders_markdown() {
        let html = r#"<html><head><title>T</title></head><body>
                <article>
                  <h1>Heading</h1>
                  <p>A paragraph with <strong>bold</strong> and a <a href="https://l.test/x">link</a>.</p>
                  <pre><code class="language-rust">fn main() {}</code></pre>
                </article>
            </body></html>"#;
        let result = read_html(html, ReaderOptions::default());
        assert_eq!(result.format, Format::Html);
        assert!(result.raw_markdown.contains("# Heading"));
        assert!(result.markdown_with_citations.contains("## References"));
        assert!(result.raw_markdown.contains("**bold**"));
        assert!(result.raw_markdown.contains("```rust"));
        assert!(!result.links.is_empty());
        assert_eq!(result.frontmatter.title.as_deref(), Some("T"));
        let timing = result.timing.as_ref().expect("timing");
        assert!(timing.total_ms >= timing.parse_ms);
        assert!(!result.compact_text.contains("fetchMs"));
    }

    #[test]
    fn detection_helper_compiles() {
        assert_eq!(html_detection().format, Format::Html);
    }

    #[test]
    fn spa_shell_warns_and_recommends_browser_path() {
        let html = r#"<html><head><title>App</title></head><body>
                <div id="root"></div>
                <script src="/assets/app.bundle.js"></script>
            </body></html>"#;
        let result = read_html(html, ReaderOptions::default());
        assert!(
            result
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::BrowserRecommended)
        );
        assert!(
            result
                .recommended_next_action
                .as_deref()
                .unwrap_or("")
                .contains("browser-rendered")
        );
    }

    #[test]
    fn rsc_streaming_intermediate_state_detected_as_spa_shell() {
        // Simulates a Next.js RSC streaming intermediate state: the HTML has
        // `self.__next_f.push(...)` calls and a `__next` container, but the
        // body text is sparse (loading fallbacks, empty segments).
        let html = r#"<html><head><title>App</title></head><body>
                <div id="__next"><div>Loading...</div></div>
                <script>self.__next_f.push([1,"k:[]"])</script>
                <script>self.__next_f.push([1,"k2:[]"])</script>
            </body></html>"#;
        assert!(looks_like_spa_shell(html.as_bytes(), "Loading"));
    }

    #[test]
    fn nextjs_ssr_with_real_content_not_spa_shell() {
        // A fully server-rendered Next.js page with real article content should
        // NOT be detected as SPA shell, even though it contains `__next` and
        // `self.__next_f.push` markers.
        let markdown = "Welcome to the Blog This is a full article with enough content to pass the readability threshold and should not trigger the SPA shell detection. Here is more text about the topic at hand.";
        let html = r#"<html><head><title>Blog Post</title></head><body>
                <div id="__next"><main><h1>Welcome to the Blog</h1>
                <p>This is a full article with enough content to pass the readability threshold
                and should not trigger the SPA shell detection.</p>
                <p>Here is more text about the topic at hand.</p>
                </main></div>
                <script>self.__next_f.push([1,"pageData"])</script>
            </body></html>"#;
        assert!(!looks_like_spa_shell(html.as_bytes(), markdown));
    }

    #[test]
    fn target_selector_only_renders_matching_content() {
        let html = r#"<html><body>
                <main><p>Keep this article text with enough words to render.</p></main>
                <section><p>Drop this sidebar text completely.</p></section>
            </body></html>"#;
        let options = ReaderOptions {
            target_selector: Some("main".to_string()),
            ..ReaderOptions::default()
        };
        let result = read_html(html, options);
        assert!(result.raw_markdown.contains("Keep this article"));
        assert!(!result.raw_markdown.contains("Drop this sidebar"));
        assert_eq!(result.extraction.method, "selector");
    }

    #[test]
    fn target_selector_errors_when_missing() {
        let error = read_html_result(
            "<html><body><p>Only body</p></body></html>",
            ReaderOptions {
                target_selector: Some(".missing".to_string()),
                ..ReaderOptions::default()
            },
        )
        .expect_err("missing selector should fail");
        assert!(
            error
                .to_string()
                .contains("target selector matched no elements")
        );
    }

    #[test]
    fn target_selector_errors_when_invalid() {
        let error = read_html_result(
            "<html><body><p>Only body</p></body></html>",
            ReaderOptions {
                target_selector: Some("[".to_string()),
                ..ReaderOptions::default()
            },
        )
        .expect_err("invalid selector should fail");
        assert!(error.to_string().contains("invalid selector"));
    }

    #[test]
    fn remove_selectors_drop_noise() {
        let html = r#"<html><body><main>
                <p>Useful content remains visible and readable.</p>
                <div class="ad">Advertisement should disappear.</div>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                remove_selectors: vec![".ad".to_string()],
                ..ReaderOptions::default()
            },
        );
        assert!(result.raw_markdown.contains("Useful content"));
        assert!(!result.raw_markdown.contains("Advertisement"));
    }

    #[test]
    fn link_summary_keeps_text_and_appends_references() {
        let html = r#"<html><body><main>
                <p>Read the <a href="https://example.test/docs">docs</a> now.</p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                retain_links: LinkRetention::Summary,
                ..ReaderOptions::default()
            },
        );
        assert!(
            result
                .markdown_with_citations
                .contains("Read the docs now.")
        );
        assert!(
            !result
                .markdown_with_citations
                .contains("[docs](https://example.test/docs)")
        );
        assert!(result.markdown_with_citations.contains("## References"));
        assert!(
            result
                .markdown_with_citations
                .contains("https://example.test/docs")
        );
    }

    #[test]
    fn default_heading_and_citation_format_stay_atx_square() {
        let html = r#"<html><body><main>
                <h1>Default Heading</h1>
                <p>Read <a href="https://example.test/docs">docs</a>.</p>
            </main></body></html>"#;
        let result = read_html(html, ReaderOptions::default());
        assert!(result.markdown_with_citations.contains("# Default Heading"));
        assert!(
            result
                .markdown_with_citations
                .contains("[docs](https://example.test/docs)[1]")
        );
        assert!(
            result
                .markdown_with_citations
                .contains("[1] docs — https://example.test/docs")
        );
    }

    #[test]
    fn setext_heading_style_affects_h1_h2_only() {
        let html = r#"<html><body><main>
                <h1>Main Heading</h1>
                <h2>Sub Heading</h2>
                <h3>Deep Heading</h3>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                markdown: crate::types::MarkdownOptions {
                    heading_style: HeadingStyle::Setext,
                    ..crate::types::MarkdownOptions::default()
                },
                ..ReaderOptions::default()
            },
        );
        assert!(result.raw_markdown.contains("Main Heading\n============"));
        assert!(result.raw_markdown.contains("Sub Heading\n-----------"));
        assert!(result.raw_markdown.contains("### Deep Heading"));
    }

    #[test]
    fn citation_format_angle_and_source_affect_inline_and_footer() {
        let html = r#"<html><body><main>
                <p>Read <a href="https://example.test/docs">docs</a>.</p>
            </main></body></html>"#;
        let angle = read_html(
            html,
            ReaderOptions {
                citation_format: CitationFormat::Angle,
                ..ReaderOptions::default()
            },
        );
        assert!(
            angle
                .markdown_with_citations
                .contains("docs](https://example.test/docs)⟨1⟩")
        );
        assert!(
            angle
                .markdown_with_citations
                .contains("⟨1⟩ docs — https://example.test/docs")
        );

        let source = read_html(
            html,
            ReaderOptions {
                citation_format: CitationFormat::Source,
                ..ReaderOptions::default()
            },
        );
        assert!(
            source
                .markdown_with_citations
                .contains("docs](https://example.test/docs)【1†source】")
        );
        assert!(
            source
                .markdown_with_citations
                .contains("【1†source】 docs — https://example.test/docs")
        );
    }

    #[test]
    fn link_summary_uses_selected_footer_format_without_inline_marker() {
        let html = r#"<html><body><main>
                <p>Read the <a href="https://example.test/docs">docs</a> now.</p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                retain_links: LinkRetention::Summary,
                citation_format: CitationFormat::Source,
                ..ReaderOptions::default()
            },
        );
        assert!(
            result
                .markdown_with_citations
                .contains("Read the docs now.")
        );
        assert!(!result.markdown_with_citations.contains("docs【1†source】"));
        assert!(
            result
                .markdown_with_citations
                .contains("【1†source】 docs — https://example.test/docs")
        );
    }

    #[test]
    fn preserve_html_tags_outputs_sanitized_inline_html() {
        let html = r#"<html><body><main>
                <p>Use <mark class="loud" onclick="bad()">highlight</mark> and <abbr title="HyperText" style="bad">HTML</abbr>.</p>
                <p>Keep <mark>&lt;img src=x onerror=bad()&gt;</mark> escaped.</p>
                <p><span onclick="bad()">Span fallback</span>.</p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                markdown: crate::types::MarkdownOptions {
                    preserve_html_tags: vec!["mark".to_string(), "abbr".to_string()],
                    ..crate::types::MarkdownOptions::default()
                },
                ..ReaderOptions::default()
            },
        );
        assert!(
            result
                .raw_markdown
                .contains(r#"<mark>highlight</mark> and <abbr title="HyperText">HTML</abbr>"#)
        );
        assert!(
            result
                .raw_markdown
                .contains("&lt;img src=x onerror=bad()&gt;")
        );
        assert!(!result.raw_markdown.contains("<img src=x"));
        assert!(result.raw_markdown.contains("Span fallback"));
        assert!(!result.raw_markdown.contains("onclick"));
        assert!(!result.raw_markdown.contains("class="));
        assert!(!result.raw_markdown.contains("style="));
    }

    #[test]
    fn tracking_whitespace_is_removed_outside_code_blocks() {
        let html = "<html><body><main>\
                <p>al\u{200B}pha\u{FEFF} beta</p>\
                <pre><code>a\u{200B}b</code></pre>\
            </main></body></html>";
        let result = read_html(html, ReaderOptions::default());
        assert!(result.raw_markdown.contains("alpha beta"));
        assert!(result.raw_markdown.contains("a\u{200B}b"));
    }

    #[test]
    fn image_summary_keeps_alt_and_appends_images() {
        let html = r#"<html><body><main>
                <p><img src="/hero.png" alt="Hero diagram"></p>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                retain_images: ImageRetention::Summary,
                ..ReaderOptions::default()
            },
        );
        assert!(result.markdown_with_citations.contains("Hero diagram"));
        assert!(!result.markdown_with_citations.contains("![Hero diagram]"));
        assert!(result.markdown_with_citations.contains("## Images"));
        assert!(
            result
                .markdown_with_citations
                .contains("https://x.test/hero.png")
        );
    }

    #[test]
    fn media_summary_extracts_static_embeds_and_canonical_urls() {
        let html = r#"<html><body><main>
                <p>Media examples with enough readable text for extraction.</p>
                <video title="Launch demo" poster="/poster.jpg" width="640" height="360">
                  <source src="/movie.mp4" type="video/mp4">
                </video>
                <audio src="/theme.mp3" title="Theme audio" type="audio/mpeg"></audio>
                <iframe src="https://www.youtube.com/embed/abc123?start=4" title="YouTube embed"></iframe>
                <embed src="https://player.vimeo.com/video/987654" title="Vimeo embed" type="text/html">
                <object data="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD" title="Bilibili embed"></object>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                mode: ExtractionMode::Full,
                include_media: true,
                retain_media: MediaRetention::Summary,
                ..ReaderOptions::default()
            },
        );
        assert!(result.media.iter().any(|media| {
            media.kind == "video"
                && media.url.as_deref() == Some("https://x.test/movie.mp4")
                && media.poster.as_deref() == Some("https://x.test/poster.jpg")
                && media.mime_type.as_deref() == Some("video/mp4")
        }));
        assert!(result.media.iter().any(|media| {
            media.kind == "audio" && media.url.as_deref() == Some("https://x.test/theme.mp3")
        }));
        assert!(result.media.iter().any(|media| {
            media.url.as_deref() == Some("https://www.youtube.com/watch?v=abc123")
        }));
        assert!(
            result
                .media
                .iter()
                .any(|media| media.url.as_deref() == Some("https://vimeo.com/987654"))
        );
        assert!(result.media.iter().any(|media| {
            media.url.as_deref() == Some("https://www.bilibili.com/video/BV1xx411c7mD")
        }));
        assert!(result.markdown_with_citations.contains("## Media"));
        assert!(
            result
                .markdown_with_citations
                .contains("YouTube embed — https://www.youtube.com/watch?v=abc123")
        );
    }

    #[test]
    fn media_retention_none_collects_raw_without_footer() {
        let html = r#"<html><body><main>
                <p>Readable page with a video embed.</p>
                <iframe src="https://youtu.be/abc123" title="Demo clip"></iframe>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                mode: ExtractionMode::Full,
                include_media: true,
                retain_media: MediaRetention::None,
                ..ReaderOptions::default()
            },
        );
        assert!(
                result
                    .media
                    .iter()
                    .any(|media| media.url.as_deref()
                        == Some("https://www.youtube.com/watch?v=abc123"))
            );
        assert!(!result.markdown_with_citations.contains("## Media"));
        assert!(
            !result
                .markdown_with_citations
                .contains("https://www.youtube.com/watch?v=abc123")
        );
    }

    #[test]
    fn media_retention_link_text_and_html_modes_render_safely() {
        let html = r#"<html><body><main>
                <p>Readable page with a video embed.</p>
                <iframe src="https://www.youtube.com/embed/abc123" title="Demo clip" onclick="bad()" width="560" height="315"></iframe>
            </main></body></html>"#;
        let link_result = read_html(
            html,
            ReaderOptions {
                mode: ExtractionMode::Full,
                include_media: true,
                retain_media: MediaRetention::Link,
                ..ReaderOptions::default()
            },
        );
        assert!(
            link_result
                .markdown_with_citations
                .contains("[Demo clip](https://www.youtube.com/watch?v=abc123)")
        );

        let text_result = read_html(
            html,
            ReaderOptions {
                mode: ExtractionMode::Full,
                include_media: true,
                retain_media: MediaRetention::Text,
                ..ReaderOptions::default()
            },
        );
        assert!(text_result.markdown_with_citations.contains("Demo clip"));
        assert!(
            !text_result
                .markdown_with_citations
                .contains("https://www.youtube.com/watch?v=abc123")
        );

        let html_result = read_html(
            html,
            ReaderOptions {
                mode: ExtractionMode::Full,
                include_media: true,
                retain_media: MediaRetention::Html,
                ..ReaderOptions::default()
            },
        );
        assert!(html_result.markdown_with_citations.contains(
                r#"<iframe src="https://www.youtube.com/watch?v=abc123" title="Demo clip" width="560" height="315"></iframe>"#
            ));
        assert!(!html_result.markdown_with_citations.contains("onclick"));
    }

    #[test]
    fn default_options_do_not_extract_or_render_static_media() {
        let html = r#"<html><body><main>
                <p>Readable page with a video embed.</p>
                <iframe src="https://www.youtube.com/embed/abc123" title="Demo clip"></iframe>
            </main></body></html>"#;
        let result = read_html(
            html,
            ReaderOptions {
                mode: ExtractionMode::Full,
                ..ReaderOptions::default()
            },
        );
        assert!(result.media.is_empty());
        assert!(!result.markdown_with_citations.contains("## Media"));
        assert!(
            !result
                .markdown_with_citations
                .contains("https://www.youtube.com")
        );
    }

    #[test]
    fn image_metadata_includes_dimensions_caption_and_decorative_flag() {
        let html = r#"<html><body><main>
                <figure>
                  <img src="/diagram.png" alt="Architecture" width="640" height="320">
                  <figcaption>System architecture diagram</figcaption>
                </figure>
                <img src="/pixel.gif" alt="" width="1" height="1">
            </main></body></html>"#;
        let result = read_html(html, ReaderOptions::default());
        let diagram = result
            .images
            .iter()
            .find(|image| image.url.ends_with("/diagram.png"))
            .expect("diagram image");
        assert_eq!(diagram.width, Some(640));
        assert_eq!(diagram.height, Some(320));
        assert_eq!(
            diagram.caption.as_deref(),
            Some("System architecture diagram")
        );
        assert!(!diagram.likely_decorative);

        let pixel = result
            .images
            .iter()
            .find(|image| image.url.ends_with("/pixel.gif"))
            .expect("pixel image");
        assert!(pixel.likely_decorative);
    }

    #[test]
    fn pdf_bytes_render_text_result() {
        let result = read_bytes_result(
            build_simple_pdf("Hello Agent PDF"),
            "application/pdf",
            "https://x.test/report.pdf",
        )
        .expect("pdf result");
        assert_eq!(result.format, Format::Pdf);
        assert!(result.markdown_with_citations.contains("# PDF Document"));
        assert!(result.markdown_with_citations.contains("<!-- page: 1 -->"));
        assert!(result.markdown_with_citations.contains("Hello Agent PDF"));
        assert!(result.compact_text.contains("Hello Agent PDF"));
        assert!(result.extraction.method.contains("pdf"));
    }

    #[test]
    fn multi_page_pdf_outputs_page_aware_chunks_and_removes_repeated_boundaries() {
        let pdf = build_multi_page_pdf(&[
            &[
                "Fixture Report Header",
                "First page body alpha content for chunk metadata",
                "Fixture Footer",
            ],
            &[
                "Fixture Report Header",
                "Second page body beta content for chunk metadata",
                "Fixture Footer",
            ],
        ]);
        let result = read_bytes_result_with_options(
            pdf,
            "application/pdf",
            "https://x.test/multi.pdf",
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Block,
                    max_chars_per_chunk: 80,
                    overlap_chars: 0,
                },
                ..ReaderOptions::default()
            },
        )
        .expect("multi-page pdf result");

        assert!(result.markdown_with_citations.contains("<!-- page: 1 -->"));
        assert!(result.markdown_with_citations.contains("<!-- page: 2 -->"));
        assert!(
            result
                .markdown_with_citations
                .contains("First page body alpha")
        );
        assert!(
            result
                .markdown_with_citations
                .contains("Second page body beta")
        );
        assert!(
            !result
                .markdown_with_citations
                .contains("Fixture Report Header")
        );
        assert!(!result.markdown_with_citations.contains("Fixture Footer"));
        assert!(result.chunks.iter().any(|chunk| {
            chunk.page_start == Some(1)
                && chunk.page_end == Some(1)
                && chunk.markdown.contains("First page body")
        }));
        assert!(result.chunks.iter().any(|chunk| {
            chunk.page_start == Some(2)
                && chunk.page_end == Some(2)
                && chunk.markdown.contains("Second page body")
        }));
    }

    #[test]
    fn table_heavy_pdf_preserves_text_and_page_metadata() {
        let pdf = build_multi_page_pdf(&[&[
            "Metric        Q1     Q2",
            "Reader runs   1200   1640",
            "Chunk reads   310    620",
        ]]);
        let result = read_bytes_result_with_options(
            pdf,
            "application/pdf",
            "https://x.test/table.pdf",
            ReaderOptions {
                chunking: ChunkingOptions {
                    mode: ChunkingMode::Block,
                    max_chars_per_chunk: 120,
                    overlap_chars: 0,
                },
                ..ReaderOptions::default()
            },
        )
        .expect("table-heavy pdf result");

        assert!(result.markdown_with_citations.contains("Metric"));
        assert!(result.markdown_with_citations.contains("Reader runs"));
        assert!(result.markdown_with_citations.contains("Chunk reads"));
        assert!(
            result
                .chunks
                .iter()
                .any(|chunk| chunk.page_start == Some(1) && chunk.page_end == Some(1))
        );
    }

    #[test]
    fn empty_pdf_recommends_ocr() {
        let result = read_bytes_result(
            build_simple_pdf(""),
            "application/pdf",
            "https://x.test/scanned.pdf",
        )
        .expect("empty pdf result");
        assert!(
            result
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::OcrRecommended)
        );
        assert!(
            result
                .markdown_with_citations
                .contains("No extractable text")
        );
    }

    #[test]
    fn docx_pptx_xlsx_fallback_extracts_basic_text() {
        let docx = zip_bytes(&[
            (
                "word/document.xml",
                r#"<w:document><w:body>
                        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>DOCX Heading</w:t></w:r></w:p>
                        <w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>DOCX list item</w:t></w:r></w:p>
                        <w:p><w:r><w:t>Read </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>docs link</w:t></w:r></w:hyperlink></w:p>
                        <w:tbl>
                          <w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr>
                          <w:tr><w:tc><w:p><w:r><w:t>Alpha</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr>
                        </w:tbl>
                      </w:body></w:document>"#,
            ),
            (
                "word/_rels/document.xml.rels",
                r#"<Relationships><Relationship Id="rId5" Target="https://example.test/docs"/></Relationships>"#,
            ),
        ]);
        let docx_result = read_bytes_result(
            docx,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "https://x.test/doc.docx",
        )
        .expect("docx result");
        assert!(
            docx_result
                .markdown_with_citations
                .contains("# DOCX Heading")
        );
        assert!(
            docx_result
                .markdown_with_citations
                .contains("- DOCX list item")
        );
        assert!(
            docx_result
                .markdown_with_citations
                .contains("[docs link](https://example.test/docs)")
        );
        assert!(
            docx_result
                .markdown_with_citations
                .contains("|Name | Value |")
                || docx_result
                    .markdown_with_citations
                    .contains("|Name | Value|")
                || docx_result
                    .markdown_with_citations
                    .contains("| Name | Value |")
        );
        assert!(docx_result.extraction.fallback_used);

        let pptx = zip_bytes(&[
            (
                "ppt/slides/slide1.xml",
                r#"<p:sld><a:t>PPTX slide text</a:t></p:sld>"#,
            ),
            (
                "ppt/notesSlides/notesSlide1.xml",
                r#"<p:notes><a:t>Speaker note text</a:t></p:notes>"#,
            ),
        ]);
        let pptx_result = read_bytes_result(
            pptx,
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "https://x.test/deck.pptx",
        )
        .expect("pptx result");
        assert!(
            pptx_result
                .markdown_with_citations
                .contains("PPTX slide text")
        );
        assert!(
            pptx_result
                .markdown_with_citations
                .contains("Speaker note text")
        );

        let xlsx = zip_bytes(&[
            (
                "xl/sharedStrings.xml",
                r#"<sst><si><t>Header</t></si><si><t>Cell value</t></si><si><t>Second sheet</t></si></sst>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData>
                        <row><c t="s"><v>0</v></c><c><f>SUM(A2:A2)</f><v>7</v></c></row>
                        <row><c t="s"><v>1</v></c><c><v>7</v></c></row>
                      </sheetData></worksheet>"#,
            ),
            (
                "xl/worksheets/sheet2.xml",
                r#"<worksheet><sheetData><row><c t="s"><v>2</v></c></row></sheetData></worksheet>"#,
            ),
        ]);
        let xlsx_result = read_bytes_result(
            xlsx,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "https://x.test/book.xlsx",
        )
        .expect("xlsx result");
        assert!(
            xlsx_result
                .markdown_with_citations
                .contains("=SUM(A2:A2) (7)")
        );
        assert!(xlsx_result.markdown_with_citations.contains("## Sheet 2"));
        assert!(xlsx_result.markdown_with_citations.contains("Second sheet"));
    }

    #[test]
    fn image_bytes_render_metadata_and_svg_text() {
        let mut png = vec![0u8; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1A\n");
        png[16..20].copy_from_slice(&640u32.to_be_bytes());
        png[20..24].copy_from_slice(&320u32.to_be_bytes());
        let png_result =
            read_bytes_result(png, "image/png", "https://x.test/image.png").expect("png result");
        assert_eq!(png_result.format, Format::Image);
        assert!(
            png_result
                .markdown_with_citations
                .contains("Dimensions: 640 x 320")
        );
        assert!(
            png_result
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::OcrRecommended)
        );

        let svg = br#"<svg><title>Diagram title</title><desc>Flow &amp; state</desc><text>Visible label</text><script>alert(1)</script></svg>"#.to_vec();
        let svg_result = read_bytes_result(svg, "image/svg+xml", "https://x.test/diagram.svg")
            .expect("svg result");
        assert!(svg_result.markdown_with_citations.contains("Diagram title"));
        assert!(svg_result.markdown_with_citations.contains("Flow & state"));
        assert!(svg_result.markdown_with_citations.contains("Visible label"));
        assert!(!svg_result.markdown_with_citations.contains("alert(1)"));
        assert!(
            !svg_result
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::OcrRecommended)
        );
    }

    #[test]
    fn image_ocr_and_caption_can_be_disabled() {
        let mut png = vec![0u8; 24];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1A\n");
        png[16..20].copy_from_slice(&16u32.to_be_bytes());
        png[20..24].copy_from_slice(&8u32.to_be_bytes());
        let result = read_bytes_result_with_options(
            png,
            "image/png",
            "https://x.test/image.png",
            ReaderOptions {
                use_ocr: false,
                use_caption: false,
                ..ReaderOptions::default()
            },
        )
        .expect("png result");
        assert!(
            result
                .markdown_with_citations
                .contains("Dimensions: 16 x 8")
        );
        assert!(!result.markdown_with_citations.contains("## OCR Text"));
        assert!(!result.warnings.iter().any(|warning| matches!(
            warning.code,
            WarningCode::OcrRecommended
                | WarningCode::OcrUnavailable
                | WarningCode::CaptionUnavailable
        )));
    }

    #[test]
    fn unsupported_binary_returns_recommendation_helper() {
        let err = read_bytes_result(
            vec![0, 159, 146, 150, 0, 1],
            "application/octet-stream",
            "https://x.test/blob.bin",
        )
        .expect_err("unsupported binary");
        assert!(matches!(err, ReaderError::UnsupportedFormat { .. }));
        assert!(err.recommended_next_action().is_none());
    }
}
