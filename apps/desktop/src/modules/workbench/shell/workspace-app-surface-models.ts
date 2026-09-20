import {
  isFileEditorAppId,
  isFileManagerAppId,
  isImageViewerAppId,
  isAgentGitAppId,
  isAgentPlanBoardAppId,
  isAgentSubagentAppId,
  isAgentProjectTreeAppId,
  isAgentSessionHistoryAppId,
  isSoftwareStoreAppId
} from "../workspace-apps/service";
import {
  isWorkspaceAppModuleLoaded,
  isWorkspaceAppModuleSurfaceReady,
  isWorkspaceProductComponent,
  isWorkspaceProductSurfaceComplete,
  resolveWorkspaceApp
} from "../workspace-apps/registry";
import type { WorkspaceTab } from "../workspace-tabs/types";
import type {
  SurfacePropsByKind,
  WorkspaceSurfaceRenderContext,
  WorkspaceSurfaceRenderModel
} from "./workspace-surface-types";
import {
  createSoftwareStoreAppRequest,
  requestSoftwareStoreDetail
} from "../software-store/service";
import { createImageViewerIdleState } from "../image-viewer/service";

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
      themeSignature: context.resolvedThemeId,
      uiThemeId: context.resolvedThemeId,
      tab: terminalTab,
      panes: context.terminalModel.getTabPanes(terminalTab.id),
      onFocusPane: (paneId) => {
        context.terminalModel.focusPane(terminalTab.id, paneId);
      },
      onClosePane: (paneId) => {
        context.terminalModel.closePane(terminalTab.id, paneId);
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

const createUnavailableAppModel = (
  tab: WorkspaceTab,
  context: WorkspaceSurfaceRenderContext,
  componentId?: string
): WorkspaceSurfaceRenderModel => ({
  kind: "unavailableApp",
  appId: tab.appId ?? "",
  ...(tab.appVersion === undefined ? {} : { appVersion: tab.appVersion }),
  title: tab.title,
  description: context.softwareStore.labels.moduleUnavailableDescription,
  repairLabel: context.softwareStore.labels.repairModule,
  onRepair: () => {
    if (componentId !== undefined) {
      requestSoftwareStoreDetail({
        kind: "component",
        id: componentId
      });
    }
    context.tabsModel.openAppTab(
      createSoftwareStoreAppRequest(context.softwareStore.labels.tabTitle)
    );
  }
});

const createFileManagerSurfaceModel = (
  tab: WorkspaceTab,
  context: WorkspaceSurfaceRenderContext
): WorkspaceSurfaceRenderModel => {
  if (tab.appInstanceId === undefined) {
    return { kind: "empty" };
  }
  const state = context.fileManagerModel.getState(tab.appInstanceId);
  if (state === null) {
    return { kind: "empty" };
  }
  return {
    kind: "fileManager",
    props: {
      desktopApi: context.desktopApi,
      state,
      labels: context.fileManagerLabels,
      model: context.fileManagerModel,
      onOpenFile: context.onOpenFileFromManager,
      ...(context.onOpenFavoriteFromFileManager === undefined
        ? {}
        : { onOpenFavorite: context.onOpenFavoriteFromFileManager }),
      chooser: context.resolveFileManagerChooser?.(tab.appInstanceId) ?? null,
      downloadsSlot: {
        title: context.fileManagerLabels.downloadManagerTitle,
        repairLabel: context.softwareStore.labels.repairModule,
        description: context.softwareStore.labels.moduleUnavailableDescription,
        startFailedDescription: context.softwareStore.labels.moduleStartFailed,
        onRepair: () => {
          requestSoftwareStoreDetail({
            kind: "component",
            id: "lyra.downloads"
          });
          context.tabsModel.openAppTab(
            createSoftwareStoreAppRequest(context.softwareStore.labels.tabTitle)
          );
        }
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

  const descriptor = resolveWorkspaceApp(tab.appId);
  if (
    descriptor !== undefined
    && isWorkspaceProductComponent(descriptor.componentId)
    && (
      tab.appVersion === undefined
      || !isWorkspaceAppModuleLoaded(descriptor.componentId, tab.appVersion)
      || (
        isWorkspaceProductSurfaceComplete(descriptor.componentId)
        && !isWorkspaceAppModuleSurfaceReady(descriptor.componentId, tab.appVersion)
      )
    )
  ) {
    return createUnavailableAppModel(tab, context, descriptor.componentId);
  }

  if (
    descriptor !== undefined
    && tab.appVersion !== undefined
    && tab.appInstanceId !== undefined
    && isWorkspaceAppModuleSurfaceReady(descriptor.componentId, tab.appVersion)
  ) {
    return {
      kind: "dynamicApp",
      instanceId: tab.appInstanceId,
      title: tab.title,
      repairLabel: context.softwareStore.labels.repairModule,
      startFailedDescription: context.softwareStore.labels.moduleStartFailed,
      onRepair: () => {
        requestSoftwareStoreDetail({
          kind: "component",
          id: descriptor.componentId
        });
        context.tabsModel.openAppTab(
          createSoftwareStoreAppRequest(context.softwareStore.labels.tabTitle)
        );
      }
    };
  }

  if (isFileManagerAppId(tab.appId) && tab.appInstanceId !== undefined) {
    return createFileManagerSurfaceModel(tab, context);
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
    const state = context.imageViewerModel.getState(tab.appInstanceId)
      ?? createImageViewerIdleState(tab.appInstanceId, tab.filePath ?? "");
    return {
      kind: "imageViewer",
      props: {
        state,
        labels: context.imageViewerLabels,
        model: context.imageViewerModel,
        themeSignature: context.resolvedThemeId,
        fileEditorModel: context.fileEditorModel,
        fileEditorLabels: context.fileEditorLabels
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
        imageViewerModel: context.imageViewerModel,
        imageViewerLabels: context.imageViewerLabels,
        themeSignature: context.resolvedThemeId,
        openDialog: context.agentSessionHistory.openDialog,
        onOpenFile: context.onOpenFileFromManager,
        onOpenTerminal: (cwd) => {
          const slashIndex = Math.max(cwd.lastIndexOf("/"), cwd.lastIndexOf("\\"));
          const title = slashIndex >= 0 ? cwd.slice(slashIndex + 1) || cwd : cwd;
          const created = context.terminalModel.openTabWithPlacement({
            placement: "workspace",
            cwd,
            title
          });
          context.tabsModel.openTerminalTab(created.tab.id, created.tab.title);
        },
        onOpenGitPanel: context.onOpenAgentGit,
        ...(context.onOpenProjectProblems === undefined
          ? {}
          : { onOpenProblems: context.onOpenProjectProblems })
      }
    };
  }

  if (isAgentPlanBoardAppId(tab.appId) && tab.appInstanceId !== undefined) {
    const appInstanceId = tab.appInstanceId;
    const state = context.agentPlanBoardModel.getState(appInstanceId);
    if (state === null) {
      return { kind: "empty" };
    }
    return {
      kind: "agentPlanBoard",
      props: {
        labels: context.agentPlanBoardLabels,
        state,
        desktopApi: context.desktopApi,
        onOpenManagedPlan: (planId) =>
          context.agentPlanBoardModel.openManagedPlan(appInstanceId, planId),
        onDeleteManagedPlan: (planId) =>
          context.agentPlanBoardModel.deleteManagedPlan(appInstanceId, planId),
        onRefreshManager: () =>
          context.agentPlanBoardModel.refreshManager(appInstanceId),
        onRevisePlan: (request) =>
          context.agentPlanBoardModel.revisePlan(appInstanceId, request),
        openDialog: context.agentSessionHistory.openDialog,
        ...(context.onOpenAgentSubagent === undefined
          ? {}
          : { onOpenSubagent: context.onOpenAgentSubagent })
      }
    };
  }

  if (isAgentSubagentAppId(tab.appId) && tab.appInstanceId !== undefined) {
    const state = context.agentSubagentModel.getState(tab.appInstanceId);
    if (state === null) {
      return { kind: "empty" };
    }
    return {
      kind: "agentSubagent",
      props: {
        labels: context.agentSubagentLabels,
        state,
        desktopApi: context.desktopApi,
        ...(context.onOpenFileFromManager === undefined
          ? {}
          : { onOpenFile: context.onOpenFileFromManager }),
        ...(context.onOpenSearchResult === undefined
          ? {}
          : {
              onOpenUrl: (url: string, title?: string) => {
                context.onOpenSearchResult(url, title ?? url);
              }
            }),
        ...(context.onRevealPathInFileManager === undefined
          ? {}
          : { onRevealPath: context.onRevealPathInFileManager }),
        ...(context.onOpenAgentSubagent === undefined
          ? {}
          : { onOpenSubagent: context.onOpenAgentSubagent })
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

  if (isAgentSessionHistoryAppId(tab.appId)) {
    return {
      kind: "agentSessionHistory",
      props: {
        desktopApi: context.desktopApi,
        labels: context.agentSessionHistory.labels,
        activeSessionId: context.agentSessionHistory.activeSessionId,
        onOpenSession: context.agentSessionHistory.onOpenSession,
        ...(context.agentSessionHistory.onCreateProjectSession === undefined
          ? {}
          : { onCreateProjectSession: context.agentSessionHistory.onCreateProjectSession }),
        ...(context.agentSessionHistory.onSessionDeleted === undefined
          ? {}
          : { onSessionDeleted: context.agentSessionHistory.onSessionDeleted }),
        openDialog: context.agentSessionHistory.openDialog,
        query: context.agentSessionHistory.query ?? "",
        refreshRequestKey: context.agentSessionHistory.refreshRequestKey ?? 0,
        locateRequest: context.agentSessionHistory.locateRequest ?? null,
        browserHistory: context.agentSessionHistory.browserHistory ?? [],
        ...(context.agentSessionHistory.browserHistoryPreviewPageId === undefined
          ? {}
          : { browserHistoryPreviewPageId: context.agentSessionHistory.browserHistoryPreviewPageId }),
        ...(context.agentSessionHistory.onBrowserHistoryPreviewChange === undefined
          ? {}
          : { onBrowserHistoryPreviewChange: context.agentSessionHistory.onBrowserHistoryPreviewChange }),
        ...(context.agentSessionHistory.onBrowserHistoryPreviewHostChange === undefined
          ? {}
          : { onBrowserHistoryPreviewHostChange: context.agentSessionHistory.onBrowserHistoryPreviewHostChange }),
        ...(context.agentSessionHistory.onOpenBrowserHistoryEntry === undefined
          ? {}
          : { onOpenBrowserHistoryEntry: context.agentSessionHistory.onOpenBrowserHistoryEntry }),
        ...(context.agentSessionHistory.locale === undefined
          ? {}
          : { locale: context.agentSessionHistory.locale })
      }
    };
  }

  if (isSoftwareStoreAppId(tab.appId)) {
    return {
      kind: "softwareStore",
      props: context.softwareStore
    };
  }

  return createUnavailableAppModel(tab, context, descriptor?.componentId);
};
