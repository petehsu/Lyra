import type {
  WorkbenchBrowserChromeSecurityPopoverPayload,
  WorkbenchBrowserSecurityLevel,
  WorkbenchBrowserWebThemeSnapshot
} from "../../shared/workbench-browser";
import { DEFAULT_WEB_THEME_SNAPSHOT } from "../../shared/web-theme";

export const LYRA_BROWSER_CHROME_POPOVER_DOCUMENT_TITLE = "Lyra Browser Chrome Popover";

export type BrowserChromePopoverDocumentOptions = {
  readonly kind: "security";
  readonly width: number;
  readonly height: number;
  readonly security: WorkbenchBrowserChromeSecurityPopoverPayload;
  readonly theme?: WorkbenchBrowserWebThemeSnapshot;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");

const normalizeSecurityLevel = (
  value: WorkbenchBrowserSecurityLevel | undefined
): WorkbenchBrowserSecurityLevel => {
  if (value === "secure" || value === "insecure" || value === "system") {
    return value;
  }
  return "system";
};

const normalizeTheme = (
  theme: WorkbenchBrowserWebThemeSnapshot | undefined
): WorkbenchBrowserWebThemeSnapshot => {
  const candidate = theme ?? DEFAULT_WEB_THEME_SNAPSHOT;
  const palette = candidate.palette ?? DEFAULT_WEB_THEME_SNAPSHOT.palette;
  return {
    enabled: candidate.enabled === true,
    isDark: candidate.isDark !== false,
    revision: Number.isFinite(candidate.revision) ? Math.round(candidate.revision) : 0,
    palette: {
      bgApp: palette.bgApp || DEFAULT_WEB_THEME_SNAPSHOT.palette.bgApp,
      bgSurface: palette.bgSurface || DEFAULT_WEB_THEME_SNAPSHOT.palette.bgSurface,
      bgEditor: palette.bgEditor || DEFAULT_WEB_THEME_SNAPSHOT.palette.bgEditor,
      textPrimary: palette.textPrimary || DEFAULT_WEB_THEME_SNAPSHOT.palette.textPrimary,
      textSecondary: palette.textSecondary || DEFAULT_WEB_THEME_SNAPSHOT.palette.textSecondary,
      textMuted: palette.textMuted || DEFAULT_WEB_THEME_SNAPSHOT.palette.textMuted,
      textAccent: palette.textAccent || DEFAULT_WEB_THEME_SNAPSHOT.palette.textAccent,
      lineDefault: palette.lineDefault || DEFAULT_WEB_THEME_SNAPSHOT.palette.lineDefault,
      lineFocused: palette.lineFocused || DEFAULT_WEB_THEME_SNAPSHOT.palette.lineFocused,
      statusSuccess: palette.statusSuccess || DEFAULT_WEB_THEME_SNAPSHOT.palette.statusSuccess,
      statusWarning: palette.statusWarning || DEFAULT_WEB_THEME_SNAPSHOT.palette.statusWarning,
      statusError: palette.statusError || DEFAULT_WEB_THEME_SNAPSHOT.palette.statusError
    }
  };
};

const copyForSecurityLevel = (
  level: WorkbenchBrowserSecurityLevel,
  domain: string
): {
  readonly mark: string;
  readonly title: string;
  readonly body: string;
  readonly details: readonly (readonly [string, string])[];
} => {
  switch (level) {
    case "secure":
      return {
        mark: "✓",
        title: "连接是安全的",
        body: "您发送到该站点的隐私数据（例如密码、Cookies）都经过证书加密，第三方无法读取。",
        details: [
          ["证书颁发机构 (CA)", "Let's Encrypt / Lyra Trusted CA Root"],
          ["验证域名 (CN)", domain],
          ["加密算法 (Cipher Suite)", "TLS 1.3, AES_256_GCM, X25519"]
        ]
      };
    case "insecure":
      return {
        mark: "!",
        title: "网站连接不安全",
        body: "当前连接未启用 SSL 加密传输（HTTP）。请勿在当前网页提交密码、银行卡等敏感凭证。",
        details: [
          ["风险警告 (Threat)", "明文数据传输 (Unencrypted HTTP Protocol)"],
          ["应对措施 (Actions)", "建议将地址改为 https:// 开头后重新加载。"]
        ]
      };
    case "system":
    default:
      return {
        mark: "i",
        title: "系统沙箱内置安全页",
        body: "此页面为 Lyra 客户端本地系统页、终端或本地文件，运行于 Lyra 安全沙箱内部。",
        details: [
          ["控制范围 (Scope)", "Lyra 本地资源与开发文件存储沙箱"],
          ["安全级别 (Level)", "信任并允许执行本地高级指令"]
        ]
      };
  }
};

export const resolveBrowserChromePopoverHeight = ({
  level,
  maxHeight
}: {
  readonly level: WorkbenchBrowserSecurityLevel;
  readonly maxHeight: number;
}): number => {
  const preferred =
    level === "secure"
      ? 314
      : level === "insecure"
        ? 260
        : 272;
  return Math.max(160, Math.min(Math.round(maxHeight), preferred));
};

export const buildBrowserChromePopoverDocument = ({
  width,
  height,
  security,
  theme
}: BrowserChromePopoverDocumentOptions): string => {
  const normalizedTheme = normalizeTheme(theme);
  const palette = normalizedTheme.palette;
  const level = normalizeSecurityLevel(security.level);
  const copy = copyForSecurityLevel(level, security.domain);
  const markColor =
    level === "secure"
      ? palette.statusSuccess
      : level === "insecure"
        ? palette.statusError
        : palette.textMuted;
  const shadow = normalizedTheme.isDark
    ? "0 18px 50px rgba(0, 0, 0, 0.48)"
    : "0 18px 42px rgba(54, 45, 24, 0.24)";
  const detailRows = copy.details
    .map(
      ([label, value]) => `
        <div class="item">
          <strong>${escapeHtml(label)}</strong>
          <span>${escapeHtml(value)}</span>
        </div>`
    )
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none';"
    />
    <title>${LYRA_BROWSER_CHROME_POPOVER_DOCUMENT_TITLE}</title>
    <style>
      :root {
        color-scheme: ${normalizedTheme.isDark ? "dark" : "light"};
        --surface: ${palette.bgSurface};
        --field: ${palette.bgEditor};
        --text: ${palette.textPrimary};
        --text-secondary: ${palette.textSecondary};
        --text-muted: ${palette.textMuted};
        --line: ${palette.lineDefault};
        --mark: ${markColor};
        --scrollbar: ${palette.textMuted};
        --scrollbar-hover: ${palette.lineFocused};
        --shadow: ${shadow};
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        width: ${Math.max(260, Math.round(width))}px;
        height: ${Math.max(160, Math.round(height))}px;
        margin: 0;
        overflow: hidden;
        background: transparent;
        color: var(--text);
        font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .popover {
        width: 100%;
        height: 100%;
        overflow: auto;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: linear-gradient(180deg, var(--surface) 0%, var(--field) 100%);
        color: var(--text);
        box-shadow: none;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        scrollbar-width: thin;
        scrollbar-color: var(--scrollbar) transparent;
      }
      .popover::-webkit-scrollbar {
        width: 10px;
        height: 10px;
        background: transparent;
      }
      .popover::-webkit-scrollbar-track {
        background: transparent;
      }
      .popover::-webkit-scrollbar-thumb {
        background-color: var(--scrollbar);
        border: 2px solid transparent;
        background-clip: padding-box;
        border-radius: 999px;
      }
      .popover::-webkit-scrollbar-thumb:hover {
        background-color: var(--scrollbar-hover);
      }
      .header {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        gap: 10px;
        align-items: start;
        padding-bottom: 7px;
        border-bottom: 1px solid var(--line);
      }
      .mark {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-top: 1px;
        background: var(--mark);
        color: white;
        font-size: 11px;
        font-weight: 800;
      }
      h3 {
        margin: 0;
        color: var(--text);
        font-size: 13px;
        line-height: 1.3;
        font-weight: 650;
        overflow-wrap: anywhere;
      }
      p {
        margin: 4px 0 0;
        color: var(--text-secondary);
        overflow-wrap: anywhere;
      }
      .details {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .item {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .item strong {
        color: var(--text-secondary);
        font-size: 10px;
        line-height: 1.3;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0.02em;
      }
      .item span {
        color: var(--text);
        background: var(--field);
        border-radius: 4px;
        padding: 3px 6px;
        font: 10.5px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      .footer {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--text-muted);
        font-size: 10.5px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
    </style>
  </head>
  <body>
    <section class="popover" role="dialog" aria-label="连接安全与证书信息" data-level="${level}">
      <header class="header">
        <span class="mark">${escapeHtml(copy.mark)}</span>
        <div>
          <h3>${escapeHtml(copy.title)}</h3>
          <p>${escapeHtml(copy.body)}</p>
        </div>
      </header>
      <div class="details">${detailRows}</div>
      <footer class="footer">验证有效期限：2026-05-01 至 2026-08-01</footer>
    </section>
  </body>
</html>`;
};
