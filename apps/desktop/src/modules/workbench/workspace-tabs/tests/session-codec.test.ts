import { beforeEach, describe, expect, test } from "vitest";

import {
  sanitizeBrowserSessionSnapshot,
  WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION
} from "../../../../shared/workbench-browser";
import {
  readWorkbenchStateSync,
  resetWorkbenchStateStorageForTests,
  writeWorkbenchStateSync
} from "../../state-storage";
import {
  readPersistedState,
  writePersistedState
} from "../session-codec";
import type { WorkspaceTabsConfig } from "../types";

const config: WorkspaceTabsConfig = {
  homeTabTitle: "Home",
  settingsTabTitle: "Settings",
  homeSearchAddress: "lyra://search",
  maxSearchTitleLength: 48
};

describe("workspace browser session codec", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
  });

  test("persists full browser restore state without falling back to renderer localStorage", () => {
    writePersistedState({
      tabs: [
        {
          id: "browser-tab-1",
          title: "Example",
          pageKind: "page",
          inputValue: "https://example.com/",
          displayAddress: "https://example.com/",
          faviconUrl: undefined,
          query: undefined,
          browserRestoreState: {
            scrollX: 12,
            scrollY: 480,
            viewport: {
              width: 1280,
              height: 720,
              deviceScaleFactor: 2
            },
            history: {
              currentIndex: 1,
              entries: [
                {
                  url: "https://example.com/login",
                  title: "Login",
                  timestamp: 101
                },
                {
                  url: "https://example.com/dashboard",
                  title: "Dashboard",
                  timestamp: 102
                }
              ]
            },
            activeElement: {
              targetRef: "lumen:abc",
              signature: "sig",
              tagName: "input",
              inputType: "text",
              cssSelector: "input[name=\"q\"]"
            },
            formDraft: {
              redacted: true,
              fieldCount: 2,
              editedFieldCount: 1,
              passwordFieldCount: 1,
              sensitiveFieldCount: 1,
              fields: [
                {
                  targetRef: "field:q",
                  tagName: "input",
                  inputType: "text",
                  dirty: true,
                  sensitive: false,
                  valueLength: 12
                },
                {
                  targetRef: "field:password",
                  tagName: "input",
                  inputType: "password",
                  dirty: true,
                  sensitive: true
                }
              ]
            },
            storage: {
              origin: "https://example.com",
              cookieCount: 2,
              localStorage: "available",
              sessionStorage: "unavailable",
              indexedDB: "unknown",
              capturedAt: 100
            },
            textHash: "text-hash",
            capturedAt: 1234
          }
        }
      ],
      activeTabId: "browser-tab-1",
      splitGroupTabIds: [],
      focusedSplitTabId: null
    });

    const raw = readWorkbenchStateSync("workspace-tabs");
    expect(raw).not.toBeNull();
    expect(raw).toContain("\"browserRestoreState\"");

    const restored = readPersistedState(config);
    expect(restored.tabs[0]?.browserRestoreState).toMatchObject({
      scrollY: 480,
      history: {
        currentIndex: 1
      },
      formDraft: {
        redacted: true,
        sensitiveFieldCount: 1
      },
      storage: {
        origin: "https://example.com",
        cookieCount: 2
      },
      textHash: "text-hash"
    });
    expect(JSON.stringify(restored)).not.toContain("secret");
  });

  test("drops legacy terminal memory app tabs", () => {
    writeWorkbenchStateSync("workspace-tabs", JSON.stringify({
      tabs: [
        {
          id: "app-tab-1",
          title: "Terminal Memory",
          pageKind: "app",
          inputValue: "",
          displayAddress: "lyra://app/terminal-memory/terminal-memory-session-1",
          faviconUrl: undefined,
          query: undefined,
          appId: "terminal-memory",
          appInstanceId: "terminal-memory-session-1",
          appIconKey: "terminal-memory-default",
          fileSessionId: "terminal-session-1"
        }
      ],
      activeTabId: "app-tab-1",
      splitGroupTabIds: [],
      focusedSplitTabId: null
    }));

    const restored = readPersistedState(config);
    expect(restored.tabs[0]).toMatchObject({
      pageKind: "search",
      title: "Home"
    });
    expect(JSON.stringify(restored)).not.toContain("terminal-memory");
  });

  test("migrates legacy browser session snapshots to the schema-versioned model", () => {
    const migrated = sanitizeBrowserSessionSnapshot({
      schemaVersion: 0,
      snapshotId: "legacy",
      capturedAt: 20,
      activeTabId: "browser-tab-1",
      layout: {
        windowWidth: 1440,
        windowHeight: 900,
        layouts: []
      },
      tabs: [
        {
          tabId: "browser-tab-1",
          address: "https://example.com/",
          title: "Example",
          isActive: true,
          canGoBack: false,
          canGoForward: true,
          profilePartition: WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
          restoreState: {
            scrollX: 0,
            scrollY: 220,
            capturedAt: 10
          }
        }
      ]
    });

    expect(migrated).toMatchObject({
      schemaVersion: 1,
      snapshotId: "legacy",
      activeTabId: "browser-tab-1",
      tabs: [
        {
          tabId: "browser-tab-1",
          restoreState: {
            scrollY: 220
          }
        }
      ]
    });
    expect(migrated?.migrations).toEqual([
      expect.objectContaining({
        fromVersion: 0,
        toVersion: 1
      })
    ]);
  });

  test("keeps tombstoned browser history scroll and focus restore metadata", () => {
    const snapshot = sanitizeBrowserSessionSnapshot({
      schemaVersion: 1,
      snapshotId: "tombstone-snapshot",
      capturedAt: 200,
      activeTabId: "browser-tab-1",
      layout: {
        windowWidth: 1440,
        windowHeight: 900,
        layouts: []
      },
      storageState: {
        schemaVersion: 1,
        profileId: "lyra-browser-live",
        profileMode: "live",
        profilePartition: WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
        persistence: "chromium-profile"
      },
      tabs: [
        {
          tabId: "browser-tab-1",
          address: "https://example.com/dashboard",
          title: "Dashboard",
          isActive: true,
          lifecycleState: "tombstoned",
          canGoBack: true,
          canGoForward: false,
          profilePartition: WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
          restoreState: {
            scrollX: 4,
            scrollY: 640,
            history: {
              currentIndex: 1,
              entries: [
                {
                  url: "https://example.com/login",
                  title: "Login",
                  timestamp: 100
                },
                {
                  url: "https://example.com/dashboard",
                  title: "Dashboard",
                  timestamp: 150
                }
              ]
            },
            activeElement: {
              targetRef: "lumen:search-box",
              signature: "input#search",
              tagName: "input",
              cssSelector: "input[name=\"search\"]"
            },
            targetRegistry: {
              warmed: true,
              targetCount: 12,
              activeTargetRef: "lumen:search-box",
              capturedAt: 180
            },
            textHash: "sha256:page-text",
            capturedAt: 190
          }
        }
      ]
    });

    expect(snapshot?.tabs[0]).toMatchObject({
      lifecycleState: "tombstoned",
      restoreState: {
        scrollY: 640,
        history: {
          currentIndex: 1,
          entries: [
            expect.objectContaining({ url: "https://example.com/login" }),
            expect.objectContaining({ url: "https://example.com/dashboard" })
          ]
        },
        activeElement: {
          targetRef: "lumen:search-box",
          cssSelector: "input[name=\"search\"]"
        },
        targetRegistry: {
          warmed: true,
          activeTargetRef: "lumen:search-box"
        }
      }
    });
  });
});
