import { describe, expect, test } from "vitest";

import { buildWorkspaceTabPageCitation, citedImageViewerAttachment } from "../workspace-tab-citation";
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

  test("cites an image viewer tab as the open file, with the tab identity", () => {
    const imageTab = tab({
      pageKind: "app",
      appId: "image-viewer",
      title: "diagram.png",
      filePath: "/tmp/diagram.png",
      displayAddress: "lyra://app/image-viewer/image-1"
    });
    const image = citedImageViewerAttachment(imageTab);
    expect(image).toMatchObject({
      label: "diagram.png",
      source: "/tmp/diagram.png",
      mediaType: "image/png",
      workspaceTabId: "tab-42",
      workspaceTabTitle: "diagram.png",
      workspaceTabPageKind: "image-viewer",
      workspaceTabAddress: "/tmp/diagram.png"
    });
    expect(citedImageViewerAttachment(tab())).toBeNull();
    expect(citedImageViewerAttachment(tab({
      pageKind: "app",
      appId: "image-viewer",
      filePath: "/tmp/notes.txt"
    }))).toBeNull();
  });
});
