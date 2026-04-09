import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";

import type { WorkspaceTabsConfig } from "../types";
import { useWorkspaceTabsModel } from "../service";
import { resetWorkbenchStateStorageForTests } from "../../state-storage";

const testConfig: WorkspaceTabsConfig = {
  homeTabTitle: "首页",
  settingsTabTitle: "设置",
  homeSearchAddress: "lyra://search",
  maxSearchTitleLength: 18
};

describe("workspace tabs model", () => {
  beforeEach(() => {
    resetWorkbenchStateStorageForTests();
  });

  test("opens and closes real tabs", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    expect(result.current.tabs).toHaveLength(1);

    act(() => {
      result.current.openNewTab();
    });

    expect(result.current.tabs).toHaveLength(2);
    const closingTabId = result.current.activeTabId;

    act(() => {
      result.current.closeTab(closingTabId);
    });

    expect(result.current.tabs).toHaveLength(1);
  });

  test("commits active input as page url", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.updateActiveInput("example.com/docs");
      result.current.commitActiveInput();
    });

    expect(result.current.activeTab?.pageKind).toBe("page");
    expect(result.current.activeTab?.displayAddress).toBe(
      "https://example.com/docs"
    );
    expect(result.current.activeTab?.title).toBe("example.com/docs");
  });

  test("opens search result in a new page tab", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openPageInNewTab("https://example.com/path?q=1", "Example Result");
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTab?.pageKind).toBe("page");
    expect(result.current.activeTab?.displayAddress).toBe(
      "https://example.com/path?q=1"
    );
    expect(result.current.activeTab?.title).toBe("Example Result");
  });

  test("opens settings as singleton tab", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openSettingsTab();
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTab?.pageKind).toBe("settings");

    const firstSettingsTabId = result.current.activeTabId;

    act(() => {
      result.current.openSettingsTab();
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe(firstSettingsTabId);
  });

  test("opens terminal tab as singleton by terminalTabId", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openTerminalTab("terminal-tab-1", "Terminal 1");
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTab?.pageKind).toBe("terminal");
    expect(result.current.activeTab?.terminalTabId).toBe("terminal-tab-1");

    const firstTerminalTabId = result.current.activeTabId;

    act(() => {
      result.current.openTerminalTab("terminal-tab-1", "Terminal 1");
    });

    expect(result.current.tabs).toHaveLength(2);
    expect(result.current.activeTabId).toBe(firstTerminalTabId);
  });

  test("inserts dropped terminal tab at requested target index", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openNewTab();
      result.current.openNewTab();
      result.current.openTerminalTab("terminal-tab-1", "Terminal 1", {
        targetIndex: 1
      });
    });

    const orderedKinds = result.current.tabs.map((tab) => tab.pageKind);
    expect(orderedKinds).toEqual(["search", "terminal", "search", "search"]);
    expect(result.current.tabs[1]?.terminalTabId).toBe("terminal-tab-1");
  });

  test("reorders existing workspace tab by drag target index", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openNewTab();
      result.current.openSettingsTab();
    });

    const settingsTab = result.current.tabs.find((tab) => tab.pageKind === "settings");
    expect(settingsTab).toBeDefined();

    act(() => {
      result.current.reorderTab(settingsTab!.id, 0);
    });

    expect(result.current.tabs[0]?.pageKind).toBe("settings");
  });

  test("keeps split tabs contiguous during reorder", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openNewTab();
      result.current.openNewTab();
      result.current.openNewTab();
    });

    const tabA = result.current.tabs[1]?.id ?? "";
    const splitLeft = result.current.tabs[2]?.id ?? "";
    const splitRight = result.current.tabs[3]?.id ?? "";

    expect(tabA.length > 0).toBe(true);
    expect(splitLeft.length > 0).toBe(true);
    expect(splitRight.length > 0).toBe(true);

    act(() => {
      result.current.splitTabWithTarget(splitRight, splitLeft);
      result.current.reorderTab(tabA, 3);
    });

    const splitLeftIndex = result.current.tabs.findIndex((tab) => tab.id === splitLeft);
    const splitRightIndex = result.current.tabs.findIndex((tab) => tab.id === splitRight);
    expect(Math.abs(splitLeftIndex - splitRightIndex)).toBe(1);
  });

  test("reorders split tabs as one block when dragging a tab in the group", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openNewTab();
      result.current.openNewTab();
      result.current.openNewTab();
      result.current.openNewTab();
    });

    const baselineOrder = result.current.tabs.map((tab) => tab.id);
    const initialTab = baselineOrder[0] ?? "";
    const beforeTab = baselineOrder[1] ?? "";
    const splitLeft = baselineOrder[2] ?? "";
    const splitRight = baselineOrder[3] ?? "";
    const trailingTab = baselineOrder[4] ?? "";

    expect(initialTab.length > 0).toBe(true);
    expect(beforeTab.length > 0).toBe(true);
    expect(splitLeft.length > 0).toBe(true);
    expect(splitRight.length > 0).toBe(true);
    expect(trailingTab.length > 0).toBe(true);

    act(() => {
      result.current.splitTabWithTarget(splitRight, splitLeft);
      result.current.reorderTab(splitRight, 0);
    });

    expect(result.current.tabs.map((tab) => tab.id)).toEqual([
      splitLeft,
      splitRight,
      initialTab,
      beforeTab,
      trailingTab
    ]);
  });

  test("opens app tabs as independent instances and updates their metadata", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openAppTab({
        appId: "file-manager",
        appInstanceId: "file-manager-1",
        title: "文件管理",
        iconKey: "file-manager-home"
      });
      result.current.openAppTab({
        appId: "file-manager",
        appInstanceId: "file-manager-2",
        title: "文件管理",
        iconKey: "file-manager-home"
      });
    });

    expect(result.current.tabs).toHaveLength(3);
    expect(
      result.current.tabs.filter((tab) => tab.pageKind === "app")
    ).toHaveLength(2);

    act(() => {
      result.current.updateAppTabMeta({
        appId: "file-manager",
        appInstanceId: "file-manager-2",
        title: "Documents",
        iconKey: "file-manager-directory-non-empty"
      });
    });

    expect(
      result.current.tabs.find((tab) => tab.appInstanceId === "file-manager-2")
    ).toMatchObject({
      title: "Documents",
      appIconKey: "file-manager-directory-non-empty"
    });
    expect(
      result.current.tabs.find((tab) => tab.appInstanceId === "file-manager-1")
    ).toMatchObject({
      title: "文件管理",
      appIconKey: "file-manager-home"
    });
  });

  test("opens ai-mcp app tab as a singleton for the same app instance", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openAppTab({
        appId: "ai-mcp",
        appInstanceId: "ai-mcp-center",
        title: "MCP",
        iconKey: "ai-panel-mcp"
      });
    });

    const firstMcpTabId = result.current.activeTabId;

    act(() => {
      result.current.openNewTab();
    });

    expect(result.current.tabs).toHaveLength(3);

    act(() => {
      result.current.openAppTab({
        appId: "ai-mcp",
        appInstanceId: "ai-mcp-center",
        title: "MCP",
        iconKey: "ai-panel-mcp"
      });
    });

    expect(
      result.current.tabs.filter(
        (tab) => tab.pageKind === "app" && tab.appId === "ai-mcp"
      )
    ).toHaveLength(1);
    expect(result.current.tabs).toHaveLength(3);
    expect(result.current.activeTabId).toBe(firstMcpTabId);
  });

  test("opens ai-history app tab as a singleton for the same app instance", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openAppTab({
        appId: "ai-history",
        appInstanceId: "ai-history-center",
        title: "History",
        iconKey: "ai-panel-history"
      });
    });

    const firstHistoryTabId = result.current.activeTabId;

    act(() => {
      result.current.openNewTab();
    });

    expect(result.current.tabs).toHaveLength(3);

    act(() => {
      result.current.openAppTab({
        appId: "ai-history",
        appInstanceId: "ai-history-center",
        title: "History",
        iconKey: "ai-panel-history"
      });
    });

    expect(
      result.current.tabs.filter(
        (tab) => tab.pageKind === "app" && tab.appId === "ai-history"
      )
    ).toHaveLength(1);
    expect(result.current.tabs).toHaveLength(3);
    expect(result.current.activeTabId).toBe(firstHistoryTabId);
  });

  test("opens ai-skills app tab as a singleton for the same app instance", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openAppTab({
        appId: "ai-skills",
        appInstanceId: "ai-skills-center",
        title: "Skills",
        iconKey: "ai-panel-skills"
      });
    });

    const firstSkillsTabId = result.current.activeTabId;

    act(() => {
      result.current.openNewTab();
    });

    expect(result.current.tabs).toHaveLength(3);

    act(() => {
      result.current.openAppTab({
        appId: "ai-skills",
        appInstanceId: "ai-skills-center",
        title: "Skills",
        iconKey: "ai-panel-skills"
      });
    });

    expect(
      result.current.tabs.filter(
        (tab) => tab.pageKind === "app" && tab.appId === "ai-skills"
      )
    ).toHaveLength(1);
    expect(result.current.tabs).toHaveLength(3);
    expect(result.current.activeTabId).toBe(firstSkillsTabId);
  });

  test("updates page tab metadata from webview events", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openPageInNewTab("https://example.com/path?q=1", "Example Result");
    });

    const pageTabId = result.current.activeTabId;

    act(() => {
      result.current.updatePageMeta(pageTabId, {
        title: "Example Official",
        faviconUrl: "https://example.com/favicon.ico"
      });
    });

    expect(result.current.activeTab?.title).toBe("Example Official");
    expect(result.current.activeTab?.faviconUrl).toBe(
      "https://example.com/favicon.ico"
    );
  });

  test("updates settings tab title when config title changes", () => {
    const { result, rerender } = renderHook(
      ({ config }) => useWorkspaceTabsModel(config),
      {
        initialProps: {
          config: testConfig
        }
      }
    );

    act(() => {
      result.current.openSettingsTab();
    });

    expect(result.current.activeTab?.title).toBe("设置");

    rerender({
      config: {
        ...testConfig,
        settingsTabTitle: "Settings"
      }
    });

    expect(result.current.activeTab?.title).toBe("Settings");
  });

  test("splits tabs and keeps split group when switching to outside tab", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openNewTab();
    });
    const firstTabId = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const secondTabId = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const outsideTabId = result.current.activeTabId;
    act(() => {
      result.current.splitTabWithTarget(secondTabId, firstTabId);
    });

    expect(result.current.getVisibleWorkspaceLayout().mode).toBe("split");
    expect(result.current.splitGroupTabIds).toEqual([firstTabId, secondTabId]);
    expect(result.current.focusedSplitTabId).toBe(secondTabId);

    act(() => {
      result.current.setActiveTab(outsideTabId);
    });

    expect(result.current.getVisibleWorkspaceLayout().mode).toBe("single");
    expect(result.current.splitGroupTabIds).toEqual([firstTabId, secondTabId]);

    act(() => {
      result.current.setActiveTab(firstTabId);
    });

    expect(result.current.getVisibleWorkspaceLayout().mode).toBe("split");
    expect(result.current.focusedSplitTabId).toBe(firstTabId);
  });

  test("detaches a tab from split and keeps remaining split in background", () => {
    const { result } = renderHook(() =>
      useWorkspaceTabsModel(testConfig, { splitOverflowPolicy: "replace_oldest" })
    );

    act(() => {
      result.current.openNewTab();
    });
    const tabA = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabB = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabC = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabD = result.current.activeTabId;
    act(() => {
      result.current.splitTabWithTarget(tabB, tabA);
      result.current.splitTabWithTarget(tabC, tabA);
      result.current.splitTabWithTarget(tabD, tabA);
      result.current.detachTabFromSplit(tabC);
    });

    expect(result.current.activeTabId).toBe(tabC);
    expect(result.current.splitGroupTabIds).toEqual([tabA, tabB, tabD]);
    expect(result.current.getVisibleWorkspaceLayout().mode).toBe("single");

    act(() => {
      result.current.setActiveTab(tabA);
    });

    expect(result.current.getVisibleWorkspaceLayout().mode).toBe("split");
    expect(result.current.getVisibleWorkspaceLayout().visibleTabIds).toEqual([
      tabA,
      tabB,
      tabD
    ]);
  });

  test("supports split overflow policy replace_target", () => {
    const { result } = renderHook(() =>
      useWorkspaceTabsModel(testConfig, { splitOverflowPolicy: "replace_target" })
    );

    act(() => {
      result.current.openNewTab();
    });
    const tabA = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabB = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabC = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabD = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabE = result.current.activeTabId;
    act(() => {
      result.current.splitTabWithTarget(tabB, tabA);
      result.current.splitTabWithTarget(tabC, tabA);
      result.current.splitTabWithTarget(tabD, tabA);
      result.current.splitTabWithTarget(tabE, tabA);
    });

    expect(result.current.splitGroupTabIds).toEqual([tabB, tabC, tabD, tabE]);
  });

  test("blocks split when overflow policy is block_with_notice", () => {
    const { result } = renderHook(() =>
      useWorkspaceTabsModel(testConfig, { splitOverflowPolicy: "block_with_notice" })
    );

    act(() => {
      result.current.openNewTab();
    });
    const tabA = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabB = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabC = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabD = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabE = result.current.activeTabId;
    act(() => {
      result.current.splitTabWithTarget(tabB, tabA);
      result.current.splitTabWithTarget(tabC, tabA);
      result.current.splitTabWithTarget(tabD, tabA);
      result.current.splitTabWithTarget(tabE, tabA);
    });

    expect(result.current.splitGroupTabIds).toEqual([tabA, tabB, tabC, tabD]);
  });

  test("restores workspace snapshot with split state", () => {
    const { result } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      result.current.openNewTab();
    });
    const tabA = result.current.activeTabId;
    act(() => {
      result.current.openNewTab();
    });
    const tabB = result.current.activeTabId;
    act(() => {
      result.current.splitTabWithTarget(tabB, tabA);
    });

    const snapshot = result.current.snapshotWorkspaceSession();
    const { result: restored } = renderHook(() => useWorkspaceTabsModel(testConfig));

    act(() => {
      restored.current.restoreWorkspaceSession(snapshot);
    });

    expect(restored.current.tabs).toHaveLength(result.current.tabs.length);
    expect(restored.current.splitGroupTabIds).toEqual([tabA, tabB]);
    expect(restored.current.activeTabId).toBe(tabB);
    expect(restored.current.getVisibleWorkspaceLayout().mode).toBe("split");
  });
});
