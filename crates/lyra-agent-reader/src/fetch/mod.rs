//! Fetch abstraction and the reserved browser/OCR provider traits.
//!
//! Milestone A ships a blocking reqwest [`FetchProvider`]. The browser and OCR
//! traits are declared so later milestones can plug in adapters without changing
//! the pipeline, but they are intentionally not implemented here.

use std::time::Duration;

use crate::errors::ReaderError;
use crate::types::{
    BrowserFrameSummary, BrowserMode, BrowserSelectedElement, BrowserShadowRootSummary,
    BrowserViewport, BrowserWaitUntil, ReaderArtifact, ReaderCachePolicy, ReaderChunk, ReaderMedia,
    ReaderMetadata, ReaderWarning,
};

#[cfg(feature = "fetch-reqwest")]
mod reqwest_provider;
#[cfg(feature = "fetch-reqwest")]
pub use reqwest_provider::ReqwestFetchProvider;

/// A network fetch request.
#[derive(Clone, Debug)]
pub struct FetchRequest<'a> {
    /// Absolute http/https URL to fetch.
    pub url: &'a str,
    /// User-Agent header value.
    pub user_agent: &'a str,
    /// Accept header value.
    pub accept: &'a str,
    /// Request timeout.
    pub timeout: Duration,
    /// Maximum number of redirects to follow.
    pub redirect_limit: usize,
    /// Maximum number of body bytes to read.
    pub max_bytes: usize,
    /// Additional caller-provided headers for trusted fetch contexts.
    pub extra_headers: &'a [(&'a str, &'a str)],
    /// Optional proxy URL hook for trusted fetch contexts.
    pub proxy: Option<&'a str>,
}

/// A network fetch response.
#[derive(Clone, Debug)]
pub struct FetchResponse {
    /// Final URL after redirects.
    pub final_url: String,
    /// HTTP status code.
    pub status: u16,
    /// `Content-Type` header value, if present.
    pub content_type: Option<String>,
    /// Selected response headers as `(name, value)` pairs.
    pub headers: Vec<(String, String)>,
    /// Response body bytes (already capped at `max_bytes`).
    pub body: Vec<u8>,
}

/// Fetches bytes for a URL. Implementations decide transport (HTTP, cache, ...).
pub trait FetchProvider {
    /// Perform the fetch.
    fn fetch(&self, request: &FetchRequest<'_>) -> Result<FetchResponse, ReaderError>;
}

/// Cache key data available before and after a fetch/render operation.
#[derive(Clone, Debug)]
pub struct ReaderCacheKeyParts<'a> {
    /// Requested URL/path, if any.
    pub requested_url: Option<&'a str>,
    /// Final URL/path after resolution, if any.
    pub final_url: Option<&'a str>,
    /// Safe header fingerprint (never raw cookie/auth values).
    pub header_fingerprint: Option<&'a str>,
    /// Hex content hash.
    pub content_hash: Option<&'a str>,
    /// Hex options hash.
    pub options_hash: &'a str,
}

/// Cached reader entry.
#[derive(Clone, Debug)]
pub struct ReaderCacheEntry {
    /// Serialized [`crate::types::ReaderResult`] JSON.
    pub result_json: String,
    /// Cache creation timestamp, RFC3339.
    pub stored_at: String,
}

/// Optional cache integration. The default reader does not persist cache.
pub trait ReaderCacheProvider {
    /// Read a cached result by deterministic key.
    fn get(
        &self,
        key: &str,
        policy: ReaderCachePolicy,
    ) -> Result<Option<ReaderCacheEntry>, ReaderError>;

    /// Write a rendered result by deterministic key.
    fn put(
        &self,
        key: &str,
        entry: &ReaderCacheEntry,
        policy: ReaderCachePolicy,
    ) -> Result<(), ReaderError>;
}

/// Normalized search request.
#[derive(Clone, Debug)]
pub struct SearchRequest<'a> {
    /// Search query.
    pub query: &'a str,
    /// Maximum number of results.
    pub limit: usize,
    /// Optional provider name/config key.
    pub provider: Option<&'a str>,
}

/// Normalized search result.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    /// Result title.
    pub title: String,
    /// Result URL.
    pub url: String,
    /// Result snippet.
    pub snippet: String,
    /// Provider/source label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Confidence score in `[0, 1]`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
    /// Optional fetched markdown excerpt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fetched_markdown_excerpt: Option<String>,
}

/// Optional pluggable search provider abstraction.
pub trait SearchProvider {
    /// Run a web/search provider query.
    fn search(&self, request: &SearchRequest<'_>) -> Result<Vec<SearchResult>, ReaderError>;
}

/// Optional tokenizer abstraction.
pub trait TokenizerProvider {
    /// Tokenizer/provider label.
    fn name(&self) -> &'static str;
    /// Count tokens for text.
    fn estimate_tokens(&self, text: &str) -> usize;
}

/// Optional `tiktoken-rs` tokenizer provider.
#[cfg(feature = "tokenizer-tiktoken")]
pub struct TiktokenTokenizerProvider {
    bpe: tiktoken_rs::CoreBPE,
    label: &'static str,
}

#[cfg(feature = "tokenizer-tiktoken")]
impl TiktokenTokenizerProvider {
    /// Build a provider using the common `cl100k_base` tokenizer.
    pub fn cl100k_base() -> Result<Self, ReaderError> {
        let bpe = tiktoken_rs::cl100k_base()
            .map_err(|error| ReaderError::Parse(format!("tiktoken init failed: {error}")))?;
        Ok(Self {
            bpe,
            label: "tiktoken:cl100k_base",
        })
    }
}

#[cfg(feature = "tokenizer-tiktoken")]
impl TokenizerProvider for TiktokenTokenizerProvider {
    fn name(&self) -> &'static str {
        self.label
    }

    fn estimate_tokens(&self, text: &str) -> usize {
        self.bpe.encode_with_special_tokens(text).len()
    }
}

/// Optional page renderer for scanned PDF OCR.
pub trait PdfPageImageProvider {
    /// Render one-based PDF page to an image byte buffer and MIME type.
    fn render_page_image(&self, pdf: &[u8], page: u32) -> Result<(Vec<u8>, String), ReaderError>;
}

/// Reserved: a browser-rendered snapshot request (later milestones).
#[derive(Clone, Debug)]
pub struct BrowserSnapshotRequest<'a> {
    /// URL to render.
    pub url: &'a str,
    /// Optional browser tab id.
    pub tab_id: Option<&'a str>,
    /// Browser tab selection/navigation mode.
    pub browser_mode: BrowserMode,
    /// Optional CSS selector to wait for.
    pub wait_for_selector: Option<&'a str>,
    /// Browser wait condition.
    pub wait_until: BrowserWaitUntil,
    /// Optional text used by `TextContains`.
    pub wait_text: Option<&'a str>,
    /// Render timeout.
    pub timeout: Duration,
    /// Whether the browser bridge should capture a screenshot artifact.
    pub include_screenshot: bool,
    /// Optional viewport for browser rendering.
    pub viewport: Option<BrowserViewport>,
    /// Whether browser rendering should emulate mobile metrics/user agent.
    pub mobile: bool,
    /// Whether readable iframes should be included in snapshot data.
    pub include_iframes: bool,
    /// Whether open shadow roots should be included in snapshot data.
    pub include_shadow_dom: bool,
    /// Whether the browser bridge should capture a full-page screenshot artifact.
    pub include_pageshot: bool,
    /// Whether media/embed metadata should be extracted.
    pub include_media: bool,
    /// CSS selector used as the requested element/root, if any.
    pub target_selector: Option<&'a str>,
}

/// Reserved: a browser-rendered snapshot result (later milestones).
#[derive(Clone, Debug)]
pub struct BrowserSnapshot {
    /// Final URL.
    pub final_url: String,
    /// Rendered outer HTML.
    pub html: String,
    /// Browser document title.
    pub title: Option<String>,
    /// Browser body innerText.
    pub body_text: Option<String>,
    /// Optional screenshot artifact ref persisted by the caller.
    pub screenshot_artifact_ref: Option<String>,
    /// Optional full-page screenshot artifact ref persisted by the caller.
    pub pageshot_artifact_ref: Option<String>,
    /// Viewport used for browser rendering.
    pub viewport: Option<BrowserViewport>,
    /// Target selector element snapshot, if requested.
    pub selected_element: Option<BrowserSelectedElement>,
    /// Best-effort iframe summaries.
    pub frames: Vec<BrowserFrameSummary>,
    /// Best-effort open shadow root summaries.
    pub shadow_roots: Vec<BrowserShadowRootSummary>,
    /// Media/embed metadata found in the rendered page.
    pub media: Vec<ReaderMedia>,
    /// Artifacts produced by the browser snapshot path.
    pub artifacts: Vec<ReaderArtifact>,
    /// Browser bridge warnings.
    pub warnings: Vec<ReaderWarning>,
}

/// Reserved: a browser snapshot provider for SPA/rendered pages.
///
/// Not implemented in Milestone A; declared so the pipeline can later route
/// `engine = browser` requests through an adapter.
pub trait BrowserSnapshotProvider {
    /// Render and snapshot a page.
    fn snapshot(
        &self,
        request: &BrowserSnapshotRequest<'_>,
    ) -> Result<BrowserSnapshot, ReaderError>;
}

/// Reserved: OCR provider for image/scanned-PDF text (later milestones).
///
/// Not implemented in Milestone A.
pub trait OcrProvider {
    /// Recognize text from image bytes.
    fn recognize(&self, image: &[u8], mime: &str) -> Result<String, ReaderError>;
}

/// Optional image caption provider.
pub trait ImageCaptionProvider {
    /// Generate a short image caption.
    fn caption(
        &self,
        image: &[u8],
        mime: &str,
        metadata: Option<&ReaderMetadata>,
    ) -> Result<String, ReaderError>;
}

/// Result payload for indexing reader output into local recall/search.
#[derive(Clone, Debug)]
pub struct ReaderIndexRecord<'a> {
    /// Stable source id, generally URL/content-hash based.
    pub source_id: &'a str,
    /// Source kind label.
    pub source_kind: &'a str,
    /// Source URL/path, if any.
    pub source_url: Option<&'a str>,
    /// Title, if any.
    pub title: Option<&'a str>,
    /// Full markdown/text body.
    pub text: &'a str,
    /// Reader chunks for granular indexing.
    pub chunks: &'a [ReaderChunk],
    /// Session id, if known.
    pub session_id: Option<&'a str>,
    /// Turn id, if known.
    pub turn_id: Option<&'a str>,
}

/// Optional indexing sink.
pub trait ReaderIndexSink {
    /// Index a reader result.
    fn index(&self, record: &ReaderIndexRecord<'_>) -> Result<(), ReaderError>;
}
