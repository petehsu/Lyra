# Lyra Agent Reader Implementation TODO

目标：自研一个 Rust-first 的网页/文档转 Agent 友好内容工具，替代当前轻量 `web_fetch` HTML 剥标签能力，并逐步覆盖 PDF、Office、图片、浏览器渲染、检索增强和 Agent chunk 输出。

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

- [ ] 确定项目名称：建议 `lyra-agent-reader`。
- [ ] 确定 crate 位置：建议 `crates/lyra-agent-reader`。
- [ ] 确定定位：Rust core + optional adapters，而不是强行全 Rust。
- [ ] 确定第一批调用方：
  - [ ] `crates/lyra-agent-runtime/src/native_backend/tools/web.rs`
  - [ ] `crates/lyra-docs-core`
  - [ ] `apps/desktop/src/main/workbench-documents`
  - [ ] Workbench Browser tab/session fetch bridge
- [ ] 确定输出主格式：
  - [ ] `markdown`
  - [ ] `text`
  - [ ] `json`
  - [ ] `chunks`
  - [ ] `frontmatter+markdown`
- [ ] 确定是否允许 optional external binaries：
  - [ ] LibreOffice for Office high-fidelity conversion
  - [ ] Tesseract or local OCR for images/scanned PDFs
  - [ ] browser/Electron/Playwright path for SPA/rendered pages
- [ ] 确定默认 preset：
  - [ ] `agent`
  - [ ] `research`
  - [ ] `index`
  - [ ] `reader`
  - [ ] `raw`

## 1. Core Crate Scaffold

- [ ] 新增 `crates/lyra-agent-reader/Cargo.toml`。
- [ ] 新增 `src/lib.rs`。
- [ ] 新增模块结构：
  - [ ] `types.rs`
  - [ ] `detect.rs`
  - [ ] `fetch.rs`
  - [ ] `html/`
  - [ ] `markdown/`
  - [ ] `extract/`
  - [ ] `document/`
  - [ ] `chunk.rs`
  - [ ] `citation.rs`
  - [ ] `budget.rs`
  - [ ] `errors.rs`
  - [ ] `tests/fixtures`
- [ ] 定义核心 request/response：
  - [ ] `ReaderRequest`
  - [ ] `ReaderInput`
  - [ ] `ReaderOptions`
  - [ ] `ReaderResult`
  - [ ] `ReaderMetadata`
  - [ ] `ReaderArtifact`
  - [ ] `ReaderChunk`
  - [ ] `ReaderWarning`
- [ ] 支持输入类型：
  - [ ] URL
  - [ ] raw HTML string
  - [ ] bytes + MIME hint
  - [ ] local file path
  - [ ] browser snapshot
  - [ ] active browser tab adapter payload
- [ ] 输出 structured raw JSON，便于 Agent 工具返回 `raw`。
- [ ] 输出 concise markdown/text，便于 Agent 工具返回 `content`。

## 2. Format Detection

- [ ] 实现 MIME + extension + magic bytes 综合检测。
- [ ] 支持格式枚举：
  - [ ] HTML/XHTML
  - [ ] Markdown
  - [ ] Plain text
  - [ ] JSON
  - [ ] XML/RSS/Atom
  - [ ] PDF
  - [ ] DOCX
  - [ ] XLSX
  - [ ] PPTX
  - [ ] CSV/TSV
  - [ ] Image: PNG/JPEG/WebP/GIF/TIFF/BMP/SVG
  - [ ] ZIP
  - [ ] Unknown binary
- [ ] 迁移或复用 `lyra-docs-core` 现有 PDF 探测逻辑。
- [ ] 给每次转换记录 `format`, `mimeType`, `detectedBy`, `confidence`。

## 3. Fetch Layer

- [ ] 抽象 `FetchProvider` trait。
- [ ] 实现 `ReqwestFetchProvider`：
  - [ ] redirect limit
  - [ ] timeout
  - [ ] max bytes
  - [ ] user-agent
  - [ ] accept header
  - [ ] proxy hook
  - [ ] cookie/header hook
  - [ ] final URL
  - [ ] response headers
- [ ] 将当前 `web_fetch` 的 HTTP path 迁移到 reader。
- [ ] 处理非文本响应：
  - [ ] PDF bytes route to document reader
  - [ ] Office bytes route to document reader
  - [ ] image bytes route to image reader
  - [ ] binary unsupported returns useful error
- [ ] 支持 `file:` URL/local file path，默认只用于本地可信调用。
- [ ] 添加 cache key 设计：
  - [ ] URL + headers subset
  - [ ] final URL
  - [ ] content hash
  - [ ] options hash
- [ ] 不在第一版实现持久 cache，但预留 trait。

## 4. Browser Render Layer

- [ ] 抽象 `BrowserSnapshotProvider` trait。
- [ ] 复用 Workbench Browser/Electron 能力，而不是 Rust 内嵌浏览器。
- [ ] 支持 browser options：
  - [ ] `engine`: `auto | http | browser`
  - [ ] `targetSelector`
  - [ ] `removeSelector`
  - [ ] `waitForSelector`
  - [ ] `waitUntil`: `html | visible-content | mutation-idle | resource-idle | media-idle | network-idle`
  - [ ] `timeoutMs`
  - [ ] `viewport`
  - [ ] `mobile`
  - [ ] `includeIframes`
  - [ ] `includeShadowDom`
  - [ ] `screenshot`
  - [ ] `pageshot`
- [ ] Browser path returns:
  - [ ] final URL
  - [ ] document title
  - [ ] outer HTML
  - [ ] body innerText
  - [ ] selected element HTML
  - [ ] links
  - [ ] images
  - [ ] media
  - [ ] screenshot artifact ref
- [ ] Auto fallback rule:
  - [ ] HTTP HTML too short -> try browser
  - [ ] content looks like SPA shell -> try browser
  - [ ] blocked/403 and browser session available -> recommend browser path
  - [ ] explicit selector/wait option -> browser path

## 5. HTML Cleaning

- [ ] 使用 Rust HTML parser，避免手写字符串剥标签。
- [ ] 评估并选型：
  - [ ] `html5ever`
  - [ ] `scraper`
  - [ ] `kuchikiki`/equivalent DOM library
  - [ ] `lol_html` for streaming rewrite if useful
- [ ] 删除噪声节点：
  - [ ] script
  - [ ] style
  - [ ] noscript policy decision
  - [ ] template
  - [ ] hidden elements
  - [ ] ads/promotional blocks
  - [ ] cookie banners
  - [ ] navigation/footer/sidebar optional
- [ ] 支持 `includeTags`/`excludeTags`。
- [ ] 支持 CSS selector target/remove。
- [ ] 规范化 URL：
  - [ ] base tag
  - [ ] relative link
  - [ ] image src/srcset
  - [ ] canonical URL
- [ ] 提取 metadata：
  - [ ] title
  - [ ] description
  - [ ] author
  - [ ] site name
  - [ ] published time
  - [ ] modified time
  - [ ] language
  - [ ] canonical URL
  - [ ] Open Graph
  - [ ] Twitter card
  - [ ] JSON-LD basic objects

## 6. Main Content Extraction

- [ ] 实现 Readability-like article extractor。
- [ ] 借鉴 Mozilla Readability scoring：
  - [ ] paragraph text length
  - [ ] link density
  - [ ] class/id positive/negative hints
  - [ ] heading structure
  - [ ] sibling merging
  - [ ] unlikely candidates
- [ ] 借鉴 Trafilatura robustness：
  - [ ] fallback extraction
  - [ ] metadata fallback
  - [ ] comments optional
  - [ ] tables optional
  - [ ] images optional
- [ ] 输出 extraction modes：
  - [ ] `main`
  - [ ] `full`
  - [ ] `selector`
  - [ ] `text`
  - [ ] `raw`
- [ ] 每次提取记录：
  - [ ] `extractionMethod`
  - [ ] `mainContentConfidence`
  - [ ] `fallbackUsed`
  - [ ] `warnings`
- [ ] 添加正文抽取 fixture：
  - [ ] news article
  - [ ] blog
  - [ ] docs page
  - [ ] GitHub README-like page
  - [ ] ecommerce listing
  - [ ] forum page
  - [ ] SPA shell
  - [ ] page with heavy nav/footer

## 7. HTML to Markdown Renderer

- [ ] 实现 Rust Turndown-like rule engine。
- [ ] 支持基础元素：
  - [ ] headings
  - [ ] paragraphs
  - [ ] strong/em
  - [ ] inline code
  - [ ] fenced code block
  - [ ] blockquote
  - [ ] ordered/unordered lists
  - [ ] nested lists
  - [ ] links
  - [ ] images
  - [ ] horizontal rule
  - [ ] line breaks
- [ ] 支持 GFM：
  - [ ] tables
  - [ ] task lists
  - [ ] strikethrough
  - [ ] fenced code language
- [ ] 支持 code block language inference：
  - [ ] class `language-*`
  - [ ] `data-lang`
  - [ ] pre/code attrs
- [ ] Markdown options：
  - [ ] heading style
  - [ ] bullet marker
  - [ ] code fence marker
  - [ ] link style inline/reference/citation
  - [ ] image style all/alt/none
  - [ ] media style link/text/none/html
  - [ ] preserve HTML allowlist
- [ ] Normalize whitespace：
  - [ ] collapse excessive blank lines
  - [ ] protect code whitespace
  - [ ] prevent malformed list/table spacing
  - [ ] remove tracking whitespace
- [ ] Add markdown renderer golden tests.

## 8. Links, Images, Media, Citations

- [ ] Extract all links with context:
  - [ ] URL
  - [ ] anchor text
  - [ ] title
  - [ ] rel
  - [ ] surrounding heading
  - [ ] DOM path/source offset if available
- [ ] Extract images:
  - [ ] src
  - [ ] srcset candidates
  - [ ] alt
  - [ ] title
  - [ ] dimensions if available
  - [ ] figure caption
  - [ ] likely decorative flag
- [ ] Extract media:
  - [ ] video
  - [ ] audio
  - [ ] iframe embeds
  - [ ] YouTube/Vimeo/Bilibili canonical URLs
- [ ] Link retention modes:
  - [ ] `all`
  - [ ] `none`
  - [ ] `text`
  - [ ] `citations`
  - [ ] `summary`
- [ ] Image retention modes:
  - [ ] `all`
  - [ ] `none`
  - [ ] `alt`
  - [ ] `summary`
- [ ] Citation formats:
  - [ ] `⟨1⟩`
  - [ ] `[1]`
  - [ ] `【1†source】`
- [ ] Append reference footer:
  - [ ] `## References`
  - [ ] `## Images`
  - [ ] `## Media`
- [ ] Deduplicate references by normalized URL.
- [ ] Preserve multiple anchors to same URL as aliases.

## 9. Agent-Friendly Output

- [ ] Frontmatter output:
  - [ ] title
  - [ ] url
  - [ ] source_url
  - [ ] retrieved_at
  - [ ] content_type
  - [ ] language
  - [ ] extraction_method
  - [ ] token_estimate
  - [ ] truncated
- [ ] Agent header output for compact text mode:
  - [ ] `Title:`
  - [ ] `URL Source:`
  - [ ] `Retrieved:`
- [ ] Return both:
  - [ ] `rawMarkdown`
  - [ ] `markdownWithCitations`
  - [ ] `fitMarkdown`
  - [ ] `plainText`
  - [ ] `metadata`
  - [ ] `links`
  - [ ] `images`
  - [ ] `chunks`
  - [ ] `artifacts`
- [ ] Add `recommendedNextAction` rules:
  - [ ] truncated -> ask for chunk/selector
  - [ ] SPA shell -> use browser engine
  - [ ] PDF image-only -> use OCR
  - [ ] Office unsupported -> enable LibreOffice adapter

## 10. Token and Size Budgeting

- [ ] Implement char budget first.
- [ ] Implement token estimate fallback.
- [ ] Evaluate tokenizer options:
  - [ ] lightweight heuristic
  - [ ] tiktoken-compatible optional crate if acceptable
  - [ ] model-specific adapter later
- [ ] Options:
  - [ ] `maxChars`
  - [ ] `maxTokens`
  - [ ] `tokenBudget`
  - [ ] `overflow`: `truncate | error | chunks`
- [ ] Truncation should prefer structural boundaries:
  - [ ] headings
  - [ ] paragraphs
  - [ ] list item boundary
  - [ ] table boundary
  - [ ] code block boundary
- [ ] Return `hasMore`, `nextCursor`, `truncated`, `totalChars`.

## 11. Chunking

- [ ] Heading-based chunking:
  - [ ] h1
  - [ ] h2
  - [ ] h3
  - [ ] h4
  - [ ] h5
- [ ] Structured block chunking:
  - [ ] paragraph blocks
  - [ ] list blocks
  - [ ] table blocks
  - [ ] code blocks
- [ ] Token/char limited chunking:
  - [ ] max chunk size
  - [ ] overlap
  - [ ] preserve references
- [ ] Each chunk includes:
  - [ ] id
  - [ ] heading path
  - [ ] markdown
  - [ ] plain text
  - [ ] source range if available
  - [ ] links/images used
  - [ ] token estimate
- [ ] JSON output for chunks.
- [ ] Delimited text output for simple Agent streaming.

## 12. Query-Focused Fit Markdown

- [ ] Implement BM25 scoring for blocks/chunks.
- [ ] Use query from request:
  - [ ] search query
  - [ ] user task
  - [ ] explicit `queryFocus`
- [ ] Content filter modes:
  - [ ] `none`
  - [ ] `prune`
  - [ ] `bm25`
  - [ ] `hybrid`
- [ ] Ranking signals:
  - [ ] BM25
  - [ ] heading match
  - [ ] metadata match
  - [ ] link anchor match
  - [ ] table density
  - [ ] code density
  - [ ] main content confidence
- [ ] Output:
  - [ ] `fitMarkdown`
  - [ ] `fitChunks`
  - [ ] `filteredOutSummary`
  - [ ] scoring debug in raw only

## 13. PDF Support

- [ ] Integrate existing `crates/lyra-docs-core` PDF parser.
- [ ] Expose PDF through unified reader result.
- [ ] Preserve page boundaries:
  - [ ] `<!-- page: 1 -->`
  - [ ] chunk metadata page index
  - [ ] references to page numbers
- [ ] Improve PDF text cleanup:
  - [ ] line merge
  - [ ] hyphenation repair
  - [ ] header/footer removal heuristic
  - [ ] page number cleanup
- [ ] Evaluate better PDF extraction options:
  - [ ] current `lopdf`
  - [ ] `pdf-extract`
  - [ ] PDF.js via optional JS sidecar
  - [ ] `pdfium-render` optional
- [ ] Table extraction:
  - [ ] basic layout heuristic
  - [ ] preserve monospaced table fallback
  - [ ] markdown table if confident
- [ ] Scanned/image-only PDFs:
  - [ ] detect empty text
  - [ ] recommend OCR adapter
  - [ ] optional render pages to image
- [ ] Tests:
  - [ ] text PDF
  - [ ] encrypted PDF
  - [ ] image-only PDF
  - [ ] multi-page PDF
  - [ ] table-heavy PDF

## 14. Office Support

- [ ] DOCX basic Rust converter:
  - [ ] unzip package
  - [ ] parse `word/document.xml`
  - [ ] headings
  - [ ] paragraphs
  - [ ] lists
  - [ ] tables
  - [ ] hyperlinks
  - [ ] footnotes/endnotes basic
  - [ ] images as references
- [ ] XLSX basic Rust converter:
  - [ ] workbook sheets
  - [ ] shared strings
  - [ ] sheet tables to markdown
  - [ ] formulas display
  - [ ] merged cells handling
  - [ ] limit huge sheets
- [ ] PPTX basic Rust converter:
  - [ ] slides
  - [ ] text boxes
  - [ ] speaker notes
  - [ ] tables
  - [ ] images
- [ ] Optional LibreOffice adapter:
  - [ ] detect binary availability
  - [ ] convert Office -> HTML/PDF
  - [ ] feed output back into reader
  - [ ] sandbox/temp directory cleanup
  - [ ] timeout
  - [ ] error reporting
- [ ] Tests:
  - [ ] simple DOCX
  - [ ] DOCX with table/image
  - [ ] simple XLSX
  - [ ] multi-sheet XLSX
  - [ ] simple PPTX
  - [ ] PPTX with notes

## 15. Image Support

- [ ] Image metadata extractor:
  - [ ] format
  - [ ] dimensions
  - [ ] EXIF orientation
  - [ ] color mode
  - [ ] file size
- [ ] SVG support:
  - [ ] sanitize
  - [ ] extract title/desc/text
  - [ ] preserve as image reference
- [ ] OCR adapter abstraction:
  - [ ] `OcrProvider` trait
  - [ ] Tesseract optional provider
  - [ ] platform OCR optional provider if available
  - [ ] no-OCR fallback warning
- [ ] VLM/caption adapter abstraction:
  - [ ] `ImageCaptionProvider` trait
  - [ ] local model optional
  - [ ] remote model optional
  - [ ] disabled by default unless configured
- [ ] Output image markdown:
  - [ ] alt/caption
  - [ ] OCR text block
  - [ ] metadata frontmatter
- [ ] Tests:
  - [ ] image with text
  - [ ] photo
  - [ ] screenshot
  - [ ] SVG with text

## 16. Search Integration

- [ ] Keep current `web_search` as search provider.
- [ ] Add result deep-read option:
  - [ ] search top N
  - [ ] fetch each result through Agent Reader
  - [ ] return compact research bundle
- [ ] Add provider abstraction:
  - [ ] DuckDuckGo HTML current
  - [ ] SearXNG optional
  - [ ] Brave/SerpAPI/Tavily/Exa optional if configured
  - [ ] local browser search optional
- [ ] Search result schema:
  - [ ] title
  - [ ] url
  - [ ] snippet
  - [ ] source
  - [ ] fetched markdown excerpt optional
  - [ ] confidence
- [ ] Add `queryFocus` from search query to fit markdown.
- [ ] Add tests with local mocked SERP HTML.

## 17. Native Tool API Changes

- [ ] Extend `/tools/web/fetch` input:
  - [ ] `url`
  - [ ] `format`
  - [ ] `mode`: `main | full | selector | raw`
  - [ ] `engine`: `auto | http | browser`
  - [ ] `targetSelector`
  - [ ] `removeSelector`
  - [ ] `waitForSelector`
  - [ ] `maxChars`
  - [ ] `maxTokens`
  - [ ] `chunking`
  - [ ] `queryFocus`
  - [ ] `retainLinks`
  - [ ] `retainImages`
  - [ ] `citations`
  - [ ] `includeRaw`
  - [ ] `includeMetadata`
  - [ ] `includeScreenshot`
  - [ ] `cachePolicy`
- [ ] Keep backward compatibility:
  - [ ] old `extractText`
  - [ ] old `includeLinks`
  - [ ] old `maxChars`
- [ ] Raw response:
  - [ ] metadata
  - [ ] markdown
  - [ ] text
  - [ ] chunks
  - [ ] links
  - [ ] images
  - [ ] artifacts
  - [ ] warnings
- [ ] Content response should be compact and readable.
- [ ] Add artifact behavior for large output.
- [ ] Update tool descriptions/schema in runtime catalog.
- [ ] Add tests in native backend foundation tests.

## 18. Desktop/Main Integration

- [ ] Reuse browser tab session fetch in `apps/desktop/src/main/workbench-documents/fetch.ts`.
- [ ] Add IPC bridge for browser snapshot/read:
  - [ ] selected element HTML
  - [ ] page HTML
  - [ ] body text
  - [ ] links/images/media
  - [ ] screenshot
- [ ] Decide whether reader runs:
  - [ ] fully in Rust native backend
  - [ ] main process wrapper calls Rust NAPI
  - [ ] mixed path by input kind
- [ ] Add document reader bridge:
  - [ ] PDF current active document -> Agent Reader
  - [ ] Office downloaded file -> Agent Reader
  - [ ] image downloaded file -> Agent Reader
- [ ] Add UI/debug hooks later:
  - [ ] inspect extracted markdown
  - [ ] compare raw/main/fit
  - [ ] show extraction warnings

## 19. Security and Safety

- [ ] URL scheme allowlist:
  - [ ] http
  - [ ] https
  - [ ] file only for trusted/local explicit contexts
- [ ] SSRF protection for remote URLs:
  - [ ] block localhost/private IP by default for untrusted Agent web fetch
  - [ ] allow local only under explicit workspace/local tool context
- [ ] Max bytes for fetch and file read.
- [ ] Max DOM size.
- [ ] Max extracted text size.
- [ ] Max number of links/images/media.
- [ ] External binary sandbox:
  - [ ] temp dir isolation
  - [ ] timeout
  - [ ] process kill
  - [ ] cleanup
- [ ] HTML sanitization for any preview/rendered artifacts.
- [ ] Do not execute page JS in Rust HTTP path.
- [ ] Browser path must rely on existing browser security boundaries.
- [ ] PII redaction optional hook, disabled by default.

## 20. Performance

- [ ] Benchmark static HTML fast path.
- [ ] Benchmark large docs page.
- [ ] Benchmark large table page.
- [ ] Benchmark PDF parse.
- [ ] Avoid full DOM clone where possible.
- [ ] Stream/limit bytes early.
- [ ] Lazy-generate chunks only when requested.
- [ ] Lazy-generate references only when requested.
- [ ] Use content hash for cache/artifacts.
- [ ] Add timing metadata:
  - [ ] fetch ms
  - [ ] parse ms
  - [ ] extract ms
  - [ ] render ms
  - [ ] total ms

## 21. Testing

- [ ] Unit tests:
  - [ ] detection
  - [ ] metadata extraction
  - [ ] readability scoring
  - [ ] markdown renderer
  - [ ] citations
  - [ ] chunking
  - [ ] budgeting
  - [ ] BM25 fit markdown
- [ ] Golden fixtures:
  - [ ] clean article
  - [ ] noisy article
  - [ ] documentation page
  - [ ] ecommerce listing
  - [ ] table-heavy page
  - [ ] code-heavy page
  - [ ] malformed HTML
  - [ ] deep nested HTML
  - [ ] SPA shell
- [ ] Integration tests:
  - [ ] local HTTP server static HTML
  - [ ] local PDF response
  - [ ] non-text binary response
  - [ ] redirect
  - [ ] 403/401
  - [ ] oversized response
- [ ] Snapshot tests for markdown output.
- [ ] Compatibility tests for old `web_fetch` behavior.
- [ ] Add fixtures from reference projects only if license-compatible.

## 22. Observability

- [ ] Structured warnings:
  - [ ] `low_main_content_confidence`
  - [ ] `truncated`
  - [ ] `unsupported_format`
  - [ ] `browser_recommended`
  - [ ] `ocr_recommended`
  - [ ] `external_adapter_missing`
- [ ] Debug trace in raw output only:
  - [ ] selected extractor
  - [ ] candidate scores
  - [ ] removed selectors count
  - [ ] fallback reason
  - [ ] timing
- [ ] Add env flag for verbose reader debug.
- [ ] Add redacted logs only; do not log full page content by default.

## 23. Milestones

### Milestone A: HTML Agent Reader MVP

- [ ] New crate scaffold.
- [ ] URL/raw HTML input.
- [ ] MIME detection for HTML/text/PDF.
- [ ] HTML parser and cleaner.
- [ ] Basic main content extractor.
- [ ] Markdown renderer with links/images/tables/code.
- [ ] Citation footer.
- [ ] Metadata extraction.
- [ ] Max chars and truncation.
- [ ] Integrate into `web_fetch`.
- [ ] Backward compatible tests pass.

### Milestone B: Strong Web Reader

- [ ] Readability-like scoring improved.
- [ ] Selector include/remove.
- [ ] Chunking.
- [ ] Token estimate.
- [ ] BM25/query-focused fit markdown.
- [ ] Link/image/media retention modes.
- [ ] More fixtures and golden tests.
- [ ] Artifact output for large pages.

### Milestone C: Browser-Aware Reader

- [ ] Browser snapshot provider interface.
- [ ] Workbench Browser bridge integration.
- [ ] `engine=auto/http/browser`.
- [ ] `waitForSelector`.
- [ ] SPA shell detection.
- [ ] Screenshot/pageshot artifact support.

### Milestone D: Unified Document Reader

- [ ] PDF through unified reader result.
- [ ] Page-aware chunks.
- [ ] PDF cleanup improvements.
- [ ] DOCX basic converter.
- [ ] XLSX basic converter.
- [ ] PPTX basic converter.
- [ ] Optional LibreOffice adapter design.

### Milestone E: Image/OCR/VLM

- [ ] Image metadata.
- [ ] SVG text extraction.
- [ ] OCR provider trait.
- [ ] Optional Tesseract provider.
- [ ] Caption provider trait.
- [ ] Agent-friendly image markdown output.

### Milestone F: Research Bundle

- [ ] `web_search` deep-read top N.
- [ ] Search query -> fit markdown.
- [ ] Multi-source citations.
- [ ] Deduplicated source list.
- [ ] Compact research JSON/markdown output.

## 24. Open Questions

- [ ] 是否默认启用 browser fallback，还是只提示 Agent 调用 browser path？
- [ ] `web_fetch` 是否应该直接支持 local/private URL，还是保持 http/https public-only？
- [ ] Office 第一版是否接受 LibreOffice optional dependency？
- [ ] 图片 OCR 是否优先做 Tesseract，还是先做 metadata + VLM adapter interface？
- [ ] 是否需要独立 CLI：`lyra-agent-reader <url-or-file>`？
- [ ] 是否把 reader 结果纳入本地搜索/记忆索引？
- [ ] 是否需要兼容 Jina Reader 风格 headers/options，方便迁移？

## 25. Definition of Done for First Useful Release

- [ ] `web_fetch` 对普通网页返回干净 Markdown，而不是简单剥 tag 文本。
- [ ] 返回 title/url/metadata/links/citations。
- [ ] 支持正文提取和 full page 两种模式。
- [ ] 支持 max chars/truncation/artifact。
- [ ] 至少 20 个 HTML golden fixtures。
- [ ] 当前 native backend tests 通过。
- [ ] 旧参数兼容，不破坏现有 Agent 调用。
- [ ] 遇到 PDF/Office/image 时给出明确 route 或 recommended next action。
