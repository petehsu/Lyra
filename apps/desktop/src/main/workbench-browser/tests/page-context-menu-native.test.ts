import { describe, expect, test, vi } from "vitest";

import { browserContextMenuLabels } from "../../../shared/browser-context-menu-labels";
import { readBrowserContextMenuLocaleFromPreferences } from "../view-manager-runtime/page-context-menu-native";

describe("page context menu native", () => {
  test("reads locale from preferences json", () => {
    expect(readBrowserContextMenuLocaleFromPreferences(null)).toBe("zh-CN");
    expect(
      readBrowserContextMenuLocaleFromPreferences(JSON.stringify({ locale: "en-US" }))
    ).toBe("en-US");
    expect(
      readBrowserContextMenuLocaleFromPreferences(JSON.stringify({ locale: "fr-FR" }))
    ).toBe("zh-CN");
  });

  test("labels include cite actions", () => {
    expect(browserContextMenuLabels("en-US").citeSelection).toContain("AI");
    expect(browserContextMenuLabels("zh-CN").citePage).toContain("AI");
  });
});