type RenderSurfaceTheme = "dark" | "light" | "auto";

export type RenderSurfaceIframeOptions = {
  readonly theme: RenderSurfaceTheme;
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

const surfaceThemeCss = (theme: RenderSurfaceTheme): string => {
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
