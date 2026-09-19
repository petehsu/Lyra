import { describe, expect, test } from "vitest";

import {
  applyCloseEditorTab,
  applyOpenEditorTab,
  applyPinEditorTab
} from "../open-editor-tab";

const createId = (filePath: string): string => `id:${filePath}`;

describe("applyOpenEditorTab", () => {
  test("reuses a preview tab for the next click-open", () => {
    const first = applyOpenEditorTab([], "/a.md", {
      pinned: false,
      createInstanceId: createId
    });
    const second = applyOpenEditorTab(first.tabs, "/b.md", {
      pinned: false,
      createInstanceId: createId
    });
    expect(second.tabs).toHaveLength(1);
    expect(second.tabs[0]?.filePath).toBe("/b.md");
    expect(second.tabs[0]?.preview).toBe(true);
    expect(second.activeEditorInstanceId).toBe(first.activeEditorInstanceId);
  });

  test("pins an existing preview and opens extra files as new tabs", () => {
    const first = applyOpenEditorTab([], "/a.md", {
      pinned: false,
      createInstanceId: createId
    });
    const pinned = applyOpenEditorTab(first.tabs, "/a.md", {
      pinned: true,
      createInstanceId: createId
    });
    expect(pinned.tabs[0]?.preview).toBe(false);
    const second = applyOpenEditorTab(pinned.tabs, "/b.md", {
      pinned: true,
      createInstanceId: createId
    });
    expect(second.tabs).toHaveLength(2);
    expect(second.tabs.map((tab) => tab.filePath)).toEqual(["/a.md", "/b.md"]);
  });
});

describe("applyCloseEditorTab", () => {
  test("activates the neighbor to the right", () => {
    const opened = applyOpenEditorTab([], "/a.md", {
      pinned: true,
      createInstanceId: createId
    });
    const two = applyOpenEditorTab(opened.tabs, "/b.md", {
      pinned: true,
      createInstanceId: createId
    });
    const closed = applyCloseEditorTab(
      two.tabs,
      opened.activeEditorInstanceId,
      opened.activeEditorInstanceId
    );
    expect(closed.tabs).toHaveLength(1);
    expect(closed.activeEditorInstanceId).toBe(two.activeEditorInstanceId);
  });
});

describe("applyPinEditorTab", () => {
  test("clears preview on the matching tab", () => {
    const opened = applyOpenEditorTab([], "/a.md", {
      pinned: false,
      createInstanceId: createId
    });
    const pinned = applyPinEditorTab(opened.tabs, opened.activeEditorInstanceId);
    expect(pinned[0]?.preview).toBe(false);
  });
});
