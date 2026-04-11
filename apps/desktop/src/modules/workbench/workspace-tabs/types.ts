import type { WorkbenchAppId, WorkspaceAppIconKey } from "../workspace-apps";
import type { WorkbenchSplitOverflowPolicy } from "../preferences";

export type WorkspaceTabPageKind =
  | "search"
  | "results"
  | "page"
  | "settings"
  | "terminal"
  | "app";

export type WorkspaceSearchMode = "standard" | "deep";

export type WorkspaceTab = {
  readonly id: string;
  readonly title: string;
  readonly pageKind: WorkspaceTabPageKind;
  readonly inputValue: string;
  readonly displayAddress: string;
  readonly faviconUrl: string | undefined;
  readonly query: string | undefined;
  readonly searchMode?: WorkspaceSearchMode;
  readonly resultMode?: WorkspaceSearchMode;
  readonly terminalTabId?: string;
  readonly appId?: WorkbenchAppId;
  readonly appInstanceId?: string;
  readonly appIconKey?: WorkspaceAppIconKey;
  readonly filePath?: string;
  readonly fileSessionId?: string;
  readonly isDirty?: boolean;
};

export type WorkspaceTabPageMeta = {
  readonly title?: string;
  readonly faviconUrl?: string;
};

export type WorkspaceTabPageRuntimeState = {
  readonly address: string;
  readonly title: string;
  readonly faviconUrl?: string;
};

export type WorkspaceResolvedNavigation =
  | {
      readonly kind: "home";
    }
  | {
      readonly kind: "page";
      readonly address: string;
    }
  | {
      readonly kind: "search";
      readonly query: string;
      readonly mode: WorkspaceSearchMode;
    };

export type WorkspaceNavigationTarget = "active-tab" | "new-tab";

export type WorkspaceTabInsertOptions = {
  readonly targetIndex?: number;
};

export type WorkspaceAppTabOpenRequest = {
  readonly appId: WorkbenchAppId;
  readonly appInstanceId: string;
  readonly title: string;
  readonly iconKey: WorkspaceAppIconKey;
  readonly filePath?: string;
  readonly fileSessionId?: string;
  readonly isDirty?: boolean;
};

export type WorkspaceAppTabMetaRequest = {
  readonly appId: WorkbenchAppId;
  readonly appInstanceId: string;
  readonly title: string;
  readonly iconKey: WorkspaceAppIconKey;
  readonly filePath?: string;
  readonly fileSessionId?: string;
  readonly isDirty?: boolean;
};

export type WorkspaceTabsState = {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string;
  readonly activeTab: WorkspaceTab | undefined;
  readonly splitGroupTabIds: readonly string[];
  readonly focusedSplitTabId: string | null;
};

export type WorkspaceVisibleLayout =
  | {
      readonly mode: "single";
      readonly activeTabId: string;
      readonly visibleTabIds: readonly string[];
      readonly splitGroupTabIds: readonly string[];
      readonly focusedSplitTabId: string | null;
    }
  | {
      readonly mode: "split";
      readonly activeTabId: string;
      readonly visibleTabIds: readonly string[];
      readonly splitGroupTabIds: readonly string[];
      readonly focusedSplitTabId: string;
    };

export type WorkspaceTabsSessionSnapshot = {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string;
  readonly splitGroupTabIds: readonly string[];
  readonly focusedSplitTabId: string | null;
};

export type WorkspaceTabsActions = {
  readonly setActiveTab: (tabId: string) => void;
  readonly reorderTab: (tabId: string, targetIndex: number) => void;
  readonly splitTabWithTarget: (sourceTabId: string, targetTabId: string) => void;
  readonly detachTabFromSplit: (tabId: string) => void;
  readonly isTabInSplit: (tabId: string) => boolean;
  readonly getVisibleWorkspaceLayout: () => WorkspaceVisibleLayout;
  readonly snapshotWorkspaceSession: () => WorkspaceTabsSessionSnapshot;
  readonly restoreWorkspaceSession: (snapshot: WorkspaceTabsSessionSnapshot) => void;
  readonly openNewTab: () => void;
  readonly openSettingsTab: () => void;
  readonly openTerminalTab: (
    terminalTabId: string,
    title: string,
    options?: WorkspaceTabInsertOptions
  ) => void;
  readonly openAppTab: (request: WorkspaceAppTabOpenRequest) => void;
  readonly updateAppTabMeta: (request: WorkspaceAppTabMetaRequest) => void;
  readonly closeTerminalTab: (terminalTabId: string) => void;
  readonly openPageInNewTab: (address: string, title?: string) => void;
  readonly closeTab: (tabId: string) => void;
  readonly updatePageMeta: (tabId: string, meta: WorkspaceTabPageMeta) => void;
  readonly syncPageRuntimeState: (
    tabId: string,
    state: WorkspaceTabPageRuntimeState
  ) => void;
  readonly navigateResolvedInput: (
    request: WorkspaceResolvedNavigation,
    options?: {
      readonly target?: WorkspaceNavigationTarget;
    }
  ) => string;
  readonly updateActiveInput: (value: string) => void;
  readonly setActiveSearchMode: (mode: WorkspaceSearchMode) => void;
  readonly commitActiveInput: () => void;
};

export type WorkspaceTabsModel = WorkspaceTabsState & WorkspaceTabsActions;

export type WorkspaceTabsConfig = {
  readonly homeTabTitle: string;
  readonly settingsTabTitle: string;
  readonly homeSearchAddress: string;
  readonly maxSearchTitleLength: number;
};

export type WorkspaceTabsOptions = {
  readonly splitOverflowPolicy: WorkbenchSplitOverflowPolicy;
};
