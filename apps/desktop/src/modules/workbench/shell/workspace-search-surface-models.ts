import type { WorkspaceTab } from "../workspace-tabs/types";
import {
  resolveManualWebSearchTargets,
  resolveWebSearchTarget
} from "../browser-search/service";
import type { WorkspaceSearchEngineSelection } from "../workspace-tabs";
import type {
  WorkspaceSurfaceRenderContext,
  WorkspaceSurfaceRenderModel
} from "./workspace-surface-types";

export const resolveTabSearchSelection = (
  tab: WorkspaceTab
): WorkspaceSearchEngineSelection => ({
  mode: tab.searchEngineSelectionMode ?? "auto",
  engineIds: tab.searchSelectedEngineIds ?? []
});

export const applySearchEngineSelection = async (
  context: WorkspaceSurfaceRenderContext,
  query: string,
  selection: WorkspaceSearchEngineSelection
): Promise<void> => {
  if (selection.mode === "auto") {
    const target = await resolveWebSearchTarget({
      desktopApi: context.desktopApi,
      query,
      searchEngines: context.autoSearchEngines
    });
    if (target === null) {
      context.tabsModel.openLocalSearchTab(
        { query, selection },
        { target: "active-tab" }
      );
      return;
    }
    context.tabsModel.openWebSearchTabs(
      {
        query,
        targets: [{
          address: target.searchUrl,
          engineId: target.engine.id,
          title: target.engine.label
        }],
        selection
      },
      { target: "active-tab" }
    );
    return;
  }

  const targets = resolveManualWebSearchTargets({
    query,
    engineIds: selection.engineIds,
    searchEngines: context.searchEngines
  });
  if (targets.length === 0) {
    return;
  }
  context.tabsModel.openWebSearchTabs(
    {
      query,
      targets: targets.map((target) => ({
        address: target.searchUrl,
        engineId: target.engine.id,
        title: target.engine.label
      })),
      selection
    },
    { target: "active-tab" }
  );
};

export const createSearchHomeModel = (
  tab: WorkspaceTab,
  context: WorkspaceSurfaceRenderContext
): WorkspaceSurfaceRenderModel => ({
  kind: "searchHome",
  props: {
    logoUrl: context.logoUrl,
    inputValue: tab.inputValue,
    placeholder: context.i18n.searchPlaceholder,
    searchActionLabel: context.i18n.searchActionLabel,
    sourceFilterLabel: context.i18n.resultsSourceFilter,
    autoSearchLabel: context.i18n.resultsAutoTab,
    searchEngines: context.searchEngines,
    onPillRef: (element) => {
      context.browserSearchModel.searchPillRef.current = element;
    },
    onInputChange: context.tabsModel.updateActiveInput,
    onSubmit: context.browserSearchModel.onSearchSurfaceSubmit,
    onSearchEngineSubmit: (engineId) => {
      void applySearchEngineSelection(
        context,
        tab.inputValue,
        { mode: "manual", engineIds: [engineId] }
      );
    }
  }
});

export const createSearchResultsModel = (
  tab: WorkspaceTab,
  context: WorkspaceSurfaceRenderContext
): WorkspaceSurfaceRenderModel => {
  const selection = resolveTabSearchSelection(tab);
  return {
    kind: "searchResults",
    props: {
    logoUrl: context.logoUrl,
    inputValue: tab.inputValue,
    placeholder: context.i18n.searchPlaceholder,
    searchActionLabel: context.i18n.searchActionLabel,
    headingLabel: context.i18n.resultsHeading,
    officialResultLabel: context.i18n.resultsOfficial,
    officialHomepageLabel: context.i18n.resultsOfficialHomepage,
    officialSubsiteLabel: context.i18n.resultsOfficialSubsite,
    officialDocsLabel: context.i18n.resultsOfficialDocs,
    officialLoginLabel: context.i18n.resultsOfficialLogin,
    officialDownloadLabel: context.i18n.resultsOfficialDownload,
    officialSupportLabel: context.i18n.resultsOfficialSupport,
    sourceFilterLabel: context.i18n.resultsSourceFilter,
    autoSearchLabel: context.i18n.resultsAutoTab,
    allTabLabel: context.i18n.resultsAllTab,
    emptyLabel:
      context.browserSearchModel.searchError === null
        ? context.i18n.resultsNoResults
        : `${context.i18n.resultsNoResults} · ${context.browserSearchModel.searchError}`,
    engineErrorLabel: context.i18n.resultsEngineError,
    webTabLabel: context.i18n.resultsWebTab,
    localTabLabel: context.i18n.resultsLocalTab,
    localTitleLabel: context.i18n.resultsLocalTitle,
    localPanelTitleLabel: context.i18n.resultsLocalPanelTitle,
    localNoMatchesLabel: context.i18n.resultsLocalNoMatches,
    localSearchingMoreLabel: context.i18n.resultsLocalSearchingMore,
    localScopeLabel: context.i18n.resultsLocalScope,
    localScannedFilesLabel: context.i18n.resultsLocalScannedFiles,
    localScannedDirsLabel: context.i18n.resultsLocalScannedDirs,
    localContentScansLabel: context.i18n.resultsLocalContentScans,
    localMatchedLabel: context.i18n.resultsLocalMatched,
    localScoreLabel: context.i18n.resultsLocalScore,
    localLineLabel: context.i18n.resultsLocalLine,
    localTimedOutLabel: context.i18n.resultsLocalTimedOut,
    channelIdleLabel: context.i18n.channelIdle,
    channelLoadingLabel: context.i18n.channelLoading,
    channelReadyLabel: context.i18n.channelReady,
    channelErrorLabel: context.i18n.channelError,
    sourceFilter: context.searchResultsSourceFilter,
    payload: context.browserSearchModel.standardSearchState,
    searchEngineSelectionMode: selection.mode,
    searchSelectedEngineIds: selection.engineIds,
    searchEngines: context.searchEngines,
    onSourceFilterChange: context.onSearchResultsSourceFilterChange,
    onSearchEngineSelectionChange: (nextSelection) => {
      void applySearchEngineSelection(
        context,
        tab.searchQuery ?? tab.query ?? tab.inputValue,
        nextSelection
      );
    },
    onSwitchToWebSearch: () => {
      void (async () => {
        const query = tab.searchQuery ?? tab.query ?? tab.inputValue;
        await applySearchEngineSelection(context, query, { mode: "auto", engineIds: [] });
      })();
    },
    sharedStartRect: context.browserSearchModel.sharedTransitionRect,
    onInputChange: context.tabsModel.updateActiveInput,
    onSubmit: context.tabsModel.commitActiveInput,
    onOpenUrl: context.onOpenSearchResult,
    onSharedAnimationDone: context.browserSearchModel.onSharedAnimationDone
    }
  };
};
