import { describe, expect, test } from "vitest";

import {
  createNavigationTab,
  looksLikeUrl,
  resolveReplacementTab,
  toSafeAddress
} from "../navigation";
import { createAppTabWithId } from "../tab-factory";
import type { WorkspaceTabsConfig } from "../types";

const testConfig: WorkspaceTabsConfig = {
  homeTabTitle: "Home",
  settingsTabTitle: "Settings",
  homeSearchAddress: "lyra://search",
  maxSearchTitleLength: 12
};

describe("workspace tab navigation helpers", () => {
  test("normalizes browser-like addresses without accepting malformed urls", () => {
    expect(looksLikeUrl("example.com/docs")).toBe(true);
    expect(looksLikeUrl("http://localhost:3000")).toBe(true);
    expect(looksLikeUrl("plain search text")).toBe(false);

    expect(toSafeAddress(" example.com/docs ")).toBe("https://example.com/docs");
    expect(toSafeAddress("https://example.com/docs?q=1")).toBe(
      "https://example.com/docs?q=1"
    );
    expect(toSafeAddress("http://exa mple.com")).toBeNull();
  });

  test("replacing an app tab with navigation keeps the tab id and drops app metadata", () => {
    const current = createAppTabWithId("browser-tab-9", {
      appId: "file-editor",
      appInstanceId: "file-editor-1",
      title: "notes.md",
      iconKey: "file-editor-code",
      filePath: "/tmp/notes.md",
      fileSessionId: "session-1",
      isDirty: true
    });

    const replacement = resolveReplacementTab(
      current,
      {
        kind: "page",
        address: "https://example.com/docs"
      },
      testConfig
    );

    expect(replacement).toMatchObject({
      id: "browser-tab-9",
      pageKind: "page",
      displayAddress: "https://example.com/docs"
    });
    expect(replacement.appId).toBeUndefined();
    expect(replacement.appInstanceId).toBeUndefined();
    expect(replacement.filePath).toBeUndefined();
    expect(replacement.fileSessionId).toBeUndefined();
    expect(replacement.isDirty).toBeUndefined();
  });

  test("creates standalone tabs for resolved navigation targets", () => {
    expect(createNavigationTab(3, { kind: "home" }, testConfig)).toMatchObject({
      id: "browser-tab-3",
      pageKind: "search",
      title: "Home"
    });

    expect(
      createNavigationTab(
        4,
        {
          kind: "search",
          query: "workspace custom chrome",
          mode: "deep"
        },
        testConfig
      )
    ).toMatchObject({
      id: "browser-tab-4",
      pageKind: "results",
      title: "workspace cu...",
      resultMode: "deep"
    });
  });
});
