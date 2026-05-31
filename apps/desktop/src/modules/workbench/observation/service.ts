import type {
  WorkbenchTerminalCloseRequest,
  WorkbenchTerminalCloseResult,
  WorkbenchTerminalFocusRequest,
  WorkbenchTerminalFocusResult,
  WorkbenchTerminalListResult,
  WorkbenchTerminalOpenRequest,
  WorkbenchTerminalOpenResult,
  WorkbenchTerminalPaneDescriptor,
  WorkbenchObservationQueryRequest,
  WorkbenchObservationQueryResult
} from "../../../shared/workbench-observation";
import type { WorkbenchObservationDependencies } from "./types";
import { listObservedTabs, readObservedLocalTab } from "./local-tab-readers";
import { readObservedWorkspace } from "./workspace-readers";

const toBridgeError = (
  requestId: string,
  code: WorkbenchObservationQueryResult["error"] extends infer T
    ? T extends { readonly code: infer Code }
      ? Code
      : never
    : never,
  message: string
): WorkbenchObservationQueryResult => ({
  requestId,
  ok: false,
  error: {
    code,
    message
  }
});

const terminalDescriptorForPane = (
  dependencies: WorkbenchObservationDependencies,
  terminalTabId: string,
  paneId: string
): WorkbenchTerminalPaneDescriptor | null => {
  const terminalTab = dependencies.terminalModel.findTab(terminalTabId);
  if (terminalTab === null) {
    return null;
  }
  const pane = dependencies.terminalModel.getTabPanes(terminalTab.id)
    .find((entry) => entry.id === paneId);
  if (pane === undefined) {
    return null;
  }
  const workspaceTab = dependencies.tabsModel.tabs.find(
    (tab) => tab.pageKind === "terminal" && tab.terminalTabId === terminalTab.id
  );
  return {
    terminalTabId: terminalTab.id,
    paneId: pane.id,
    sessionId: pane.sessionId,
    title: pane.title,
    placement: terminalTab.placement,
    isActive:
      terminalTab.id === dependencies.terminalModel.state.activeTabId
      && terminalTab.activePaneId === pane.id,
    ...(pane.cwd === undefined ? {} : { cwd: pane.cwd }),
    ...(pane.shell === undefined ? {} : { shell: pane.shell }),
    ...(workspaceTab === undefined ? {} : { workspaceTabId: workspaceTab.id })
  };
};

const listTerminalPanes = (
  dependencies: WorkbenchObservationDependencies
): WorkbenchTerminalListResult => {
  const panes = dependencies.terminalModel.state.tabs.flatMap((tab) =>
    tab.paneIds.flatMap((paneId) => {
      const descriptor = terminalDescriptorForPane(dependencies, tab.id, paneId);
      return descriptor === null ? [] : [descriptor];
    })
  );
  const layout = dependencies.tabsModel.getVisibleWorkspaceLayout();
  const focusedWorkspaceTabId =
    layout.mode === "split" ? layout.focusedSplitTabId : dependencies.tabsModel.activeTabId;
  const focusedWorkspaceTab = dependencies.tabsModel.tabs.find(
    (tab) => tab.id === focusedWorkspaceTabId
  );
  const focusedTerminalTabId =
    focusedWorkspaceTab?.pageKind === "terminal"
      ? focusedWorkspaceTab.terminalTabId
      : undefined;
  const active =
    (focusedTerminalTabId === undefined
      ? null
      : panes.find((pane) => pane.terminalTabId === focusedTerminalTabId && pane.isActive)
        ?? panes.find((pane) => pane.terminalTabId === focusedTerminalTabId)
        ?? null)
    ?? panes.find((pane) => pane.isActive)
    ?? panes[0]
    ?? null;
  return { active, panes };
};

const resolveTerminalPane = (
  request: WorkbenchTerminalFocusRequest | WorkbenchTerminalCloseRequest,
  dependencies: WorkbenchObservationDependencies
): WorkbenchTerminalPaneDescriptor | null => {
  const listed = listTerminalPanes(dependencies);
  const sessionId =
    typeof request.sessionId === "string" && request.sessionId.trim().length > 0
      ? request.sessionId.trim()
      : undefined;
  const paneId =
    typeof request.paneId === "string" && request.paneId.trim().length > 0
      ? request.paneId.trim()
      : undefined;
  const terminalTabId =
    typeof request.terminalTabId === "string" && request.terminalTabId.trim().length > 0
      ? request.terminalTabId.trim()
      : undefined;
  return listed.panes.find((pane) => (
    (sessionId === undefined || pane.sessionId === sessionId)
    && (paneId === undefined || pane.paneId === paneId)
    && (terminalTabId === undefined || pane.terminalTabId === terminalTabId)
  )) ?? null;
};

const openTerminalPane = (
  request: WorkbenchTerminalOpenRequest,
  dependencies: WorkbenchObservationDependencies
): WorkbenchTerminalOpenResult => {
  const placement = request.placement === "workspace" ? "workspace" : "dock";
  const { tab, pane } = dependencies.terminalModel.openTabWithPlacement({
    placement,
    ...(typeof request.title === "string" && request.title.trim().length > 0
      ? { title: request.title.trim() }
      : {}),
    ...(typeof request.cwd === "string" && request.cwd.trim().length > 0
      ? { cwd: request.cwd.trim() }
      : {})
  });
  if (placement === "workspace") {
    dependencies.tabsModel.openTerminalTab(tab.id, tab.title);
  }
  const descriptor = terminalDescriptorForPane(dependencies, tab.id, pane.id);
  return descriptor ?? {
    terminalTabId: tab.id,
    paneId: pane.id,
    sessionId: pane.sessionId,
    title: pane.title,
    placement,
    isActive: true
  };
};

const focusTerminalPane = (
  request: WorkbenchTerminalFocusRequest,
  dependencies: WorkbenchObservationDependencies
): WorkbenchTerminalFocusResult | null => {
  const target = resolveTerminalPane(request, dependencies);
  if (target === null) {
    return null;
  }
  dependencies.terminalModel.focusPane(target.terminalTabId, target.paneId);
  if (target.workspaceTabId !== undefined) {
    dependencies.tabsModel.setActiveTab(target.workspaceTabId);
  }
  return {
    ...target,
    isActive: true
  };
};

const closeTerminalPane = (
  request: WorkbenchTerminalCloseRequest,
  dependencies: WorkbenchObservationDependencies
): WorkbenchTerminalCloseResult => {
  const target = resolveTerminalPane(request, dependencies);
  if (target === null) {
    return { closed: false };
  }
  dependencies.terminalModel.closePane(target.terminalTabId, target.paneId);
  if (target.workspaceTabId !== undefined) {
    dependencies.tabsModel.closeTerminalTab(target.terminalTabId);
  }
  return {
    closed: true,
    terminalTabId: target.terminalTabId,
    paneId: target.paneId,
    sessionId: target.sessionId
  };
};

export const attachWorkbenchObservationBridge = (
  dependencies: WorkbenchObservationDependencies
): (() => void) => {
  const desktopApi = dependencies.desktopApi;
  if (desktopApi === null) {
    return () => undefined;
  }

  return desktopApi.workbenchObservation.registerHandler(
    async (request: WorkbenchObservationQueryRequest): Promise<WorkbenchObservationQueryResult> => {
      const requestId = request.requestId;
      try {
        if (request.method === "workbench.tabs.list_local") {
          return {
            requestId,
            ok: true,
            result: listObservedTabs(request.payload, dependencies)
          };
        }
        if (request.method === "workbench.workspace.read_local") {
          return {
            requestId,
            ok: true,
            result: readObservedWorkspace(request.payload, dependencies)
          };
        }
        if (request.method === "workbench.tab.activate_local") {
          const tabId = request.payload.tabId.trim();
          const tabExists = dependencies.tabsModel.tabs.some((tab) => tab.id === tabId);
          if (!tabExists) {
            return toBridgeError(
              requestId,
              "tab_not_found",
              `Workbench tab not found: ${tabId}`
            );
          }
          dependencies.tabsModel.setActiveTab(tabId);
          return {
            requestId,
            ok: true,
            result: {
              tabId,
              activeTabId: tabId
            }
          };
        }
        if (request.method === "workbench.terminal.list_local") {
          return {
            requestId,
            ok: true,
            result: listTerminalPanes(dependencies)
          };
        }
        if (request.method === "workbench.terminal.open_local") {
          return {
            requestId,
            ok: true,
            result: openTerminalPane(request.payload, dependencies)
          };
        }
        if (request.method === "workbench.terminal.focus_local") {
          const result = focusTerminalPane(request.payload, dependencies);
          if (result === null) {
            return toBridgeError(
              requestId,
              "terminal_unavailable",
              "Terminal pane not found."
            );
          }
          return {
            requestId,
            ok: true,
            result
          };
        }
        if (request.method === "workbench.terminal.close_local") {
          return {
            requestId,
            ok: true,
            result: closeTerminalPane(request.payload, dependencies)
          };
        }
        if (request.method === "workbench.tab.read_local") {
          const result = readObservedLocalTab(request.payload, dependencies);
          if ("code" in result) {
            return {
              requestId,
              ok: false,
              error: result
            };
          }
          return {
            requestId,
            ok: true,
            result
          };
        }
        return toBridgeError(
          requestId,
          "unsupported_tab_kind",
          "Unsupported workbench observation method."
        );
      } catch (error: unknown) {
        return toBridgeError(
          requestId,
          "renderer_bridge_unavailable",
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  );
};
