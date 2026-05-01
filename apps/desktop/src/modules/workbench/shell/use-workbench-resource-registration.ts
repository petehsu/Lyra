import { useEffect, useRef } from "react";

import type {
  LyraDesktopApi,
  LyraResourceLifecycleState,
  LyraResourceRegisterRequest
} from "../../../shared/desktop-bridge";
import type { FileEditorModel } from "../file-editor";
import type { FileManagerModel } from "../file-manager";
import type { TerminalDockModel } from "../terminal-dock";
import type { WorkspaceTabsModel, WorkspaceVisibleLayout } from "../workspace-tabs";

type UseWorkbenchResourceRegistrationParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
  readonly visibleWorkspaceLayout: WorkspaceVisibleLayout;
  readonly fileManagerModel: FileManagerModel;
  readonly fileEditorModel: FileEditorModel;
  readonly terminalModel: TerminalDockModel;
};

const resolveLifecycleState = (
  tabId: string,
  tabsModel: WorkspaceTabsModel,
  visibleWorkspaceLayout: WorkspaceVisibleLayout
): LyraResourceLifecycleState => {
  if (tabId === tabsModel.activeTabId) {
    return "foreground";
  }
  if (visibleWorkspaceLayout.visibleTabIds.includes(tabId)) {
    return "visible";
  }
  return "hot-hidden";
};

const resolvePageCoreKey = (address: string): string => {
  try {
    const parsed = new URL(address);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return address;
  }
};

export const useWorkbenchResourceRegistration = ({
  desktopApi,
  tabsModel,
  visibleWorkspaceLayout,
  fileManagerModel,
  fileEditorModel,
  terminalModel
}: UseWorkbenchResourceRegistrationParams): void => {
  const previousResourceIdsRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (desktopApi === null || desktopApi.resources === undefined) {
      return;
    }

    const requests: LyraResourceRegisterRequest[] = tabsModel.tabs.map((tab) => {
      const lifecycleState = resolveLifecycleState(tab.id, tabsModel, visibleWorkspaceLayout);
      const visible = visibleWorkspaceLayout.visibleTabIds.includes(tab.id);
      const base = {
        resourceId: `view:${tab.id}`,
        label: tab.title,
        viewId: tab.id,
        lifecycleState,
        tabId: tab.id,
        address: tab.displayAddress,
        visible
      } satisfies Partial<LyraResourceRegisterRequest>;

      if (tab.pageKind === "page") {
        return {
          ...base,
          kind: "workspace-page-view",
          stateKey: `web-state:${tab.id}`,
          coreKey: resolvePageCoreKey(tab.displayAddress)
        } as LyraResourceRegisterRequest;
      }

      if (tab.pageKind === "terminal" && tab.terminalTabId !== undefined) {
        const terminalTab = terminalModel.findTab(tab.terminalTabId);
        return {
          ...base,
          kind: "terminal-view",
          stateKey: `terminal-state:${tab.terminalTabId}`,
          coreKey: `terminal:${tab.terminalTabId}`,
          label: terminalTab?.title ?? tab.title
        } as LyraResourceRegisterRequest;
      }

      if (tab.pageKind === "app" && tab.appId === "file-manager" && tab.appInstanceId !== undefined) {
        const state = fileManagerModel.getState(tab.appInstanceId);
        const path = state?.currentLocation?.path ?? tab.appInstanceId;
        return {
          ...base,
          kind: "file-manager-view",
          stateKey: `file-manager-state:${tab.appInstanceId}`,
          coreKey: `file-graph:${path}`
        } as LyraResourceRegisterRequest;
      }

      if (tab.pageKind === "app" && tab.appId === "file-editor" && tab.appInstanceId !== undefined) {
        const state = fileEditorModel.getState(tab.appInstanceId);
        const filePath = state?.filePath ?? tab.filePath ?? tab.appInstanceId;
        return {
          ...base,
          kind: "file-editor-view",
          stateKey: `file-editor-state:${tab.appInstanceId}`,
          coreKey: `file-buffer:${filePath}`
        } as LyraResourceRegisterRequest;
      }

      if (tab.pageKind === "app" && tab.appId !== undefined && tab.appInstanceId !== undefined) {
        return {
          ...base,
          kind: "workspace-app-view",
          stateKey: `app-state:${tab.appId}:${tab.appInstanceId}`,
          coreKey: `app-core:${tab.appId}`
        } as LyraResourceRegisterRequest;
      }

      return {
        ...base,
        kind: `workspace-${tab.pageKind}-view`,
        stateKey: `workspace-state:${tab.id}`,
        coreKey: `workspace-core:${tab.pageKind}`
      } as LyraResourceRegisterRequest;
    });

    const nextResourceIds = new Set(requests.map((request) => request.resourceId));
    for (const request of requests) {
      void desktopApi.resources.registerOrUpdate(request).catch(() => undefined);
    }
    for (const previousId of previousResourceIdsRef.current) {
      if (nextResourceIds.has(previousId)) {
        continue;
      }
      void desktopApi.resources.remove(previousId).catch(() => undefined);
    }
    previousResourceIdsRef.current = nextResourceIds;
  }, [
    desktopApi,
    fileEditorModel,
    fileManagerModel,
    tabsModel,
    tabsModel.activeTabId,
    tabsModel.tabs,
    terminalModel,
    visibleWorkspaceLayout
  ]);
};
