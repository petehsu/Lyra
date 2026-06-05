import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { SearchEngineDefinition } from "../browser-search/types";
import type {
  FileEditorChangeReviewItem,
  FileEditorModel
} from "../file-editor";
import type { ImageViewerModel } from "../image-viewer";
import type { FileManagerChooserMode, FileManagerModel } from "../file-manager";
import type { WorkbenchNotificationModel } from "../notifications";
import {
  createAgentSessionHistoryAppRequest,
  type AgentSessionHistorySurfaceProps
} from "../agent-session-history";
import type { AgentProjectTreeModel } from "../agent-project-tree";
import type { WorkbenchPreferencesModel } from "../preferences";
import { createSoftwareStoreAppRequest } from "../software-store";
import { createLoginManagerAppRequest } from "../login-manager";
import type { SoftwareCapabilitiesRegistryModel } from "../software-capabilities";
import type { TerminalDockModel } from "../terminal-dock/types";
import type { WorkspaceTabsModel, WorkspaceTab } from "../workspace-tabs/types";
import { LOGO_URL } from "./service";
import type { BrowserSearchModel } from "../browser-search";
import type { WorkbenchLabels } from "./use-workbench-labels";
import type { WorkspaceSurfaceRouterProps } from "./workspace-surface-router";

export type WorkspaceSurfaceRouterCoreProps = Omit<
  WorkspaceSurfaceRouterProps,
  "surfaceAdapters"
>;

type UseWorkspaceSurfaceRouterPropsParams = {
  readonly activeTab: WorkspaceTab | undefined;
  readonly tabsModel: WorkspaceTabsModel;
  readonly browserSearchModel: BrowserSearchModel;
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly onPageHostChange: (tabId: string, element: HTMLElement | null) => void;
  readonly terminalModel: TerminalDockModel;
  readonly desktopApi: LyraDesktopApi | null;
  readonly resolvedThemeId: string;
  readonly fileManagerModel: FileManagerModel;
  readonly resolveFileManagerChooser: (instanceId: string) => FileManagerChooserMode | null;
  readonly fileEditorModel: FileEditorModel;
  readonly imageViewerModel: ImageViewerModel;
  readonly agentProjectTreeModel: AgentProjectTreeModel;
  readonly activeEditorReviewIndex: number;
  readonly editorReviewItems: readonly FileEditorChangeReviewItem[];
  readonly resolveActiveEditorWorkItem: (filePath: string) => FileEditorChangeReviewItem | undefined;
  readonly onGoToPreviousEditorWorkItem: () => void;
  readonly onGoToNextEditorWorkItem: () => void;
  readonly onAcceptAllEditorWorkItems: () => void;
  readonly onAcceptEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
  readonly onRejectEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
  readonly onUndoEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
  readonly preferencesModel: WorkbenchPreferencesModel;
  readonly settings: WorkspaceSurfaceRouterProps["settings"];
  readonly notificationModel: WorkbenchNotificationModel;
  readonly labels: WorkbenchLabels;
  readonly softwareCapabilities: SoftwareCapabilitiesRegistryModel;
  readonly onOpenFileFromManager: (filePath: string) => void;
  readonly onRevealPathInFileManager: (filePath: string) => void;
  readonly onOpenNotificationSource: (notificationId: string) => void;
  readonly onRequestClearNotifications: () => void;
  readonly onOpenAgentGit: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void;
  readonly agentSessionHistory: {
    readonly labels: AgentSessionHistorySurfaceProps["labels"];
    readonly activeSessionId: string | null;
    readonly onOpenSession: AgentSessionHistorySurfaceProps["onOpenSession"];
    readonly onSessionDeleted?: AgentSessionHistorySurfaceProps["onSessionDeleted"];
    readonly openDialog: AgentSessionHistorySurfaceProps["openDialog"];
    readonly query: AgentSessionHistorySurfaceProps["query"];
    readonly refreshRequestKey: AgentSessionHistorySurfaceProps["refreshRequestKey"];
    readonly locateRequest: AgentSessionHistorySurfaceProps["locateRequest"];
    readonly browserHistory: AgentSessionHistorySurfaceProps["browserHistory"];
    readonly browserHistoryPreviewPageId: AgentSessionHistorySurfaceProps["browserHistoryPreviewPageId"];
    readonly onBrowserHistoryPreviewChange: AgentSessionHistorySurfaceProps["onBrowserHistoryPreviewChange"];
    readonly onBrowserHistoryPreviewHostChange: AgentSessionHistorySurfaceProps["onBrowserHistoryPreviewHostChange"];
    readonly onOpenBrowserHistoryEntry: AgentSessionHistorySurfaceProps["onOpenBrowserHistoryEntry"];
    readonly locale?: AgentSessionHistorySurfaceProps["locale"];
  };
};

export const useWorkspaceSurfaceRouterProps = ({
  activeTab,
  tabsModel,
  browserSearchModel,
  engineById,
  onPageHostChange,
  terminalModel,
  desktopApi,
  resolvedThemeId,
  fileManagerModel,
  resolveFileManagerChooser,
  fileEditorModel,
  imageViewerModel,
  agentProjectTreeModel,
  activeEditorReviewIndex,
  editorReviewItems,
  resolveActiveEditorWorkItem,
  onGoToPreviousEditorWorkItem,
  onGoToNextEditorWorkItem,
  onAcceptAllEditorWorkItems,
  onAcceptEditorWorkItem,
  onRejectEditorWorkItem,
  onUndoEditorWorkItem,
  preferencesModel,
  settings,
  notificationModel,
  labels,
  softwareCapabilities,
  onOpenFileFromManager,
  onRevealPathInFileManager,
  onOpenNotificationSource,
  onRequestClearNotifications,
  onOpenAgentGit,
  agentSessionHistory
}: UseWorkspaceSurfaceRouterPropsParams): WorkspaceSurfaceRouterCoreProps => {
  const preferences = preferencesModel.preferences;

  return {
    activeTab,
    tabsModel,
    logoUrl: LOGO_URL,
    browserSearchModel,
    engineById,
    onOpenSearchResult: tabsModel.openPageInNewTab,
    onPageHostChange,
    terminalModel,
    desktopApi,
    terminalLabels: labels.terminal,
    resolvedThemeId,
    fileManagerModel,
    fileManagerLabels: labels.fileManager,
    resolveFileManagerChooser,
    fileEditorModel,
    fileEditorLabels: labels.fileEditor,
    imageViewerModel,
    imageViewerLabels: labels.imageViewer,
    agentProjectTreeModel,
    agentProjectTreeLabels: labels.agentProjectTree,
    agentGitLabels: labels.agentGit,
    agentSelfDevLabels: labels.agentSelfDev,
    agentSelfDevLocale: preferences.locale,
    agentOvernightLabels: labels.agentOvernight,
    agentOvernightLocale: preferences.locale,
    onOpenAgentGit,
    fileEditorReview: {
      editorWorkAcceptLabel: labels.fileEditorReview.accept,
      editorWorkRejectLabel: labels.fileEditorReview.reject,
      editorWorkUndoLabel: labels.fileEditorReview.undo,
      editorWorkPrevLabel: labels.fileEditorReview.previous,
      editorWorkNextLabel: labels.fileEditorReview.next,
      editorWorkAcceptAllLabel: labels.fileEditorReview.acceptAll,
      canGoToPreviousEditorWorkItem: activeEditorReviewIndex > 0,
      canGoToNextEditorWorkItem:
        activeEditorReviewIndex >= 0
        && activeEditorReviewIndex < editorReviewItems.length - 1,
      canAcceptAllEditorWorkItems: editorReviewItems.some(
        (item) => item.status === "completed" && item.decision !== "accepted"
      ),
      resolveActiveEditorWorkItem,
      onGoToPreviousEditorWorkItem,
      onGoToNextEditorWorkItem,
      onAcceptAllEditorWorkItems,
      onAcceptEditorWorkItem,
      onRejectEditorWorkItem,
      onUndoEditorWorkItem
    },
    splitThreePaneLayout: preferences.splitThreePaneLayout,
    searchResultsSourceFilter: preferences.searchResultsSourceFilter,
    onSearchResultsSourceFilterChange: preferencesModel.setSearchResultsSourceFilter,
    settings,
    onOpenFileFromManager,
    onRevealPathInFileManager,
    i18n: labels.workspaceI18n,
    notifications: {
      model: notificationModel,
      labels: labels.notificationCenter,
      onOpenNotificationSource,
      onRequestClearAll: onRequestClearNotifications
    },
    agentSessionHistory,
    loginManager: {
      desktopApi,
      labels: labels.loginManager,
      onOpenSite: tabsModel.openPageInNewTab
    },
    softwareStore: {
      desktopApi,
      labels: labels.softwareStore,
      softwareCapabilities,
      activeUiPackId: preferences.uiPackId,
      onUiPackIdChange: preferencesModel.setUiPackId,
      onOpenBuiltinApp: (appId) => {
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
          tabsModel.openAppTab(createLoginManagerAppRequest(labels.loginManager.tabTitle));
          return;
        }
        if (appId === "software-store") {
          tabsModel.openAppTab(createSoftwareStoreAppRequest(labels.softwareStore.tabTitle));
        }
      }
    }
  };
};
