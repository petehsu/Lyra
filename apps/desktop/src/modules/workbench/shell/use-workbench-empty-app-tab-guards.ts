import { useCallback, useEffect } from "react";

import type { WorkspaceTabsModel } from "../workspace-tabs/types";
import type { WorkbenchAppId } from "../workspace-apps";

type UseWorkbenchEmptyAppTabGuardsParams = {
  readonly tabsModel: WorkspaceTabsModel;
  readonly notificationCount: number;
};

const closeAppTabsById = (
  tabs: WorkspaceTabsModel["tabs"],
  closeTab: WorkspaceTabsModel["closeTab"],
  appId: WorkbenchAppId
): void => {
  tabs
    .filter((tab) => tab.pageKind === "app" && tab.appId === appId)
    .forEach((tab) => {
      closeTab(tab.id);
    });
};

export const useWorkbenchEmptyAppTabGuards = ({
  tabsModel,
  notificationCount
}: UseWorkbenchEmptyAppTabGuardsParams): void => {
  const { closeTab, tabs } = tabsModel;
  const closeNotificationCenterTabs = useCallback((): void => {
    closeAppTabsById(tabs, closeTab, "notification-center");
  }, [closeTab, tabs]);

  useEffect(() => {
    if (notificationCount > 0) {
      return;
    }
    closeNotificationCenterTabs();
  }, [closeNotificationCenterTabs, notificationCount]);

};
