import { describe, expect, test } from "vitest";

import { attachPageCitationMaps } from "../page-citation-map";
import type { AgentPageCitation } from "../../../shared/agent";

const page = (overrides: Partial<AgentPageCitation> = {}): AgentPageCitation => ({
  id: "page-cite-1",
  tabId: "tab-1",
  tabTitle: "Docs",
  pageUrl: "https://example.com",
  pageTitle: "Docs",
  excerptKind: "page",
  preview: "Docs",
  quotedText: "Docs",
  truncated: false,
  ...overrides
});

describe("attachPageCitationMaps", () => {
  test("sends a dragged page without scanning it again", () => {
    let scanned = false;
    const browser = {
      observeAgentPage: async () => {
        scanned = true;
        return { mapAppendix: "Now operable:\n[1 targetRef=lumen:a] button: \"Save\"" };
      }
    };
    const carried = "Now operable:\n[1 targetRef=lumen:a] button: \"Save\"";
    const result = attachPageCitationMaps(
      { text: "look", pageCitations: [page({ surfaceMap: carried })] },
      browser as never
    );
    expect(scanned).toBe(false);
    expect(result.pageCitations?.[0]?.surfaceMap).toBe(carried);
  });

  test("leaves a selected excerpt without a map", async () => {
    const browser = {
      observeAgentPage: async () => ({ mapAppendix: "Now operable:" })
    };
    const result = await attachPageCitationMaps(
      { text: "look", pageCitations: [page({ excerptKind: "selection" })] },
      browser as never
    );
    expect(result.pageCitations?.[0]?.surfaceMap).toBeUndefined();
  });
});
