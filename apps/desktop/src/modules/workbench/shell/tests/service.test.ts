import { describe, expect, it } from "vitest";

import { resolveDocsEntryUrl } from "../service";

describe("resolveDocsEntryUrl", () => {
  it("appends host, locale and theme query params", () => {
    const url = resolveDocsEntryUrl("http://localhost:5174/", {
      locale: "zh-CN",
      themeId: "lyra-dark"
    });
    expect(url).toContain("host=lyra");
    expect(url).toContain("locale=zh-CN");
    expect(url).toContain("theme=lyra-dark");
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
