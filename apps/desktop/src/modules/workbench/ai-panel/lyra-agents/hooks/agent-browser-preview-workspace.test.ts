import { afterEach, describe, expect, test } from "vitest";

import {
  destroyAgentBrowserPreviewWatch,
  ensureParkedAgentBrowserPage,
  isAgentBrowserPreviewWatchTab,
  parkAgentBrowserPreviewTabOnClose,
  promoteAgentBrowserPreviewTab,
  registerAgentBrowserPreviewWorkspace,
  resetAgentBrowserPreviewWorkspaceForTests,
  setAgentBrowserPreviewWatchTabIds
} from "./agent-browser-preview-workspace";

describe("agent browser preview workspace", () => {
  afterEach(() => {
    resetAgentBrowserPreviewWorkspaceForTests();
  });

  test("parks watched page tabs and promotes them back", () => {
    const parked: { tabId: string; address: string; titleHint?: string }[] = [];
    const closed: string[] = [];
    setAgentBrowserPreviewWatchTabIds(["tab-live"]);
    registerAgentBrowserPreviewWorkspace({
      parkTabIfWatched: (tabId, tab) => {
        parked.push({
          tabId,
          address: tab.displayAddress,
          titleHint: tab.title
        });
        return true;
      },
      ensureParked: (page) => {
        parked.push({
          tabId: page.tabId,
          address: page.address,
          ...(page.titleHint === undefined ? {} : { titleHint: page.titleHint })
        });
      },
      promoteOrActivate: (tabId) => parked.some((page) => page.tabId === tabId),
      destroyWatch: (tabIds) => {
        closed.push(...tabIds);
      }
    });

    expect(
      parkAgentBrowserPreviewTabOnClose("tab-live", {
        pageKind: "page",
        displayAddress: "https://example.com",
        title: "Example"
      })
    ).toBe(true);
    expect(
      parkAgentBrowserPreviewTabOnClose("tab-other", {
        pageKind: "page",
        displayAddress: "https://example.com/other",
        title: "Other"
      })
    ).toBe(false);
    expect(promoteAgentBrowserPreviewTab("tab-live")).toBe(true);
    destroyAgentBrowserPreviewWatch(["tab-live"]);
    expect(closed).toEqual(["tab-live"]);
    expect(isAgentBrowserPreviewWatchTab("tab-live")).toBe(true);
  });

  test("ensures a live page is parked before it appears in the workspace", () => {
    const parked: { tabId: string; address: string; titleHint?: string }[] = [];
    registerAgentBrowserPreviewWorkspace({
      parkTabIfWatched: () => false,
      ensureParked: (page) => {
        parked.push({
          tabId: page.tabId,
          address: page.address,
          ...(page.titleHint === undefined ? {} : { titleHint: page.titleHint })
        });
      },
      promoteOrActivate: (tabId) => parked.some((page) => page.tabId === tabId),
      destroyWatch: () => undefined
    });

    ensureParkedAgentBrowserPage({
      tabId: "browser-agent-1",
      address: "https://example.com",
      titleHint: "Example"
    });
    expect(parked).toEqual([
      {
        tabId: "browser-agent-1",
        address: "https://example.com",
        titleHint: "Example"
      }
    ]);
    expect(isAgentBrowserPreviewWatchTab("browser-agent-1")).toBe(true);
    expect(promoteAgentBrowserPreviewTab("browser-agent-1")).toBe(true);
  });
});
