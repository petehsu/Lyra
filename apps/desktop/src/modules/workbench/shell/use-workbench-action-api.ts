import { useMemo } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { FileManagerModel } from "../file-manager";
import type { I18nKey, WorkbenchLocale } from "../i18n";
import type { WorkbenchResolvedThemeId } from "../theme";
import type { WorkspaceTabsModel } from "../workspace-tabs";
import {
  AGENT_SESSION_HISTORY_INSTANCE_ID,
  createAgentSessionHistoryAppRequest
} from "../agent-session-history";
import { createSoftwareStoreAppRequest } from "../software-store";
import { resolveDocsEntryUrl } from "./service";
import type { PanelLayoutModel } from "./use-panel-layout";

export type WorkbenchActionApi = {
  readonly openNewTab: () => void;
  readonly openSettings: () => void;
  readonly openSoftwareStore: () => void;
  readonly openFileManager: () => void;
  readonly openAgentSessionHistory: () => void;
  readonly openDocs: () => void;
  readonly toggleAiPanel: () => void;
  readonly toggleTerminalPanel: () => void;
  readonly toggleTerminalPanelSide: () => void;
  readonly minimizeWindow: () => void;
  readonly toggleMaximizeWindow: () => void;
  readonly closeWindow: () => void;
};

export type WorkbenchPresentationState = {
  readonly isMac: boolean;
  readonly isMaximized: boolean;
  readonly isAiPanelVisible: boolean;
  readonly isTerminalPanelVisible: boolean;
  readonly terminalPanelSide: "top" | "bottom";
};

export type WorkbenchChromeLabels = {
  readonly toggleAiPanel: string;
  readonly toggleTerminalPanel: string;
  readonly moveTerminalToTop: string;
  readonly moveTerminalToBottom: string;
  readonly openSettings: string;
  readonly openSoftwareStore: string;
  readonly openFiles: string;
  readonly openAgentSessionHistory: string;
  readonly openDocs: string;
  readonly minimizeWindow: string;
  readonly toggleMaximizeWindow: string;
  readonly closeWindow: string;
};

type UseWorkbenchActionApiParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
  readonly fileManagerModel: FileManagerModel;
  readonly panelLayoutModel: PanelLayoutModel;
  readonly onBeforePanelLayoutAnimation?: () => Promise<void> | void;
  readonly docsEntryAddress: string;
  readonly docsTabTitle: string;
  readonly agentSessionHistoryTitle: string;
  readonly softwareStoreTitle: string;
  readonly locale: WorkbenchLocale;
  readonly resolvedThemeId: WorkbenchResolvedThemeId;
};

export const useWorkbenchActionApi = ({
  desktopApi,
  tabsModel,
  fileManagerModel,
  panelLayoutModel,
  onBeforePanelLayoutAnimation,
  docsEntryAddress,
  docsTabTitle,
  agentSessionHistoryTitle,
  softwareStoreTitle,
  locale,
  resolvedThemeId
}: UseWorkbenchActionApiParams): WorkbenchActionApi =>
  useMemo(() => {
    const runPanelLayoutAction = (action: () => void): void => {
      const pendingTransition = onBeforePanelLayoutAnimation?.();
      if (
        pendingTransition !== undefined
        && typeof pendingTransition.then === "function"
      ) {
        void pendingTransition.finally(action);
        return;
      }
      action();
    };

    return {
      openNewTab: tabsModel.openNewTab,
      openSettings: tabsModel.openSettingsTab,
      openSoftwareStore: () => {
        tabsModel.openAppTab(createSoftwareStoreAppRequest(softwareStoreTitle));
      },
      openFileManager: () => {
        const nextApp = fileManagerModel.createInstance();
        tabsModel.openAppTab(nextApp);
        void fileManagerModel.openHome(nextApp.appInstanceId);
      },
      openAgentSessionHistory: () => {
        const existingTab = tabsModel.tabs.find(
          (tab) =>
            tab.pageKind === "app" &&
            tab.appId === "agent-session-history" &&
            tab.appInstanceId === AGENT_SESSION_HISTORY_INSTANCE_ID
        );
        if (existingTab !== undefined) {
          tabsModel.setActiveTab(existingTab.id);
          return;
        }
        tabsModel.openAppTab(createAgentSessionHistoryAppRequest(agentSessionHistoryTitle));
      },
      openDocs: () => {
        tabsModel.openPageInNewTab(
          resolveDocsEntryUrl(docsEntryAddress, {
            locale,
            themeId: resolvedThemeId
          }),
          docsTabTitle
        );
      },
      toggleAiPanel: () => {
        runPanelLayoutAction(panelLayoutModel.toggleLeftPanel);
      },
      toggleTerminalPanel: () => {
        runPanelLayoutAction(panelLayoutModel.toggleBottomPanel);
      },
      toggleTerminalPanelSide: () => {
        runPanelLayoutAction(panelLayoutModel.toggleTerminalPanelSide);
      },
      minimizeWindow: () => {
        void desktopApi?.windowControls.minimize();
      },
      toggleMaximizeWindow: () => {
        void desktopApi?.windowControls.toggleMaximize();
      },
      closeWindow: () => {
        void desktopApi?.windowControls.close();
      }
    };
  }, [
    desktopApi,
    docsEntryAddress,
    docsTabTitle,
    agentSessionHistoryTitle,
    softwareStoreTitle,
    fileManagerModel,
    locale,
    onBeforePanelLayoutAnimation,
    panelLayoutModel.toggleBottomPanel,
    panelLayoutModel.toggleLeftPanel,
    panelLayoutModel.toggleTerminalPanelSide,
    resolvedThemeId,
    tabsModel
  ]);

export const createWorkbenchChromeLabels = (
  t: (key: I18nKey) => string
): WorkbenchChromeLabels => ({
  toggleAiPanel: t("panel.toggleLeft"),
  toggleTerminalPanel: t("panel.toggleBottom"),
  moveTerminalToTop: t("panel.moveTerminalToTop"),
  moveTerminalToBottom: t("panel.moveTerminalToBottom"),
  openSettings: t("settings.open"),
  openSoftwareStore: t("softwareStore.open"),
  openFiles: t("files.open"),
  openAgentSessionHistory: t("agentHistory.open"),
  openDocs: t("docs.open"),
  minimizeWindow: t("window.minimize"),
  toggleMaximizeWindow: t("window.toggleMaximize"),
  closeWindow: t("window.close")
});
