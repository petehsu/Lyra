import { useMemo } from "react";

import type { I18nKey } from "../i18n";
import type { WorkbenchPreferences } from "../preferences";
import type { SettingsAiModel } from "../settings-ai";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { GlobalDialogModel } from "../global-dialog";
import type { WorkbenchLocationControls } from "../location";
import type { AiPanelSide } from "./use-panel-layout";
import type { AiPanelSurfaceProps } from "../ai-panel";

type SidebarAiPreferences = Pick<
  WorkbenchPreferences,
  "locale" | "aiStopBehavior" | "aiRichRenderingEnabled"
>;

type UseWorkbenchSidebarAiSurfacePropsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly preferences: SidebarAiPreferences;
  readonly settingsAiModel: SettingsAiModel;
  readonly aiPanelSide: AiPanelSide;
  readonly themeSignature?: string | undefined;
  readonly onToggleAiPanelSide: () => void;
  readonly onRequestProjectBind: (
    currentPath?: string
  ) => Promise<string | null>;
  readonly onOpenProjectTree: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void;
  readonly onOpenModelSettings: () => Promise<void> | void;
  readonly onOpenUrlInWorkbench: (request: {
    readonly url: string;
    readonly title?: string;
  }) => Promise<void> | void;
  readonly onOpenTerminalLiveSession: (request: {
    readonly sessionId?: string | null;
    readonly terminalTabId?: string | null;
    readonly paneId?: string | null;
  }) => Promise<void> | void;
  readonly onOpenFile?: ((
    filePath: string,
    location?: { readonly line: number; readonly endLine?: number }
  ) => void) | undefined;
  readonly resolveActiveWorkspaceTab?: () => import("../workspace-tabs/types").WorkspaceTab | undefined;
  readonly onPickFileFromFileManager?: () => Promise<string | null>;
  readonly listWorkspaceTabs?: () => readonly import("../workspace-tabs/types").WorkspaceTab[];
  readonly listTerminalTabs?: () => readonly import("../terminal-dock/types").TerminalDockTab[];
  readonly locationControls?: WorkbenchLocationControls;
  readonly openDialog?: GlobalDialogModel["openDialog"];
  readonly t: (key: I18nKey) => string;
};

export const useWorkbenchSidebarAiSurfaceProps = ({
  desktopApi,
  preferences,
  settingsAiModel,
  aiPanelSide,
  onToggleAiPanelSide,
  onRequestProjectBind,
  onOpenProjectTree,
  onOpenModelSettings,
  onOpenUrlInWorkbench,
  onOpenTerminalLiveSession,
  onOpenFile,
  resolveActiveWorkspaceTab,
  onPickFileFromFileManager,
  listWorkspaceTabs,
  listTerminalTabs,
  locationControls,
  openDialog,
  t
}: UseWorkbenchSidebarAiSurfacePropsParams): AiPanelSurfaceProps =>
  useMemo(
    () => ({
      variant: "sidebar",
      desktopApi,
      settingsAiModel,
      locale: preferences.locale,
      title: t("ai.tabTitle"),
      aiPanelSide,
      onToggleAiPanelSide,
      onRequestProjectBind,
      onOpenProjectTree,
      onOpenModelSettings,
      onOpenUrlInWorkbench,
      onOpenTerminalLiveSession,
      onOpenFile,
      ...(resolveActiveWorkspaceTab === undefined ? {} : { resolveActiveWorkspaceTab }),
      ...(onPickFileFromFileManager === undefined ? {} : { onPickFileFromFileManager }),
      ...(listWorkspaceTabs === undefined ? {} : { listWorkspaceTabs }),
      ...(listTerminalTabs === undefined ? {} : { listTerminalTabs }),
      ...(locationControls === undefined ? {} : { locationControls }),
      ...(openDialog === undefined ? {} : { openDialog }),
      movePanelToLeftLabel: t("ai.movePanelToLeft"),
      movePanelToRightLabel: t("ai.movePanelToRight"),
      emptyThreadLabel: t("ai.startBySending"),
    }),
    [
      aiPanelSide,
      desktopApi,
      settingsAiModel,
      onToggleAiPanelSide,
      onRequestProjectBind,
      onOpenProjectTree,
      onOpenModelSettings,
      onOpenUrlInWorkbench,
      onOpenTerminalLiveSession,
      onOpenFile,
      resolveActiveWorkspaceTab,
      onPickFileFromFileManager,
      listWorkspaceTabs,
      listTerminalTabs,
      locationControls,
      openDialog,
      preferences.locale,
      t,
    ]
  );