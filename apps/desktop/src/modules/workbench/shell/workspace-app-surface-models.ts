import {
  isFileEditorAppId,
  isFileManagerAppId,
  isImageViewerAppId,
  isAgentGitAppId,
  isAgentProjectTreeAppId,
  isAgentSelfDevAppId,
  isAgentOvernightAppId,
  isAgentSessionHistoryAppId,
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
      },
      onOpenTab: context.terminalModel.openTab,
      onSplitHorizontal: () => {
        context.terminalModel.splitTab(terminalTab.id, "horizontal");
      },
      onSplitVertical: () => {
        context.terminalModel.splitTab(terminalTab.id, "vertical");
      },
      onMoveToDock: () => {
        context.terminalModel.moveTabToDock(terminalTab.id);
        context.tabsModel.closeTerminalTab(terminalTab.id);
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

  if (isImageViewerAppId(tab.appId) && tab.appInstanceId !== undefined) {
    const state = context.imageViewerModel.getState(tab.appInstanceId);
    if (state === null) {
      return { kind: "empty" };
    }
    return {
      kind: "imageViewer",
      props: {
        state,
        labels: context.imageViewerLabels,
        model: context.imageViewerModel,
        themeSignature: context.resolvedThemeId
      }
    };
  }

  if (isAgentProjectTreeAppId(tab.appId) && tab.appInstanceId !== undefined) {
    const state = context.agentProjectTreeModel.getState(tab.appInstanceId);
    if (state === null) {
      return { kind: "empty" };
    }
    return {
      kind: "agentProjectTree",
      props: {
        desktopApi: context.desktopApi,
        labels: context.agentProjectTreeLabels,
        state,
        model: context.agentProjectTreeModel,
        fileEditorModel: context.fileEditorModel,
        fileEditorLabels: context.fileEditorLabels,
        themeSignature: context.resolvedThemeId,
        onOpenGitPanel: context.onOpenAgentGit
      }
    };
  }

  if (isAgentGitAppId(tab.appId)) {
    const rootPath = tab.filePath?.trim() ?? "";
    if (rootPath.length === 0) {
      return { kind: "empty" };
    }
    return {
      kind: "agentGit",
      props: {
        desktopApi: context.desktopApi,
        labels: context.agentGitLabels,
        agentSessionId: tab.fileSessionId ?? tab.appInstanceId ?? tab.id,
        rootPath,
        title: tab.title
      }
    };
  }

  if (isAgentSelfDevAppId(tab.appId)) {
    return {
      kind: "agentSelfDev",
      props: {
        desktopApi: context.desktopApi,
        labels: context.agentSelfDevLabels,
        parentSessionId: tab.fileSessionId ?? null,
        ...(context.agentSelfDevLocale === undefined
          ? {}
          : { locale: context.agentSelfDevLocale })
      }
    };
  }

  if (isAgentOvernightAppId(tab.appId)) {
    return {
      kind: "agentOvernight",
      props: {
        desktopApi: context.desktopApi,
        labels: context.agentOvernightLabels,
        parentSessionId: tab.fileSessionId ?? null,
        ...(context.agentOvernightLocale === undefined
          ? {}
          : { locale: context.agentOvernightLocale })
      }
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

  if (isAgentSessionHistoryAppId(tab.appId)) {
    return {
      kind: "agentSessionHistory",
      props: {
        desktopApi: context.desktopApi,
        labels: context.agentSessionHistory.labels,
        activeSessionId: context.agentSessionHistory.activeSessionId,
        onOpenSession: context.agentSessionHistory.onOpenSession,
        ...(context.agentSessionHistory.locale === undefined
          ? {}
          : { locale: context.agentSessionHistory.locale })
      }
    };
  }

  return { kind: "empty" };
};
