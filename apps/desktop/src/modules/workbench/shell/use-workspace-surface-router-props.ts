import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { AiPlanReviewModel } from "../ai-panel";
import type { SearchEngineDefinition } from "../browser-search/types";
import type {
  FileEditorChangeReviewItem,
  FileEditorModel
} from "../file-editor";
import type { FileManagerChooserMode, FileManagerModel } from "../file-manager";
import type { McpCenterModel } from "../mcp-center";
import type { WorkbenchNotificationModel } from "../notifications";
import type { PluginsCenterModel } from "../plugins-center";
import type { WorkbenchPreferencesModel } from "../preferences";
import type { SettingsAiModel } from "../settings-ai";
import type { SkillsCenterModel } from "../skills-center";
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
  readonly terminalThemeSignature: string;
  readonly resolvedThemeId: string;
  readonly fileManagerModel: FileManagerModel;
  readonly resolveFileManagerChooser: (instanceId: string) => FileManagerChooserMode | null;
  readonly fileEditorModel: FileEditorModel;
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
  readonly mcpCenterModel: McpCenterModel;
  readonly skillsCenterModel: SkillsCenterModel;
  readonly pluginsCenterModel: PluginsCenterModel;
  readonly settingsAiModel: SettingsAiModel;
  readonly notificationModel: WorkbenchNotificationModel;
  readonly labels: WorkbenchLabels;
  readonly openDialog: NonNullable<WorkspaceSurfaceRouterProps["aiHistory"]["openDialog"]>;
  readonly planReviewModel: AiPlanReviewModel;
  readonly onOpenFileFromManager: (filePath: string) => void;
  readonly onRevealPathInFileManager: (filePath: string) => void;
  readonly onOpenNotificationSource: (notificationId: string) => void;
  readonly onRequestClearNotifications: () => void;
};

export const useWorkspaceSurfaceRouterProps = ({
  activeTab,
  tabsModel,
  browserSearchModel,
  engineById,
  onPageHostChange,
  terminalModel,
  desktopApi,
  terminalThemeSignature,
  resolvedThemeId,
  fileManagerModel,
  resolveFileManagerChooser,
  fileEditorModel,
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
  mcpCenterModel,
  skillsCenterModel,
  pluginsCenterModel,
  settingsAiModel,
  notificationModel,
  labels,
  openDialog,
  planReviewModel,
  onOpenFileFromManager,
  onRevealPathInFileManager,
  onOpenNotificationSource,
  onRequestClearNotifications
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
    terminalThemeSignature,
    terminalThemePreset: preferences.terminalThemePreset,
    resolvedThemeId,
    fileManagerModel,
    fileManagerLabels: labels.fileManager,
    resolveFileManagerChooser,
    fileEditorModel,
    fileEditorLabels: labels.fileEditor,
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
    mcpCenter: {
      model: mcpCenterModel,
      labels: labels.mcpCenter
    },
    skillsCenter: {
      model: skillsCenterModel,
      labels: labels.skillsCenter
    },
    pluginsCenter: {
      model: pluginsCenterModel,
      labels: labels.pluginsCenter
    },
    aiHistory: {
      locale: preferences.locale,
      ...labels.aiHistory,
      richRenderingEnabled: preferences.aiRichRenderingEnabled,
      themeSignature: resolvedThemeId,
      defaultProfileId: settingsAiModel.defaultProfileId,
      defaultProviderId: settingsAiModel.defaultProviderId,
      openDialog
    },
    planReview: {
      model: planReviewModel
    },
    notifications: {
      model: notificationModel,
      labels: labels.notificationCenter,
      onOpenNotificationSource,
      onRequestClearAll: onRequestClearNotifications
    }
  };
};
