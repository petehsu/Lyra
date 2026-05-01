import { useMemo } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { FileManagerModel } from "../file-manager";
import type { I18nKey, WorkbenchLocale } from "../i18n";
import type { WorkbenchResolvedThemeId } from "../theme";
import type { WorkspaceTabsModel } from "../workspace-tabs";
import { createResourceMonitorAppRequest } from "../resource-monitor";
import { resolveDocsEntryUrl } from "./service";
import type { PanelLayoutModel } from "./use-panel-layout";

export type WorkbenchActionApi = {
  readonly openNewTab: () => void;
  readonly openSettings: () => void;
  readonly openFileManager: () => void;
  readonly openActivityMonitor: () => void;
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
  readonly openFiles: string;
  readonly openActivityMonitor: string;
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
  readonly docsEntryAddress: string;
  readonly docsTabTitle: string;
  readonly activityMonitorTitle: string;
  readonly locale: WorkbenchLocale;
  readonly resolvedThemeId: WorkbenchResolvedThemeId;
};

export const useWorkbenchActionApi = ({
  desktopApi,
  tabsModel,
  fileManagerModel,
  panelLayoutModel,
  docsEntryAddress,
  docsTabTitle,
  activityMonitorTitle,
  locale,
  resolvedThemeId
}: UseWorkbenchActionApiParams): WorkbenchActionApi =>
  useMemo(
    () => ({
      openNewTab: tabsModel.openNewTab,
      openSettings: tabsModel.openSettingsTab,
      openFileManager: () => {
        const nextApp = fileManagerModel.createInstance();
        tabsModel.openAppTab(nextApp);
        void fileManagerModel.openHome(nextApp.appInstanceId);
      },
      openActivityMonitor: () => {
        tabsModel.openAppTab(createResourceMonitorAppRequest(activityMonitorTitle));
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
      toggleAiPanel: panelLayoutModel.toggleLeftPanel,
      toggleTerminalPanel: panelLayoutModel.toggleBottomPanel,
      toggleTerminalPanelSide: panelLayoutModel.toggleTerminalPanelSide,
      minimizeWindow: () => {
        void desktopApi?.windowControls.minimize();
      },
      toggleMaximizeWindow: () => {
        void desktopApi?.windowControls.toggleMaximize();
      },
      closeWindow: () => {
        void desktopApi?.windowControls.close();
      }
    }),
    [
      desktopApi,
      docsEntryAddress,
      docsTabTitle,
      activityMonitorTitle,
      fileManagerModel,
      locale,
      panelLayoutModel.toggleBottomPanel,
      panelLayoutModel.toggleLeftPanel,
      panelLayoutModel.toggleTerminalPanelSide,
      resolvedThemeId,
      tabsModel
    ]
  );

export const createWorkbenchChromeLabels = (
  t: (key: I18nKey) => string
): WorkbenchChromeLabels => ({
  toggleAiPanel: t("panel.toggleLeft"),
  toggleTerminalPanel: t("panel.toggleBottom"),
  moveTerminalToTop: t("panel.moveTerminalToTop"),
  moveTerminalToBottom: t("panel.moveTerminalToBottom"),
  openSettings: t("settings.open"),
  openFiles: t("files.open"),
  openActivityMonitor: t("resources.openActivityMonitor"),
  openDocs: t("docs.open"),
  minimizeWindow: t("window.minimize"),
  toggleMaximizeWindow: t("window.toggleMaximize"),
  closeWindow: t("window.close")
});
