import type {
  WorkbenchBrowserChromeSecurityPopoverPayload,
  WorkbenchBrowserFindLabels,
  WorkbenchBrowserOmniboxLabels,
  WorkbenchBrowserSecurityLabels,
  WorkbenchBrowserOmniboxSuggestion,
  WorkbenchBrowserSearchInPageMatch,
  WorkbenchBrowserSecurityLevel,
  WorkbenchBrowserWebThemeSnapshot
} from "../../shared/workbench-browser";
import { DEFAULT_WEB_THEME_SNAPSHOT } from "../../shared/workbench-browser";

export const LYRA_BROWSER_CHROME_POPOVER_DOCUMENT_TITLE = "Lyra Browser Chrome Popover";

export type BrowserChromePopoverDocumentOptions = {
  readonly kind: "security" | "find" | "omnibox";
  readonly width: number;
  readonly height: number;
  readonly security?: WorkbenchBrowserChromeSecurityPopoverPayload;
  readonly find?: {
    readonly query: string;
    readonly placeholder?: string;
    readonly currentIndex: number;
    readonly totalMatches: number;
    readonly activeMatchId?: string;
    readonly matches: readonly WorkbenchBrowserSearchInPageMatch[];
    readonly truncated?: boolean;
    readonly labels?: WorkbenchBrowserFindLabels;
  };
  readonly omnibox?: {
    readonly value: string;
    readonly selectedIndex: number;
    readonly suggestions: readonly WorkbenchBrowserOmniboxSuggestion[];
    readonly labels?: WorkbenchBrowserOmniboxLabels;
  };
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

type SecurityPopoverCopy = WorkbenchBrowserSecurityLabels & {
  readonly mark: string;
};

const DEFAULT_FIND_LABELS: WorkbenchBrowserFindLabels = {
  ariaLabel: "Page content search results",
  current: "Current",
  result: "Result",
  emptyStart: "Type to search page content",
  emptyNoMatch: "No matches found",
  truncationNotice: "Only the first results are shown."
};

const DEFAULT_OMNIBOX_LABELS: WorkbenchBrowserOmniboxLabels = {
  ariaLabel: "Address suggestions",
  history: "History",
  searchSuggestion: "Search suggestion",
  emptyStart: "Type to search",
  emptyNoMatch: "No matching suggestions"
};

const DEFAULT_SECURITY_COPY: WorkbenchBrowserSecurityLabels = {
    ariaLabel: "Connection security information",
    secureTitle: "Connection is secure",
    secureBody: "This page loaded over HTTPS. Lyra only shows connection and certificate information it actually read from the current page.",
    insecureTitle: "Connection is not secure",
    insecureBody: "This page did not load over HTTPS. Content on this connection may be read or changed by others on the network.",
    systemTitle: "Local or system page",
    systemBody: "This is not a remote HTTPS website. Lyra only shows the local or system origin details it can confirm.",
    connectionLabel: "Connection",
    addressLabel: "Address",
    hostLabel: "Host",
    originLabel: "Origin",
    schemeLabel: "Scheme",
    certificateSubjectLabel: "Certificate subject",
    certificateSubjectCommonNameLabel: "Certificate subject CN",
    certificateIssuerLabel: "Certificate issuer",
    certificateIssuerCommonNameLabel: "Certificate issuer CN",
    certificateValidFromLabel: "Valid from",
    certificateValidToLabel: "Valid until",
    certificateSerialLabel: "Serial number",
    certificateFingerprintLabel: "SHA-256 fingerprint",
    certificateSubjectAltNameLabel: "Subject alternative names",
    certificateUnavailableLabel: "Certificate details",
    certificateNotApplicableLabel: "Not applicable",
    secureConnection: "HTTPS",
    insecureConnection: "Unencrypted HTTP",
    localConnection: "Local/system page",
    unavailableReason: "Certificate details unavailable: {reason}",
    unavailableNotHttps: "The current page is not an HTTPS connection.",
  unavailableNoCertificate: "Chromium did not return a parsable certificate chain."
};

const copyForSecurityLevel = (
  level: WorkbenchBrowserSecurityLevel,
  providedLabels: WorkbenchBrowserSecurityLabels | undefined
): {
  readonly mark: string;
  readonly title: string;
  readonly body: string;
  readonly labels: SecurityPopoverCopy;
} => {
  const base = providedLabels ?? DEFAULT_SECURITY_COPY;
  const mark =
    level === "secure"
      ? "✓"
      : level === "insecure"
        ? "!"
        : "i";
  const labels = { ...base, mark };
  switch (level) {
    case "secure":
      return {
        mark,
        title: base.secureTitle,
        body: base.secureBody,
        labels
      };
    case "insecure":
      return {
        mark,
        title: base.insecureTitle,
        body: base.insecureBody,
        labels
      };
    case "system":
    default:
      return {
        mark,
        title: base.systemTitle,
        body: base.systemBody,
        labels
      };
  }
};

const formatSecurityUnavailableReason = (
  template: string,
  reason: string
): string => template.replace("{reason}", reason);

const securityConnectionLabel = (
  level: WorkbenchBrowserSecurityLevel,
  labels: SecurityPopoverCopy
): string => {
  switch (level) {
    case "secure":
      return labels.secureConnection;
    case "insecure":
      return labels.insecureConnection;
    case "system":
    default:
      return labels.localConnection;
  }
};

const securityDetailRows = (
  security: WorkbenchBrowserChromeSecurityPopoverPayload,
  level: WorkbenchBrowserSecurityLevel,
  labels: SecurityPopoverCopy
): readonly (readonly [string, string])[] => {
  const cert = security.certificate;
  const unavailableReason =
    security.certificateUnavailableReason
    ?? (level === "secure" ? labels.unavailableNoCertificate : labels.unavailableNotHttps);
  const rows: (readonly [string, string])[] = [
    [labels.connectionLabel, securityConnectionLabel(level, labels)],
    [labels.addressLabel, security.address],
    [labels.hostLabel, security.domain],
    ...(security.origin === undefined ? [] : [[labels.originLabel, security.origin] as const]),
    ...(security.scheme === undefined ? [] : [[labels.schemeLabel, security.scheme] as const])
  ];

  if (cert !== undefined) {
    rows.push(
      ...(cert.subject === undefined ? [] : [[labels.certificateSubjectLabel, cert.subject] as const]),
      ...(cert.subjectCommonName === undefined ? [] : [[labels.certificateSubjectCommonNameLabel, cert.subjectCommonName] as const]),
      ...(cert.issuer === undefined ? [] : [[labels.certificateIssuerLabel, cert.issuer] as const]),
      ...(cert.issuerCommonName === undefined ? [] : [[labels.certificateIssuerCommonNameLabel, cert.issuerCommonName] as const]),
      ...(cert.validFrom === undefined ? [] : [[labels.certificateValidFromLabel, cert.validFrom] as const]),
      ...(cert.validTo === undefined ? [] : [[labels.certificateValidToLabel, cert.validTo] as const]),
      ...(cert.serialNumber === undefined ? [] : [[labels.certificateSerialLabel, cert.serialNumber] as const]),
      ...(cert.fingerprint256 === undefined ? [] : [[labels.certificateFingerprintLabel, cert.fingerprint256] as const]),
      ...(cert.subjectAltName === undefined ? [] : [[labels.certificateSubjectAltNameLabel, cert.subjectAltName] as const])
    );
  } else if (security.certificateStatus === "not-applicable") {
    rows.push([labels.certificateUnavailableLabel, labels.certificateNotApplicableLabel]);
  } else {
    rows.push([
      labels.certificateUnavailableLabel,
      formatSecurityUnavailableReason(labels.unavailableReason, unavailableReason)
    ]);
  }

  return rows.filter((row) => row[1].trim().length > 0);
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

export const resolveBrowserFindPopoverHeight = ({
  matchCount,
  maxHeight
}: {
  readonly matchCount: number;
  readonly maxHeight: number;
}): number => {
  const visibleRows = Math.min(8, Math.max(1, Math.round(matchCount)));
  const preferred = 10 + visibleRows * 36 + 8;
  return Math.max(54, Math.min(Math.round(maxHeight), Math.min(240, preferred)));
};

export const resolveBrowserOmniboxPopoverHeight = ({
  itemCount,
  maxHeight
}: {
  readonly itemCount: number;
  readonly maxHeight: number;
}): number => {
  const visibleRows = Math.min(8, Math.max(1, Math.round(itemCount)));
  const preferred = 10 + visibleRows * 36 + 8;
  return Math.max(54, Math.min(Math.round(maxHeight), Math.min(240, preferred)));
};

const buildFindActionUrl = (action: string, value?: string | number): string => {
  const params = new URLSearchParams();
  if (value !== undefined) {
    params.set("value", String(value));
  }
  return `lyra-find://${action}${params.toString().length === 0 ? "" : `?${params.toString()}`}`;
};

const buildOmniboxActionUrl = (index: number): string => {
  const params = new URLSearchParams();
  params.set("index", String(index));
  return `lyra-omnibox://suggestion?${params.toString()}`;
};

const highlightSnippet = (snippet: string, query: string): string => {
  const escapedSnippet = escapeHtml(snippet);
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return escapedSnippet;
  }
  const lowerSnippet = snippet.toLocaleLowerCase();
  const lowerQuery = trimmedQuery.toLocaleLowerCase();
  const index = lowerSnippet.indexOf(lowerQuery);
  if (index < 0) {
    return escapedSnippet;
  }
  const before = escapeHtml(snippet.slice(0, index));
  const match = escapeHtml(snippet.slice(index, index + trimmedQuery.length));
  const after = escapeHtml(snippet.slice(index + trimmedQuery.length));
  return `${before}<mark>${match}</mark>${after}`;
};

const buildFindPopoverDocument = ({
  width,
  height,
  find,
  theme
}: {
  readonly width: number;
  readonly height: number;
  readonly find: NonNullable<BrowserChromePopoverDocumentOptions["find"]>;
  readonly theme?: WorkbenchBrowserWebThemeSnapshot;
}): string => {
  const labels = find.labels ?? DEFAULT_FIND_LABELS;
  const rows = find.matches
    .map((match) => {
      const selected = match.id === find.activeMatchId || match.index === find.currentIndex;
      return `
        <a class="lyra-suggestion-item${selected ? " is-selected" : ""}" href="${buildFindActionUrl("match", match.index)}" role="option" aria-selected="${selected ? "true" : "false"}">
          <span class="lyra-suggestion-left">
            <span class="lyra-find-result-index">#${match.index}</span>
            <span class="lyra-suggestion-text">${highlightSnippet(match.snippet, find.query)}</span>
          </span>
          <span class="lyra-suggestion-type-badge">${escapeHtml(selected ? labels.current : labels.result)}</span>
        </a>`;
    })
    .join("");
  const empty = find.query.trim().length === 0 ? labels.emptyStart : labels.emptyNoMatch;
  return buildOmniboxLikeDocument({
    width,
    height,
    ...(theme === undefined ? {} : { theme }),
    ariaLabel: labels.ariaLabel,
    mode: "page-find",
    body: `
      ${rows.length > 0 ? rows : `<div class="lyra-find-empty">${escapeHtml(empty)}</div>`}
      ${find.truncated === true ? `<div class="lyra-find-truncated">${escapeHtml(labels.truncationNotice)}</div>` : ""}
    `
  });
};

const buildOmniboxLikeDocument = ({
  width,
  height,
  theme,
  body,
  ariaLabel,
  mode = "normal",
  controls,
  script
}: {
  readonly width: number;
  readonly height: number;
  readonly theme?: WorkbenchBrowserWebThemeSnapshot;
  readonly body: string;
  readonly ariaLabel: string;
  readonly mode?: "normal" | "page-find";
  readonly controls?: string;
  readonly script?: string;
}): string => {
  const normalizedTheme = normalizeTheme(theme);
  const palette = normalizedTheme.palette;
  const hasScript = script !== undefined && script.trim().length > 0;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src ${hasScript ? "'unsafe-inline'" : "'none'"}; navigate-to lyra-find: lyra-omnibox:;"
    />
    <title>${LYRA_BROWSER_CHROME_POPOVER_DOCUMENT_TITLE}</title>
    <style>
      :root {
        color-scheme: ${normalizedTheme.isDark ? "dark" : "light"};
        --lyra-unit-1: 1px;
        --lyra-unit-2: 2px;
        --lyra-unit-3: 3px;
        --lyra-unit-4: 4px;
        --lyra-unit-6: 6px;
        --lyra-unit-7: 7px;
        --lyra-unit-8: 8px;
        --lyra-unit-9: 9px;
        --lyra-unit-10: 10px;
        --lyra-unit-11-5: 11.5px;
        --lyra-unit-12: 12px;
        --lyra-unit-13: 13px;
        --lyra-unit-14: 14px;
        --lyra-unit-18: 18px;
        --lyra-unit-24: 24px;
        --lyra-unit-28: 28px;
        --lyra-unit-34: 34px;
        --lyra-unit-44: 44px;
        --lyra-unit-48: 48px;
        --lyra-unit-240: 240px;
        --lyra-unit-999: 999px;
        --lyra-shell-titlebar-nav-h: 28px;
        --lyra-stroke-hairline: 1px;
        --lyra-radius-pill: 999px;
        --lyra-titlebar-navigation-radius: var(--lyra-unit-14);
        --lyra-app-bg: ${palette.bgApp};
        --lyra-app-surface-bg: ${palette.bgSurface};
        --lyra-app-panel-bg: ${palette.bgEditor};
        --lyra-app-row-hover-bg: color-mix(in srgb, ${palette.bgEditor} 78%, ${palette.textAccent} 10%);
        --lyra-app-border: ${palette.lineDefault};
        --lyra-text-primary: ${palette.textPrimary};
        --lyra-text-secondary: ${palette.textSecondary};
        --lyra-text-muted: ${palette.textMuted};
        --lyra-text-accent: ${palette.textAccent};
        --lyra-scrollbar-thumb-idle: ${palette.textMuted};
        --lyra-scrollbar-thumb-hover: ${palette.lineFocused};
        --lyra-font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      html,
      body {
        width: ${Math.max(220, Math.round(width))}px;
        height: ${Math.max(54, Math.round(height))}px;
        margin: 0;
        overflow: hidden;
        background: transparent;
        color: var(--lyra-text-primary);
        font: 12px/1.45 var(--lyra-font-ui);
      }
      .lyra-titlebar-navigation {
        width: 100%;
        min-width: 0;
        height: 100%;
        position: relative;
      }
      .lyra-titlebar-navigation-shell {
        --lyra-titlebar-navigation-radius: var(--lyra-unit-14);
        width: 100%;
        min-width: 0;
        height: 100%;
        min-height: var(--lyra-shell-titlebar-nav-h);
        max-height: 100%;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding: 0;
        border: var(--lyra-stroke-hairline) solid
          color-mix(in srgb, var(--lyra-app-border) 54%, var(--lyra-text-secondary) 22%);
        border-radius: var(--lyra-titlebar-navigation-radius);
        background:
          linear-gradient(
            180deg,
            color-mix(in srgb, var(--lyra-app-surface-bg) 96%, transparent) 0%,
            color-mix(in srgb, var(--lyra-app-panel-bg) 90%, transparent) 100%
          );
        box-shadow:
          inset 0 var(--lyra-unit-1) 0 color-mix(in srgb, var(--lyra-app-surface-bg) 34%, transparent),
          0 var(--lyra-unit-10) 28px color-mix(in srgb, var(--lyra-app-bg) 16%, transparent);
        overflow: hidden;
        transform-origin: bottom center;
        animation: lyra-native-omnibox-expand 190ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      .lyra-omnibox-suggestions {
        box-sizing: border-box;
        width: 100%;
        flex: 1 1 auto;
        max-height: var(--lyra-unit-240);
        overflow: hidden;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--lyra-scrollbar-thumb-idle) transparent;
        padding: var(--lyra-unit-6) 0 var(--lyra-unit-3);
        list-style: none;
        margin: 0;
        text-align: left;
        border-bottom: var(--lyra-stroke-hairline) solid
          color-mix(in srgb, var(--lyra-app-border) 34%, transparent);
        background: transparent;
        animation: omnibox-suggestions-reveal 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
      }
      .lyra-titlebar-navigation-shell[data-mode="page-find"] .lyra-omnibox-suggestions {
        border-bottom: 0;
      }
      .lyra-omnibox-suggestions::-webkit-scrollbar {
        width: var(--lyra-unit-10);
        height: var(--lyra-unit-10);
        background: transparent;
      }
      .lyra-omnibox-suggestions::-webkit-scrollbar-track {
        background: transparent;
      }
      .lyra-omnibox-suggestions::-webkit-scrollbar-thumb {
        background-color: var(--lyra-scrollbar-thumb-idle);
        border: var(--lyra-unit-2) solid transparent;
        background-clip: padding-box;
        border-radius: var(--lyra-radius-pill);
      }
      .lyra-omnibox-suggestions::-webkit-scrollbar-thumb:hover {
        background-color: var(--lyra-scrollbar-thumb-hover);
      }
      .lyra-suggestion-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--lyra-unit-10);
        min-width: 0;
        padding: var(--lyra-unit-7) var(--lyra-unit-12);
        color: var(--lyra-text-primary);
        text-decoration: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .lyra-suggestion-item:hover,
      .lyra-suggestion-item.is-selected {
        background: var(--lyra-app-row-hover-bg);
        color: var(--lyra-text-primary);
      }
      .lyra-suggestion-left {
        display: flex;
        align-items: center;
        gap: var(--lyra-unit-10);
        min-width: 0;
        flex: 1;
      }
      .lyra-suggestion-glyph,
      .lyra-find-result-index {
        width: 34px;
        flex: 0 0 34px;
        color: var(--lyra-text-muted);
        font-variant-numeric: tabular-nums;
      }
      .lyra-suggestion-item:hover .lyra-suggestion-glyph,
      .lyra-suggestion-item.is-selected .lyra-suggestion-glyph {
        color: var(--lyra-text-accent);
      }
      .lyra-suggestion-text {
        min-width: 0;
        font-size: var(--lyra-unit-11-5);
        font-family: var(--lyra-font-ui);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--lyra-text-primary);
      }
      .lyra-suggestion-type-badge {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--lyra-text-muted);
        letter-spacing: 0.04em;
        opacity: 0.68;
        flex: 0 0 auto;
      }
      .lyra-suggestion-item:hover .lyra-suggestion-type-badge,
      .lyra-suggestion-item.is-selected .lyra-suggestion-type-badge {
        opacity: 0.95;
      }
      mark {
        color: inherit;
        background: rgba(255, 214, 64, 0.42);
        border-radius: 3px;
        padding: 0 1px;
      }
      .lyra-find-empty,
      .lyra-find-truncated {
        color: var(--lyra-text-muted);
        padding: 5px;
        font-size: var(--lyra-unit-11-5);
      }
      .lyra-find-empty {
        padding: var(--lyra-unit-7) var(--lyra-unit-12);
      }
      .lyra-find-truncated {
        padding: var(--lyra-unit-3) var(--lyra-unit-12) var(--lyra-unit-6);
        font-size: 10.5px;
      }
      .lyra-titlebar-navigation-row {
        width: 100%;
        min-height: var(--lyra-shell-titlebar-nav-h);
        display: grid;
        grid-template-columns: var(--lyra-shell-titlebar-nav-h) minmax(0, 1fr);
        align-items: center;
        gap: 0;
        position: relative;
        flex: 0 0 var(--lyra-shell-titlebar-nav-h);
      }
      .lyra-titlebar-navigation-security-btn {
        width: var(--lyra-shell-titlebar-nav-h);
        height: var(--lyra-shell-titlebar-nav-h);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        background: transparent;
        color: var(--lyra-text-muted);
        flex: 0 0 var(--lyra-shell-titlebar-nav-h);
        user-select: none;
      }
      .lyra-find-search-glyph {
        font-size: var(--lyra-unit-13);
        line-height: 1;
      }
      .lyra-titlebar-navigation-input {
        box-sizing: border-box;
        min-width: 0;
        width: 100%;
        height: calc(var(--lyra-shell-titlebar-nav-h) - var(--lyra-unit-2));
        border: 0;
        background: transparent;
        color: var(--lyra-text-primary);
        font-family: var(--lyra-font-ui);
        font-size: var(--lyra-unit-12);
        line-height: 1.5;
        outline: none;
        padding: 0 calc(var(--lyra-shell-titlebar-nav-h) * 4 + var(--lyra-unit-48)) 0 0;
      }
      .lyra-titlebar-navigation-input::placeholder {
        color: var(--lyra-text-muted);
      }
      .lyra-titlebar-navigation-actions {
        position: absolute;
        top: 50%;
        right: 0;
        display: inline-flex;
        align-items: center;
        transform: translateY(-50%);
      }
      .lyra-titlebar-navigation-action {
        width: var(--lyra-shell-titlebar-nav-h);
        height: var(--lyra-shell-titlebar-nav-h);
        border: 0;
        border-radius: var(--lyra-unit-999);
        background: transparent;
        color: var(--lyra-text-muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font: 14px/1 var(--lyra-font-ui);
        padding: 0;
        transition:
          color 120ms ease,
          opacity 120ms ease;
      }
      .lyra-titlebar-navigation-action:hover,
      .lyra-titlebar-navigation-action:focus-visible {
        color: var(--lyra-text-primary);
        background: transparent;
        opacity: 1;
        outline: none;
      }
      .lyra-titlebar-navigation-action:disabled {
        cursor: default;
        opacity: 0.38;
      }
      .lyra-titlebar-page-find-counter {
        min-width: var(--lyra-unit-48);
        height: var(--lyra-shell-titlebar-nav-h);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--lyra-text-secondary);
        font-size: var(--lyra-unit-11-5);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      @keyframes lyra-native-omnibox-expand {
        from {
          opacity: 0;
          clip-path: inset(calc(100% - var(--lyra-shell-titlebar-nav-h)) 0 0 0 round var(--lyra-titlebar-navigation-radius));
        }
        to {
          opacity: 1;
          clip-path: inset(0 0 0 0 round var(--lyra-titlebar-navigation-radius));
        }
      }
      @keyframes omnibox-suggestions-reveal {
        from {
          opacity: 0;
          transform: translateY(var(--lyra-unit-4));
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    </style>
  </head>
  <body>
    <form class="lyra-titlebar-navigation lyra-no-drag" aria-label="${escapeHtml(ariaLabel)}">
      <div class="lyra-titlebar-navigation-shell" data-suggestions-open="true" data-mode="${mode}">
        <div class="lyra-omnibox-suggestions" role="listbox" aria-label="${escapeHtml(ariaLabel)}">
          ${body}
        </div>
        ${controls ?? ""}
      </div>
    </form>
    ${hasScript ? `<script>${script}</script>` : ""}
  </body>
</html>`;
};

const buildOmniboxPopoverDocument = ({
  width,
  height,
  omnibox,
  theme
}: {
  readonly width: number;
  readonly height: number;
  readonly omnibox: NonNullable<BrowserChromePopoverDocumentOptions["omnibox"]>;
  readonly theme?: WorkbenchBrowserWebThemeSnapshot;
}): string => {
  const labels = omnibox.labels ?? DEFAULT_OMNIBOX_LABELS;
  const rows = omnibox.suggestions
    .map((suggestion, index) => {
      const selected = index === omnibox.selectedIndex;
      const text = `${suggestion.value}${suggestion.label ? ` (${suggestion.label})` : ""}`;
      return `
        <a class="lyra-suggestion-item${selected ? " is-selected" : ""}" href="${buildOmniboxActionUrl(index)}" role="option" aria-selected="${selected ? "true" : "false"}">
          <span class="lyra-suggestion-left">
            <span class="lyra-suggestion-glyph">${suggestion.type === "history" ? "◎" : "⌕"}</span>
            <span class="lyra-suggestion-text">${escapeHtml(text)}</span>
          </span>
          <span class="lyra-suggestion-type-badge">${escapeHtml(suggestion.type === "history" ? labels.history : labels.searchSuggestion)}</span>
        </a>`;
    })
    .join("");
  const empty = omnibox.value.trim().length === 0 ? labels.emptyStart : labels.emptyNoMatch;
  return buildOmniboxLikeDocument({
    width,
    height,
    ...(theme === undefined ? {} : { theme }),
    ariaLabel: labels.ariaLabel,
    body: rows.length > 0 ? rows : `<div class="lyra-find-empty">${escapeHtml(empty)}</div>`
  });
};

export const buildBrowserChromePopoverDocument = ({
  kind,
  width,
  height,
  security,
  find,
  omnibox,
  theme
}: BrowserChromePopoverDocumentOptions): string => {
  if (kind === "omnibox") {
    if (omnibox === undefined) {
      throw new Error("omnibox popover payload is required");
    }
    return buildOmniboxPopoverDocument({
      width,
      height,
      omnibox,
      ...(theme === undefined ? {} : { theme })
    });
  }
  if (kind === "find") {
    if (find === undefined) {
      throw new Error("find popover payload is required");
    }
    return buildFindPopoverDocument({
      width,
      height,
      find,
      ...(theme === undefined ? {} : { theme })
    });
  }
  if (security === undefined) {
    throw new Error("security popover payload is required");
  }
  const normalizedTheme = normalizeTheme(theme);
  const palette = normalizedTheme.palette;
  const level = normalizeSecurityLevel(security.level);
  const copy = copyForSecurityLevel(level, security.labels);
  const markColor =
    level === "secure"
      ? palette.statusSuccess
      : level === "insecure"
        ? palette.statusError
        : palette.textMuted;
  const shadow = normalizedTheme.isDark
    ? "0 7px 22px rgba(0, 0, 0, 0.32)"
    : "0 7px 22px rgba(20, 24, 33, 0.12)";
  const detailRows = securityDetailRows(security, level, copy.labels)
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
        border-radius: 10px;
        background: var(--surface);
        color: var(--text);
        box-shadow: var(--shadow);
        padding: 10px;
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
        grid-template-columns: 22px minmax(0, 1fr);
        gap: 8px;
        align-items: start;
        padding: 2px 2px 8px;
        border-bottom: 1px solid var(--line);
      }
      .mark {
        width: 22px;
        height: 22px;
        border-radius: 6px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--field);
        color: var(--mark);
        font-size: 11px;
        font-weight: 800;
        border: 1px solid var(--line);
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
        gap: 6px;
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
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 4px 6px;
        font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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
    <section class="popover" role="dialog" aria-label="${escapeHtml(copy.labels.ariaLabel)}" data-level="${level}">
      <header class="header">
        <span class="mark">${escapeHtml(copy.mark)}</span>
        <div>
          <h3>${escapeHtml(copy.title)}</h3>
          <p>${escapeHtml(copy.body)}</p>
        </div>
      </header>
      <div class="details">${detailRows}</div>
    </section>
  </body>
</html>`;
};
