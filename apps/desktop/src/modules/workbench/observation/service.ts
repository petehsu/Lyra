import type {
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
