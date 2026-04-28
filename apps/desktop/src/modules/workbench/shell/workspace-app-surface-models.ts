import {
  isAiHistoryAppId,
  isAiMcpAppId,
  isAiPluginsAppId,
  isAiSkillsAppId,
  isFileEditorAppId,
  isFileManagerAppId,
  isNotificationCenterAppId
} from "../workspace-apps";
import type { WorkspaceTab } from "../workspace-tabs/types";
import type {
  SurfacePropsByKind,
  WorkspaceSurfaceRenderContext,
  WorkspaceSurfaceRenderModel
} from "./workspace-surface-types";

const createFileEditorProps = (
  state: NonNullable<ReturnType<WorkspaceSurfaceRenderContext["fileEditorModel"]["getState"]>>,
  context: WorkspaceSurfaceRenderContext
): SurfacePropsByKind["fileEditor"] => {
  const activeEditorWorkItem = context.fileEditorReview?.resolveActiveEditorWorkItem(state.filePath);
  return {
    state,
    labels: context.fileEditorLabels,
    model: context.fileEditorModel,
    themeSignature: context.resolvedThemeId,
    ...(context.fileEditorReview === undefined
      ? {}
      : {
          editorWorkAcceptLabel: context.fileEditorReview.editorWorkAcceptLabel,
          editorWorkRejectLabel: context.fileEditorReview.editorWorkRejectLabel,
          editorWorkUndoLabel: context.fileEditorReview.editorWorkUndoLabel,
          editorWorkPrevLabel: context.fileEditorReview.editorWorkPrevLabel,
          editorWorkNextLabel: context.fileEditorReview.editorWorkNextLabel,
          editorWorkAcceptAllLabel: context.fileEditorReview.editorWorkAcceptAllLabel,
          canGoToPreviousEditorWorkItem: context.fileEditorReview.canGoToPreviousEditorWorkItem,
          canGoToNextEditorWorkItem: context.fileEditorReview.canGoToNextEditorWorkItem,
          canAcceptAllEditorWorkItems: context.fileEditorReview.canAcceptAllEditorWorkItems,
          ...(activeEditorWorkItem === undefined
            ? {}
            : { activeEditorWorkItem }),
          onGoToPreviousEditorWorkItem: context.fileEditorReview.onGoToPreviousEditorWorkItem,
          onGoToNextEditorWorkItem: context.fileEditorReview.onGoToNextEditorWorkItem,
          onAcceptAllEditorWorkItems: context.fileEditorReview.onAcceptAllEditorWorkItems,
          onAcceptEditorWorkItem: context.fileEditorReview.onAcceptEditorWorkItem,
          onRejectEditorWorkItem: context.fileEditorReview.onRejectEditorWorkItem,
          onUndoEditorWorkItem: context.fileEditorReview.onUndoEditorWorkItem
        })
  };
};

const createAiHistoryProps = (
  context: WorkspaceSurfaceRenderContext
): SurfacePropsByKind["aiHistory"] => ({
  desktopApi: context.desktopApi,
  locale: context.aiHistory.locale,
  title: context.aiHistory.title,
  newSessionTitle: context.aiHistory.newSessionTitle,
  newConversationLabel: context.aiHistory.newConversationLabel,
  openConversationLabel: context.aiHistory.openConversationLabel,
  ...(context.aiHistory.renameConversationLabel === undefined
    ? {}
    : { renameConversationLabel: context.aiHistory.renameConversationLabel }),
  deleteConversationLabel: context.aiHistory.deleteConversationLabel,
  archiveConversationLabel: context.aiHistory.archiveConversationLabel,
  archivedConversationLabel: context.aiHistory.archivedConversationLabel,
  archivedProjectLabel: context.aiHistory.archivedProjectLabel,
  deleteArchivedConversationTitle: context.aiHistory.deleteArchivedConversationTitle,
  deleteArchivedConversationDescription: context.aiHistory.deleteArchivedConversationDescription,
  deleteArchivedConversationConfirm: context.aiHistory.deleteArchivedConversationConfirm,
  deleteArchivedConversationCancel: context.aiHistory.deleteArchivedConversationCancel,
  profileLabel: context.aiHistory.profileLabel,
  sessionIdLabel: context.aiHistory.sessionIdLabel,
  loadingSessionsLabel: context.aiHistory.loadingSessionsLabel,
  emptyStateTitle: context.aiHistory.emptyStateTitle,
  emptyStateDescription: context.aiHistory.emptyStateDescription,
  scopeGlobalLabel: context.aiHistory.scopeGlobalLabel,
  scopeProjectLabel: context.aiHistory.scopeProjectLabel,
  noProjectSessionsEmptyLabel: context.aiHistory.noProjectSessionsEmptyLabel,
  noProjectsEmptyLabel: context.aiHistory.noProjectsEmptyLabel,
  projectSessionCountLabel: context.aiHistory.projectSessionCountLabel,
  backToProjectsLabel: context.aiHistory.backToProjectsLabel,
  projectPathLabel: context.aiHistory.projectPathLabel,
  threadPreviewEmptyLabel: context.aiHistory.threadPreviewEmptyLabel,
  previewEmptyTitle: context.aiHistory.previewEmptyTitle,
  previewEmptyDescription: context.aiHistory.previewEmptyDescription,
  previewLoadingLabel: context.aiHistory.previewLoadingLabel,
  ...(context.aiHistory.richRenderingEnabled === undefined
    ? {}
    : { richRenderingEnabled: context.aiHistory.richRenderingEnabled }),
  ...(context.aiHistory.themeSignature === undefined
    ? {}
    : { themeSignature: context.aiHistory.themeSignature }),
  ...(context.aiHistory.defaultProfileId === undefined
    ? {}
    : { defaultProfileId: context.aiHistory.defaultProfileId }),
  ...(context.aiHistory.defaultProviderId === undefined
    ? {}
    : { defaultProviderId: context.aiHistory.defaultProviderId }),
  ...(context.aiHistory.openDialog === undefined
    ? {}
    : { openDialog: context.aiHistory.openDialog })
});

export const createTerminalWorkspaceModel = (
  tab: WorkspaceTab,
  context: WorkspaceSurfaceRenderContext
): WorkspaceSurfaceRenderModel => {
  if (tab.terminalTabId === undefined) {
    return { kind: "empty" };
  }
  const terminalTab = context.terminalModel.findTab(tab.terminalTabId);
  if (terminalTab === null) {
    return { kind: "empty" };
  }
  return {
    kind: "terminalWorkspace",
    props: {
      desktopApi: context.desktopApi,
      labels: context.terminalLabels,
      themeSignature: context.terminalThemeSignature,
      themePresetId: context.terminalThemePreset,
      uiThemeId: context.resolvedThemeId,
      tab: terminalTab,
      panes: context.terminalModel.getTabPanes(terminalTab.id),
      onFocusPane: (paneId) => {
        context.terminalModel.focusPane(terminalTab.id, paneId);
      }
    }
  };
};

export const createAppSurfaceRenderModel = (
  tab: WorkspaceTab,
  context: WorkspaceSurfaceRenderContext
): WorkspaceSurfaceRenderModel => {
  if (tab.appId === undefined) {
    return { kind: "empty" };
  }

  if (isFileManagerAppId(tab.appId) && tab.appInstanceId !== undefined) {
    const state = context.fileManagerModel.getState(tab.appInstanceId);
    if (state === null) {
      return { kind: "empty" };
    }
    return {
      kind: "fileManager",
      props: {
        state,
        labels: context.fileManagerLabels,
        model: context.fileManagerModel,
        onOpenFile: context.onOpenFileFromManager,
        chooser: context.resolveFileManagerChooser?.(tab.appInstanceId) ?? null
      }
    };
  }

  if (isFileEditorAppId(tab.appId) && tab.appInstanceId !== undefined) {
    const state = context.fileEditorModel.getState(tab.appInstanceId);
    if (state === null) {
      return { kind: "empty" };
    }
    return {
      kind: "fileEditor",
      props: createFileEditorProps(state, context)
    };
  }

  if (isNotificationCenterAppId(tab.appId)) {
    return {
      kind: "notificationCenter",
      props: {
        labels: context.notifications.labels,
        notifications: context.notifications.model.notifications,
        selectedNotificationId: context.notifications.model.selectedNotificationId,
        onSelectNotification: context.notifications.model.selectNotification,
        onMarkAllRead: context.notifications.model.markAllNotificationsRead,
        onClearAll: context.notifications.onRequestClearAll,
        onOpenNotificationSource: context.notifications.onOpenNotificationSource
      }
    };
  }

  if (isAiMcpAppId(tab.appId)) {
    return {
      kind: "mcpCenter",
      props: {
        model: context.mcpCenter.model,
        labels: context.mcpCenter.labels
      }
    };
  }

  if (isAiSkillsAppId(tab.appId)) {
    return {
      kind: "skillsCenter",
      props: {
        model: context.skillsCenter.model,
        labels: context.skillsCenter.labels
      }
    };
  }

  if (isAiPluginsAppId(tab.appId)) {
    return {
      kind: "pluginsCenter",
      props: {
        model: context.pluginsCenter.model,
        labels: context.pluginsCenter.labels
      }
    };
  }

  if (isAiHistoryAppId(tab.appId)) {
    return {
      kind: "aiHistory",
      props: createAiHistoryProps(context)
    };
  }

  return { kind: "empty" };
};
