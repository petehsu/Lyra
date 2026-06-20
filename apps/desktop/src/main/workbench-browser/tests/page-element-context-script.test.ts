import { describe, expect, test } from "vitest";

import { normalizePageElementContext } from "../page-element-context-script";
import { buildPageCitationFromContextMenu } from "../../../modules/workbench/ai-panel/lyra-agents/features/chat/page-citation";

describe("page-element-context-script", () => {
  test("normalizes element context payloads", () => {
    expect(
      normalizePageElementContext({
        elementTag: "a",
        elementSelector: "article > a:nth-of-type(1)",
        elementId: "cta",
        elementRole: "link",
        elementAriaLabel: "Read more"
      })
    ).toEqual({
      elementTag: "a",
      elementSelector: "article > a:nth-of-type(1)",
      elementId: "cta",
      elementRole: "link",
      elementAriaLabel: "Read more"
    });
  });

  test("returns null for empty element context", () => {
    expect(normalizePageElementContext({})).toBeNull();
  });
});

describe("buildPageCitationFromContextMenu", () => {
  test("includes element metadata for right-click citations", () => {
    const citation = buildPageCitationFromContextMenu(
      {
        tabId: "tab-1",
        anchorX: 10,
        anchorY: 12,
        pageUrl: "https://example.com/docs",
        pageTitle: "Docs",
        selectionText: "hello",
        mediaType: "none",
        elementTag: "p",
        elementSelector: "article > p:nth-of-type(2)",
        elementRole: "paragraph",
        isEditable: false,
        canGoBack: false,
        canGoForward: false
      },
      "Docs"
    );

    expect(citation.tabId).toBe("tab-1");
    expect(citation.excerptKind).toBe("selection");
    expect(citation.elementTag).toBe("p");
    expect(citation.elementSelector).toBe("article > p:nth-of-type(2)");
    expect(citation.elementRole).toBe("paragraph");
    expect(citation.sourceKind).toBe("browser");
  });
});
