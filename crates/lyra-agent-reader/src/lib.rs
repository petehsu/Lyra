//! `lyra-agent-reader` — native-core web/document to agent-friendly content.
//!
//! Milestone A scope: fetch + format detection + HTML cleaning + Readability-like
//! main-content extraction + HTML→Markdown rendering + links/images/citations +
//! agent-friendly frontmatter + char budgeting. PDF/Office/image/browser paths
//! are reserved via traits but not implemented in this milestone.
//!
//! Entry points:
//! - [`read`] takes a [`ReaderRequest`] and a [`FetchProvider`] (network-capable).
//! - [`read_html`] renders in-hand HTML without any network access.

mod budget;
mod chunk;
mod citation;
mod detect;
mod document;
mod document_formats;
mod errors;
mod extract;
mod fetch;
mod html;
mod links;
mod markdown;
mod types;

pub use errors::{ReaderError, ReaderResult as ReaderFallible};
#[cfg(feature = "fetch-reqwest")]
pub use fetch::ReqwestFetchProvider;
#[cfg(feature = "tokenizer-tiktoken")]
pub use fetch::TiktokenTokenizerProvider;
pub use fetch::{
    BrowserSnapshot, BrowserSnapshotProvider, BrowserSnapshotRequest, FetchProvider, FetchRequest,
    FetchResponse, ImageCaptionProvider, OcrProvider, PdfPageImageProvider, ReaderCacheEntry,
    ReaderCacheKeyParts, ReaderCacheProvider, ReaderIndexRecord, ReaderIndexSink, SearchProvider,
    SearchRequest, SearchResult, TokenizerProvider,
};
pub use budget::{effective_char_limit, estimate_tokens};
pub use types::*;

/// Read content from a [`ReaderRequest`], fetching over the network if needed.
///
/// `fetch` is only used when the input is a [`ReaderInput::Url`]; in-hand inputs
/// (`RawHtml`/`Bytes`/`LocalFile`) ignore it.
pub fn read(
    request: &ReaderRequest,
    fetch: &dyn FetchProvider,
) -> Result<ReaderResult, ReaderError> {
    document::run(request, Some(fetch))
}

/// Read content with an optional browser snapshot provider for `engine=browser`
/// or `engine=auto` fallback.
pub fn read_with_browser_provider(
    request: &ReaderRequest,
    fetch: &dyn FetchProvider,
    browser: Option<&dyn BrowserSnapshotProvider>,
) -> Result<ReaderResult, ReaderError> {
    document::run_with_browser(request, Some(fetch), browser)
}

/// Render in-hand HTML to an agent-friendly result without any network access.
pub fn read_html(
    html: &str,
    base_url: Option<&str>,
    options: &ReaderOptions,
) -> Result<ReaderResult, ReaderError> {
    let request = ReaderRequest {
        input: ReaderInput::RawHtml {
            html: html.to_string(),
            base_url: base_url.map(str::to_string),
        },
        options: options.clone(),
    };
    document::run(&request, None)
}
