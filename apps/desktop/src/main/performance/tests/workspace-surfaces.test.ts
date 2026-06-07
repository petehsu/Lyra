import { describe, expect, test, vi } from "vitest";

import {
  createLyraWorkspaceSurfacePerformanceSync,
  parseWorkspaceTabsSnapshot,
  workspaceTabToPerformanceResource
} from "../workspace-surfaces";
import type { LyraPerformanceResourceDescriptor } from "../../../shared/performance-kernel";
import type { LyraPerformanceResourceScheduler } from "../service";

const createWorkspaceTabsJson = (
  tabIds: readonly string[],
  activeTabId: string
): string => JSON.stringify({
  tabs: tabIds.map((id) => ({
    id,
    title: "首页",
	    pageKind: "search",
	    inputValue: "",
	    displayAddress: "lyra://search"
	  })),
  activeTabId,
  splitGroupTabIds: [],
  focusedSplitTabId: null
});

describe("workspace surface performance sync", () => {
  test("maps repeated home tabs to one reusable workspace core with independent state keys", () => {
    const snapshot = parseWorkspaceTabsSnapshot(
      createWorkspaceTabsJson(["browser-tab-1", "browser-tab-2", "browser-tab-3"], "browser-tab-2")
    );
    const resources = snapshot.tabs.map((tab) => workspaceTabToPerformanceResource(tab, snapshot, 1000));

    expect(resources).toHaveLength(3);
    expect(resources.map((resource) => resource.resourceId)).toEqual([
      "workspaceSurface:browser-tab-1",
      "workspaceSurface:browser-tab-2",
      "workspaceSurface:browser-tab-3"
    ]);
    expect(new Set(resources.map((resource) => resource.coreKey)).size).toBe(1);
    expect(new Set(resources.map((resource) => resource.stateKey)).size).toBe(3);
    expect(resources.find((resource) => resource.resourceId === "workspaceSurface:browser-tab-2")).toMatchObject({
      active: true,
      lifecycle: "foreground"
    });
    expect(resources.filter((resource) => resource.active === false)).toHaveLength(2);
  });

  test("maps every workspace tab kind into the performance kernel contract", () => {
    const snapshot = parseWorkspaceTabsSnapshot(JSON.stringify({
      tabs: [
        {
          id: "search-home",
          title: "首页",
          pageKind: "search",
          inputValue: "",
          displayAddress: "lyra://search"
        },
        {
          id: "search-results",
          title: "结果",
          pageKind: "results",
	          inputValue: "rust",
	          query: "rust",
	          displayAddress: "lyra://search?q=rust"
	        },
        {
          id: "web-page",
          title: "Example",
          pageKind: "page",
          inputValue: "https://example.com",
          displayAddress: "https://example.com"
        },
        {
          id: "settings",
          title: "设置",
          pageKind: "settings",
          inputValue: "",
          displayAddress: "lyra://settings"
        },
        {
          id: "terminal",
          title: "Terminal",
          pageKind: "terminal",
          inputValue: "",
          displayAddress: "lyra://terminal",
          terminalTabId: "terminal-tab-1"
        },
        {
          id: "plugin",
          title: "Plugin",
          pageKind: "app",
          inputValue: "",
          displayAddress: "lyra://app/custom/custom-1",
          appId: "custom-plugin",
          appInstanceId: "custom-1"
        }
      ],
      activeTabId: "web-page",
      splitGroupTabIds: ["terminal"],
      focusedSplitTabId: "terminal"
    }));
    const resources = snapshot.tabs.map((tab) => workspaceTabToPerformanceResource(tab, snapshot, 1000));

    expect(resources).toHaveLength(6);
    expect(resources.map((resource) => [resource.resourceId, resource.kind])).toEqual([
      ["workspaceSurface:search-home", "workspaceSurface"],
      ["workspaceSurface:search-results", "workspaceSurface"],
      ["workspaceSurface:web-page", "workspaceSurface"],
      ["workspaceSurface:settings", "workspaceSurface"],
      ["workspaceSurface:terminal", "terminalPane"],
      ["workspaceSurface:plugin", "pluginSurface"]
    ]);
    expect(resources.find((resource) => resource.resourceId === "workspaceSurface:web-page")).toMatchObject({
      active: true,
      lifecycle: "foreground"
    });
    expect(resources.find((resource) => resource.resourceId === "workspaceSurface:terminal")).toMatchObject({
      visible: true,
      active: true,
      isolation: {
        requiresDedicatedCore: true
      }
    });
    expect(resources.find((resource) => resource.resourceId === "workspaceSurface:plugin")).toMatchObject({
      isolation: {
        requiresDedicatedCore: true
      }
    });
  });

  test("syncs workspace tab additions and unregisters removed surfaces", () => {
    let json = createWorkspaceTabsJson(["browser-tab-1", "browser-tab-2"], "browser-tab-1");
    const listeners = new Set<(event: { readonly key: "workspace-tabs"; readonly json: string }) => void>();
    const updates: LyraPerformanceResourceDescriptor[] = [];
    const unregisterResource = vi.fn();
    const scheduler: LyraPerformanceResourceScheduler = {
      registerResource: (resource) => updates.push(resource),
      updateResource: (resource) => updates.push(resource),
      unregisterResource,
      status: async () => {
        throw new Error("status is not used by workspace surface sync tests");
      },
      readPressureSnapshot: async () => {
        throw new Error("readPressureSnapshot is not used by workspace surface sync tests");
      },
      runPressureHarness: async () => {
        throw new Error("runPressureHarness is not used by workspace surface sync tests");
      }
    };
    const sync = createLyraWorkspaceSurfacePerformanceSync({
      workbenchState: {
        readState: () => json,
        subscribe: (listener) => {
          listeners.add(listener as (event: { readonly key: "workspace-tabs"; readonly json: string }) => void);
          return () => listeners.clear();
        }
      },
      performanceScheduler: scheduler
    });

    expect(updates.map((resource) => resource.resourceId)).toEqual([
      "workspaceSurface:browser-tab-1",
      "workspaceSurface:browser-tab-2"
    ]);

    json = createWorkspaceTabsJson(["browser-tab-2"], "browser-tab-2");
    for (const listener of listeners) {
      listener({ key: "workspace-tabs", json });
    }

    expect(updates.at(-1)?.resourceId).toBe("workspaceSurface:browser-tab-2");
    expect(unregisterResource).toHaveBeenCalledWith("workspaceSurface:browser-tab-1");

    sync.dispose();
    expect(unregisterResource).toHaveBeenCalledWith("workspaceSurface:browser-tab-2");
  });
});
