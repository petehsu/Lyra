import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction
} from "react";

import type { BrowserTabStripProps } from "../browser-tabs/tab-strip";
import type { ResolvedIdentityIcon } from "../identity";
import type { WorkbenchSplitTriggerMode } from "../preferences";
import type { WorkspaceTabsInteractionPolicy } from "../interaction-policy";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs";
import type { TerminalWorkspaceActions } from "./use-terminal-workspace-actions";
import type { WorkbenchActionApi } from "./use-workbench-action-api";

export type WorkbenchWorkspaceTabsLabels = {
  readonly goBackLabel: string;
  readonly goForwardLabel: string;
  readonly toggleTabStackLabel: string;
  readonly openNewTabLabel: string;
  readonly closeTabLabel: string;
};

type UseWorkbenchWorkspaceTabsPropsArgs = {
  readonly tabsModel: WorkspaceTabsModel;
  readonly terminalIdentityByTabId?: Readonly<Record<string, ResolvedIdentityIcon>>;
  readonly workspaceAppIdentityByTabId?: Readonly<Record<string, ResolvedIdentityIcon>>;
  readonly activeTabPageKind: WorkspaceTab["pageKind"];
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly stackedMode: boolean;
  readonly setStackedMode: Dispatch<SetStateAction<boolean>>;
  readonly labels: WorkbenchWorkspaceTabsLabels;
  readonly splitTriggerMode: WorkbenchSplitTriggerMode;
  readonly interactionPolicy: WorkspaceTabsInteractionPolicy;
  readonly terminalWorkspaceActions: TerminalWorkspaceActions;
  readonly workbenchActions: Pick<WorkbenchActionApi, "openNewTab">;
  readonly onGoBack: () => void;
  readonly onGoForward: () => void;
};

export const useWorkbenchWorkspaceTabsProps = ({
  tabsModel,
  terminalIdentityByTabId,
  workspaceAppIdentityByTabId,
  activeTabPageKind,
  canGoBack,
  canGoForward,
  stackedMode,
  setStackedMode,
  labels,
  splitTriggerMode,
  interactionPolicy,
  terminalWorkspaceActions,
  workbenchActions,
  onGoBack,
  onGoForward
}: UseWorkbenchWorkspaceTabsPropsArgs): BrowserTabStripProps => {
  const onToggleStackedMode = useCallback(() => {
    setStackedMode((current) => !current);
  }, [setStackedMode]);

  const onTabContextMenu = useCallback(
    (tab: WorkspaceTab, anchorX: number, anchorY: number): void => {
      if (tab.pageKind !== "terminal") {
        return;
      }
      terminalWorkspaceActions.onWorkspaceTabContextMenu(tab.id, anchorX, anchorY);
    },
    [terminalWorkspaceActions]
  );

  const onDropTerminalDockTab = useCallback(
    (request: { readonly terminalTabId: string; readonly targetIndex: number }): void => {
      terminalWorkspaceActions.openTerminalTabInWorkspace(
        request.terminalTabId,
        request.targetIndex
      );
    },
    [terminalWorkspaceActions]
  );

  return useMemo(
    () => ({
      tabs: tabsModel.tabs,
      ...(terminalIdentityByTabId === undefined ? {} : { terminalIdentityByTabId }),
      ...(workspaceAppIdentityByTabId === undefined ? {} : { workspaceAppIdentityByTabId }),
      splitGroupTabIds: tabsModel.splitGroupTabIds,
      activeTabId: tabsModel.activeTabId,
      goBackLabel: labels.goBackLabel,
      goForwardLabel: labels.goForwardLabel,
      toggleTabStackLabel: labels.toggleTabStackLabel,
      stackedMode,
      canGoBack: activeTabPageKind === "page" && canGoBack,
      canGoForward: activeTabPageKind === "page" && canGoForward,
      openNewTabLabel: labels.openNewTabLabel,
      closeTabLabel: labels.closeTabLabel,
      splitTriggerMode,
      interactionPolicy,
      isTabInSplit: tabsModel.isTabInSplit,
      onGoBack,
      onGoForward,
      onToggleStackedMode,
      onTabContextMenu,
      onActivateTab: tabsModel.setActiveTab,
      onCloseTab: terminalWorkspaceActions.onBrowserTabClose,
      onOpenNewTab: workbenchActions.openNewTab,
      onDropTerminalDockTab,
      onReorderTabs: tabsModel.reorderTab,
      onSplitTabs: tabsModel.splitTabWithTarget,
      onDetachTabFromSplit: tabsModel.detachTabFromSplit
    }),
    [
      activeTabPageKind,
      canGoBack,
      canGoForward,
      interactionPolicy,
      labels,
      onDropTerminalDockTab,
      onGoBack,
      onGoForward,
      onTabContextMenu,
      onToggleStackedMode,
      splitTriggerMode,
      stackedMode,
      tabsModel,
      terminalIdentityByTabId,
      terminalWorkspaceActions.onBrowserTabClose,
      workspaceAppIdentityByTabId,
      workbenchActions.openNewTab
    ]
  );
};
