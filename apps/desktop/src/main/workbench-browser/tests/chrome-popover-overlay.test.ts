import { describe, expect, test } from "vitest";

import {
  buildBrowserChromePopoverDocument,
  LYRA_BROWSER_CHROME_POPOVER_DOCUMENT_TITLE,
  resolveBrowserChromePopoverHeight,
  resolveBrowserFindPopoverHeight,
  resolveBrowserOmniboxPopoverHeight
} from "../chrome-popover-overlay";

const terraLightTheme = {
  enabled: true,
  isDark: false,
  revision: 2,
  palette: {
    bgApp: "#f7f2df",
    bgSurface: "#ecddb4",
    bgEditor: "#dfcf9f",
    textPrimary: "#241f16",
    textSecondary: "#5b513f",
    textMuted: "#81745d",
    textAccent: "#8a6f20",
    lineDefault: "#c5b37c",
    lineFocused: "#a27d18",
    statusSuccess: "#357a38",
    statusWarning: "#8a6f20",
    statusError: "#ad2f2f"
  }
} as const;

describe("browser chrome popover overlay", () => {
  test("builds a self-contained browser-chrome document with Lyra theme tokens", () => {
    const html = buildBrowserChromePopoverDocument({
      kind: "security",
      width: 300,
      height: 314,
      theme: terraLightTheme,
      security: {
        level: "secure",
        address: "https://example.com/",
        domain: "example.com"
      }
    });

    expect(html).toContain(LYRA_BROWSER_CHROME_POPOVER_DOCUMENT_TITLE);
    expect(html).toContain("连接安全信息");
    expect(html).toContain("example.com");
    expect(html).toContain("--surface: #ecddb4");
    expect(html).toContain("--field: #dfcf9f");
    expect(html).toContain("background: transparent");
    expect(html).toContain("border-radius: 10px");
    expect(html).not.toContain("linear-gradient(180deg, var(--surface)");
    expect(html).not.toContain("Canvas");
    expect(html).not.toContain("backdrop-filter");
    expect(html).not.toContain("document.addEventListener");
    expect(html).not.toContain("Let's Encrypt / Lyra Trusted CA Root");
    expect(html).not.toContain("TLS 1.3, AES_256_GCM, X25519");
    expect(html).not.toContain("2026-05-01");
  });

  test("renders only provided certificate facts for secure pages", () => {
    const html = buildBrowserChromePopoverDocument({
      kind: "security",
      width: 340,
      height: 314,
      theme: terraLightTheme,
      security: {
        level: "secure",
        locale: "en-US",
        address: "https://example.com/",
        domain: "example.com",
        scheme: "https",
        origin: "https://example.com",
        certificateStatus: "available",
        certificate: {
          subject: "CN=example.com\nO=Example Inc",
          subjectCommonName: "example.com",
          issuer: "CN=Example Issuer",
          issuerCommonName: "Example Issuer",
          validFrom: "Jan 1 00:00:00 2026 GMT",
          validTo: "Apr 1 23:59:59 2026 GMT",
          serialNumber: "01AB",
          fingerprint256: "AA:BB:CC",
          subjectAltName: "DNS:example.com"
        }
      }
    });

    expect(html).toContain("Connection security information");
    expect(html).toContain("Certificate subject CN");
    expect(html).toContain("example.com");
    expect(html).toContain("Example Issuer");
    expect(html).toContain("AA:BB:CC");
    expect(html).not.toContain("Certificate details unavailable");
    expect(html).not.toContain("Lyra Trusted CA Root");
  });

  test("renders localized certificate unavailable state without fallback certificate data", () => {
    const html = buildBrowserChromePopoverDocument({
      kind: "security",
      width: 340,
      height: 314,
      theme: terraLightTheme,
      security: {
        level: "secure",
        locale: "en-US",
        address: "https://example.com/",
        domain: "example.com",
        certificateStatus: "unavailable",
        certificateUnavailableReason: "Chromium did not return a parsable certificate chain."
      }
    });

    expect(html).toContain("Certificate details unavailable");
    expect(html).toContain("Chromium did not return a parsable certificate chain.");
    expect(html).not.toContain("Let's Encrypt");
    expect(html).not.toContain("验证有效期限");
  });

  test("escapes page-provided text before rendering it in the isolated document", () => {
    const html = buildBrowserChromePopoverDocument({
      kind: "security",
      width: 300,
      height: 272,
      theme: terraLightTheme,
      security: {
        level: "secure",
        address: "https://example.com/",
        domain: "<script>alert(1)</script>"
      }
    });

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  test("resolves bounded content heights by security level", () => {
    expect(resolveBrowserChromePopoverHeight({ level: "secure", maxHeight: 520 })).toBe(314);
    expect(resolveBrowserChromePopoverHeight({ level: "insecure", maxHeight: 520 })).toBe(260);
    expect(resolveBrowserChromePopoverHeight({ level: "system", maxHeight: 520 })).toBe(272);
    expect(resolveBrowserChromePopoverHeight({ level: "secure", maxHeight: 180 })).toBe(180);
  });

  test("builds a browser-native find result surface without owning text input", () => {
    const html = buildBrowserChromePopoverDocument({
      kind: "find",
      width: 430,
      height: 180,
      theme: terraLightTheme,
      find: {
        query: "Lyra",
        placeholder: "Find in page",
        currentIndex: 2,
        totalMatches: 7,
        activeMatchId: "match-2",
        matches: [
          {
            id: "match-1",
            index: 1,
            startChar: 10,
            endChar: 14,
            snippet: "Open Lyra from the toolbar"
          },
          {
            id: "match-2",
            index: 2,
            startChar: 40,
            endChar: 44,
            snippet: "Find <Lyra> inside a page"
          }
        ],
        truncated: true
      }
    });

    expect(html).toContain("lyra-titlebar-navigation-shell");
    expect(html).toContain("lyra-omnibox-suggestions");
    expect(html).toContain("data-mode=\"page-find\"");
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("navigate-to lyra-find: lyra-omnibox:;");
    expect(html).toContain("lyra-find://match?value=2");
    expect(html).toContain("class=\"lyra-suggestion-item is-selected\"");
    expect(html).toContain("Find &lt;<mark>Lyra</mark>&gt; inside a page");
    expect(html).toContain("仅显示前 2 个结果");
    expect(html).not.toContain("data-find-input");
    expect(html).not.toContain("data-find-action");
    expect(html).not.toContain("placeholder=\"Find in page\"");
    expect(html).not.toContain("2 / 7");
    expect(html).not.toContain("class=\"header\"");
    expect(html).not.toContain("<Lyra>");

    const compactHtml = buildBrowserChromePopoverDocument({
      kind: "find",
      width: 260,
      height: 54,
      theme: terraLightTheme,
      find: {
        query: "",
        currentIndex: 0,
        totalMatches: 0,
        matches: [],
        truncated: false
      }
    });

    expect(compactHtml).toContain("width: 260px");
    expect(compactHtml).not.toContain("width: 300px");
  });

  test("builds a browser-native omnibox suggestions surface", () => {
    const html = buildBrowserChromePopoverDocument({
      kind: "omnibox",
      width: 220,
      height: 180,
      theme: terraLightTheme,
      omnibox: {
        value: "goo",
        selectedIndex: 1,
        suggestions: [
          { value: "https://accounts.google.com/", type: "history", label: "Google" },
          { value: "google search", type: "search", label: "Google" }
        ]
      }
    });

    expect(html).toContain("lyra-titlebar-navigation-shell");
    expect(html).toContain("lyra-omnibox-suggestions");
    expect(html).toContain("lyra-omnibox://suggestion?index=1");
    expect(html).toContain("class=\"lyra-suggestion-item is-selected\"");
    expect(html).toContain("https://accounts.google.com/ (Google)");
    expect(html).toContain("搜索建议");
    expect(html).not.toContain("lyra-find://previous");
  });

  test("resolves bounded content heights for find results", () => {
    expect(resolveBrowserFindPopoverHeight({ matchCount: 0, maxHeight: 600 })).toBe(54);
    expect(resolveBrowserFindPopoverHeight({ matchCount: 12, maxHeight: 600 })).toBe(240);
    expect(resolveBrowserFindPopoverHeight({ matchCount: 12, maxHeight: 180 })).toBe(180);
  });

  test("keeps omnibox suggestion heights aligned with result-surface sizing", () => {
    expect(resolveBrowserOmniboxPopoverHeight({ itemCount: 0, maxHeight: 600 })).toBe(54);
    expect(resolveBrowserOmniboxPopoverHeight({ itemCount: 12, maxHeight: 600 })).toBe(240);
    expect(resolveBrowserOmniboxPopoverHeight({ itemCount: 12, maxHeight: 180 })).toBe(180);
  });
});
