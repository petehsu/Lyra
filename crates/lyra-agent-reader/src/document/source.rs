//! Input resolution for reader document sources.

use std::path::PathBuf;
use std::time::Instant;

use crate::errors::ReaderError;
use crate::fetch::FetchProvider;
use crate::types::{
    BrowserAxElement, BrowserFrameSummary, BrowserSelectedElement, BrowserShadowRootSummary,
    BrowserViewport, ReaderArtifact, ReaderEngine, ReaderInput, ReaderMedia, ReaderRequest,
    ReaderWarning, WarningCode,
};

use super::elapsed_ms;
use super::network_policy;

const DEFAULT_USER_AGENT: &str = "Lyra Agent/0.1";
const DEFAULT_TIMEOUT_SECS: u64 = 20;
const DEFAULT_MAX_BYTES: usize = 8 * 1024 * 1024;
const TRUSTED_LOCAL_MAX_BYTES: usize = 64 * 1024 * 1024;

/// A resolved input ready for detection and rendering.
pub(super) struct Source {
    pub(super) bytes: Vec<u8>,
    pub(super) content_type: Option<String>,
    pub(super) base_url: Option<String>,
    pub(super) final_url: Option<String>,
    pub(super) requested_url: Option<String>,
    pub(super) status: Option<u16>,
    pub(super) response_headers: Vec<(String, String)>,
    pub(super) detect_hint: Option<String>,
    pub(super) fetch_warnings: Vec<ReaderWarning>,
    pub(super) fetch_ms: u64,
    pub(super) source_kind: SourceKind,
    pub(super) browser_title: Option<String>,
    pub(super) browser_body_text: Option<String>,
    pub(super) browser_viewport: Option<BrowserViewport>,
    pub(super) browser_selected_element: Option<BrowserSelectedElement>,
    pub(super) browser_frames: Vec<BrowserFrameSummary>,
    pub(super) browser_shadow_roots: Vec<BrowserShadowRootSummary>,
    pub(super) ax_elements: Vec<BrowserAxElement>,
    pub(super) media: Vec<ReaderMedia>,
    pub(super) artifacts: Vec<ReaderArtifact>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SourceKind {
    Http,
    RawHtml,
    Bytes,
    LocalFile,
    Browser,
}

pub(super) fn resolve_source(
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
            ax_elements: Vec::new(),
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
            ax_elements: Vec::new(),
            media: Vec::new(),
            artifacts: Vec::new(),
        }),
        ReaderInput::LocalFile(path) => read_local_file_source(path, None, &request.options),
        ReaderInput::BrowserSnapshot(snapshot) => {
            Ok(super::browser_source::browser_snapshot_source(snapshot))
        }
    }
}

pub(super) fn fetch_url(
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
    let response = network_policy::fetch_with_checked_redirects(
        url, options, provider, user_agent, timeout, max_bytes,
    )?;
    network_policy::enforce_remote_url_policy(&response.final_url, options)?;
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
        ax_elements: Vec::new(),
        media: Vec::new(),
        artifacts: Vec::new(),
    })
}

pub(super) fn input_url(request: &ReaderRequest) -> Option<String> {
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
        ax_elements: Vec::new(),
        media: Vec::new(),
        artifacts: Vec::new(),
    })
}
