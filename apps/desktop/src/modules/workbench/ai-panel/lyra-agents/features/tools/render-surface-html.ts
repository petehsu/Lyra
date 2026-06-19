import type {
  InlineRenderNode,
  LyraRenderDocument,
  RenderBlock,
  RenderTheme
} from "../../../../../../shared/render";
import { scopeToHighlightClass } from "../rich-text/scope-theme";

export type RenderSurfaceIframeOptions = {
  readonly theme: RenderTheme;
  readonly interactive: boolean;
  readonly title: string;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

const renderInlineNodesToHtml = (nodes: readonly InlineRenderNode[]): string =>
  nodes.map((node) => renderInlineNodeToHtml(node)).join("");

const renderInlineNodeToHtml = (node: InlineRenderNode): string => {
  switch (node.kind) {
    case "text":
      return escapeHtml(node.value);
    case "code":
      return `<code>${escapeHtml(node.value)}</code>`;
    case "strong":
      return `<strong>${renderInlineNodesToHtml(node.children)}</strong>`;
    case "emphasis":
      return `<em>${renderInlineNodesToHtml(node.children)}</em>`;
    case "strikethrough":
      return `<s>${renderInlineNodesToHtml(node.children)}</s>`;
    case "link":
      return `<a href="${escapeHtml(node.href)}">${renderInlineNodesToHtml(node.children)}</a>`;
    case "image":
      return `<img src="${escapeHtml(node.src)}" alt="${escapeHtml(node.alt)}" />`;
    case "mathInline":
      return node.svg ?? `<code>$${escapeHtml(node.latex)}$</code>`;
    case "softBreak":
      return " ";
    case "hardBreak":
      return "<br />";
    default:
      return "";
  }
};

const renderTableCellsToHtml = (
  cells: readonly InlineRenderNode[][],
  cellTag: "td" | "th"
): string =>
  cells
    .map((cell) => `<${cellTag}>${renderInlineNodesToHtml(cell)}</${cellTag}>`)
    .join("");

const renderBlockToHtml = (block: RenderBlock): string => {
  switch (block.kind) {
    case "paragraph":
      return `<p>${renderInlineNodesToHtml(block.children)}</p>`;
    case "heading": {
      const level = Math.min(6, Math.max(1, block.level));
      return `<h${level}>${renderInlineNodesToHtml(block.children)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${block.children.map((child) => renderBlockToHtml(child)).join("")}</blockquote>`;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const items = block.items
        .map((item) => {
          const checkbox = item.checked === undefined
            ? ""
            : `<input type="checkbox" disabled ${item.checked ? "checked" : ""} />`;
          const body = item.children.map((child) => renderBlockToHtml(child)).join("");
          return `<li>${checkbox}${body}</li>`;
        })
        .join("");
      return `<${tag}>${items}</${tag}>`;
    }
    case "codeBlock": {
      const highlighted = renderHighlightedSourceToHtml(block.source, block.spans);
      return `<pre class="hljs"><code>${highlighted}</code></pre>`;
    }
    case "mermaid":
      return block.svg ?? `<pre>${escapeHtml(block.source)}</pre>`;
    case "mathBlock":
      return block.svg ?? `<pre>${escapeHtml(block.latex)}</pre>`;
    case "table": {
      const headers = block.headers.length > 0
        ? `<thead><tr>${renderTableCellsToHtml(block.headers, "th")}</tr></thead>`
        : "";
      const rows = block.rows
        .map((row) => `<tr>${renderTableCellsToHtml(row, "td")}</tr>`)
        .join("");
      return `<table>${headers}<tbody>${rows}</tbody></table>`;
    }
    case "thematicBreak":
      return "<hr />";
    default:
      return "";
  }
};

const renderHighlightedSourceToHtml = (
  source: string,
  spans: readonly { readonly start: number; readonly end: number; readonly scope: string }[]
): string => {
  if (spans.length === 0) {
    return escapeHtml(source);
  }

  const sorted = [...spans].sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  const parts: string[] = [];
  let cursor = 0;

  for (const span of sorted) {
    const start = Math.max(0, Math.min(span.start, source.length));
    const end = Math.max(start, Math.min(span.end, source.length));
    if (start > cursor) {
      parts.push(escapeHtml(source.slice(cursor, start)));
    }
    if (end > start) {
      const className = scopeToHighlightClass(span.scope);
      parts.push(
        `<span class="${className}">${escapeHtml(source.slice(start, end))}</span>`
      );
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < source.length) {
    parts.push(escapeHtml(source.slice(cursor)));
  }

  return parts.join("");
};

export const renderDocumentToHtml = (document: LyraRenderDocument): string =>
  document.blocks.map((block) => renderBlockToHtml(block)).join("");

const surfaceThemeCss = (theme: RenderTheme): string => {
  const dark = `
    :root {
      color-scheme: dark;
      --surface-bg: #111318;
      --surface-text: #e8eaef;
      --surface-muted: #9aa3b2;
      --surface-border: rgba(255, 255, 255, 0.12);
      --surface-code-bg: rgba(255, 255, 255, 0.06);
      --surface-link: #8ab4ff;
    }
  `;
  const light = `
    :root {
      color-scheme: light;
      --surface-bg: #ffffff;
      --surface-text: #1b1f24;
      --surface-muted: #5f6b7a;
      --surface-border: rgba(15, 23, 42, 0.12);
      --surface-code-bg: rgba(15, 23, 42, 0.05);
      --surface-link: #245bdb;
    }
  `;

  if (theme === "dark") {
    return dark;
  }
  if (theme === "light") {
    return light;
  }
  return `${dark}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
    --surface-bg: #ffffff;
    --surface-text: #1b1f24;
    --surface-muted: #5f6b7a;
    --surface-border: rgba(15, 23, 42, 0.12);
    --surface-code-bg: rgba(15, 23, 42, 0.05);
    --surface-link: #245bdb;
  }
}`;
};

const surfaceBaseCss = `
  html, body {
    margin: 0;
    padding: 0;
    background: var(--surface-bg);
    color: var(--surface-text);
    font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  body {
    padding: 12px 14px;
    box-sizing: border-box;
  }
  a { color: var(--surface-link); }
  pre, code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  pre {
    margin: 0.75em 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--surface-code-bg);
    overflow: auto;
  }
  code {
    padding: 0.1em 0.35em;
    border-radius: 4px;
    background: var(--surface-code-bg);
  }
  pre code { padding: 0; background: transparent; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th, td {
    border: 1px solid var(--surface-border);
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  th { color: var(--surface-muted); font-weight: 600; }
  blockquote {
    margin: 0.75em 0;
    padding-left: 12px;
    border-left: 3px solid var(--surface-border);
    color: var(--surface-muted);
  }
  hr {
    border: 0;
    border-top: 1px solid var(--surface-border);
    margin: 1em 0;
  }
  img, svg { max-width: 100%; height: auto; }
  .hljs-comment { color: #7a8496; }
  .hljs-string { color: #9ccc65; }
  .hljs-number { color: #f78c6c; }
  .hljs-keyword { color: #c792ea; }
  .hljs-title.function_ { color: #82aaff; }
  .hljs-type { color: #ffcb6b; }
  .hljs-attr { color: #f07178; }
  .hljs-variable { color: #89ddff; }
`;

const interactiveBridgeScript = `
(() => {
  const emit = (payload) => {
    parent.postMessage({ type: "lyra-render-surface-event", ...payload }, "*");
  };
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const action = target.closest("[data-lyra-action]");
    if (action === null) return;
    emit({
      surfaceAction: action.getAttribute("data-lyra-action"),
      surfaceId: document.body.dataset.lyraSurfaceId ?? null
    });
  }, true);
})();
`;

const contentSecurityPolicy = (interactive: boolean): string =>
  interactive
    ? "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:;"
    : "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;";

const isFullHtmlDocument = (content: string): boolean =>
  /^\s*<!doctype html\b/i.test(content) || /^\s*<html\b/i.test(content);

export const buildRenderSurfaceIframeDocument = (
  bodyHtml: string,
  options: RenderSurfaceIframeOptions & { readonly surfaceId?: string }
): string => {
  const bridge = options.interactive
    ? `<script>${interactiveBridgeScript}</script>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(options.interactive)}" />
    <title>${escapeHtml(options.title)}</title>
    <style>
${surfaceThemeCss(options.theme)}
${surfaceBaseCss}
    </style>
  </head>
  <body data-lyra-surface-id="${escapeHtml(options.surfaceId ?? "")}">
    ${bodyHtml}
    ${bridge}
  </body>
</html>`;
};

export const buildRenderSurfaceIframeSrcDoc = (
  format: "html" | "svg" | "markdown" | "json" | "text",
  content: string,
  options: RenderSurfaceIframeOptions & { readonly surfaceId?: string }
): string => {
  if (format === "html" && isFullHtmlDocument(content)) {
    return content;
  }

  const bodyHtml = (() => {
    switch (format) {
      case "svg":
        return content.trimStart().startsWith("<svg")
          ? content
          : `<div class="render-surface-svg">${content}</div>`;
      case "json":
        return `<pre><code>${escapeHtml(content)}</code></pre>`;
      case "text":
        return `<pre>${escapeHtml(content)}</pre>`;
      case "html":
      case "markdown":
      default:
        return content;
    }
  })();

  return buildRenderSurfaceIframeDocument(bodyHtml, options);
};