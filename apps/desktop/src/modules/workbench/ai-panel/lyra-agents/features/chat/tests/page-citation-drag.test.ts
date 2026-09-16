import { describe, expect, test } from "vitest";

import {
  buildPageCitationFromDragPayload,
  compactCitationTrail
} from "../page-citation";

describe("page-citation drag trails", () => {
  test("drops data urls from compact trails", () => {
    expect(compactCitationTrail([
      "Gallery",
      "https://example.com/gallery",
      "data:image/png;base64,AAAA",
      "tab-42"
    ])).toBe("Gallery\nhttps://example.com/gallery\ntab-42");
  });

  test("page drags include tab id and url without page body", () => {
    const citation = buildPageCitationFromDragPayload({
      tabId: "tab-42",
      pageUrl: "https://example.com/docs",
      pageTitle: "Docs"
    }, "Docs");
    expect(citation.quotedText).toBe("Docs\nhttps://example.com/docs\ntab-42");
    expect(citation.tabId).toBe("tab-42");
    expect(citation.excerptKind).toBe("page");
  });
});
