import {
  isFileEditorAppId,
  isFileManagerAppId,
  isImageViewerAppId,
  isNotificationCenterAppId,
  isResourceMonitorAppId
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

  if (isResourceMonitorAppId(tab.appId)) {
    return {
      kind: "resourceMonitor",
      props: {
        desktopApi: context.desktopApi,
        labels: context.resourceMonitor.labels
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

  return { kind: "empty" };
};
