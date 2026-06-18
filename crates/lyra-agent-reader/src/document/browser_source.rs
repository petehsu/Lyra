//! Browser snapshot source resolution and fallback decisions.

use std::time::Duration;

use crate::errors::ReaderError;
use crate::fetch::{BrowserSnapshotProvider, BrowserSnapshotRequest};
use crate::types::{
    BrowserSnapshotInput, Format, ReaderArtifact, ReaderEngine, ReaderInput, ReaderRequest,
    ReaderResult, WarningCode,
};

use super::source::{Source, SourceKind, input_url, resolve_source};

const DEFAULT_TIMEOUT_SECS: u64 = 20;
const AUTO_BROWSER_FALLBACK_MIN_TEXT_CHARS: usize = 80;

pub(super) fn browser_snapshot_source(snapshot: &BrowserSnapshotInput) -> Source {
    let mut artifacts = Vec::new();
    if let Some(id) = snapshot.screenshot_artifact_ref.as_ref() {
        artifacts.push(ReaderArtifact {
            id: Some(id.clone()),
            kind: "browser_screenshot".to_string(),
            mime_type: "image/png".to_string(),
        });
    }
    if let Some(id) = snapshot.pageshot_artifact_ref.as_ref() {
        artifacts.push(ReaderArtifact {
            id: Some(id.clone()),
            kind: "browser_pageshot".to_string(),
            mime_type: "image/png".to_string(),
        });
    }
    Source {
        bytes: snapshot.html.clone().into_bytes(),
        content_type: Some("text/html".to_string()),
        base_url: snapshot.final_url.clone(),
        final_url: snapshot.final_url.clone(),
        requested_url: snapshot
            .requested_url
            .clone()
            .or_else(|| snapshot.final_url.clone()),
        status: None,
        response_headers: Vec::new(),
        detect_hint: Some("text/html".to_string()),
        fetch_warnings: snapshot.warnings.clone(),
        fetch_ms: 0,
        source_kind: SourceKind::Browser,
        browser_title: snapshot.title.clone(),
        browser_body_text: snapshot.body_text.clone(),
        browser_viewport: snapshot.viewport.clone(),
        browser_selected_element: snapshot.selected_element.clone(),
        browser_frames: snapshot.frames.clone(),
        browser_shadow_roots: snapshot.shadow_roots.clone(),
        media: snapshot.media.clone(),
        artifacts,
    }
}

pub(super) fn auto_browser_fallback_reason(
    request: &ReaderRequest,
    result: &ReaderResult,
) -> String {
    if request.options.wait_for_selector.is_some() {
        return "waitForSelector requires a rendered browser snapshot".to_string();
    }
    if result
        .warnings
        .iter()
        .any(|warning| warning.code == WarningCode::BrowserRecommended)
    {
        return result
            .warnings
            .iter()
            .find(|warning| warning.code == WarningCode::BrowserRecommended)
            .map(|warning| warning.message.clone())
            .unwrap_or_else(|| "browser rendering recommended".to_string());
    }
    let text_chars = result.plain_text.trim().chars().count();
    format!(
        "http rendered only {text_chars} chars of extractable text; likely SPA shell or blocked content"
    )
}

pub(super) fn should_auto_browser_fallback(request: &ReaderRequest, result: &ReaderResult) -> bool {
    if !matches!(request.options.engine, ReaderEngine::Auto) {
        return false;
    }
    if !matches!(request.input, ReaderInput::Url(_)) {
        return false;
    }
    if request.options.wait_for_selector.is_some() {
        return true;
    }
    if result
        .warnings
        .iter()
        .any(|warning| warning.code == WarningCode::BrowserRecommended)
    {
        return true;
    }
    matches!(
        result.format,
        Format::Html | Format::Xml | Format::Rss | Format::Atom
    ) && result.plain_text.trim().chars().count() < AUTO_BROWSER_FALLBACK_MIN_TEXT_CHARS
}

pub(super) fn should_auto_browser_fallback_error(
    request: &ReaderRequest,
    error: &ReaderError,
) -> bool {
    if !matches!(request.options.engine, ReaderEngine::Auto) {
        return false;
    }
    if !matches!(request.input, ReaderInput::Url(_)) {
        return false;
    }
    matches!(
        error,
        ReaderError::AccessDenied {
            status: 401 | 403 | 451,
            ..
        }
    )
}

pub(super) fn resolve_browser_source(
    request: &ReaderRequest,
    browser: Option<&dyn BrowserSnapshotProvider>,
) -> Result<Source, ReaderError> {
    let Some(url) = input_url(request) else {
        return resolve_source(request, None);
    };
    let provider = browser.ok_or_else(|| ReaderError::Fetch {
        message: "browser snapshot provider is required for browser rendering".to_string(),
        final_url: Some(url.clone()),
        status: None,
    })?;
    let timeout = Duration::from_millis(
        request
            .options
            .browser_timeout_ms
            .unwrap_or(DEFAULT_TIMEOUT_SECS * 1_000)
            .max(250),
    );
    let snapshot = provider.snapshot(&BrowserSnapshotRequest {
        url: &url,
        tab_id: None,
        browser_mode: request.options.browser_mode,
        wait_for_selector: request.options.wait_for_selector.as_deref(),
        wait_until: request.options.wait_until,
        wait_text: request.options.query_focus.as_deref(),
        timeout,
        include_screenshot: request.options.include_screenshot,
        viewport: request.options.viewport.clone(),
        mobile: request.options.mobile,
        include_iframes: request.options.include_iframes,
        include_shadow_dom: request.options.include_shadow_dom,
        include_pageshot: request.options.include_pageshot,
        include_media: request.options.include_media,
        target_selector: request.options.target_selector.as_deref(),
    })?;
    let warnings = snapshot.warnings;
    let mut artifacts = snapshot.artifacts;
    if let Some(id) = snapshot.screenshot_artifact_ref.as_ref() {
        if !artifacts
            .iter()
            .any(|artifact| artifact.id.as_deref() == Some(id.as_str()))
        {
            artifacts.push(ReaderArtifact {
                id: Some(id.clone()),
                kind: "browser_screenshot".to_string(),
                mime_type: "image/png".to_string(),
            });
        }
    }
    if let Some(id) = snapshot.pageshot_artifact_ref.as_ref() {
        if !artifacts
            .iter()
            .any(|artifact| artifact.id.as_deref() == Some(id.as_str()))
        {
            artifacts.push(ReaderArtifact {
                id: Some(id.clone()),
                kind: "browser_pageshot".to_string(),
                mime_type: "image/png".to_string(),
            });
        }
    }
    Ok(Source {
        bytes: snapshot.html.into_bytes(),
        content_type: Some("text/html".to_string()),
        base_url: Some(snapshot.final_url.clone()),
        final_url: Some(snapshot.final_url.clone()),
        requested_url: Some(url),
        status: None,
        response_headers: Vec::new(),
        detect_hint: Some("text/html".to_string()),
        fetch_warnings: warnings,
        fetch_ms: 0,
        source_kind: SourceKind::Browser,
        browser_title: snapshot.title,
        browser_body_text: snapshot.body_text,
        browser_viewport: snapshot.viewport,
        browser_selected_element: snapshot.selected_element,
        browser_frames: snapshot.frames,
        browser_shadow_roots: snapshot.shadow_roots,
        media: snapshot.media,
        artifacts,
    })
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
    fn browser_snapshot_input_uses_html_pipeline_and_artifact_metadata() {
        let request = ReaderRequest {
                input: ReaderInput::BrowserSnapshot(BrowserSnapshotInput {
                    html: r#"<html><body><nav>Chrome</nav><main><h1>Rendered Title</h1><p>Rendered body with <a href="/next">next link</a>.</p></main></body></html>"#
                        .to_string(),
                    final_url: Some("https://x.test/app".to_string()),
                    requested_url: Some("https://x.test/app".to_string()),
                    title: Some("Browser Title".to_string()),
                    body_text: Some("Rendered body fallback".to_string()),
                    screenshot_artifact_ref: Some("artifact-browser-shot".to_string()),
                    pageshot_artifact_ref: Some("artifact-browser-pageshot".to_string()),
                    viewport: Some(crate::types::BrowserViewport {
                        width: 390,
                        height: 844,
                        device_scale_factor: Some(3.0),
                    }),
                    selected_element: Some(crate::types::BrowserSelectedElement {
                        selector: Some("main".to_string()),
                        html: Some("<main>Rendered body</main>".to_string()),
                        text: Some("Rendered body".to_string()),
                        bounds: None,
                    }),
                    frames: Vec::new(),
                    shadow_roots: Vec::new(),
                    media: vec![crate::types::ReaderMedia {
                        kind: "video".to_string(),
                        url: Some("https://x.test/movie.mp4".to_string()),
                        title: Some("Demo video".to_string()),
                        text: None,
                        poster: None,
                        mime_type: Some("video/mp4".to_string()),
                        width: Some(640),
                        height: Some(360),
                    }],
                    warnings: Vec::new(),
                }),
                options: ReaderOptions {
                    target_selector: Some("main".to_string()),
                    remove_selectors: vec!["nav".to_string()],
                    chunking: ChunkingOptions {
                        mode: ChunkingMode::Block,
                        max_chars_per_chunk: 80,
                        overlap_chars: 0,
                    },
                    ..ReaderOptions::default()
                },
            };

        let result = run(&request, None).expect("browser snapshot result");
        assert_eq!(result.extraction.method, "browser");
        assert!(result.markdown_with_citations.contains("Rendered body"));
        assert!(!result.markdown_with_citations.contains("Chrome"));
        assert!(result.links.iter().any(|link| link.url.ends_with("/next")));
        assert!(
            result
                .chunks
                .iter()
                .any(|chunk| chunk.markdown.contains("Rendered body"))
        );
        assert!(
            result
                .artifacts
                .iter()
                .any(|artifact| artifact.id.as_deref() == Some("artifact-browser-shot"))
        );
        assert!(
            result
                .artifacts
                .iter()
                .any(|artifact| artifact.id.as_deref() == Some("artifact-browser-pageshot"))
        );
        assert!(
            result
                .media
                .iter()
                .any(|media| media.url.as_deref() == Some("https://x.test/movie.mp4"))
        );
        assert!(!result.compact_text.contains("artifact-browser-shot"));
        assert!(!result.compact_text.contains("artifact-browser-pageshot"));
    }

    #[test]
    fn browser_engine_without_provider_returns_clear_error() {
        let request = ReaderRequest {
            input: ReaderInput::Url("https://x.test/app".to_string()),
            options: ReaderOptions {
                engine: ReaderEngine::Browser,
                ..ReaderOptions::default()
            },
        };

        let error = run(&request, None).expect_err("missing browser provider");
        assert!(matches!(
            error,
            ReaderError::EnginesExhausted { .. } | ReaderError::Fetch { .. }
        ));
        assert!(!error.engine_attempts().is_empty());
        assert!(
            error
                .recommended_next_action()
                .unwrap_or_default()
                .contains("browser")
        );
    }

    #[test]
    fn auto_engine_falls_back_to_browser_for_spa_shell() {
        let fetch = StaticFetch {
                body: br#"<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>"#.to_vec(),
                content_type: "text/html; charset=utf-8",
            };
        let browser = StaticBrowser;
        let request = ReaderRequest {
            input: ReaderInput::Url("https://x.test/app".to_string()),
            options: ReaderOptions::default(),
        };

        let result =
            run_with_browser(&request, Some(&fetch), Some(&browser)).expect("browser fallback");
        assert_eq!(result.extraction.method, "browser");
        assert_eq!(result.engine_used.as_deref(), Some("browser"));
        assert_eq!(result.engine_attempts.len(), 2);
        assert!(!result.engine_attempts[0].success);
        assert!(result.engine_attempts[1].success);
        assert!(result.compact_text.contains("Dynamic browser text"));
    }

    #[test]
    fn browser_snapshot_media_dedupes_with_static_html_media() {
        let request = ReaderRequest {
            input: ReaderInput::BrowserSnapshot(BrowserSnapshotInput {
                html: r#"<html><body><main>
                        <p>Rendered browser media page.</p>
                        <video src="/movie.mp4" title="Demo video"></video>
                    </main></body></html>"#
                    .to_string(),
                final_url: Some("https://x.test/app".to_string()),
                requested_url: Some("https://x.test/app".to_string()),
                title: Some("Browser Media".to_string()),
                body_text: None,
                screenshot_artifact_ref: None,
                pageshot_artifact_ref: None,
                viewport: None,
                selected_element: None,
                frames: Vec::new(),
                shadow_roots: Vec::new(),
                media: vec![crate::types::ReaderMedia {
                    kind: "video".to_string(),
                    url: Some("https://x.test/movie.mp4".to_string()),
                    title: Some("Demo video".to_string()),
                    text: None,
                    poster: None,
                    mime_type: None,
                    width: None,
                    height: None,
                }],
                warnings: Vec::new(),
            }),
            options: ReaderOptions {
                mode: ExtractionMode::Full,
                include_media: true,
                retain_media: MediaRetention::Summary,
                ..ReaderOptions::default()
            },
        };
        let result = run(&request, None).expect("browser media result");
        assert_eq!(
            result
                .media
                .iter()
                .filter(|media| media.url.as_deref() == Some("https://x.test/movie.mp4"))
                .count(),
            1
        );
        assert!(result.markdown_with_citations.contains("## Media"));
    }
}
