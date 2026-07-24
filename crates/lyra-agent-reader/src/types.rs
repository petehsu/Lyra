//! Request and result data types for the agent reader.
//!
//! These are plain serializable structs/enums (POD). Behaviour lives in the
//! pipeline modules; this file only describes the shapes that cross the public
//! API boundary.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A full reader request: what to read plus how to render it.
#[derive(Clone, Debug)]
pub struct ReaderRequest {
    /// The input source.
    pub input: ReaderInput,
    /// Rendering and extraction options.
    pub options: ReaderOptions,
}

/// The source of content to read.
#[derive(Clone, Debug)]
pub enum ReaderInput {
    /// Fetch an absolute http/https URL.
    Url(String),
    /// Already-in-hand HTML, with an optional base URL for link resolution.
    RawHtml {
        /// The HTML document text.
        html: String,
        /// Base URL used to resolve relative links/images.
        base_url: Option<String>,
    },
    /// Raw bytes with an optional MIME hint and base URL.
    Bytes {
        /// The raw bytes.
        bytes: Vec<u8>,
        /// MIME hint (e.g. from a Content-Type header).
        mime: Option<String>,
        /// Base URL used to resolve relative links/images.
        base_url: Option<String>,
    },
    /// A local file path (used only for trusted/local contexts).
    LocalFile(PathBuf),
    /// Already-rendered browser snapshot.
    BrowserSnapshot(BrowserSnapshotInput),
}

/// How much of the document to keep.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ExtractionMode {
    /// Readability-like main article extraction.
    Main,
    /// The full cleaned document.
    Full,
    /// Plain text only (no markdown structure emphasis).
    Text,
    /// Preserve raw/cleaned source behind reader safety limits.
    Raw,
}

impl Default for ExtractionMode {
    fn default() -> Self {
        Self::Main
    }
}

/// Reader defaults tuned for common caller workflows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReaderPreset {
    /// Compact, citation-aware output for direct agent use.
    Agent,
    /// Query-focused output with chunks and references for research tasks.
    Research,
    /// Chunk-rich output intended for indexing/recall.
    Index,
    /// Clean human-reader markdown.
    Reader,
    /// Preserve raw/cleaned source as much as the safety caps allow.
    Raw,
}

impl Default for ReaderPreset {
    fn default() -> Self {
        Self::Agent
    }
}

/// Preferred high-level response format for callers that need one shape.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReaderOutputFormat {
    /// Markdown with citations/references.
    Markdown,
    /// Plain compact text.
    Text,
    /// Full structured result.
    Json,
    /// Chunk-only oriented output.
    Chunks,
    /// Frontmatter plus markdown.
    FrontmatterMarkdown,
}

impl Default for ReaderOutputFormat {
    fn default() -> Self {
        Self::Markdown
    }
}

/// Cache behaviour requested by the caller.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReaderCachePolicy {
    /// Let an adapter decide whether to use cache.
    Auto,
    /// Do not read from or write to cache.
    NoStore,
    /// Read from cache when fresh enough and update it after fetch.
    ReadWrite,
    /// Only use a cache hit; fail or continue uncached if no provider exists.
    CacheOnly,
}

impl Default for ReaderCachePolicy {
    fn default() -> Self {
        Self::Auto
    }
}

/// How links are represented in the rendered markdown.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkRetention {
    /// Keep inline markdown links.
    All,
    /// Strip link syntax, keep anchor text only.
    Text,
    /// Replace links with `[n]` markers and append a References footer.
    Citations,
    /// Keep anchor text inline and append a deduplicated References footer.
    Summary,
    /// Remove links entirely (keep anchor text inline).
    None,
}

impl Default for LinkRetention {
    fn default() -> Self {
        Self::All
    }
}

/// How images are represented in the rendered markdown.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageRetention {
    /// Keep `![alt](src)` image markdown.
    All,
    /// Keep alt text only (as plain text).
    Alt,
    /// Keep alt text inline and append a deduplicated Images footer.
    Summary,
    /// Remove images entirely.
    None,
}

impl Default for ImageRetention {
    fn default() -> Self {
        Self::All
    }
}

/// How media embeds are represented in the rendered markdown.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaRetention {
    /// Render media as a markdown link.
    Link,
    /// Render only title/label text.
    Text,
    /// Collect media and append a deduplicated Media footer.
    Summary,
    /// Render a minimal safe HTML media tag.
    Html,
    /// Do not render media inline or in a footer.
    None,
}

impl Default for MediaRetention {
    fn default() -> Self {
        Self::None
    }
}

/// Markdown heading rendering style.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HeadingStyle {
    /// ATX headings, for example `# Heading`.
    Atx,
    /// Setext headings for h1/h2, ATX for h3-h6.
    Setext,
}

impl Default for HeadingStyle {
    fn default() -> Self {
        Self::Atx
    }
}

/// Citation marker and reference footer style.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CitationFormat {
    /// `[1]`
    Square,
    /// `⟨1⟩`
    Angle,
    /// `【1†source】`
    Source,
}

impl Default for CitationFormat {
    fn default() -> Self {
        Self::Square
    }
}

/// Markdown rendering style options.
#[derive(Clone, Debug)]
pub struct MarkdownOptions {
    /// Heading rendering style.
    pub heading_style: HeadingStyle,
    /// Bullet marker for unordered lists (`-`, `*`, or `+`).
    pub bullet_marker: char,
    /// Fence used for code blocks (` ``` ` length is fixed at 3).
    pub code_fence: char,
    /// Whether to emit GFM tables (false renders tables as plain text).
    pub gfm_tables: bool,
    /// Safe inline HTML tags to preserve in markdown output.
    pub preserve_html_tags: Vec<String>,
}

impl Default for MarkdownOptions {
    fn default() -> Self {
        Self {
            heading_style: HeadingStyle::Atx,
            bullet_marker: '-',
            code_fence: '`',
            gfm_tables: true,
            preserve_html_tags: Vec::new(),
        }
    }
}

/// Whether and how markdown chunks should be generated.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChunkingMode {
    /// Do not generate chunks.
    Disabled,
    /// Split by markdown headings.
    Heading,
    /// Split by block boundaries.
    Block,
}

impl Default for ChunkingMode {
    fn default() -> Self {
        Self::Disabled
    }
}

/// Chunk generation options.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkingOptions {
    /// Chunking mode.
    pub mode: ChunkingMode,
    /// Maximum characters per chunk before a boundary split is preferred.
    pub max_chars_per_chunk: usize,
    /// Reserved for later overlap support.
    pub overlap_chars: usize,
}

impl Default for ChunkingOptions {
    fn default() -> Self {
        Self {
            mode: ChunkingMode::Disabled,
            max_chars_per_chunk: 4_000,
            overlap_chars: 0,
        }
    }
}

/// Query-focused content filtering strategy.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentFilterMode {
    /// Do not generate fit markdown.
    None,
    /// Keep chunks that directly contain query terms.
    Prune,
    /// Rank chunks with a local BM25-like scorer.
    Bm25,
    /// Rank chunks with BM25 plus local structural signals.
    Hybrid,
}

impl Default for ContentFilterMode {
    fn default() -> Self {
        Self::None
    }
}

/// What to do when rendered content exceeds the requested output budget.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OverflowMode {
    /// Mark the result as truncated and return cursor metadata.
    Truncate,
    /// Fail the read with a budget error.
    Error,
    /// Keep full content and rely on generated chunks for follow-up reads.
    Chunks,
}

impl Default for OverflowMode {
    fn default() -> Self {
        Self::Truncate
    }
}

/// Which engine should produce the readable source.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReaderEngine {
    /// Try the HTTP reader first and fall back to a browser snapshot when useful.
    Auto,
    /// Use only the HTTP/static reader path.
    Http,
    /// Require a browser-rendered snapshot.
    Browser,
}

impl Default for ReaderEngine {
    fn default() -> Self {
        Self::Auto
    }
}

/// Browser tab selection/navigation mode for browser-backed reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrowserMode {
    /// Reuse a matching tab when possible, otherwise open/navigate a new tab.
    MatchingOrNewTab,
    /// Use the active browser tab, navigating it if needed.
    ActiveTab,
    /// Always open a new browser tab for the URL.
    NewTab,
}

impl Default for BrowserMode {
    fn default() -> Self {
        Self::MatchingOrNewTab
    }
}

/// Browser wait strategy before taking a rendered snapshot.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BrowserWaitUntil {
    /// Wait only until basic HTML is available.
    Html,
    /// Wait until page text appears idle/stable.
    LoadIdle,
    /// Wait until page text is stable for a short idle window.
    TextStable,
    /// Wait until page text differs from the first observed text.
    TextChanged,
    /// Wait until page text contains the requested text.
    TextContains,
    /// Wait until network is idle (no in-flight requests for a short window).
    NetworkIdle,
    /// Smart wait: document ready → network idle → DOM/text stability.
    AutoSmart,
}

impl Default for BrowserWaitUntil {
    fn default() -> Self {
        Self::AutoSmart
    }
}

/// Already-rendered browser snapshot input.
#[derive(Clone, Debug)]
pub struct BrowserSnapshotInput {
    /// Rendered document HTML.
    pub html: String,
    /// Final rendered URL.
    pub final_url: Option<String>,
    /// Requested/source URL before browser redirects, if known.
    pub requested_url: Option<String>,
    /// Browser document title.
    pub title: Option<String>,
    /// Browser body innerText, used as a fallback when HTML has little text.
    pub body_text: Option<String>,
    /// Screenshot artifact id/ref, if the caller persisted one.
    pub screenshot_artifact_ref: Option<String>,
    /// Full-page screenshot artifact id/ref, if the caller persisted one.
    pub pageshot_artifact_ref: Option<String>,
    /// Viewport used for browser rendering, when known.
    pub viewport: Option<BrowserViewport>,
    /// Target selector element snapshot, when requested and found.
    pub selected_element: Option<BrowserSelectedElement>,
    /// Best-effort iframe summaries gathered by the browser bridge.
    pub frames: Vec<BrowserFrameSummary>,
    /// Best-effort open shadow root summaries gathered by the browser bridge.
    pub shadow_roots: Vec<BrowserShadowRootSummary>,
    /// Media elements found by the browser bridge.
    pub media: Vec<ReaderMedia>,
    /// Structured warnings from the browser bridge.
    pub warnings: Vec<ReaderWarning>,
    /// Accessibility-tree elements gathered by the browser bridge.
    pub ax_elements: Vec<BrowserAxElement>,
}

/// A structured accessibility-tree element snapshot from the browser bridge.
///
/// Mirrors a subset of the CDP `Accessibility.node` shape so the agent can
/// reference interactive/content nodes by `ref_id` without re-parsing the DOM.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserAxElement {
    /// CDP accessibility node ref id (used for act/type targetRef).
    pub ref_id: String,
    /// ARIA/DOM role (e.g. `button`, `link`, `textbox`, `main`).
    pub role: String,
    /// Accessible name (computed from aria-label / textContent / title).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// href for links; ignored for non-link roles.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Element bounds in CSS pixels `(x, y, width, height)`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<(i64, i64, i64, i64)>,
    /// Whether the element is interactive (focusable + actionable).
    pub is_interactive: bool,
    /// Whether the element is a content landmark (main/article/region).
    pub is_content: bool,
}

/// Options controlling extraction, rendering, fetching, and budgeting.
#[derive(Clone, Debug)]
pub struct ReaderOptions {
    /// High-level preset applied by adapters/CLI before specific overrides.
    pub preset: ReaderPreset,
    /// Preferred output shape for adapters/CLI.
    pub output_format: ReaderOutputFormat,
    /// Reader engine preference.
    pub engine: ReaderEngine,
    /// Which slice of the document to keep.
    pub mode: ExtractionMode,
    /// Whether raw/cleaned source snippets should be included in structured output.
    pub include_raw: bool,
    /// Character budget; `None` means no truncation by the reader.
    pub max_chars: Option<usize>,
    /// Approximate token budget for rendered output; converted with the local
    /// heuristic estimator.
    pub max_tokens: Option<usize>,
    /// Alias for caller-supplied context budget; the stricter token budget wins
    /// when both token fields are set.
    pub token_budget: Option<usize>,
    /// Behaviour when content exceeds the effective char/token budget.
    pub overflow: OverflowMode,
    /// Optional CSS selector whose first match becomes the render root.
    pub target_selector: Option<String>,
    /// Extra CSS selectors to remove before extraction/rendering.
    pub remove_selectors: Vec<String>,
    /// HTML tag names to keep; empty means keep all tags that survive cleaning.
    pub include_tags: Vec<String>,
    /// HTML tag names to remove in addition to cleaner rules.
    pub exclude_tags: Vec<String>,
    /// Chunk generation options.
    pub chunking: ChunkingOptions,
    /// Query used by query-focused content filtering.
    pub query_focus: Option<String>,
    /// User task/query text used as a secondary query focus signal.
    pub user_task: Option<String>,
    /// Query-focused content filtering strategy.
    pub content_filter: ContentFilterMode,
    /// Link representation.
    pub retain_links: LinkRetention,
    /// Image representation.
    pub retain_images: ImageRetention,
    /// Media representation.
    pub retain_media: MediaRetention,
    /// Citation marker/footer format.
    pub citation_format: CitationFormat,
    /// Whether to emit a `## References` citation footer.
    pub citations: bool,
    /// Whether to populate the metadata block.
    pub include_metadata: bool,
    /// Markdown rendering options.
    pub markdown: MarkdownOptions,
    /// Override user agent for network fetches.
    pub user_agent: Option<String>,
    /// Override request timeout for network fetches.
    pub timeout: Option<Duration>,
    /// Maximum bytes to download.
    pub max_bytes: Option<usize>,
    /// Cache policy requested by the caller.
    pub cache_policy: ReaderCachePolicy,
    /// Whether local/file inputs are trusted for expanded capabilities.
    pub trusted_local: bool,
    /// Whether private/localhost/link-local remote URLs may be fetched.
    pub allow_private_network: bool,
    /// Maximum DOM/source bytes accepted by the HTML path.
    pub max_dom_bytes: Option<usize>,
    /// Maximum extracted text/markdown characters retained by the reader.
    pub max_extracted_chars: Option<usize>,
    /// Whether callers should index this result into local recall/search.
    pub index_result: bool,
    /// Whether OCR adapters should run when available.
    pub use_ocr: bool,
    /// Whether image caption adapters should run when available.
    pub use_caption: bool,
    /// Optional CSS selector that browser rendering should wait for.
    pub wait_for_selector: Option<String>,
    /// Browser wait condition.
    pub wait_until: BrowserWaitUntil,
    /// Optional browser render timeout in milliseconds.
    pub browser_timeout_ms: Option<u64>,
    /// Browser tab selection/navigation mode.
    pub browser_mode: BrowserMode,
    /// Whether browser path should capture a screenshot artifact.
    pub include_screenshot: bool,
    /// Browser viewport for rendered snapshot requests.
    pub viewport: Option<BrowserViewport>,
    /// Whether the browser path should emulate a mobile viewport/user agent.
    pub mobile: bool,
    /// Whether same-origin/readable iframes should be folded into snapshot data.
    pub include_iframes: bool,
    /// Whether open shadow roots should be folded into snapshot data.
    pub include_shadow_dom: bool,
    /// Whether browser path should capture a full-page screenshot artifact.
    pub include_pageshot: bool,
    /// Whether browser path should extract audio/video/embed media metadata.
    pub include_media: bool,
    /// Whether the browser bridge should extract an accessibility-tree snapshot.
    pub include_ax_tree: bool,
    /// Whether to collect raw-only, redacted debug trace metadata.
    pub include_debug_trace: bool,
}

impl Default for ReaderOptions {
    fn default() -> Self {
        Self {
            preset: ReaderPreset::Agent,
            output_format: ReaderOutputFormat::Markdown,
            engine: ReaderEngine::Auto,
            mode: ExtractionMode::Main,
            include_raw: false,
            max_chars: Some(12_000),
            max_tokens: None,
            token_budget: None,
            overflow: OverflowMode::Truncate,
            target_selector: None,
            remove_selectors: Vec::new(),
            include_tags: Vec::new(),
            exclude_tags: Vec::new(),
            chunking: ChunkingOptions::default(),
            query_focus: None,
            user_task: None,
            content_filter: ContentFilterMode::None,
            retain_links: LinkRetention::All,
            retain_images: ImageRetention::All,
            retain_media: MediaRetention::None,
            citation_format: CitationFormat::Square,
            citations: true,
            include_metadata: true,
            markdown: MarkdownOptions::default(),
            user_agent: None,
            timeout: None,
            max_bytes: None,
            cache_policy: ReaderCachePolicy::Auto,
            trusted_local: false,
            allow_private_network: false,
            max_dom_bytes: None,
            max_extracted_chars: Some(1_000_000),
            index_result: true,
            use_ocr: true,
            use_caption: true,
            wait_for_selector: None,
            wait_until: BrowserWaitUntil::AutoSmart,
            browser_timeout_ms: None,
            browser_mode: BrowserMode::MatchingOrNewTab,
            include_screenshot: false,
            viewport: None,
            mobile: false,
            include_iframes: false,
            include_shadow_dom: false,
            include_pageshot: false,
            include_media: false,
            include_ax_tree: false,
            include_debug_trace: false,
        }
    }
}

impl ReaderOptions {
    /// Apply preset defaults without overwriting explicit, non-default knobs.
    pub fn apply_preset_defaults(&mut self) {
        match self.preset {
            ReaderPreset::Agent => {}
            ReaderPreset::Research => {
                if matches!(self.content_filter, ContentFilterMode::None) {
                    self.content_filter = ContentFilterMode::Hybrid;
                }
                if matches!(self.chunking.mode, ChunkingMode::Disabled) {
                    self.chunking.mode = ChunkingMode::Block;
                    self.chunking.max_chars_per_chunk = 4_000;
                }
                if matches!(self.retain_links, LinkRetention::All) {
                    self.retain_links = LinkRetention::Summary;
                }
                if matches!(self.retain_images, ImageRetention::All) {
                    self.retain_images = ImageRetention::Summary;
                }
                self.citations = true;
            }
            ReaderPreset::Index => {
                self.output_format = ReaderOutputFormat::Chunks;
                if matches!(self.chunking.mode, ChunkingMode::Disabled) {
                    self.chunking.mode = ChunkingMode::Block;
                    self.chunking.max_chars_per_chunk = 2_000;
                }
                self.max_chars = None;
                self.index_result = true;
            }
            ReaderPreset::Reader => {
                self.output_format = ReaderOutputFormat::FrontmatterMarkdown;
                if matches!(self.retain_links, LinkRetention::All) {
                    self.retain_links = LinkRetention::Summary;
                }
                if matches!(self.retain_images, ImageRetention::All) {
                    self.retain_images = ImageRetention::Alt;
                }
            }
            ReaderPreset::Raw => {
                self.output_format = ReaderOutputFormat::Json;
                self.mode = ExtractionMode::Raw;
                self.include_raw = true;
                self.max_chars = None;
            }
        }
    }
}

/// Viewport used by browser-backed reads.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserViewport {
    /// CSS pixel width.
    pub width: u32,
    /// CSS pixel height.
    pub height: u32,
    /// Device scale factor, if explicitly requested or reported.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_scale_factor: Option<f32>,
}

/// Rectangle/bounds for a browser element in CSS pixels.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserElementBounds {
    /// X coordinate relative to the viewport.
    pub x: f64,
    /// Y coordinate relative to the viewport.
    pub y: f64,
    /// Element width.
    pub width: f64,
    /// Element height.
    pub height: f64,
}

/// Browser-selected element snapshot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSelectedElement {
    /// CSS selector used to find the element.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    /// Sanitized/capped outer HTML.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// Normalized visible text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Element bounds in CSS pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<BrowserElementBounds>,
}

/// Best-effort iframe summary from a browser snapshot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFrameSummary {
    /// Frame URL, if visible to the bridge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Frame title, if readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Normalized frame text, if readable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Sanitized/capped frame HTML, if readable and requested.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// Reason the frame could not be read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
}

/// Best-effort open shadow root summary from a browser snapshot.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserShadowRootSummary {
    /// Host selector/path preview.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    /// Normalized shadow text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Sanitized/capped shadow HTML.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// Reason the shadow root could not be read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
}

/// Detected content format.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    /// HTML / XHTML.
    Html,
    /// Markdown.
    Markdown,
    /// Plain text.
    Text,
    /// JSON.
    Json,
    /// Generic XML.
    Xml,
    /// RSS feed.
    Rss,
    /// Atom feed.
    Atom,
    /// PDF document.
    Pdf,
    /// Word document.
    Docx,
    /// Excel workbook.
    Xlsx,
    /// PowerPoint deck.
    Pptx,
    /// CSV / TSV.
    Csv,
    /// Raster or vector image.
    Image,
    /// ZIP archive.
    Zip,
    /// Unrecognized binary.
    UnknownBinary,
}

impl Format {
    /// Short, stable label used in errors and warnings.
    pub fn label(self) -> &'static str {
        match self {
            Format::Html => "html",
            Format::Markdown => "markdown",
            Format::Text => "text",
            Format::Json => "json",
            Format::Xml => "xml",
            Format::Rss => "rss",
            Format::Atom => "atom",
            Format::Pdf => "pdf",
            Format::Docx => "docx",
            Format::Xlsx => "xlsx",
            Format::Pptx => "pptx",
            Format::Csv => "csv",
            Format::Image => "image",
            Format::Zip => "zip",
            Format::UnknownBinary => "binary",
        }
    }

    /// Whether the reader can render this format to markdown/text in this build.
    pub fn is_textual(self) -> bool {
        matches!(
            self,
            Format::Html
                | Format::Markdown
                | Format::Text
                | Format::Json
                | Format::Xml
                | Format::Rss
                | Format::Atom
                | Format::Csv
        )
    }
}

/// Which signal decided the detected format.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DetectedBy {
    /// Decided by the reported MIME type.
    MimeType,
    /// Decided by the file extension.
    Extension,
    /// Decided by leading magic bytes.
    MagicBytes,
    /// Fell back to a default guess.
    Default,
}

/// The outcome of format detection.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    /// Detected format.
    pub format: Format,
    /// Reported or inferred MIME type.
    pub mime_type: Option<String>,
    /// Which signal decided it.
    pub detected_by: DetectedBy,
    /// Confidence in `[0, 1]`.
    pub confidence: f32,
}

/// A structured warning surfaced to the agent.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderWarning {
    /// Machine-readable code.
    pub code: WarningCode,
    /// Human-readable message.
    pub message: String,
}

/// Warning codes the reader can emit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WarningCode {
    /// Main content extraction had low confidence.
    LowMainContentConfidence,
    /// Output was truncated by the char budget.
    Truncated,
    /// The format is not supported for rendering.
    UnsupportedFormat,
    /// A browser engine is recommended (SPA shell / blocked).
    BrowserRecommended,
    /// OCR is recommended (image-only content).
    OcrRecommended,
    /// HTML appeared malformed but was parsed leniently.
    MalformedHtml,
    /// Body charset was not UTF-8 and was decoded best-effort.
    NonUtf8Charset,
    /// An optional external adapter was not available.
    ExternalAdapterMissing,
    /// An optional external adapter failed or timed out and fallback was used.
    ExternalAdapterFailed,
    /// Link/image output was truncated by a safety limit.
    ResourceLimitExceeded,
    /// A URL/file/security policy blocked the requested operation.
    SecurityBlocked,
    /// Cache was requested and a cached entry was used.
    CacheHit,
    /// Cache was requested but no cached entry was available.
    CacheMiss,
    /// OCR was requested but no OCR provider/backend was available.
    OcrUnavailable,
    /// Captioning was requested but no caption provider/backend was available.
    CaptionUnavailable,
    /// HTML/SVG/raw preview content was sanitized before output.
    SanitizedHtml,
}

/// Page metadata extracted from the document head and structured data.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderMetadata {
    /// Document title.
    pub title: Option<String>,
    /// Meta description.
    pub description: Option<String>,
    /// Author.
    pub author: Option<String>,
    /// Site name.
    pub site_name: Option<String>,
    /// Published timestamp (as found, not normalized).
    pub published_time: Option<String>,
    /// Modified timestamp (as found).
    pub modified_time: Option<String>,
    /// Document language.
    pub language: Option<String>,
    /// Canonical URL.
    pub canonical: Option<String>,
    /// Open Graph key/value pairs (without the `og:` prefix).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub open_graph: Vec<(String, String)>,
    /// Twitter card key/value pairs (without the `twitter:` prefix).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub twitter: Vec<(String, String)>,
    /// Parsed JSON-LD objects.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub json_ld: Vec<Value>,
}

/// A link with surrounding context.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderLink {
    /// Absolute URL.
    pub url: String,
    /// Anchor text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Title attribute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// `rel` attribute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rel: Option<String>,
    /// Nearest enclosing heading text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub section: Option<String>,
    /// Best-effort DOM path/source hint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dom_path: Option<String>,
    /// Source byte offset when parser support is available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_offset: Option<usize>,
}

/// An image with metadata.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderImage {
    /// Absolute URL.
    pub url: String,
    /// Alt text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    /// Title attribute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// `srcset` candidate URLs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub srcset: Vec<String>,
    /// Width attribute, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// Height attribute, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// Nearest figure caption, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    /// Whether the image looks decorative/tracking rather than contentful.
    pub likely_decorative: bool,
}

/// Browser media/embed metadata.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderMedia {
    /// Media kind, for example `video`, `audio`, `iframe`, `embed`, or `object`.
    pub kind: String,
    /// Primary URL/source, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Title/label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Text/accessible label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Poster image URL for video.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    /// MIME/type hint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    /// Width attribute or rendered width, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// Height attribute or rendered height, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

/// A content chunk. Stubbed in Milestone A (always empty); filled in Milestone B.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderChunk {
    /// Stable chunk id.
    pub id: String,
    /// Heading breadcrumb to this chunk.
    pub heading_path: Vec<String>,
    /// Start character offset in the rendered markdown for this chunk's main
    /// content (overlap is excluded).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_start_char: Option<usize>,
    /// End character offset in the rendered markdown for this chunk's main
    /// content (overlap is excluded).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_end_char: Option<usize>,
    /// First PDF page covered by this chunk, inferred from rendered page markers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_start: Option<u32>,
    /// Last PDF page covered by this chunk, inferred from rendered page markers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_end: Option<u32>,
    /// Chunk markdown.
    pub markdown: String,
    /// Chunk plain text.
    pub plain_text: String,
    /// Estimated token count.
    pub token_estimate: usize,
    /// Links referenced by this chunk.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<ReaderLink>,
    /// Images referenced by this chunk.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ReaderImage>,
}

/// Summary of query-focused filtering decisions.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredOutSummary {
    /// Number of candidate chunks considered.
    pub total_chunks: usize,
    /// Number of chunks kept in `fit_chunks`.
    pub kept_chunks: usize,
    /// Number of chunks filtered out.
    pub filtered_chunks: usize,
    /// Kept chunk ids.
    pub kept_chunk_ids: Vec<String>,
    /// Filtered-out chunk ids.
    pub filtered_chunk_ids: Vec<String>,
    /// Query terms matched by kept chunks.
    pub matched_terms: Vec<String>,
}

/// Per-chunk query-focused scoring details.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FitChunkScoreDebug {
    /// Candidate chunk id.
    pub chunk_id: String,
    /// Total score used for sorting/filtering.
    pub total_score: f32,
    /// BM25 component.
    pub bm25_score: f32,
    /// Heading match component.
    pub heading_score: f32,
    /// Link match component.
    pub link_score: f32,
    /// Table match component.
    pub table_score: f32,
    /// Code match component.
    pub code_score: f32,
    /// Query terms matched by this chunk.
    pub matched_terms: Vec<String>,
    /// Whether this chunk was kept.
    pub kept: bool,
}

/// Descriptor of an out-of-band artifact (full body, screenshot, ...).
///
/// In Milestone A the reader returns no artifacts itself; the caller owns
/// artifact persistence. This descriptor exists for forward compatibility.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderArtifact {
    /// Artifact id/ref if persisted by the caller.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Artifact kind label.
    pub kind: String,
    /// Artifact MIME type.
    pub mime_type: String,
}

/// Information about how the main content was extracted.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractionInfo {
    /// Which extraction method produced the output.
    pub method: String,
    /// Confidence in the main-content selection, `[0, 1]`.
    pub main_content_confidence: f32,
    /// Whether a fallback path was used.
    pub fallback_used: bool,
}

/// Lightweight timing breakdown for observability/debug output.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderTiming {
    /// Network fetch duration in milliseconds.
    pub fetch_ms: u64,
    /// Parse/decode duration in milliseconds.
    pub parse_ms: u64,
    /// Extraction/cleaning duration in milliseconds.
    pub extract_ms: u64,
    /// Markdown/document render duration in milliseconds.
    pub render_ms: u64,
    /// End-to-end reader duration in milliseconds.
    pub total_ms: u64,
}

/// Raw-only debug trace for reader diagnostics.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderDebugTrace {
    /// Whether trace was enabled by request option or environment.
    pub enabled_by: String,
    /// Final extractor/render path selected for the result.
    pub selected_extractor: String,
    /// Fallback reason when extraction/rendering fell back.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_reason: Option<String>,
    /// Redacted cleaning statistics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cleaning: Option<ReaderCleaningDebug>,
    /// Redacted candidate scoring summary.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extractor_candidates: Vec<ReaderExtractorCandidateDebug>,
}

/// Redacted HTML cleaning statistics.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderCleaningDebug {
    /// Total excluded DOM nodes after all cleaning rules.
    pub removed_total: usize,
    /// Nodes excluded by built-in cleaner rules.
    pub default_removed: usize,
    /// Nodes newly excluded by caller supplied selectors.
    pub caller_selector_removed: usize,
    /// Total nodes matched by caller supplied selectors, including already-excluded nodes.
    pub caller_selector_matched: usize,
    /// Per-selector match/removal counts.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub remove_selectors: Vec<ReaderSelectorRemovalDebug>,
}

/// Per-selector removal statistics.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSelectorRemovalDebug {
    /// The selector string supplied by the caller.
    pub selector: String,
    /// Number of DOM nodes matched by the selector.
    pub matched_nodes: usize,
    /// Number of matched nodes that were newly excluded by this selector.
    pub newly_excluded_nodes: usize,
}

/// Redacted extractor candidate score summary.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderExtractorCandidateDebug {
    /// Candidate rank within the reported list.
    pub rank: usize,
    /// Candidate DOM tag name.
    pub tag_name: String,
    /// Candidate id attribute, if present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// Candidate classes, capped by the producer.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub classes: Vec<String>,
    /// Final score used for ranking.
    pub score: f32,
    /// Redacted subtree text length.
    pub text_len: usize,
    /// Link density for the candidate subtree.
    pub link_density: f32,
    /// Whether this candidate was selected.
    pub selected: bool,
}

/// YAML-ish frontmatter fields for agent-friendly output.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Frontmatter {
    /// Title.
    pub title: Option<String>,
    /// Requested URL.
    pub url: Option<String>,
    /// Final/source URL after redirects.
    pub source_url: Option<String>,
    /// Retrieval timestamp (RFC3339).
    pub retrieved_at: Option<String>,
    /// Content type label.
    pub content_type: Option<String>,
    /// Language.
    pub language: Option<String>,
    /// Extraction method.
    pub extraction_method: Option<String>,
    /// Rough token estimate.
    pub token_estimate: usize,
    /// Whether the body was truncated.
    pub truncated: bool,
}

/// One engine attempt in a multi-engine fetch/render pipeline.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderEngineAttempt {
    /// Engine label, for example `http` or `browser`.
    pub engine: String,
    /// Whether this attempt produced the final successful output.
    pub success: bool,
    /// Why the attempt failed or why the pipeline switched to the next engine.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// HTTP status observed by this attempt, when applicable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

/// The full result of a read.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderResult {
    /// Detected format.
    pub format: Format,
    /// Which signal decided the format.
    pub detected_by: DetectedBy,
    /// Reported MIME type, if any.
    pub mime_type: Option<String>,
    /// Final URL after redirects, if fetched.
    pub final_url: Option<String>,
    /// HTTP status, if fetched.
    pub status: Option<u16>,
    /// Agent-friendly frontmatter.
    pub frontmatter: Frontmatter,
    /// Rendered markdown (untruncated; the caller may truncate for display).
    pub raw_markdown: String,
    /// Rendered markdown with citation markers and reference footer.
    pub markdown_with_citations: String,
    /// Query-focused markdown, if requested and query matched content.
    pub fit_markdown: String,
    /// Budget-friendly text for direct Agent display.
    pub compact_text: String,
    /// Plain text rendition.
    pub plain_text: String,
    /// Extracted metadata.
    pub metadata: ReaderMetadata,
    /// Extracted links.
    pub links: Vec<ReaderLink>,
    /// Extracted images.
    pub images: Vec<ReaderImage>,
    /// Extracted browser media/embed metadata.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub media: Vec<ReaderMedia>,
    /// Accessibility-tree elements gathered by the browser bridge.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ax_elements: Vec<BrowserAxElement>,
    /// Content chunks (empty in Milestone A).
    pub chunks: Vec<ReaderChunk>,
    /// Query-focused chunks, if requested.
    pub fit_chunks: Vec<ReaderChunk>,
    /// Summary of query-focused chunks filtered out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filtered_out_summary: Option<FilteredOutSummary>,
    /// Query-focused per-chunk scoring details.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fit_scoring_debug: Vec<FitChunkScoreDebug>,
    /// Artifact descriptors (empty in Milestone A).
    pub artifacts: Vec<ReaderArtifact>,
    /// Warnings emitted during processing.
    pub warnings: Vec<ReaderWarning>,
    /// Whether `raw_markdown` exceeds the char budget (informational; the
    /// reader does not truncate when `max_chars` is `None`).
    pub truncated: bool,
    /// Total character count of the untruncated markdown.
    pub total_chars: usize,
    /// Whether more content exists beyond what a budget would keep.
    pub has_more: bool,
    /// Character cursor where the next budgeted read should continue, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<usize>,
    /// Recommended follow-up action for the caller/agent, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended_next_action: Option<String>,
    /// How the content was extracted.
    pub extraction: ExtractionInfo,
    /// Lightweight processing timings for raw/debug callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<ReaderTiming>,
    /// Optional redacted debug trace for raw/debug callers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub debug_trace: Option<ReaderDebugTrace>,
    /// Raw/cleaned source included only when `include_raw` or raw preset/mode is requested.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_source: Option<String>,
    /// Deterministic cache key for this read, if enough inputs were available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_key: Option<String>,
    /// Engine that produced the final successful output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine_used: Option<String>,
    /// Ordered engine attempts, including failures and fallback switches.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub engine_attempts: Vec<ReaderEngineAttempt>,
}
