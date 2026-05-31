import { describe, expect, test } from "vitest";

import {
  buildBrowserChromePopoverDocument,
  LYRA_BROWSER_CHROME_POPOVER_DOCUMENT_TITLE,
  resolveBrowserChromePopoverHeight
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
    expect(html).toContain("连接安全与证书信息");
    expect(html).toContain("example.com");
    expect(html).toContain("--surface: #ecddb4");
    expect(html).toContain("--field: #dfcf9f");
    expect(html).toContain("background: transparent");
    expect(html).toContain("border-radius: 12px");
    expect(html).not.toContain("Canvas");
    expect(html).not.toContain("backdrop-filter");
    expect(html).not.toContain("document.addEventListener");
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
});
