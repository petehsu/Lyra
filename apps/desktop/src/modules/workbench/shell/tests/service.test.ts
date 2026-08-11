import { describe, expect, it } from "vitest";

import { resolveDocsEntryUrl } from "../service";

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
