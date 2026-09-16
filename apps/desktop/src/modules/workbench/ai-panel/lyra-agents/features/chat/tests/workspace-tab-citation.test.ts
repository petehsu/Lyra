import { describe, expect, test } from "vitest";

import { buildWorkspaceTabPageCitation } from "../workspace-tab-citation";
import type { WorkspaceTab } from "../../../../../workspace-tabs/types";

const tab = (overrides?: Partial<WorkspaceTab>): WorkspaceTab => ({
  id: "tab-42",
  title: "Docs",
  pageKind: "page",
  inputValue: "",
  displayAddress: "https://example.com/docs",
  faviconUrl: undefined,
  query: undefined,
  ...overrides
});

describe("workspace-tab-citation", () => {
  test("attaches tab id and url without page body", () => {
    const citation = buildWorkspaceTabPageCitation(tab());
    expect(citation.quotedText).toBe("Docs\nhttps://example.com/docs\ntab-42");
    expect(citation.tabId).toBe("tab-42");
    expect(citation.pageUrl).toBe("https://example.com/docs");
    expect(citation.truncated).toBe(false);
  });
});
