import { useCallback } from "react";

import { createAgentSessionHistoryAppRequest } from "../agent-session-history";
import type { BrowserSettingsCategoryFocusRequest } from "../browser-tabs/settings-surface";
import type { FileManagerModel } from "../file-manager";
import type { SoftwareStoreBuiltinAppId } from "../software-store";
import type { WorkspaceTabsModel } from "../workspace-tabs";
import type { WorkbenchLabels } from "./use-workbench-labels";

type UseSoftwareStoreBuiltinAppOpenerParams = {
  readonly fileManagerModel: FileManagerModel;
  readonly labels: WorkbenchLabels;
  readonly onOpenSettingsSection: (categoryId: BrowserSettingsCategoryFocusRequest["categoryId"]) => void;
  readonly tabsModel: WorkspaceTabsModel;
};

export const useSoftwareStoreBuiltinAppOpener = ({
  fileManagerModel,
  labels,
  onOpenSettingsSection,
  tabsModel
}: UseSoftwareStoreBuiltinAppOpenerParams): ((appId: SoftwareStoreBuiltinAppId) => void) =>
  useCallback((appId: SoftwareStoreBuiltinAppId): void => {
    if (appId === "browser-search") {
      tabsModel.openNewTab();
      return;
    }
    if (appId === "settings") {
      tabsModel.openSettingsTab();
      return;
    }
    if (appId === "file-manager") {
      const nextApp = fileManagerModel.createInstance();
      tabsModel.openAppTab(nextApp);
      void fileManagerModel.openHome(nextApp.appInstanceId);
      return;
    }
    if (appId === "agent-history") {
      tabsModel.openAppTab(createAgentSessionHistoryAppRequest(labels.agentSessionHistory.title));
      return;
    }
    if (appId === "login-manager") {
      onOpenSettingsSection("loginManager");
      return;
    }
    if (appId === "software-store") {
      onOpenSettingsSection("softwareStore");
    }
  }, [
    fileManagerModel,
    labels.agentSessionHistory.title,
    onOpenSettingsSection,
    tabsModel
  ]);
