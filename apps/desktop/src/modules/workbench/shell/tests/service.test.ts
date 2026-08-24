import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveDocsEntryUrl,
  syncDocumentThemeTone,
  syncWindowThemeSource
} from "../service";

afterEach(() => {
  document.documentElement.style.colorScheme = "";
  delete document.documentElement.dataset.lyraThemeTone;
  vi.restoreAllMocks();
});

describe("resolveDocsEntryUrl", () => {
  it("injects locale into path and appends host and theme query params", () => {
    const url = resolveDocsEntryUrl("https://lyra-docs.example.com/docs", {
      locale: "zh-CN",
      themeId: "lyra-dark"
    });
    expect(url).toContain("/zh-CN/docs");
    expect(url).toContain("host=lyra");
    expect(url).toContain("theme=lyra-dark");
  });

  it("does not duplicate locale when already in path", () => {
    const url = resolveDocsEntryUrl("http://localhost:5174/zh-CN/docs", {
      locale: "zh-CN",
      themeId: "lyra-dark"
    });
    expect(url).toContain("/zh-CN/docs");
    expect(url).not.toContain("/zh-CN/zh-CN");
    expect(url).toContain("host=lyra");
  });

  it("keeps base address when url is invalid", () => {
    const broken = "::invalid-url::";
    expect(
      resolveDocsEntryUrl(broken, {
        locale: "en-US",
        themeId: "lyra-light"
      })
    ).toBe(broken);
  });
});

describe("theme synchronization", () => {
  it("updates the document color scheme with the resolved Lyra theme", () => {
    syncDocumentThemeTone("lyra-dark");
    expect(document.documentElement.dataset.lyraThemeTone).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    syncDocumentThemeTone("lyra-light");
    expect(document.documentElement.dataset.lyraThemeTone).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("propagates the selected mode to Electron and Chromium pages", async () => {
    const setThemeSource = vi.fn(async () => undefined);
    syncWindowThemeSource({
      windowControls: { setThemeSource }
    } as never, "lyra-dark");

    await vi.waitFor(() => {
      expect(setThemeSource).toHaveBeenCalledWith("dark");
    });
  });
});
