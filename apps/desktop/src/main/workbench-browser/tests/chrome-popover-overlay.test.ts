import { describe, expect, test } from "vitest";

import {
  buildBrowserChromePopoverDocument,
  LYRA_BROWSER_CHROME_POPOVER_DOCUMENT_TITLE,
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
  test("builds a theme-token suggestion panel without cloning the address field", () => {
    const html = buildBrowserChromePopoverDocument({
      kind: "omnibox",
      width: 420,
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

    expect(html).toContain(LYRA_BROWSER_CHROME_POPOVER_DOCUMENT_TITLE);
    expect(html).toContain("lyra-omnibox-suggestion-panel");
    expect(html).toContain("--lyra-app-popover-bg: #ecddb4");
    expect(html).toContain("--lyra-app-row-hover-bg: #dfcf9f");
    expect(html).toContain("--lyra-text-primary: #241f16");
    expect(html).toContain("width: 420px");
    expect(html).toContain("lyra-omnibox://suggestion?index=1");
    expect(html).toContain("class=\"lyra-suggestion-item is-selected\"");
    expect(html).toContain("https://accounts.google.com/ (Google)");
    expect(html).toContain("Search suggestion");
    expect(html).toContain("background: transparent");
    expect(html).not.toContain("lyra-titlebar-navigation-shell");
    expect(html).not.toContain("lyra-titlebar-navigation-input");
    expect(html).not.toContain("lyra-titlebar-navigation-row");
    expect(html).not.toContain("--surface:");
    expect(html).not.toContain("--field:");
    expect(html).not.toContain("linear-gradient");
    expect(html).not.toContain("lyra-native-omnibox-expand");
    expect(html).not.toContain("data-suggestions-open");
    expect(html).not.toContain("lyra-find://previous");
  });

  test("escapes page-provided text before rendering it in the isolated document", () => {
    const html = buildBrowserChromePopoverDocument({
      kind: "omnibox",
      width: 300,
      height: 120,
      theme: terraLightTheme,
      omnibox: {
        value: "<script>",
        selectedIndex: -1,
        suggestions: [
          { value: "<script>alert(1)</script>", type: "history", label: "XSS" }
        ]
      }
    });

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
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

    expect(html).toContain("lyra-omnibox-suggestion-panel");
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("navigate-to lyra-find: lyra-omnibox:;");
    expect(html).toContain("lyra-find://match?value=2");
    expect(html).toContain("class=\"lyra-suggestion-item is-selected\"");
    expect(html).toContain("Find &lt;<mark>Lyra</mark>&gt; inside a page");
    expect(html).toContain("Only the first results are shown.");
    expect(html).toContain("--lyra-app-popover-bg: #ecddb4");
    expect(html).not.toContain("lyra-titlebar-navigation-shell");
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
