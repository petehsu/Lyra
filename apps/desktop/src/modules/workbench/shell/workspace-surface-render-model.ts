import type { WorkspaceTab } from "../workspace-tabs/types";
import {
  createAppSurfaceRenderModel,
  createTerminalWorkspaceModel
} from "./workspace-app-surface-models";
import {
  createDeepSearchResultsModel,
  createSearchHomeModel,
  createSearchResultsModel
} from "./workspace-search-surface-models";
import type {
  WorkspaceSurfaceRenderContext,
  WorkspaceSurfaceRenderModel
} from "./workspace-surface-types";

export type { WorkspaceSurfaceRenderModel } from "./workspace-surface-types";

export const createWorkspaceSurfaceRenderModel = (
  tab: WorkspaceTab,
  context: WorkspaceSurfaceRenderContext
): WorkspaceSurfaceRenderModel => {
  if (tab.pageKind === "results") {
    const resultMode = tab.resultMode ?? tab.searchMode ?? "standard";
    return resultMode === "deep"
      ? createDeepSearchResultsModel(tab, context)
      : createSearchResultsModel(tab, context);
  }

  if (tab.pageKind === "page") {
    return {
      kind: "browserPage",
      props: {
        tabId: tab.id,
        onHostChange: context.onPageHostChange
      }
    };
  }

  if (tab.pageKind === "search") {
    return createSearchHomeModel(tab, context);
  }

  if (tab.pageKind === "settings") {
    return {
      kind: "settings",
      props: context.settings
    };
  }

  if (tab.pageKind === "terminal") {
    return createTerminalWorkspaceModel(tab, context);
  }

  if (tab.pageKind === "app") {
    return createAppSurfaceRenderModel(tab, context);
  }

  return { kind: "empty" };
};
