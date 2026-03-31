import { create } from "zustand";

import type { WorkbenchTab } from "../shell/types";
import type { TabStore } from "./types";

const seedTabs: readonly WorkbenchTab[] = [
  {
    id: "tab-editor-service",
    title: "service.ts",
    subtitle: "src/checkout/service.ts",
    type: "editor",
    pinned: false,
    dirty: true
  },
  {
    id: "tab-browser-checkout",
    title: "localhost:3000",
    subtitle: "/checkout",
    type: "browser",
    pinned: false,
    dirty: false
  },
  {
    id: "tab-plugin-v2ray",
    title: "v2ray-control",
    subtitle: "plugins/v2ray-bridge",
    type: "plugin",
    pinned: false,
    dirty: false
  }
];

const createId = (prefix: string): string => {
  const randomPart = Math.random().toString(16).slice(2, 8);
  return `${prefix}-${Date.now()}-${randomPart}`;
};

const clampRecentlyClosed = (tabs: readonly WorkbenchTab[]): readonly WorkbenchTab[] => tabs.slice(0, 12);

const resolveNextActiveTabId = (
  currentTabs: readonly WorkbenchTab[],
  currentActiveTabId: string,
  removeIndex: number
): string => {
  if (currentTabs.length <= 1) {
    return currentActiveTabId;
  }

  const removedTab = currentTabs[removeIndex];
  if (removedTab === undefined) {
    return currentActiveTabId;
  }

  if (removedTab.id === currentActiveTabId) {
    const nextIndex = removeIndex > 0 ? removeIndex - 1 : 1;
    const fallbackTab = currentTabs[nextIndex];
    return fallbackTab === undefined ? currentActiveTabId : fallbackTab.id;
  }

  return currentActiveTabId;
};

export const useTabStore = create<TabStore>()((set, get) => ({
  tabs: seedTabs,
  activeTabId: seedTabs[0]?.id ?? "",
  recentlyClosed: [],
  activateTab: (tabId) => {
    const tabExists = get().tabs.some((tab) => tab.id === tabId);
    if (tabExists === false) {
      return;
    }
    set({ activeTabId: tabId });
  },
  openTab: (tab) => {
    const current = get();
    set({
      tabs: [...current.tabs, tab],
      activeTabId: tab.id
    });
  },
  closeTab: (tabId) => {
    const current = get();
    const removeIndex = current.tabs.findIndex((tab) => tab.id === tabId);

    if (removeIndex < 0) {
      return;
    }

    const removed = current.tabs[removeIndex];
    if (removed === undefined) {
      return;
    }

    const nextActiveId = resolveNextActiveTabId(current.tabs, current.activeTabId, removeIndex);
    const nextTabs = current.tabs.filter((tab) => tab.id !== tabId);

    if (nextTabs.length === 0) {
      return;
    }

    set({
      tabs: nextTabs,
      activeTabId: nextActiveId,
      recentlyClosed: clampRecentlyClosed([removed, ...current.recentlyClosed])
    });
  },
  restoreClosedTab: () => {
    const current = get();
    const restored = current.recentlyClosed[0];
    if (restored === undefined) {
      return;
    }

    set({
      tabs: [...current.tabs, restored],
      activeTabId: restored.id,
      recentlyClosed: current.recentlyClosed.slice(1)
    });
  },
  createPluginTab: () => {
    const tab: WorkbenchTab = {
      id: createId("tab-plugin"),
      title: `plugin-${Math.floor(Math.random() * 90 + 10)}`,
      subtitle: "plugins/new-module",
      type: "plugin",
      pinned: false,
      dirty: false
    };

    get().openTab(tab);
  }
}));
