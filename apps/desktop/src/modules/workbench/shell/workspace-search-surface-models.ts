import type { WorkspaceTab } from "../workspace-tabs/types";
import type {
  SurfacePropsByKind,
  WorkspaceSurfaceRenderContext,
  WorkspaceSurfaceRenderModel
} from "./workspace-surface-types";

export const createDeepSearchLabels = (
  i18n: WorkspaceSurfaceRenderContext["i18n"]
): SurfacePropsByKind["deepSearchResults"]["labels"] => ({
  headingLabel: i18n.deepSearchHeading,
  deepSearchToggleLabel: i18n.deepSearchToggle,
  deepSearchChipLabel: i18n.deepSearchChip,
  stopLabel: i18n.deepSearchStop,
  fitViewLabel: i18n.deepSearchFitView,
  resetLayoutLabel: i18n.deepSearchResetLayout,
  loadingLabel: i18n.deepSearchLoading,
  emptyLabel: i18n.deepSearchEmpty,
  officialResultLabel: i18n.resultsOfficial,
  officialHomepageLabel: i18n.resultsOfficialHomepage,
  officialSubsiteLabel: i18n.resultsOfficialSubsite,
  officialDocsLabel: i18n.resultsOfficialDocs,
  officialLoginLabel: i18n.resultsOfficialLogin,
  officialDownloadLabel: i18n.resultsOfficialDownload,
  officialSupportLabel: i18n.resultsOfficialSupport,
  overviewLabel: i18n.deepSearchOverview,
  selectedNodeLabel: i18n.deepSearchSelectedNode,
  phaseLabel: i18n.deepSearchPhase,
  budgetLabel: i18n.deepSearchBudget,
  webStatusLabel: i18n.deepSearchWebStatus,
  localStatusLabel: i18n.deepSearchLocalStatus,
  dedupedLabel: i18n.deepSearchDeduped,
  derivedLabel: i18n.deepSearchDerived,
  roundsLabel: i18n.deepSearchRounds,
  sourceFilterLabel: i18n.resultsSourceFilter,
  webLabel: i18n.resultsWebTab,
  localLabel: i18n.resultsLocalTab,
  openLabel: i18n.deepSearchOpen,
  expandLabel: i18n.deepSearchExpand,
  centerLabel: i18n.deepSearchCenter,
  emptySelectionLabel: i18n.deepSearchNoSelection,
  allLabel: i18n.resultsAllTab,
  snippetLabel: i18n.deepSearchSnippet,
  sourceLabel: i18n.deepSearchSource,
  connectedLinksLabel: i18n.deepSearchConnectedLinks,
  edgeFiltersLabel: i18n.deepSearchEdgeFilters,
  directionLabel: i18n.deepSearchDirection,
  incomingLabel: i18n.deepSearchIncoming,
  outgoingLabel: i18n.deepSearchOutgoing,
  bothLabel: i18n.deepSearchBoth,
  discoveredLabel: i18n.deepSearchDiscovered,
  expandedLabel: i18n.deepSearchExpanded,
  relatedLabel: i18n.deepSearchRelated,
  hostsSubdomainLabel: i18n.deepSearchHostsSubdomain,
  containsPageLabel: i18n.deepSearchContainsPage,
  lineageLabel: i18n.deepSearchLineage,
  alternateLinksLabel: i18n.deepSearchAlternateLinks,
  revealInManagerLabel: i18n.deepSearchRevealInManager,
  matchKindLabel: i18n.deepSearchMatchKind,
  lineLabel: i18n.deepSearchLine,
  sharedTermsLabel: i18n.deepSearchSharedTerms,
  domainLabel: i18n.deepSearchDomain,
  subdomainLabel: i18n.deepSearchSubdomain,
  pageLabel: i18n.deepSearchPage,
  verifiedLabel: i18n.deepSearchVerified,
  guessedLabel: i18n.deepSearchGuessed,
  discoveredByLabel: i18n.deepSearchDiscoveredBy,
  verificationScoreLabel: i18n.deepSearchVerificationScore,
  guessedDomainsLabel: i18n.deepSearchGuessedDomains,
  verifiedDomainsLabel: i18n.deepSearchVerifiedDomains,
  subdomainsLabel: i18n.deepSearchSubdomains,
  visitedPagesLabel: i18n.deepSearchVisitedPages,
  queuedPagesLabel: i18n.deepSearchQueuedPages,
  droppedPagesLabel: i18n.deepSearchDroppedPages,
  siteExpansionStatusLabel: i18n.deepSearchSiteExpansionStatus
});

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
    deepSearchToggleLabel: context.i18n.deepSearchToggle,
    deepSearchEnabled: context.browserSearchModel.activeSearchMode === "deep",
    deepSearchChipLabel: context.i18n.deepSearchChip,
    onPillRef: (element) => {
      context.browserSearchModel.searchPillRef.current = element;
    },
    onInputChange: context.tabsModel.updateActiveInput,
    onSubmit: context.browserSearchModel.onSearchSurfaceSubmit,
    onToggleDeepSearch: context.browserSearchModel.onToggleDeepSearch
  }
});

export const createSearchResultsModel = (
  tab: WorkspaceTab,
  context: WorkspaceSurfaceRenderContext
): WorkspaceSurfaceRenderModel => ({
  kind: "searchResults",
  props: {
    logoUrl: context.logoUrl,
    inputValue: tab.inputValue,
    placeholder: context.i18n.searchPlaceholder,
    searchActionLabel: context.i18n.searchActionLabel,
    deepSearchToggleLabel: context.i18n.deepSearchToggle,
    deepSearchEnabled: context.browserSearchModel.activeSearchMode === "deep",
    deepSearchChipLabel: context.i18n.deepSearchChip,
    headingLabel: context.i18n.resultsHeading,
    blendLabel: context.i18n.resultsBlendTitle,
    engineOverviewLabel: context.i18n.resultsEngineOverview,
    officialResultLabel: context.i18n.resultsOfficial,
    officialHomepageLabel: context.i18n.resultsOfficialHomepage,
    officialSubsiteLabel: context.i18n.resultsOfficialSubsite,
    officialDocsLabel: context.i18n.resultsOfficialDocs,
    officialLoginLabel: context.i18n.resultsOfficialLogin,
    officialDownloadLabel: context.i18n.resultsOfficialDownload,
    officialSupportLabel: context.i18n.resultsOfficialSupport,
    sourceFilterLabel: context.i18n.resultsSourceFilter,
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
    onToggleDeepSearch: context.browserSearchModel.onToggleDeepSearch,
    onSourceFilterChange: context.onSearchResultsSourceFilterChange,
    sharedStartRect: context.browserSearchModel.sharedTransitionRect,
    engineById: context.engineById,
    onInputChange: context.tabsModel.updateActiveInput,
    onSubmit: context.tabsModel.commitActiveInput,
    onOpenUrl: context.onOpenSearchResult,
    onSharedAnimationDone: context.browserSearchModel.onSharedAnimationDone
  }
});

export const createDeepSearchResultsModel = (
  tab: WorkspaceTab,
  context: WorkspaceSurfaceRenderContext
): WorkspaceSurfaceRenderModel => ({
  kind: "deepSearchResults",
  props: {
    logoUrl: context.logoUrl,
    inputValue: tab.inputValue,
    placeholder: context.i18n.searchPlaceholder,
    searchActionLabel: context.i18n.searchActionLabel,
    deepSearchEnabled: context.browserSearchModel.activeSearchMode === "deep",
    labels: createDeepSearchLabels(context.i18n),
    snapshot: context.browserSearchModel.deepSearchState.snapshot,
    searching: context.browserSearchModel.isSearching,
    viewportMemoryKey: `${tab.id}:${tab.query ?? ""}`,
    restoreViewportEnabled: context.settings.deepSearchRestoreViewportValue,
    localOpenBehavior: context.settings.deepSearchLocalOpenBehaviorValue,
    sourceFilter: context.searchResultsSourceFilter,
    sharedStartRect: context.browserSearchModel.sharedTransitionRect,
    onInputChange: context.tabsModel.updateActiveInput,
    onSubmit: context.tabsModel.commitActiveInput,
    onToggleDeepSearch: context.browserSearchModel.onToggleDeepSearch,
    onCancel: context.browserSearchModel.onCancelDeepSearch,
    onExpandNode: context.browserSearchModel.onExpandDeepNode,
    onSourceFilterChange: context.onSearchResultsSourceFilterChange,
    onOpenUrl: context.onOpenSearchResult,
    onOpenLocalPath: context.onOpenFileFromManager,
    onRevealLocalPath: context.onRevealPathInFileManager,
    onSharedAnimationDone: context.browserSearchModel.onSharedAnimationDone
  }
});
