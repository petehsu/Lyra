import type { WorkbenchWebActionRequest } from "../../../shared/workbench-web-automation";
import type { WorkbenchWebAutomationCache } from "../cache";
import type { WorkbenchWebAutomationServiceDeps } from "../types";

export type WorkbenchWebServiceGuardsRuntime = {
  readonly createWebAutomationError: (...args: any[]) => Error;
  readonly safeActions: ReadonlySet<string>;
  readonly mutateActions: ReadonlySet<string>;
  readonly navigateActions: ReadonlySet<string>;
};

export const createWorkbenchWebServiceGuards = (
  runtime: WorkbenchWebServiceGuardsRuntime
): {
  readonly resolveTabId: (
    deps: WorkbenchWebAutomationServiceDeps,
    requestedTabId?: string
  ) => string;
  readonly assertActiveVisiblePage: (
    deps: WorkbenchWebAutomationServiceDeps,
    tabId: string
  ) => void;
  readonly assertActionAllowed: (
    request: WorkbenchWebActionRequest,
    mode: "safe" | "mutate" | "navigate"
  ) => void;
  readonly invalidateTabGraphCache: (
    cache: WorkbenchWebAutomationCache,
    tabId: string,
    graphId?: string
  ) => void;
} => {
  const { createWebAutomationError, safeActions, mutateActions, navigateActions } = runtime;

  const resolveTabId = (
    deps: WorkbenchWebAutomationServiceDeps,
    requestedTabId?: string
  ): string => {
    if (typeof requestedTabId === "string" && requestedTabId.trim().length > 0) {
      const normalized = requestedTabId.trim();
      if (
        normalized !== "active-tab"
        && normalized !== "current-tab"
        && normalized !== "active"
        && normalized !== "current"
      ) {
        return normalized;
      }
    }
    const active = deps.browserBridge.readActiveTabId();
    if (active === null || active.length === 0) {
      throw createWebAutomationError(
        "tab_not_found",
        "active page tab not found",
        "precondition",
        true
      );
    }
    return active;
  };

  const assertActiveVisiblePage = (
    deps: WorkbenchWebAutomationServiceDeps,
    tabId: string
  ): void => {
    const activeTabId = deps.browserBridge.readActiveTabId();
    const state = deps.browserBridge.readPageState({ tabId });
    if (state === null || activeTabId !== tabId || state.isVisible !== true) {
      throw createWebAutomationError(
        "active_visible_page_required",
        "web automation requires the active visible page tab",
        "precondition",
        true,
        {
          details: {
            activeTabId,
            requestedTabId: tabId,
            isVisible: state?.isVisible ?? false
          }
        }
      );
    }
  };

  const assertActionAllowed = (
    request: WorkbenchWebActionRequest,
    mode: "safe" | "mutate" | "navigate"
  ): void => {
    const kind = request.action.kind;
    if (mode === "safe" && safeActions.has(kind)) {
      return;
    }
    if (mode === "mutate" && mutateActions.has(kind)) {
      return;
    }
    if (mode === "navigate" && navigateActions.has(kind)) {
      return;
    }
    throw createWebAutomationError(
      "action_blocked_by_policy",
      `action ${kind} is not allowed in ${mode} mode`,
      "precondition",
      false
    );
  };

  const invalidateTabGraphCache = (
    cache: WorkbenchWebAutomationCache,
    tabId: string,
    graphId?: string
  ): void => {
    cache.graphByTab.remove(tabId);
    if (typeof graphId === "string") {
      cache.graphById.remove(graphId);
    }
  };

  return {
    resolveTabId,
    assertActiveVisiblePage,
    assertActionAllowed,
    invalidateTabGraphCache,
  };
};
