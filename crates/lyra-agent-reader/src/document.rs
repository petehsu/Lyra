//! Top-level pipeline: detect → route → render → assemble [`ReaderResult`].

#[path = "document/cache.rs"]
mod cache;
#[path = "document/caption.rs"]
mod caption;
#[path = "document/image.rs"]
mod image;
#[path = "document/ocr.rs"]
mod ocr;
#[path = "document/office.rs"]
mod office;
#[path = "document/pdf.rs"]
mod pdf;
#[path = "document/security.rs"]
mod security;

use chrono::Utc;
use sha2::{Digest, Sha256};
use std::net::{IpAddr, ToSocketAddrs};
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use crate::budget;
use crate::chunk;
use crate::citation;
use crate::detect;
use crate::document_formats;
use crate::errors::ReaderError;
use crate::extract;
use crate::fetch::{BrowserSnapshotProvider, BrowserSnapshotRequest, FetchProvider, FetchRequest};
use crate::html::{clean, metadata, parse};
use crate::links;
use crate::markdown::Renderer;
#[cfg(test)]
use crate::types::DetectedBy;
use crate::types::{
    BrowserFrameSummary, BrowserSelectedElement, BrowserShadowRootSummary, BrowserSnapshotInput,
    BrowserViewport, ChunkingMode, Detection, ExtractionMode, Format, Frontmatter, ReaderArtifact,
    ReaderDebugTrace, ReaderEngine, ReaderInput, ReaderMedia, ReaderRequest, ReaderResult,
    ReaderTiming, ReaderWarning, WarningCode,
};

const DEFAULT_USER_AGENT: &str = "Lyra Agent/0.1";
const DEFAULT_TIMEOUT_SECS: u64 = 20;
const DEFAULT_REDIRECT_LIMIT: usize = 5;
const DEFAULT_MAX_BYTES: usize = 8 * 1024 * 1024;
const TRUSTED_LOCAL_MAX_BYTES: usize = 64 * 1024 * 1024;
const DEFAULT_MAX_DOM_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_MAX_EXTRACTED_CHARS: usize = 1_000_000;
const DEFAULT_RESOURCE_LIMIT: usize = 500;
const LIBREOFFICE_TIMEOUT: Duration = Duration::from_secs(20);
const AUTO_BROWSER_FALLBACK_MIN_TEXT_CHARS: usize = 80;
const DEFAULT_ACCEPT: &str =
    "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5";

/// Run the full pipeline for `request`, fetching via `fetch` when needed.
pub fn run(
    request: &ReaderRequest,
    fetch: Option<&dyn FetchProvider>,
) -> Result<ReaderResult, ReaderError> {
    run_with_optional_browser(request, fetch, None)
}

/// Run the pipeline with an optional browser snapshot provider.
pub fn run_with_browser(
    request: &ReaderRequest,
    fetch: Option<&dyn FetchProvider>,
    browser: Option<&dyn BrowserSnapshotProvider>,
) -> Result<ReaderResult, ReaderError> {
    run_with_optional_browser(request, fetch, browser)
}

fn run_with_optional_browser(
    request: &ReaderRequest,
    fetch: Option<&dyn FetchProvider>,
    browser: Option<&dyn BrowserSnapshotProvider>,
) -> Result<ReaderResult, ReaderError> {
    let normalized_request;
    let request = if matches!(request.options.preset, crate::types::ReaderPreset::Agent) {
        request
    } else {
        normalized_request = {
            let mut request = request.clone();
            request.options.apply_preset_defaults();
            request
        };
        &normalized_request
    };
    let total_start = Instant::now();
    if matches!(request.options.engine, ReaderEngine::Browser)
        && matches!(request.input, ReaderInput::Url(_))
    {
        let source = resolve_browser_source(request, browser)?;
        let mut result = render_source(request, &source)?;
        result
            .timing
            .get_or_insert_with(ReaderTiming::default)
            .total_ms = elapsed_ms(total_start);
        return Ok(result);
    }

    if matches!(request.options.engine, ReaderEngine::Browser) && browser.is_none() {
        return Err(ReaderError::Fetch {
            message: "browser snapshot provider is required for engine=browser".to_string(),
            final_url: input_url(request),
            status: None,
        });
    }

    let source = match resolve_source(request, fetch) {
        Ok(source) => source,
        Err(error) if should_auto_browser_fallback_error(request, &error) => {
            if browser.is_some() {
                let mut result = resolve_browser_source(request, browser)
                    .and_then(|browser_source| render_source(request, &browser_source))?;
                result
                    .timing
                    .get_or_insert_with(ReaderTiming::default)
                    .total_ms = elapsed_ms(total_start);
                return Ok(result);
            }
            return Err(error);
        }
        Err(error) => return Err(error),
    };
    let mut result = render_source(request, &source)?;
    if should_auto_browser_fallback(request, &result) {
        if let Some(browser) = browser {
            match resolve_browser_source(request, Some(browser))
                .and_then(|browser_source| render_source(request, &browser_source))
            {
                Ok(mut browser_result) => {
                    browser_result
                        .timing
                        .get_or_insert_with(ReaderTiming::default)
                        .total_ms = elapsed_ms(total_start);
                    return Ok(browser_result);
                }
                Err(error) => {
                    result.warnings.push(ReaderWarning {
                        code: WarningCode::BrowserRecommended,
                        message: format!("browser fallback failed: {error}"),
                    });
                    if result.recommended_next_action.is_none() {
                        result.recommended_next_action = Some(
                            "Use a browser-rendered snapshot or browser path for this page."
                                .to_string(),
                        );
                    }
                }
            }
        } else if result.recommended_next_action.is_none() {
            result.recommended_next_action =
                Some("Use a browser-rendered snapshot or browser path for this page.".to_string());
        }
    }
    let timing = result.timing.get_or_insert_with(ReaderTiming::default);
    timing.fetch_ms = source.fetch_ms;
    timing.total_ms = elapsed_ms(total_start);
    Ok(result)
}

fn render_source(request: &ReaderRequest, source: &Source) -> Result<ReaderResult, ReaderError> {
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

/// A resolved input ready for detection and rendering.
struct Source {
    bytes: Vec<u8>,
    content_type: Option<String>,
    base_url: Option<String>,
    final_url: Option<String>,
    requested_url: Option<String>,
    status: Option<u16>,
    response_headers: Vec<(String, String)>,
    detect_hint: Option<String>,
    fetch_warnings: Vec<ReaderWarning>,
    fetch_ms: u64,
    source_kind: SourceKind,
    browser_title: Option<String>,
    browser_body_text: Option<String>,
    browser_viewport: Option<BrowserViewport>,
    browser_selected_element: Option<BrowserSelectedElement>,
    browser_frames: Vec<BrowserFrameSummary>,
    browser_shadow_roots: Vec<BrowserShadowRootSummary>,
    media: Vec<ReaderMedia>,
    artifacts: Vec<ReaderArtifact>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SourceKind {
    Http,
    RawHtml,
    Bytes,
    LocalFile,
    Browser,
}

fn resolve_source(
    request: &ReaderRequest,
    fetch: Option<&dyn FetchProvider>,
) -> Result<Source, ReaderError> {
    match &request.input {
        ReaderInput::Url(url) => fetch_url(url, &request.options, fetch),
        ReaderInput::RawHtml { html, base_url } => Ok(Source {
            bytes: html.clone().into_bytes(),
            content_type: Some("text/html".to_string()),
            base_url: base_url.clone(),
            final_url: base_url.clone(),
            requested_url: base_url.clone(),
            status: None,
            response_headers: Vec::new(),
            detect_hint: Some("text/html".to_string()),
            fetch_warnings: Vec::new(),
            fetch_ms: 0,
            source_kind: SourceKind::RawHtml,
            browser_title: None,
            browser_body_text: None,
            browser_viewport: None,
            browser_selected_element: None,
            browser_frames: Vec::new(),
            browser_shadow_roots: Vec::new(),
            media: Vec::new(),
            artifacts: Vec::new(),
        }),
        ReaderInput::Bytes {
            bytes,
            mime,
            base_url,
        } => Ok(Source {
            bytes: bytes.clone(),
            content_type: mime.clone(),
            base_url: base_url.clone(),
            final_url: base_url.clone(),
            requested_url: base_url.clone(),
            status: None,
            response_headers: Vec::new(),
            detect_hint: base_url.clone().or_else(|| mime.clone()),
            fetch_warnings: Vec::new(),
            fetch_ms: 0,
            source_kind: SourceKind::Bytes,
            browser_title: None,
            browser_body_text: None,
            browser_viewport: None,
            browser_selected_element: None,
            browser_frames: Vec::new(),
            browser_shadow_roots: Vec::new(),
            media: Vec::new(),
            artifacts: Vec::new(),
        }),
        ReaderInput::LocalFile(path) => read_local_file_source(path, None, &request.options),
        ReaderInput::BrowserSnapshot(snapshot) => Ok(browser_snapshot_source(snapshot)),
    }
}

fn browser_snapshot_source(snapshot: &BrowserSnapshotInput) -> Source {
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

fn fetch_url(
    url: &str,
    options: &crate::types::ReaderOptions,
    fetch: Option<&dyn FetchProvider>,
) -> Result<Source, ReaderError> {
    if let Some(file_path) = file_url_path(url) {
        if !options.trusted_local {
            return Err(ReaderError::Fetch {
                message: "file: URLs require trustedLocal=true".to_string(),
                final_url: Some(url.to_string()),
                status: None,
            });
        }
        return read_local_file_source(&file_path, Some(url.to_string()), options);
    }
    let provider = fetch.ok_or_else(|| ReaderError::Fetch {
        message: "no fetch provider supplied for URL input".to_string(),
        final_url: Some(url.to_string()),
        status: None,
    })?;
    let user_agent = options.user_agent.as_deref().unwrap_or(DEFAULT_USER_AGENT);
    let timeout = options
        .timeout
        .unwrap_or_else(|| std::time::Duration::from_secs(DEFAULT_TIMEOUT_SECS));
    let max_bytes = options.max_bytes.unwrap_or(DEFAULT_MAX_BYTES);
    let fetch_start = Instant::now();
    let response =
        fetch_with_checked_redirects(url, options, provider, user_agent, timeout, max_bytes)?;
    enforce_remote_url_policy(&response.final_url, options)?;
    let fetch_ms = elapsed_ms(fetch_start);
    let mut fetch_warnings = Vec::new();
    if options.wait_for_selector.is_some() && !matches!(options.engine, ReaderEngine::Http) {
        fetch_warnings.push(ReaderWarning {
            code: WarningCode::BrowserRecommended,
            message: "waitForSelector requires browser-rendered reading".to_string(),
        });
    }
    Ok(Source {
        bytes: response.body,
        content_type: response.content_type.clone(),
        base_url: Some(response.final_url.clone()),
        final_url: Some(response.final_url.clone()),
        requested_url: Some(url.to_string()),
        status: Some(response.status),
        response_headers: response.headers,
        detect_hint: response
            .content_type
            .clone()
            .or_else(|| Some(response.final_url.clone())),
        fetch_warnings,
        fetch_ms,
        source_kind: SourceKind::Http,
        browser_title: None,
        browser_body_text: None,
        browser_viewport: None,
        browser_selected_element: None,
        browser_frames: Vec::new(),
        browser_shadow_roots: Vec::new(),
        media: Vec::new(),
        artifacts: Vec::new(),
    })
}

fn fetch_with_checked_redirects(
    url: &str,
    options: &crate::types::ReaderOptions,
    provider: &dyn FetchProvider,
    user_agent: &str,
    timeout: Duration,
    max_bytes: usize,
) -> Result<crate::fetch::FetchResponse, ReaderError> {
    let mut current_url = url.to_string();
    for redirect_count in 0..=DEFAULT_REDIRECT_LIMIT {
        enforce_remote_url_policy(&current_url, options)?;
        let response = provider.fetch(&FetchRequest {
            url: &current_url,
            user_agent,
            accept: DEFAULT_ACCEPT,
            timeout,
            // Redirects are followed here so URL/IP policy runs before each hop.
            redirect_limit: 0,
            max_bytes,
            extra_headers: &[],
            proxy: None,
        })?;
        if !is_http_redirect(response.status) {
            return Ok(response);
        }
        let Some(location) = header_value(&response.headers, "location") else {
            return Ok(response);
        };
        if redirect_count == DEFAULT_REDIRECT_LIMIT {
            return Err(ReaderError::Fetch {
                message: format!("too many redirects; last location: {location}"),
                final_url: Some(response.final_url),
                status: Some(response.status),
            });
        }
        let next_url = resolve_redirect_url(&current_url, &location)?;
        enforce_remote_url_policy(&next_url, options)?;
        current_url = next_url;
    }
    unreachable!("redirect loop always returns or errors within the redirect limit")
}

fn is_http_redirect(status: u16) -> bool {
    matches!(status, 301 | 302 | 303 | 307 | 308)
}

fn header_value(headers: &[(String, String)], name: &str) -> Option<String> {
    headers
        .iter()
        .find(|(header_name, _)| header_name.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn resolve_redirect_url(base_url: &str, location: &str) -> Result<String, ReaderError> {
    let base = url::Url::parse(base_url).map_err(|error| ReaderError::Fetch {
        message: format!("invalid redirect base URL: {error}"),
        final_url: Some(base_url.to_string()),
        status: None,
    })?;
    base.join(location)
        .map(|url| url.to_string())
        .map_err(|error| ReaderError::Fetch {
            message: format!("invalid redirect location: {error}"),
            final_url: Some(base_url.to_string()),
            status: None,
        })
}

fn should_auto_browser_fallback(request: &ReaderRequest, result: &ReaderResult) -> bool {
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

fn should_auto_browser_fallback_error(request: &ReaderRequest, error: &ReaderError) -> bool {
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

fn resolve_browser_source(
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

fn input_url(request: &ReaderRequest) -> Option<String> {
    match &request.input {
        ReaderInput::Url(url) => Some(url.clone()),
        ReaderInput::BrowserSnapshot(snapshot) => snapshot
            .requested_url
            .clone()
            .or_else(|| snapshot.final_url.clone()),
        _ => None,
    }
}

fn file_url_path(url: &str) -> Option<PathBuf> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != "file" {
        return None;
    }
    parsed.to_file_path().ok()
}

fn read_local_file_source(
    path: &std::path::Path,
    requested_url: Option<String>,
    options: &crate::types::ReaderOptions,
) -> Result<Source, ReaderError> {
    if !options.trusted_local && requested_url.is_some() {
        return Err(ReaderError::Fetch {
            message: "file: URLs require trustedLocal=true".to_string(),
            final_url: requested_url,
            status: None,
        });
    }
    let metadata = std::fs::metadata(path).map_err(|error| ReaderError::Io(error.to_string()))?;
    let max_bytes = options.max_bytes.unwrap_or(TRUSTED_LOCAL_MAX_BYTES);
    if metadata.len() > max_bytes as u64 {
        return Err(ReaderError::Fetch {
            message: format!("local file exceeded maxBytes limit of {max_bytes} bytes"),
            final_url: Some(path.to_string_lossy().to_string()),
            status: None,
        });
    }
    let bytes = std::fs::read(path).map_err(|error| ReaderError::Io(error.to_string()))?;
    let path_str = requested_url.unwrap_or_else(|| path.to_string_lossy().to_string());
    Ok(Source {
        bytes,
        content_type: mime_guess::from_path(path).first_raw().map(str::to_string),
        base_url: Some(path_str.clone()),
        final_url: Some(path_str.clone()),
        requested_url: Some(path_str.clone()),
        status: None,
        response_headers: Vec::new(),
        detect_hint: Some(path_str),
        fetch_warnings: Vec::new(),
        fetch_ms: 0,
        source_kind: SourceKind::LocalFile,
        browser_title: None,
        browser_body_text: None,
        browser_viewport: None,
        browser_selected_element: None,
        browser_frames: Vec::new(),
        browser_shadow_roots: Vec::new(),
        media: Vec::new(),
        artifacts: Vec::new(),
    })
}

fn enforce_remote_url_policy(
    raw_url: &str,
    options: &crate::types::ReaderOptions,
) -> Result<(), ReaderError> {
    let parsed = url::Url::parse(raw_url).map_err(|error| ReaderError::Fetch {
        message: format!("invalid URL: {error}"),
        final_url: Some(raw_url.to_string()),
        status: None,
    })?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ReaderError::Fetch {
            message: format!("unsupported URL scheme: {}", parsed.scheme()),
            final_url: Some(raw_url.to_string()),
            status: None,
        });
    }
    if options.allow_private_network {
        return Ok(());
    }
    let Some(host) = parsed.host_str() else {
        return Ok(());
    };
    if host.eq_ignore_ascii_case("localhost") {
        return Err(private_network_error(raw_url));
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_local_ip(ip) {
            return Err(private_network_error(raw_url));
        }
        return Ok(());
    }
    let port = parsed.port_or_known_default().unwrap_or(443);
    if let Ok(addresses) = (host, port).to_socket_addrs() {
        for address in addresses {
            if is_private_or_local_ip(address.ip()) {
                return Err(private_network_error(raw_url));
            }
        }
    }
    Ok(())
}

fn private_network_error(raw_url: &str) -> ReaderError {
    ReaderError::Fetch {
        message: "remote URL resolved to a private, localhost, or link-local address".to_string(),
        final_url: Some(raw_url.to_string()),
        status: None,
    }
}

fn is_private_or_local_ip(ip: IpAddr) -> bool {
    security::blocks_untrusted_remote_ip(ip)
}

fn render_html(
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
    let adapter = try_libreoffice_html(&source.bytes, detection.format);
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

struct LibreOfficeAttempt {
    html: Option<String>,
    warnings: Vec<ReaderWarning>,
}

fn try_libreoffice_html(bytes: &[u8], format: Format) -> LibreOfficeAttempt {
    try_libreoffice_html_with_candidates(bytes, format, libreoffice_candidates())
}

fn libreoffice_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    if let Ok(path) = std::env::var("LYRA_AGENT_READER_LIBREOFFICE") {
        if !path.trim().is_empty() {
            candidates.push(path);
        }
    }
    candidates.push("soffice".to_string());
    candidates.push("libreoffice".to_string());
    candidates
}

fn try_libreoffice_html_with_candidates(
    bytes: &[u8],
    format: Format,
    candidates: Vec<String>,
) -> LibreOfficeAttempt {
    let mut warnings = Vec::new();
    let extension = match format {
        Format::Docx => "docx",
        Format::Xlsx => "xlsx",
        Format::Pptx => "pptx",
        _ => {
            return LibreOfficeAttempt {
                html: None,
                warnings,
            };
        }
    };
    let temp_dir = match tempfile::tempdir() {
        Ok(value) => value,
        Err(error) => {
            warnings.push(ReaderWarning {
                code: WarningCode::ExternalAdapterFailed,
                message: format!("LibreOffice temp directory creation failed: {error}"),
            });
            return LibreOfficeAttempt {
                html: None,
                warnings,
            };
        }
    };
    let input_path = temp_dir.path().join(format!("input.{extension}"));
    if let Err(error) = std::fs::write(&input_path, bytes) {
        warnings.push(ReaderWarning {
            code: WarningCode::ExternalAdapterFailed,
            message: format!("LibreOffice input write failed: {error}"),
        });
        return LibreOfficeAttempt {
            html: None,
            warnings,
        };
    }

    let mut attempted = false;
    for binary in candidates {
        let spawn = Command::new(&binary)
            .arg("--headless")
            .arg("--convert-to")
            .arg("html")
            .arg("--outdir")
            .arg(temp_dir.path())
            .arg(&input_path)
            .spawn();
        let Ok(mut child) = spawn else {
            continue;
        };
        attempted = true;
        let status = wait_for_child_with_timeout(&mut child, LIBREOFFICE_TIMEOUT, &mut warnings);
        let Some(status) = status else {
            let _ = child.kill();
            let _ = child.wait();
            warnings.push(ReaderWarning {
                code: WarningCode::ExternalAdapterFailed,
                message: format!(
                    "LibreOffice conversion timed out after {} seconds; Rust fallback was used",
                    LIBREOFFICE_TIMEOUT.as_secs()
                ),
            });
            continue;
        };
        if !status.success() {
            warnings.push(ReaderWarning {
                code: WarningCode::ExternalAdapterFailed,
                message: format!("LibreOffice conversion exited with status {status}"),
            });
            continue;
        }
        let html_path = temp_dir.path().join("input.html");
        if let Ok(html) = std::fs::read_to_string(&html_path) {
            if !html.trim().is_empty() {
                return LibreOfficeAttempt {
                    html: Some(html),
                    warnings,
                };
            }
        }
    }
    if !attempted {
        warnings.push(ReaderWarning {
            code: WarningCode::ExternalAdapterMissing,
            message: "LibreOffice/soffice was not available; Rust Office fallback was used"
                .to_string(),
        });
    }
    LibreOfficeAttempt {
        html: None,
        warnings,
    }
}

fn wait_for_child_with_timeout(
    child: &mut std::process::Child,
    timeout: Duration,
    warnings: &mut Vec<ReaderWarning>,
) -> Option<std::process::ExitStatus> {
    let wait_start = Instant::now();
    while wait_start.elapsed() < timeout {
        match child.try_wait() {
            Ok(Some(value)) => return Some(value),
            Ok(None) => std::thread::sleep(Duration::from_millis(50).min(timeout)),
            Err(error) => {
                warnings.push(ReaderWarning {
                    code: WarningCode::ExternalAdapterFailed,
                    message: format!("LibreOffice wait failed: {error}"),
                });
                return None;
            }
        }
    }
    None
}

fn render_image(
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

fn assemble_rendered_document(
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
struct ProcessingTiming {
    parse_ms: u64,
    extract_ms: u64,
    render_ms: u64,
}

#[allow(clippy::too_many_arguments)]
fn assemble(
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
        title: title.clone(),
        url: source.requested_url.clone(),
        source_url: source.final_url.clone(),
        retrieved_at: Some(retrieved_at.clone()),
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

fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

fn debug_trace_requested(options: &crate::types::ReaderOptions) -> bool {
    options.include_debug_trace || debug_trace_env_enabled()
}

fn debug_trace_enabled_by(options: &crate::types::ReaderOptions) -> String {
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

fn recommended_next_action(truncated: bool, warnings: &[ReaderWarning]) -> Option<String> {
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
    let script_count = html.matches("<script").count();
    let has_bundle = html.contains(".js")
        || html.contains("/assets/")
        || html.contains("__next")
        || html.contains("vite");
    has_app_root && script_count > 0 && has_bundle
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
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::types::{
        BrowserMode, BrowserSnapshotInput, BrowserWaitUntil, ChunkingMode, ChunkingOptions,
        CitationFormat, ContentFilterMode, HeadingStyle, ImageRetention, LinkRetention,
        MediaRetention, OverflowMode, ReaderEngine, ReaderOptions,
    };
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct StaticFetch {
        body: Vec<u8>,
        content_type: &'static str,
    }

    impl FetchProvider for StaticFetch {
        fn fetch(
            &self,
            request: &FetchRequest<'_>,
        ) -> Result<crate::fetch::FetchResponse, ReaderError> {
            Ok(crate::fetch::FetchResponse {
                final_url: request.url.to_string(),
                status: 200,
                content_type: Some(self.content_type.to_string()),
                headers: Vec::new(),
                body: self.body.clone(),
            })
        }
    }

    struct RedirectFetch {
        location: String,
        calls: AtomicUsize,
    }

    impl RedirectFetch {
        fn new(location: &str) -> Self {
            Self {
                location: location.to_string(),
                calls: AtomicUsize::new(0),
            }
        }

        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl FetchProvider for RedirectFetch {
        fn fetch(
            &self,
            request: &FetchRequest<'_>,
        ) -> Result<crate::fetch::FetchResponse, ReaderError> {
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            if call == 0 {
                return Ok(crate::fetch::FetchResponse {
                    final_url: request.url.to_string(),
                    status: 302,
                    content_type: Some("text/html".to_string()),
                    headers: vec![("location".to_string(), self.location.clone())],
                    body: Vec::new(),
                });
            }
            Ok(crate::fetch::FetchResponse {
                final_url: request.url.to_string(),
                status: 200,
                content_type: Some("text/html".to_string()),
                headers: Vec::new(),
                body: b"<html><body><main>redirected body</main></body></html>".to_vec(),
            })
        }
    }

    struct StaticBrowser;

    impl BrowserSnapshotProvider for StaticBrowser {
        fn snapshot(
            &self,
            request: &BrowserSnapshotRequest<'_>,
        ) -> Result<crate::fetch::BrowserSnapshot, ReaderError> {
            assert_eq!(request.browser_mode, BrowserMode::MatchingOrNewTab);
            assert_eq!(request.wait_until, BrowserWaitUntil::LoadIdle);
            Ok(crate::fetch::BrowserSnapshot {
                final_url: request.url.to_string(),
                html: r#"<html><head><title>Rendered App</title></head><body><main><h1>Rendered</h1><p>Dynamic browser text is now available.</p></main></body></html>"#.to_string(),
                title: Some("Rendered App".to_string()),
                body_text: Some("Rendered Dynamic browser text is now available.".to_string()),
                screenshot_artifact_ref: None,
                pageshot_artifact_ref: None,
                viewport: None,
                selected_element: None,
                frames: Vec::new(),
                shadow_roots: Vec::new(),
                media: Vec::new(),
                artifacts: Vec::new(),
                warnings: Vec::new(),
            })
        }
    }

    fn read_html_result(html: &str, options: ReaderOptions) -> Result<ReaderResult, ReaderError> {
        let request = ReaderRequest {
            input: ReaderInput::RawHtml {
                html: html.to_string(),
                base_url: Some("https://x.test/".to_string()),
            },
            options,
        };
        run(&request, None)
    }

    fn read_bytes_result(
        bytes: Vec<u8>,
        mime: &str,
        base_url: &str,
    ) -> Result<ReaderResult, ReaderError> {
        read_bytes_result_with_options(bytes, mime, base_url, ReaderOptions::default())
    }

    fn read_bytes_result_with_options(
        bytes: Vec<u8>,
        mime: &str,
        base_url: &str,
        options: ReaderOptions,
    ) -> Result<ReaderResult, ReaderError> {
        let request = ReaderRequest {
            input: ReaderInput::Bytes {
                bytes,
                mime: Some(mime.to_string()),
                base_url: Some(base_url.to_string()),
            },
            options,
        };
        run(&request, None)
    }

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
        assert!(matches!(error, ReaderError::Fetch { .. }));
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
        assert!(result.compact_text.contains("Dynamic browser text"));
    }

    fn build_simple_pdf(text: &str) -> Vec<u8> {
        let stream = format!("BT /F1 24 Tf 72 720 Td ({}) Tj ET", text);
        let objects = vec![
            "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
            "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n".to_string(),
            "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n".to_string(),
            format!(
                "4 0 obj\n<< /Length {} >>\nstream\n{}\nendstream\nendobj\n",
                stream.len(),
                stream
            ),
            "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".to_string(),
        ];
        let mut pdf = String::from("%PDF-1.4\n");
        let mut offsets = vec![0usize];
        for object in &objects {
            offsets.push(pdf.len());
            pdf.push_str(object);
        }
        let xref_offset = pdf.len();
        pdf.push_str("xref\n0 6\n");
        pdf.push_str("0000000000 65535 f \n");
        for offset in offsets.iter().skip(1) {
            pdf.push_str(&format!("{:010} 00000 n \n", offset));
        }
        pdf.push_str("trailer\n<< /Root 1 0 R /Size 6 >>\n");
        pdf.push_str(&format!("startxref\n{}\n%%EOF\n", xref_offset));
        pdf.into_bytes()
    }

    fn build_multi_page_pdf(pages: &[&[&str]]) -> Vec<u8> {
        let page_count = pages.len();
        let page_object_start = 3usize;
        let content_object_start = page_object_start + page_count;
        let font_object_id = content_object_start + page_count;
        let kids = (0..page_count)
            .map(|index| format!("{} 0 R", page_object_start + index))
            .collect::<Vec<_>>()
            .join(" ");
        let mut objects = vec![
            "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
            format!(
                "2 0 obj\n<< /Type /Pages /Kids [{}] /Count {} >>\nendobj\n",
                kids, page_count
            ),
        ];
        for index in 0..page_count {
            objects.push(format!(
                "{} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {} 0 R >> >> /Contents {} 0 R >>\nendobj\n",
                page_object_start + index,
                font_object_id,
                content_object_start + index
            ));
        }
        for (index, lines) in pages.iter().enumerate() {
            let stream = pdf_text_stream(lines);
            objects.push(format!(
                "{} 0 obj\n<< /Length {} >>\nstream\n{}\nendstream\nendobj\n",
                content_object_start + index,
                stream.len(),
                stream
            ));
        }
        objects.push(format!(
            "{} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
            font_object_id
        ));

        let mut pdf = String::from("%PDF-1.4\n");
        let mut offsets = vec![0usize];
        for object in &objects {
            offsets.push(pdf.len());
            pdf.push_str(object);
        }
        let xref_offset = pdf.len();
        pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
        pdf.push_str("0000000000 65535 f \n");
        for offset in offsets.iter().skip(1) {
            pdf.push_str(&format!("{:010} 00000 n \n", offset));
        }
        pdf.push_str(&format!(
            "trailer\n<< /Root 1 0 R /Size {} >>\n",
            objects.len() + 1
        ));
        pdf.push_str(&format!("startxref\n{}\n%%EOF\n", xref_offset));
        pdf.into_bytes()
    }

    fn pdf_text_stream(lines: &[&str]) -> String {
        let mut stream = String::new();
        for (index, line) in lines.iter().enumerate() {
            let y = 720isize - index as isize * 20;
            stream.push_str(&format!("BT /F1 12 Tf 72 {y} Td ("));
            stream.push_str(&escape_pdf_text(line));
            stream.push_str(") Tj ET\n");
        }
        stream
    }

    fn escape_pdf_text(text: &str) -> String {
        text.replace('\\', "\\\\")
            .replace('(', "\\(")
            .replace(')', "\\)")
    }

    fn zip_bytes(files: &[(&str, &str)]) -> Vec<u8> {
        let cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(cursor);
        let options = zip::write::SimpleFileOptions::default();
        for (name, content) in files {
            writer.start_file(name, options).expect("start zip file");
            writer
                .write_all(content.as_bytes())
                .expect("write zip file");
        }
        writer.finish().expect("finish zip").into_inner()
    }

    fn read_html(html: &str, options: ReaderOptions) -> ReaderResult {
        read_html_result(html, options).unwrap()
    }

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
    fn remote_redirect_to_private_network_is_blocked_before_following() {
        let fetch = RedirectFetch::new("http://127.0.0.1/private");
        let request = ReaderRequest {
            input: ReaderInput::Url("https://public.test/start".to_string()),
            options: ReaderOptions::default(),
        };
        let error = run(&request, Some(&fetch)).expect_err("private redirect should be blocked");
        match error {
            ReaderError::Fetch {
                message, final_url, ..
            } => {
                assert!(message.contains("private"));
                assert_eq!(final_url.as_deref(), Some("http://127.0.0.1/private"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
        assert_eq!(fetch.calls(), 1);
    }

    #[test]
    fn remote_redirect_is_followed_after_policy_check() {
        let fetch = RedirectFetch::new("/final");
        let request = ReaderRequest {
            input: ReaderInput::Url("https://public.test/start".to_string()),
            options: ReaderOptions::default(),
        };
        let result = run(&request, Some(&fetch)).expect("redirect result");
        assert_eq!(
            result.final_url.as_deref(),
            Some("https://public.test/final")
        );
        assert!(result.markdown_with_citations.contains("redirected body"));
        assert_eq!(fetch.calls(), 2);
    }

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
    fn libreoffice_missing_returns_warning_and_recommendation() {
        let attempt = try_libreoffice_html_with_candidates(
            b"not a real docx",
            Format::Docx,
            vec!["/definitely/not/lyra-soffice".to_string()],
        );
        assert!(attempt.html.is_none());
        assert!(
            attempt
                .warnings
                .iter()
                .any(|warning| warning.code == WarningCode::ExternalAdapterMissing)
        );
        assert!(
            recommended_next_action(false, &attempt.warnings)
                .unwrap_or_default()
                .contains("LibreOffice")
        );
    }

    #[test]
    fn external_adapter_timeout_kills_process() {
        let mut child = Command::new("sh")
            .arg("-c")
            .arg("sleep 1")
            .spawn()
            .expect("spawn sleep");
        let mut warnings = Vec::new();
        let status =
            wait_for_child_with_timeout(&mut child, Duration::from_millis(10), &mut warnings);
        assert!(status.is_none());
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn detection_helper_compiles() {
        assert_eq!(html_detection().format, Format::Html);
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
