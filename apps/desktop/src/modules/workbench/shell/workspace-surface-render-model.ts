import type { WorkspaceTab } from "../workspace-tabs/types";
import {
  createAppSurfaceRenderModel,
  createTerminalWorkspaceModel
} from "./workspace-app-surface-models";
import {
  createSearchHomeModel,
  createSearchResultsModel,
  applySearchEngineSelection,
  resolveTabSearchSelection
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
    return createSearchResultsModel(tab, context);
  }

  if (tab.pageKind === "page") {
    const selection = resolveTabSearchSelection(tab);
    return {
      kind: "browserPage",
      props: {
        tabId: tab.id,
        ...(tab.searchQuery === undefined
          ? {}
          : {
              searchQuery: tab.searchQuery,
              searchSource: tab.searchSource,
              searchEngineSelectionMode: selection.mode,
              searchSelectedEngineIds: selection.engineIds,
              searchEngines: context.searchEngines,
              sourceFilterLabel: context.i18n.resultsSourceFilter,
              autoSearchLabel: context.i18n.resultsAutoTab,
              webTabLabel: context.i18n.resultsWebTab,
              onSearchEngineSelectionChange: (nextSelection) => {
                void applySearchEngineSelection(
                  context,
                  tab.searchQuery ?? "",
                  nextSelection
                );
              }
            }),
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
