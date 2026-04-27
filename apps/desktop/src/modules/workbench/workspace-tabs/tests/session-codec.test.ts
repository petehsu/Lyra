import { describe, expect, test } from "vitest";

import {
  resolveNextSerial,
  sanitizePersistedSnapshot,
  sanitizePersistedTab
} from "../session-codec";
import {
  createPageTabWithId,
  createSearchTabWithId,
  createSettingsTabWithId
} from "../tab-factory";
import type { WorkspaceTabsConfig } from "../types";

const testConfig: WorkspaceTabsConfig = {
  homeTabTitle: "Home",
  settingsTabTitle: "Settings",
  homeSearchAddress: "lyra://search",
  maxSearchTitleLength: 12
};

describe("workspace tabs session codec", () => {
  test("drops invalid persisted app tabs instead of restoring unknown surfaces", () => {
    expect(
      sanitizePersistedTab({
        id: "browser-tab-2",
        title: "Legacy App",
        pageKind: "app",
        inputValue: "",
        displayAddress: "lyra://app/legacy-app/legacy-1",
        appId: "legacy-app",
        appInstanceId: "legacy-1",
        appIconKey: "ai-panel-mcp"
      })
    ).toBeNull();
  });

  test("restores valid snapshots with normalized active and split state", () => {
    const firstTab = createSearchTabWithId("browser-tab-4", testConfig);
    const settingsTab = createSettingsTabWithId("browser-tab-9", testConfig);

    const restored = sanitizePersistedSnapshot(
      {
        tabs: [firstTab, settingsTab],
        activeTabId: "missing-tab",
        splitGroupTabIds: [
          "browser-tab-9",
          "missing-tab",
          "browser-tab-9",
          "browser-tab-4"
        ],
        focusedSplitTabId: "missing-tab"
      },
      testConfig
    );

    expect(restored).toMatchObject({
      activeTabId: "browser-tab-4",
      splitGroupTabIds: ["browser-tab-9", "browser-tab-4"],
      focusedSplitTabId: "browser-tab-9"
    });
    expect(restored?.tabs.map((tab) => tab.id)).toEqual([
      "browser-tab-4",
      "browser-tab-9"
    ]);
  });

  test("rejects snapshots that contain no restorable tabs", () => {
    expect(
      sanitizePersistedSnapshot(
        {
          tabs: [
            {
              id: "browser-tab-1",
              pageKind: "page",
              inputValue: "https://example.com",
              displayAddress: "https://example.com"
            }
          ],
          activeTabId: "browser-tab-1",
          splitGroupTabIds: [],
          focusedSplitTabId: null
        },
        testConfig
      )
    ).toBeNull();
  });

  test("resolves the next browser tab serial while ignoring external ids", () => {
    const tabs = [
      createSearchTabWithId("browser-tab-4", testConfig),
      createPageTabWithId("external-tab", "https://example.com"),
      createSettingsTabWithId("browser-tab-12", testConfig)
    ];

    expect(resolveNextSerial(tabs)).toBe(13);
  });
});
