# Lyra Agent Reader Implementation TODO

目标：自研一个 native-core 的网页/文档转 Agent 友好内容工具，替代当前轻量 `web_fetch` HTML 剥标签能力，并逐步覆盖 PDF、Office、图片、浏览器渲染、检索增强和 Agent chunk 输出。

参考方向：
- `参考/web-to-md-tools/jina-reader`
- `参考/web-to-md-tools/crawl4ai`
- `参考/web-to-md-tools/firecrawl`
- `参考/web-to-md-tools/markitdown`
- `参考/web-to-md-tools/readability`
- `参考/web-to-md-tools/trafilatura`
- `参考/web-to-md-tools/turndown`
- `参考/web-to-md-tools/llm-reader`

## 0. Design Decisions

- [x] 确定项目名称：建议 `lyra-agent-reader`。
- [x] 确定 crate 位置：建议 `crates/lyra-agent-reader`。
- [x] 确定定位：native core + optional adapters。Rust/C/C++/OS API 都可以作为具体模块的一等实现路径。
- [x] 确定第一批调用方：
  - [x] `crates/lyra-agent-runtime/src/native_backend/tools/web.rs`
  - [x] `crates/lyra-docs-core`
  - [x] `apps/desktop/src/main/workbench-documents`
  - [x] Workbench Browser tab/session fetch bridge
- [x] 确定输出主格式：
  - [x] `markdown`
  - [x] `text`
  - [x] `json`
  - [x] `chunks`
  - [x] `frontmatter+markdown`
- [x] 确定是否允许 optional external binaries：
  - [x] LibreOffice for Office high-fidelity conversion
  - [x] Tesseract or local OCR for images/scanned PDFs
  - [x] browser/Electron/Playwright path for SPA/rendered pages
- [x] 确定默认 preset：
  - [x] `agent`
  - [x] `research`
  - [x] `index`
  - [x] `reader`
  - [x] `raw`

### Completion Defaults Recorded

- Default preset is `agent`; `research` enables hybrid fit/chunks/citations, `index` emits chunk-rich JSON for recall, `reader` favors clean frontmatter markdown, and `raw` preserves capped raw source.
- Default tool indexing is enabled: `indexResult=true` for `web_fetch`, `web_research`, and Workbench agent document reads; callers can opt out with `indexResult=false`.
- Default search provider remains DuckDuckGo; configured `searxng`, `brave`, `serpapi`, `tavily`, and `exa` providers normalize to `title/url/snippet/source/confidence` and deep reads add fetched markdown excerpts.
- Default OCR/caption stance: OCR auto-detects `tesseract` through `LYRA_AGENT_READER_TESSERACT` or `PATH`; image captioning is enabled in options and emits structured unavailable warnings unless a host/provider is attached.
- Default safety stance: untrusted remote fetch blocks localhost/private/link-local IPs and rechecks redirects; trusted `file:`/local document reads are explicit and capped at 64 MiB.
- Default cache stance: deterministic cache keys include requested URL/path, final URL/path, safe response-header fingerprint, content hash, and option hash; persistent cache remains provider-only.
- Compatibility stance: CLI is included as `lyra-agent-reader`, and `/tools/web/fetch` accepts the Jina-style aliases listed in this TODO.

## 1. Core Crate Scaffold

- [x] 新增 `crates/lyra-agent-reader/Cargo.toml`。
- [x] 新增 `src/lib.rs`。
- [x] 新增模块结构：
  - [x] `types.rs`
  - [x] `detect.rs`
  - [x] `fetch.rs`
  - [x] `html/`
  - [x] `markdown/`
  - [x] `extract/`
  - [x] `document/`
  - [x] `chunk.rs`
  - [x] `citation.rs`
  - [x] `budget.rs`
  - [x] `errors.rs`
  - [x] `tests/fixtures`
- [x] 定义核心 request/response：
  - [x] `ReaderRequest`
  - [x] `ReaderInput`
  - [x] `ReaderOptions`
  - [x] `ReaderResult`
  - [x] `ReaderMetadata`
  - [x] `ReaderArtifact`
  - [x] `ReaderChunk`
  - [x] `ReaderWarning`
- [x] 支持输入类型：
  - [x] URL
  - [x] raw HTML string
  - [x] bytes + MIME hint
  - [x] local file path
  - [x] browser snapshot
  - [x] active browser tab adapter payload
- [x] 输出 structured raw JSON，便于 Agent 工具返回 `raw`。
- [x] 输出 concise markdown/text，便于 Agent 工具返回 `content`。

## 2. Format Detection

- [x] 实现 MIME + extension + magic bytes 综合检测。
- [x] 支持格式枚举：
  - [x] HTML/XHTML
  - [x] Markdown
  - [x] Plain text
  - [x] JSON
  - [x] XML/RSS/Atom
  - [x] PDF
  - [x] DOCX
  - [x] XLSX
  - [x] PPTX
  - [x] CSV/TSV
  - [x] Image: PNG/JPEG/WebP/GIF/TIFF/BMP/SVG
  - [x] ZIP
  - [x] Unknown binary
- [x] 迁移或复用 `lyra-docs-core` 现有 PDF 探测逻辑。
- [x] 给每次转换记录 `format`, `mimeType`, `detectedBy`, `confidence`。

## 3. Fetch Layer

- [x] 抽象 `FetchProvider` trait。
- [x] 实现 `ReqwestFetchProvider`：
  - [x] redirect limit
  - [x] timeout
  - [x] max bytes
  - [x] user-agent
  - [x] accept header
  - [x] proxy hook
  - [x] cookie/header hook
  - [x] final URL
  - [x] response headers
- [x] 将当前 `web_fetch` 的 HTTP path 迁移到 reader。
- [x] 处理非文本响应：
  - [x] PDF bytes route to document reader
  - [x] Office bytes route to document reader
  - [x] image bytes route to image reader
  - [x] binary unsupported returns useful error
- [x] 支持 `file:` URL/local file path，默认只用于本地可信调用。
  - [x] `file:` URL
  - [x] local file path
- [x] 添加 cache key 设计：
  - [x] URL + headers subset
  - [x] final URL
  - [x] content hash
  - [x] options hash
- [x] 不在第一版实现持久 cache，但预留 trait。

## 4. Browser Render Layer

- [x] 抽象 `BrowserSnapshotProvider` trait。
- [x] 复用 Workbench Browser/Electron 能力，而不是 Rust 内嵌浏览器。
- [x] 支持 browser options：
  - [x] `engine`: `auto | http | browser`
  - [x] `targetSelector`
  - [x] `removeSelector`
  - [x] `waitForSelector`
  - [x] `waitUntil`: `html | loadIdle | textStable | textChanged | textContains`
  - [x] `timeoutMs`
  - [x] `viewport`
  - [x] `mobile`
  - [x] `includeIframes`
  - [x] `includeShadowDom`
  - [x] `screenshot`
  - [x] `pageshot`
- [x] Browser path returns:
  - [x] final URL
  - [x] document title
  - [x] outer HTML
  - [x] body innerText
  - [x] selected element HTML
  - [x] links
  - [x] images
  - [x] media
  - [x] screenshot artifact ref
- [x] Auto fallback rule:
  - [x] HTTP HTML too short -> try browser
  - [x] content looks like SPA shell -> try browser
  - [x] blocked/403 and browser session available -> recommend browser path
  - [x] explicit selector/wait option -> browser path

## 5. HTML Cleaning

- [x] 使用 Rust HTML parser，避免手写字符串剥标签。
- [x] 评估并选型：
  - [x] `html5ever`
  - [x] `scraper`
  - [x] `kuchikiki`/equivalent DOM library
  - [x] `lol_html` for streaming rewrite if useful
- [x] 删除噪声节点：
  - [x] script
  - [x] style
  - [x] noscript policy decision
  - [x] template
  - [x] hidden elements
  - [x] ads/promotional blocks
  - [x] cookie banners
  - [x] navigation/footer/sidebar optional
- [x] 支持 `includeTags`/`excludeTags`。
- [x] 支持 CSS selector target/remove。
- [x] 规范化 URL：
  - [x] base tag
  - [x] relative link
  - [x] image src/srcset
  - [x] canonical URL
- [x] 提取 metadata：
  - [x] title
  - [x] description
  - [x] author
  - [x] site name
  - [x] published time
  - [x] modified time
  - [x] language
  - [x] canonical URL
  - [x] Open Graph
  - [x] Twitter card
  - [x] JSON-LD basic objects

## 6. Main Content Extraction

- [x] 实现 Readability-like article extractor。
- [x] 借鉴 Mozilla Readability scoring：
  - [x] paragraph text length
  - [x] link density
  - [x] class/id positive/negative hints
  - [x] heading structure
  - [x] sibling merging
  - [x] unlikely candidates
- [x] 借鉴 Trafilatura robustness：
  - [x] fallback extraction
  - [x] metadata fallback
  - [x] comments optional
  - [x] tables optional
  - [x] images optional
- [x] 输出 extraction modes：
  - [x] `main`
  - [x] `full`
  - [x] `selector`
  - [x] `text`
  - [x] `raw`
- [x] 每次提取记录：
  - [x] `extractionMethod`
  - [x] `mainContentConfidence`
  - [x] `fallbackUsed`
  - [x] `warnings`
- [x] 添加正文抽取 fixture：
  - [x] news article
  - [x] blog
  - [x] docs page
  - [x] GitHub README-like page
  - [x] ecommerce listing
  - [x] forum page
  - [x] SPA shell
  - [x] page with heavy nav/footer

## 7. HTML to Markdown Renderer

- [x] 实现 Rust Turndown-like rule engine。
- [x] 支持基础元素：
  - [x] headings
  - [x] paragraphs
  - [x] strong/em
  - [x] inline code
  - [x] fenced code block
  - [x] blockquote
  - [x] ordered/unordered lists
  - [x] nested lists
  - [x] links
  - [x] images
  - [x] horizontal rule
  - [x] line breaks
- [x] 支持 GFM：
  - [x] tables
  - [x] task lists
  - [x] strikethrough
  - [x] fenced code language
- [x] 支持 code block language inference：
  - [x] class `language-*`
  - [x] `data-lang`
  - [x] pre/code attrs
- [x] Markdown options：
  - [x] heading style
  - [x] bullet marker
  - [x] code fence marker
  - [x] link style inline/reference/citation
  - [x] image style all/alt/none
  - [x] media style link/text/none/html
  - [x] preserve HTML allowlist
- [x] Normalize whitespace：
  - [x] collapse excessive blank lines
  - [x] protect code whitespace
  - [x] prevent malformed list/table spacing
  - [x] remove tracking whitespace
- [x] Add markdown renderer golden tests.

## 8. Links, Images, Media, Citations

- [x] Extract all links with context:
  - [x] URL
  - [x] anchor text
  - [x] title
  - [x] rel
  - [x] surrounding heading
  - [x] DOM path/source offset if available
- [x] Extract images:
  - [x] src
  - [x] srcset candidates
  - [x] alt
  - [x] title
  - [x] dimensions if available
  - [x] figure caption
  - [x] likely decorative flag
- [x] Extract media:
  - [x] video
  - [x] audio
  - [x] iframe embeds
  - [x] YouTube/Vimeo/Bilibili canonical URLs
- [x] Link retention modes:
  - [x] `all`
  - [x] `none`
  - [x] `text`
  - [x] `citations`
  - [x] `summary`
- [x] Image retention modes:
  - [x] `all`
  - [x] `none`
  - [x] `alt`
  - [x] `summary`
- [x] Citation formats:
  - [x] `⟨1⟩`
  - [x] `[1]`
  - [x] `【1†source】`
- [x] Append reference footer:
  - [x] `## References`
  - [x] `## Images`
  - [x] `## Media`
- [x] Deduplicate references by normalized URL.
- [x] Preserve multiple anchors to same URL as aliases.

## 9. Agent-Friendly Output

- [x] Frontmatter output:
  - [x] title
  - [x] url
  - [x] source_url
  - [x] retrieved_at
  - [x] content_type
  - [x] language
  - [x] extraction_method
  - [x] token_estimate
  - [x] truncated
- [x] Agent header output for compact text mode:
  - [x] `Title:`
  - [x] `URL Source:`
  - [x] `Retrieved:`
- [x] Return both:
  - [x] `rawMarkdown`
  - [x] `markdownWithCitations`
  - [x] `fitMarkdown`
  - [x] `compactText`
  - [x] `plainText`
  - [x] `metadata`
  - [x] `links`
  - [x] `images`
  - [x] `chunks`
  - [x] `artifacts`
  - [x] `recommendedNextAction`
- [x] Add `recommendedNextAction` rules:
  - [x] truncated -> ask for chunk/selector
  - [x] SPA shell -> use browser engine
  - [x] PDF image-only -> use OCR
  - [x] Office unsupported -> enable LibreOffice adapter

## 10. Token and Size Budgeting

- [x] Implement char budget first.
- [x] Implement token estimate fallback.
- [x] Evaluate tokenizer options:
  - [x] lightweight heuristic
  - [x] tiktoken-compatible optional crate if acceptable
  - [x] model-specific adapter later
- [x] Options:
  - [x] `maxChars`
  - [x] `maxTokens`
  - [x] `tokenBudget`
  - [x] `overflow`: `truncate | error | chunks`
- [x] Truncation should prefer structural boundaries:
  - [x] headings
  - [x] paragraphs
  - [x] list item boundary
  - [x] table boundary
  - [x] code block boundary
- [x] Return `hasMore`, `nextCursor`, `truncated`, `totalChars`.
  - [x] `hasMore`
  - [x] `nextCursor`
  - [x] `truncated`
  - [x] `totalChars`

## 11. Chunking

- [x] Heading-based chunking:
  - [x] h1
  - [x] h2
  - [x] h3
  - [x] h4
  - [x] h5
- [x] Structured block chunking:
  - [x] paragraph blocks
  - [x] list blocks
  - [x] table blocks
  - [x] code blocks
- [x] Token/char limited chunking:
  - [x] max chunk size
  - [x] overlap
  - [x] preserve references
- [x] Each chunk includes:
  - [x] id
  - [x] heading path
  - [x] markdown
  - [x] plain text
  - [x] source range if available
  - [x] links/images used
  - [x] token estimate
- [x] JSON output for chunks.
- [x] Delimited text output for simple Agent streaming.

## 12. Query-Focused Fit Markdown

- [x] Implement BM25 scoring for blocks/chunks.
- [x] Use query from request:
  - [x] search query
  - [x] user task
  - [x] explicit `queryFocus`
- [x] Content filter modes:
  - [x] `none`
  - [x] `prune`
  - [x] `bm25`
  - [x] `hybrid`
- [x] Ranking signals:
  - [x] BM25
  - [x] heading match
  - [x] metadata match
  - [x] link anchor match
  - [x] table density
  - [x] code density
  - [x] main content confidence
- [x] Output:
  - [x] `fitMarkdown`
  - [x] `fitChunks`
  - [x] `filteredOutSummary`
  - [x] scoring debug in raw only

## 13. PDF Support

- [x] Integrate existing `crates/lyra-docs-core` PDF parser.
- [x] Expose PDF through unified reader result.
- [x] Preserve page boundaries:
  - [x] `<!-- page: 1 -->`
  - [x] chunk metadata page index
  - [x] references to page numbers
- [x] Improve PDF text cleanup:
  - [x] line merge
  - [x] hyphenation repair
  - [x] header/footer removal heuristic
  - [x] page number cleanup
- [x] Evaluate better PDF extraction options:
  - [x] current `lopdf`
  - [x] `pdf-extract`
  - [x] PDF.js via optional JS sidecar
  - [x] `pdfium-render` optional
- [x] Table extraction:
  - [x] basic layout heuristic
  - [x] preserve monospaced table fallback
  - [x] markdown table if confident
- [x] Scanned/image-only PDFs:
  - [x] detect empty text
  - [x] recommend OCR adapter
  - [x] optional render pages to image
- [x] Tests:
  - [x] text PDF
  - [x] encrypted PDF
  - [x] image-only PDF
  - [x] multi-page PDF
  - [x] table-heavy PDF

## 14. Office Support

- [x] DOCX basic Rust converter:
  - [x] unzip package
  - [x] parse `word/document.xml`
  - [x] headings
  - [x] paragraphs
  - [x] lists
  - [x] tables
  - [x] hyperlinks
  - [x] footnotes/endnotes basic
  - [x] images as references
- [x] XLSX basic Rust converter:
  - [x] workbook sheets
  - [x] shared strings
  - [x] sheet tables to markdown
  - [x] formulas display
  - [x] merged cells handling
  - [x] limit huge sheets
- [x] PPTX basic Rust converter:
  - [x] slides
  - [x] text boxes
  - [x] speaker notes
  - [x] tables
  - [x] images
- [x] Optional LibreOffice adapter:
  - [x] detect binary availability
  - [x] convert Office -> HTML/PDF
  - [x] feed output back into reader
  - [x] sandbox/temp directory cleanup
  - [x] timeout
  - [x] error reporting
- [x] Tests:
  - [x] simple DOCX
  - [x] DOCX with table/image
  - [x] simple XLSX
  - [x] multi-sheet XLSX
  - [x] simple PPTX
  - [x] PPTX with notes

## 15. Image Support

- [x] Image metadata extractor:
  - [x] format
  - [x] dimensions
  - [x] EXIF orientation
  - [x] color mode
  - [x] file size
- [x] SVG support:
  - [x] sanitize
  - [x] extract title/desc/text
  - [x] preserve as image reference
- [x] OCR adapter abstraction:
  - [x] `OcrProvider` trait
  - [x] Tesseract optional provider
  - [ ] platform OCR optional provider if available
  - [x] no-OCR fallback warning
- [x] VLM/caption adapter abstraction:
  - [x] `ImageCaptionProvider` trait
  - [ ] local model optional
  - [ ] remote model optional
  - [x] no-provider fallback warning when captioning is requested
- [x] Output image markdown:
  - [x] alt/caption
  - [x] OCR text block
  - [x] metadata frontmatter
- [x] Tests:
  - [x] image with text
  - [x] photo
  - [x] screenshot
  - [x] SVG with text

## 16. Search Integration

- [x] Keep current `web_search` as search provider.
- [x] Add result deep-read option:
  - [x] search top N
  - [x] fetch each result through Agent Reader
  - [x] return compact research bundle
- [x] Add provider abstraction:
  - [x] DuckDuckGo HTML current
  - [x] SearXNG optional
  - [x] Brave/SerpAPI/Tavily/Exa optional if configured
  - [x] local browser search optional
- [x] Search result schema:
  - [x] title
  - [x] url
  - [x] snippet
  - [x] source
  - [x] fetched markdown excerpt optional
  - [x] confidence
- [x] Add `queryFocus` from search query to fit markdown.
- [x] Add tests with local mocked SERP HTML.

## 17. Native Tool API Changes

- [x] Extend `/tools/web/fetch` input:
  - [x] `url`
  - [x] `format`
  - [x] `mode`: `main | full | selector | raw`
  - [x] `engine`: `auto | http | browser`
  - [x] `targetSelector`
  - [x] `removeSelector`
  - [x] `waitForSelector`
  - [x] `maxChars`
  - [x] `maxTokens`
  - [x] `chunking`
  - [x] `queryFocus`
  - [x] `retainLinks`
  - [x] `retainImages`
  - [x] `retainMedia`
  - [x] `headingStyle`
  - [x] `citationFormat`
  - [x] `preserveHtmlTags`
  - [x] `citations`
  - [x] `includeRaw`
  - [x] `includeMetadata`
  - [x] `includeScreenshot`
  - [x] `includePageshot`
  - [x] `includeMedia`
  - [x] `includeIframes`
  - [x] `includeShadowDom`
  - [x] `includeDebugTrace`
  - [x] `useOcr`
  - [x] `useCaption`
  - [x] `cachePolicy`
- [x] Keep backward compatibility:
  - [x] old `extractText`
  - [x] old `includeLinks`
  - [x] old `maxChars`
- [x] Raw response:
  - [x] metadata
  - [x] markdown
  - [x] text
  - [x] chunks
  - [x] links
  - [x] images
  - [x] artifacts
  - [x] warnings
- [x] Content response should be compact and readable.
- [x] Add artifact behavior for large output.
- [x] Update tool descriptions/schema in runtime catalog.
- [x] Add tests in native backend foundation tests.

## 18. Desktop/Main Integration

- [x] Reuse browser tab session fetch in `apps/desktop/src/main/workbench-documents/fetch.ts`.
- [x] Add IPC bridge for browser snapshot/read:
  - [x] selected element HTML
  - [x] page HTML
  - [x] body text
  - [x] links/images/media
  - [x] links/images
  - [x] screenshot
- [x] Decide whether reader runs:
  - [x] fully in Rust native backend
  - [x] main process wrapper calls Rust NAPI
  - [x] mixed path by input kind
- [x] Add document reader bridge:
  - [x] PDF current active document -> Agent Reader
  - [x] Office downloaded file -> Agent Reader
  - [x] image downloaded file -> Agent Reader
- [x] Add UI/debug hooks later:
  - [x] inspect extracted markdown
  - [x] compare raw/main/fit
  - [x] show extraction warnings

## 19. Security and Safety

- [x] URL scheme allowlist:
  - [x] http
  - [x] https
  - [x] file only for trusted/local explicit contexts
- [x] SSRF protection for remote URLs:
  - [x] block localhost/private IP by default for untrusted Agent web fetch
  - [x] allow local only under explicit workspace/local tool context
- [x] Max bytes for fetch and file read.
- [x] Max DOM size.
- [x] Max extracted text size.
- [x] Max number of links/images/media.
- [x] External binary sandbox:
  - [x] temp dir isolation
  - [x] timeout
  - [x] process kill
  - [x] cleanup
- [x] HTML sanitization for any preview/rendered artifacts.
- [x] Do not execute page JS in Rust HTTP path.
- [x] Browser path must rely on existing browser security boundaries.
- [x] PII redaction optional hook, disabled by default.

## 20. Performance

- [x] Benchmark static HTML fast path.
- [x] Benchmark large docs page.
- [x] Benchmark large table page.
- [x] Benchmark PDF parse.
- [x] Avoid full DOM clone where possible.
- [x] Stream/limit bytes early.
- [x] Lazy-generate chunks only when requested.
- [x] Lazy-generate references only when requested.
- [x] Use content hash for cache/artifacts.
- [x] Add timing metadata:
  - [x] fetch ms
  - [x] parse ms
  - [x] extract ms
  - [x] render ms
  - [x] total ms

## 21. Testing

- [x] Unit tests:
  - [x] detection
  - [x] metadata extraction
  - [x] readability scoring
  - [x] markdown renderer
  - [x] citations
  - [x] chunking
  - [x] budgeting
  - [x] BM25 fit markdown
- [x] Golden fixtures:
  - [x] clean article
  - [x] noisy article
  - [x] documentation page
  - [x] ecommerce listing
  - [x] table-heavy page
  - [x] code-heavy page
  - [x] malformed HTML
  - [x] deep nested HTML
  - [x] SPA shell
- [x] Integration tests:
  - [x] local HTTP server static HTML
  - [x] local PDF response
  - [x] non-text binary response
  - [x] redirect
  - [x] 403/401
  - [x] oversized response
- [x] Snapshot tests for markdown output.
- [x] Compatibility tests for old `web_fetch` behavior.
- [x] Add fixtures from reference projects only if license-compatible.

## 22. Observability

- [x] Structured warnings:
  - [x] `low_main_content_confidence`
  - [x] `truncated`
  - [x] `unsupported_format`
  - [x] `browser_recommended`
  - [x] `ocr_recommended`
  - [x] `external_adapter_missing`
- [x] Debug trace in raw output only:
  - [x] selected extractor
  - [x] candidate scores
  - [x] removed selectors count
  - [x] fallback reason
  - [x] timing
- [x] Add env flag for verbose reader debug.
- [x] Add redacted logs only; do not log full page content by default.

## 23. Milestones

### Milestone A: HTML Agent Reader MVP

- [x] New crate scaffold.
- [x] URL/raw HTML input.
- [x] MIME detection for HTML/text/PDF.
- [x] HTML parser and cleaner.
- [x] Basic main content extractor.
- [x] Markdown renderer with links/images/tables/code.
- [x] Citation footer.
- [x] Metadata extraction.
- [x] Max chars and truncation.
- [x] Integrate into `web_fetch`.
- [x] Backward compatible tests pass.

### Milestone B: Strong Web Reader

- [x] Readability-like scoring improved.
- [x] Selector include/remove.
- [x] Chunking.
- [x] Token estimate.
- [x] BM25/query-focused fit markdown.
- [x] Link/image/media retention modes.
- [x] More fixtures and golden tests.
- [x] Artifact output for large pages.

### Milestone C: Browser-Aware Reader

- [x] Browser snapshot provider interface.
- [x] Workbench Browser bridge integration.
- [x] `engine=auto/http/browser`.
- [x] `waitForSelector`.
- [x] SPA shell detection.
- [x] Screenshot artifact support.
- [x] Pageshot artifact support.

### Milestone D: Unified Document Reader

- [x] PDF through unified reader result.
- [x] Page-aware chunks.
- [x] PDF cleanup improvements.
- [x] DOCX basic converter.
- [x] XLSX basic converter.
- [x] PPTX basic converter.
- [x] Optional LibreOffice adapter design.

### Milestone E: Image/OCR/VLM

- [x] Image metadata.
- [x] SVG text extraction.
- [x] OCR provider trait.
- [x] Optional Tesseract provider.
- [x] Caption provider trait.
- [x] Agent-friendly image markdown output.

### Milestone F: Research Bundle

- [x] Research tool deep-read top N via current `web_search` provider.
- [x] Search query -> fit markdown.
- [x] Multi-source citations.
- [x] Deduplicated source list.
- [x] Compact research JSON/markdown output.

## 24. Open Questions

- [x] 是否默认启用 browser fallback，还是只提示 Agent 调用 browser path？答：`engine=auto` 默认启用 fallback；无 browser provider 时保留 clear recommendation。
- [x] `web_fetch` 是否应该直接支持 local/private URL，还是保持 http/https public-only？答：默认 public http/https；`trustedLocal=true` 支持 `file:`，`allowPrivateNetwork=true` 才允许私网/localhost。
- [x] Office 第一版是否接受 LibreOffice optional dependency？答：接受，作为高保真 optional adapter；Rust ZIP/XML fallback 保底。
- [x] 图片 OCR 是否优先做 Tesseract，还是先做 metadata + VLM adapter interface？答：两者都保留；Tesseract auto-detect，caption provider/host 能力缺失时结构化 warning。
- [x] 是否需要独立 CLI：`lyra-agent-reader <url-or-file>`？答：需要，已加入 CLI 和 Jina header alias 输入。
- [x] 是否把 reader 结果纳入本地搜索/记忆索引？答：需要，默认 `indexResult=true` 并写入 recall `source_kind="agent_reader"`。
- [x] 是否需要兼容 Jina Reader 风格 headers/options，方便迁移？答：需要，已支持常用 `X-Respond-With`、selector、generated alt、links summary、cache aliases。

## 25. Definition of Done for First Useful Release

- [x] `web_fetch` 对普通网页返回干净 Markdown，而不是简单剥 tag 文本。
- [x] 返回 title/url/metadata/links/citations。
- [x] 支持正文提取和 full page 两种模式。
- [x] 支持 max chars/truncation/artifact。
- [x] 至少 20 个 HTML golden fixtures。
- [x] 当前 native backend tests 通过。
- [x] 旧参数兼容，不破坏现有 Agent 调用。
- [x] 遇到 PDF/Office/image 时给出明确 route 或 recommended next action。
