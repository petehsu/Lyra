import type { WorkspaceTab } from "../../../workspace-tabs/types";

type AgentBrowserPreviewWorkspaceBridge = {
  readonly parkTabIfWatched: (
    tabId: string,
    tab: Pick<WorkspaceTab, "pageKind" | "displayAddress" | "title">
  ) => boolean;
  readonly ensureParked: (page: {
    readonly tabId: string;
    readonly address: string;
    readonly titleHint?: string;
  }) => void;
  readonly promoteOrActivate: (tabId: string) => boolean;
  readonly destroyWatch: (tabIds: readonly string[]) => void;
};

let watchTabIds = new Set<string>();
let workspaceBridge: AgentBrowserPreviewWorkspaceBridge | null = null;

export const setAgentBrowserPreviewWatchTabIds = (ids: readonly string[]): void => {
  watchTabIds = new Set(ids);
};

export const isAgentBrowserPreviewWatchTab = (tabId: string): boolean =>
  watchTabIds.has(tabId);

export const registerAgentBrowserPreviewWorkspace = (
  bridge: AgentBrowserPreviewWorkspaceBridge
): (() => void) => {
  workspaceBridge = bridge;
  return () => {
    if (workspaceBridge === bridge) {
      workspaceBridge = null;
    }
  };
};

export const parkAgentBrowserPreviewTabOnClose = (
  tabId: string,
  tab: Pick<WorkspaceTab, "pageKind" | "displayAddress" | "title"> | undefined
): boolean => {
  if (tab === undefined || tab.pageKind !== "page" || watchTabIds.has(tabId) === false) {
    return false;
  }
  return workspaceBridge?.parkTabIfWatched(tabId, tab) === true;
};

export const promoteAgentBrowserPreviewTab = (tabId: string): boolean =>
  workspaceBridge?.promoteOrActivate(tabId) === true;

export const ensureParkedAgentBrowserPage = (page: {
  readonly tabId: string;
  readonly address: string;
  readonly titleHint?: string;
}): void => {
  if (page.tabId.length === 0 || page.address.length === 0) {
    return;
  }
  watchTabIds = new Set([...watchTabIds, page.tabId]);
  workspaceBridge?.ensureParked(page);
};

export const destroyAgentBrowserPreviewWatch = (tabIds: readonly string[]): void => {
  workspaceBridge?.destroyWatch(tabIds);
};

export const resetAgentBrowserPreviewWorkspaceForTests = (): void => {
  watchTabIds = new Set();
  workspaceBridge = null;
};
