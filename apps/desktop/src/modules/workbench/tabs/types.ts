import type { WorkbenchTab } from "../shell/types";

export type TabState = {
  readonly tabs: readonly WorkbenchTab[];
  readonly activeTabId: string;
  readonly recentlyClosed: readonly WorkbenchTab[];
};

export type TabActions = {
  readonly activateTab: (tabId: string) => void;
  readonly openTab: (tab: WorkbenchTab) => void;
  readonly closeTab: (tabId: string) => void;
  readonly restoreClosedTab: () => void;
  readonly createPluginTab: () => void;
};

export type TabStore = TabState & TabActions;
