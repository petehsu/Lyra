# lyra-render-core

Rust markdown rendering pipeline for Lyra. Converts agent markdown into a
`LyraRenderDocument` AST (JSON) consumed by the desktop renderer and WASM build.

## Pipeline

```text
preprocess (AI repair) → parse (pulldown-cmark + details) → enrich (safety/math/mermaid/highlight) → LyraRenderDocument
```

- **Standard path** (`parse_standard_markdown`): skips preprocess; use for spec conformance and unit tests.
- **Agent path** (`render_document`): runs preprocess first to repair common AI markdown glitches.

### Preprocess layers (aligned with markdown-it / marked)

| Phase | What it fixes |
|-------|----------------|
| `normalize_input` | `\r\n`/`\r` → `\n`, `\0` → U+FFFD (markdown-it `normalize.mjs`) |
| `normalize_fullwidth_markdown_chars` | `＃＊｀｜－` → ASCII markdown punctuation |
| `convert_display_math_fences` | `$$…$$` → ` ```latex ` blocks |
| `separate_run_on_block_markers` | Run-on headings, fences, HR, blockquotes, lists, details |
| `auto_close_unclosed_markers` | Dangling ` ``` ` / `**` / `` ` `` outside code (non-streaming only; skips inline/fenced regions) |

Streaming mode (`RenderDocumentMode::Fragment`) still applies structural line fixes but skips auto-close so bold/code does not flicker mid-token.

## Link and image safety

During **enrich**, Lyra also:

- **Linkifies** bare `http(s)://`, `www.`, `mailto:`, and `//` URLs in plain text (markdown-it `linkify.mjs`; toggle with `enableLinkify`)
- **Normalizes** link/image hrefs via punycode + URL encoding (markdown-it `normalizeLink`)

Unsafe URLs are stripped during enrich (Rust) and again defensively in the React renderer (TypeScript). Rules mirror markdown-it `validateLink`:

- Allowed: `http:`, `https:`, `mailto:`, relative paths, and whitelisted `data:image/*` MIME types.
- Blocked: `javascript:`, `vbscript:`, `file:`, and other non-http schemes.

See `src/safety.rs` and `apps/desktop/src/shared/render-safety.ts`.

## CommonMark test fixtures

Vendored fixtures live under `tests/fixtures/`:

| File | Purpose |
|------|---------|
| `commonmark-smoke.txt` | Curated CommonMark-style examples (parse-without-panic smoke test) |
| `commonmark-ast-golden.json` | Shape-level AST expectations for core block types |

Run integration tests:

```bash
cargo test -p lyra-render-core --test commonmark
```

Refresh smoke fixtures from a local CommonMark spec checkout:

```bash
pnpm render:sync-commonmark-fixtures -- --source /path/to/spec.txt
```

The `参考/` directory is gitignored; always vendor curated examples into `tests/fixtures/`.

## Known gaps vs CommonMark / GFM

| Area | Status |
|------|--------|
| Image `alt` text | Captured from inline text between `Tag::Image` start/end events |
| Reference-style links | Covered by golden fixture `reference_style_link` |
| Setext headings | Covered by golden fixture `setext_heading` |
| Task lists / strikethrough | Covered by golden fixtures `task_list` and `strikethrough` |
| HTML blocks / inline HTML | Not a rendering target; passed through or stripped depending on context |
| Nested blockquotes / lists | Parsed; smoke only — golden tests use flat shapes |

Golden tests assert **block shape** (heading level, list item count, table dimensions) rather than full inline AST equality. Expand `commonmark-ast-golden.json` when adding regression coverage.