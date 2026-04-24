import type { ReactNode } from "react";

import { BrowserResultSurface, DeepSearchResultSurface } from "../browser-search";
import type { SearchEngineDefinition } from "../browser-search/types";
import {
  BrowserPageSurface,
  BrowserSearchSurface,
  BrowserSettingsSurface
} from "../browser-tabs";
import type { BrowserSettingsSurfaceProps } from "../browser-tabs/settings-surface";
import { AiHistorySurface, type AiHistorySurfaceProps } from "../ai-history";
import {
  FileManagerSurface,
  type FileManagerChooserMode,
  type FileManagerModel,
  type FileManagerSurfaceLabels
} from "../file-manager";
import {
  FileEditorSurface,
  type FileEditorChangeReviewItem,
  type FileEditorLabels,
  type FileEditorModel
} from "../file-editor";
import type { WorkbenchLocale } from "../i18n";
import { McpCenterSurface, type McpCenterLabels, type McpCenterModel } from "../mcp-center";
import {
  NotificationCenterSurface,
  type NotificationCenterLabels,
  type WorkbenchNotificationModel
} from "../notifications";
import type { WorkbenchSplitThreePaneLayout } from "../preferences";
import {
  SkillsCenterSurface,
  type SkillsCenterLabels,
  type SkillsCenterModel
} from "../skills-center";
import { TerminalWorkspaceSurface } from "../terminal-dock";
import type { TerminalDockLabels, TerminalDockModel } from "../terminal-dock/types";
import type { TerminalThemeMode } from "../terminal-theme";
import type { WorkbenchThemeId } from "../theme";
import {
  isAiHistoryAppId,
  isAiMcpAppId,
  isAiSkillsAppId,
  isFileEditorAppId,
  isFileManagerAppId,
  isNotificationCenterAppId
} from "../workspace-apps";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs/types";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { BrowserSearchModel } from "./use-browser-search-model";

type ChoiceOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
};

export type WorkspaceSurfaceSettingsProps = BrowserSettingsSurfaceProps;

export type WorkspaceSurfaceI18nProps = {
  readonly searchPlaceholder: string;
  readonly searchActionLabel: string;
  readonly resultsHeading: string;
  readonly resultsBlendTitle: string;
  readonly resultsEngineOverview: string;
  readonly resultsNoResults: string;
  readonly resultsEngineError: string;
  readonly resultsOfficial: string;
  readonly resultsOfficialHomepage: string;
  readonly resultsOfficialSubsite: string;
  readonly resultsOfficialDocs: string;
  readonly resultsOfficialLogin: string;
  readonly resultsOfficialDownload: string;
  readonly resultsOfficialSupport: string;
  readonly resultsSourceFilter: string;
  readonly resultsAllTab: string;
  readonly resultsWebTab: string;
  readonly resultsLocalTab: string;
  readonly resultsLocalTitle: string;
  readonly resultsLocalPanelTitle: string;
  readonly resultsLocalNoMatches: string;
  readonly resultsLocalSearchingMore: string;
  readonly resultsLocalScope: string;
  readonly resultsLocalScannedFiles: string;
  readonly resultsLocalScannedDirs: string;
  readonly resultsLocalContentScans: string;
  readonly resultsLocalMatched: string;
  readonly resultsLocalIndex: string;
  readonly resultsLocalScore: string;
  readonly resultsLocalLine: string;
  readonly channelIdle: string;
  readonly channelLoading: string;
  readonly channelReady: string;
  readonly channelError: string;
  readonly deepSearchToggle: string;
  readonly deepSearchChip: string;
  readonly deepSearchHeading: string;
  readonly deepSearchStop: string;
  readonly deepSearchFitView: string;
  readonly deepSearchResetLayout: string;
  readonly deepSearchLoading: string;
  readonly deepSearchEmpty: string;
  readonly deepSearchOverview: string;
  readonly deepSearchSelectedNode: string;
  readonly deepSearchPhase: string;
  readonly deepSearchBudget: string;
  readonly deepSearchWebStatus: string;
  readonly deepSearchLocalStatus: string;
  readonly deepSearchDeduped: string;
  readonly deepSearchDerived: string;
  readonly deepSearchRounds: string;
  readonly deepSearchOpen: string;
  readonly deepSearchExpand: string;
  readonly deepSearchCenter: string;
  readonly deepSearchNoSelection: string;
  readonly deepSearchAll: string;
  readonly deepSearchSnippet: string;
  readonly deepSearchSource: string;
  readonly deepSearchConnectedLinks: string;
  readonly deepSearchEdgeFilters: string;
  readonly deepSearchDirection: string;
  readonly deepSearchIncoming: string;
  readonly deepSearchOutgoing: string;
  readonly deepSearchBoth: string;
  readonly deepSearchDiscovered: string;
  readonly deepSearchExpanded: string;
  readonly deepSearchRelated: string;
  readonly deepSearchHostsSubdomain: string;
  readonly deepSearchContainsPage: string;
  readonly deepSearchLineage: string;
  readonly deepSearchAlternateLinks: string;
  readonly deepSearchRevealInManager: string;
  readonly deepSearchMatchKind: string;
  readonly deepSearchLine: string;
  readonly deepSearchSharedTerms: string;
  readonly deepSearchDomain: string;
  readonly deepSearchSubdomain: string;
  readonly deepSearchPage: string;
  readonly deepSearchVerified: string;
  readonly deepSearchGuessed: string;
  readonly deepSearchDiscoveredBy: string;
  readonly deepSearchVerificationScore: string;
  readonly deepSearchGuessedDomains: string;
  readonly deepSearchVerifiedDomains: string;
  readonly deepSearchSubdomains: string;
  readonly deepSearchVisitedPages: string;
  readonly deepSearchQueuedPages: string;
  readonly deepSearchDroppedPages: string;
  readonly deepSearchSiteExpansionStatus: string;
};

export type WorkspaceSurfaceRouterProps = {
  readonly activeTab: WorkspaceTab | undefined;
  readonly tabsModel: WorkspaceTabsModel;
  readonly logoUrl: string;
  readonly browserSearchModel: BrowserSearchModel;
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly onOpenSearchResult: (url: string, title: string) => void;
  readonly onPageHostChange: (tabId: string, element: HTMLElement | null) => void;
  readonly terminalModel: TerminalDockModel;
  readonly desktopApi: LyraDesktopApi | null;
  readonly terminalLabels: TerminalDockLabels;
  readonly terminalThemeSignature: string;
  readonly terminalThemePreset: TerminalThemeMode;
  readonly resolvedThemeId: string;
  readonly fileManagerModel: FileManagerModel;
  readonly fileManagerLabels: FileManagerSurfaceLabels;
  readonly resolveFileManagerChooser?: (instanceId: string) => FileManagerChooserMode | null;
  readonly fileEditorModel: FileEditorModel;
  readonly fileEditorLabels: FileEditorLabels;
  readonly fileEditorReview?: {
    readonly editorWorkAcceptLabel: string;
    readonly editorWorkRejectLabel: string;
    readonly editorWorkUndoLabel: string;
    readonly editorWorkPrevLabel: string;
    readonly editorWorkNextLabel: string;
    readonly editorWorkAcceptAllLabel: string;
    readonly canGoToPreviousEditorWorkItem: boolean;
    readonly canGoToNextEditorWorkItem: boolean;
    readonly canAcceptAllEditorWorkItems: boolean;
    readonly resolveActiveEditorWorkItem: (filePath: string) => FileEditorChangeReviewItem | undefined;
    readonly onGoToPreviousEditorWorkItem: () => void;
    readonly onGoToNextEditorWorkItem: () => void;
    readonly onAcceptAllEditorWorkItems: () => void;
    readonly onAcceptEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
    readonly onRejectEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
    readonly onUndoEditorWorkItem: (item: FileEditorChangeReviewItem) => void;
  };
  readonly onOpenFileFromManager: (filePath: string) => void;
  readonly onRevealPathInFileManager: (filePath: string) => void;
  readonly splitThreePaneLayout: WorkbenchSplitThreePaneLayout;
  readonly settings: WorkspaceSurfaceSettingsProps;
  readonly searchResultsSourceFilter: "all" | "web" | "local";
  readonly onSearchResultsSourceFilterChange: (value: "all" | "web" | "local") => void;
  readonly i18n: WorkspaceSurfaceI18nProps;
  readonly mcpCenter: {
    readonly model: McpCenterModel;
    readonly labels: McpCenterLabels;
  };
  readonly skillsCenter: {
    readonly model: SkillsCenterModel;
    readonly labels: SkillsCenterLabels;
  };
  readonly aiHistory: {
    readonly locale: string;
    readonly title: string;
    readonly newSessionTitle: string;
    readonly newConversationLabel: string;
    readonly openConversationLabel: string;
    readonly deleteConversationLabel: string;
    readonly archiveConversationLabel: string;
    readonly archivedConversationLabel: string;
    readonly archivedProjectLabel: string;
    readonly deleteArchivedConversationTitle: string;
    readonly deleteArchivedConversationDescription: string;
    readonly deleteArchivedConversationConfirm: string;
    readonly deleteArchivedConversationCancel: string;
    readonly profileLabel: string;
    readonly sessionIdLabel: string;
    readonly loadingSessionsLabel: string;
    readonly emptyStateTitle: string;
    readonly emptyStateDescription: string;
    readonly scopeGlobalLabel: string;
    readonly scopeProjectLabel: string;
    readonly noProjectSessionsEmptyLabel: string;
    readonly noProjectsEmptyLabel: string;
    readonly projectSessionCountLabel: string;
    readonly backToProjectsLabel: string;
    readonly projectPathLabel: string;
    readonly threadPreviewEmptyLabel: string;
    readonly previewEmptyTitle: string;
    readonly previewEmptyDescription: string;
    readonly previewLoadingLabel: string;
    readonly defaultProfileId?: string | null;
    readonly defaultProviderId?: string | null;
    readonly openDialog?: AiHistorySurfaceProps["openDialog"];
  };
  readonly notifications: {
    readonly model: WorkbenchNotificationModel;
    readonly labels: NotificationCenterLabels;
    readonly onOpenNotificationSource: (notificationId: string) => void;
    readonly onRequestClearAll: () => void;
  };
};

export const WorkspaceSurfaceRouter = ({
  activeTab,
  tabsModel,
  logoUrl,
  browserSearchModel,
  engineById,
  onOpenSearchResult,
  onPageHostChange,
  terminalModel,
  desktopApi,
  terminalLabels,
  terminalThemeSignature,
  terminalThemePreset,
  resolvedThemeId,
  fileManagerModel,
  fileManagerLabels,
  resolveFileManagerChooser,
  fileEditorModel,
  fileEditorLabels,
  fileEditorReview,
  onOpenFileFromManager,
  onRevealPathInFileManager,
  splitThreePaneLayout,
  settings,
  searchResultsSourceFilter,
  onSearchResultsSourceFilterChange,
  i18n,
  mcpCenter,
  skillsCenter,
  aiHistory,
  notifications
}: WorkspaceSurfaceRouterProps) => {
  const renderPageSurface = (tab: WorkspaceTab): ReactNode => (
    <BrowserPageSurface
      tabId={tab.id}
      onHostChange={onPageHostChange}
    />
  );

  const renderTabSurface = (tab: WorkspaceTab): ReactNode => {
    if (tab.pageKind === "results") {
      const resultMode = tab.resultMode ?? tab.searchMode ?? "standard";
      if (resultMode === "deep") {
        return (
          <DeepSearchResultSurface
            logoUrl={logoUrl}
            inputValue={tab.inputValue}
            placeholder={i18n.searchPlaceholder}
            searchActionLabel={i18n.searchActionLabel}
            deepSearchEnabled={browserSearchModel.activeSearchMode === "deep"}
            labels={{
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
            }}
            snapshot={browserSearchModel.deepSearchState.snapshot}
            searching={browserSearchModel.isSearching}
            viewportMemoryKey={`${tab.id}:${tab.query ?? ""}`}
            restoreViewportEnabled={settings.deepSearchRestoreViewportValue}
            localOpenBehavior={settings.deepSearchLocalOpenBehaviorValue}
            sourceFilter={searchResultsSourceFilter}
            sharedStartRect={browserSearchModel.sharedTransitionRect}
            onInputChange={tabsModel.updateActiveInput}
            onSubmit={tabsModel.commitActiveInput}
            onToggleDeepSearch={browserSearchModel.onToggleDeepSearch}
            onCancel={browserSearchModel.onCancelDeepSearch}
            onExpandNode={browserSearchModel.onExpandDeepNode}
            onSourceFilterChange={onSearchResultsSourceFilterChange}
            onOpenUrl={onOpenSearchResult}
            onOpenLocalPath={onOpenFileFromManager}
            onRevealLocalPath={onRevealPathInFileManager}
            onSharedAnimationDone={browserSearchModel.onSharedAnimationDone}
          />
        );
      }
      return (
        <BrowserResultSurface
          logoUrl={logoUrl}
          inputValue={tab.inputValue}
          placeholder={i18n.searchPlaceholder}
          searchActionLabel={i18n.searchActionLabel}
          deepSearchToggleLabel={i18n.deepSearchToggle}
          deepSearchEnabled={browserSearchModel.activeSearchMode === "deep"}
          deepSearchChipLabel={i18n.deepSearchChip}
          headingLabel={i18n.resultsHeading}
          blendLabel={i18n.resultsBlendTitle}
          engineOverviewLabel={i18n.resultsEngineOverview}
          officialResultLabel={i18n.resultsOfficial}
          officialHomepageLabel={i18n.resultsOfficialHomepage}
          officialSubsiteLabel={i18n.resultsOfficialSubsite}
          officialDocsLabel={i18n.resultsOfficialDocs}
          officialLoginLabel={i18n.resultsOfficialLogin}
          officialDownloadLabel={i18n.resultsOfficialDownload}
          officialSupportLabel={i18n.resultsOfficialSupport}
          sourceFilterLabel={i18n.resultsSourceFilter}
          allTabLabel={i18n.resultsAllTab}
          emptyLabel={
            browserSearchModel.searchError === null
              ? i18n.resultsNoResults
              : `${i18n.resultsNoResults} · ${browserSearchModel.searchError}`
          }
          engineErrorLabel={i18n.resultsEngineError}
          webTabLabel={i18n.resultsWebTab}
          localTabLabel={i18n.resultsLocalTab}
          localTitleLabel={i18n.resultsLocalTitle}
          localPanelTitleLabel={i18n.resultsLocalPanelTitle}
          localNoMatchesLabel={i18n.resultsLocalNoMatches}
          localSearchingMoreLabel={i18n.resultsLocalSearchingMore}
          localScopeLabel={i18n.resultsLocalScope}
          localScannedFilesLabel={i18n.resultsLocalScannedFiles}
          localScannedDirsLabel={i18n.resultsLocalScannedDirs}
          localContentScansLabel={i18n.resultsLocalContentScans}
          localMatchedLabel={i18n.resultsLocalMatched}
          localIndexLabel={i18n.resultsLocalIndex}
          localScoreLabel={i18n.resultsLocalScore}
          localLineLabel={i18n.resultsLocalLine}
          channelIdleLabel={i18n.channelIdle}
          channelLoadingLabel={i18n.channelLoading}
          channelReadyLabel={i18n.channelReady}
          channelErrorLabel={i18n.channelError}
          sourceFilter={searchResultsSourceFilter}
          payload={browserSearchModel.standardSearchState}
          onToggleDeepSearch={browserSearchModel.onToggleDeepSearch}
          onSourceFilterChange={onSearchResultsSourceFilterChange}
          sharedStartRect={browserSearchModel.sharedTransitionRect}
          engineById={engineById}
          onInputChange={tabsModel.updateActiveInput}
          onSubmit={tabsModel.commitActiveInput}
          onOpenUrl={onOpenSearchResult}
          onSharedAnimationDone={browserSearchModel.onSharedAnimationDone}
        />
      );
    }

    if (tab.pageKind === "page") {
      return renderPageSurface(tab);
    }

    if (tab.pageKind === "search") {
      return (
        <BrowserSearchSurface
          logoUrl={logoUrl}
          inputValue={tab.inputValue}
          placeholder={i18n.searchPlaceholder}
          searchActionLabel={i18n.searchActionLabel}
          deepSearchToggleLabel={i18n.deepSearchToggle}
          deepSearchEnabled={browserSearchModel.activeSearchMode === "deep"}
          deepSearchChipLabel={i18n.deepSearchChip}
          onPillRef={(element) => {
            browserSearchModel.searchPillRef.current = element;
          }}
          onInputChange={tabsModel.updateActiveInput}
          onSubmit={browserSearchModel.onSearchSurfaceSubmit}
          onToggleDeepSearch={browserSearchModel.onToggleDeepSearch}
        />
      );
    }

    if (tab.pageKind === "settings") {
      return (
        <BrowserSettingsSurface {...settings} />
      );
    }

    if (tab.pageKind === "terminal" && tab.terminalTabId !== undefined) {
      const terminalTab = terminalModel.findTab(tab.terminalTabId);
      if (terminalTab === null) {
        return null;
      }
      const panes = terminalModel.getTabPanes(terminalTab.id);
      return (
        <TerminalWorkspaceSurface
          desktopApi={desktopApi}
          labels={terminalLabels}
          themeSignature={terminalThemeSignature}
          themePresetId={terminalThemePreset}
          uiThemeId={resolvedThemeId}
          tab={terminalTab}
          panes={panes}
          onFocusPane={(paneId) => {
            terminalModel.focusPane(terminalTab.id, paneId);
          }}
        />
      );
    }

    if (tab.pageKind !== "app" || tab.appId === undefined) {
      return null;
    }

    if (isFileManagerAppId(tab.appId) && tab.appInstanceId !== undefined) {
      const state = fileManagerModel.getState(tab.appInstanceId);
      if (state === null) {
        return null;
      }
      return (
        <FileManagerSurface
          state={state}
          labels={fileManagerLabels}
          model={fileManagerModel}
          onOpenFile={onOpenFileFromManager}
          chooser={resolveFileManagerChooser?.(tab.appInstanceId) ?? null}
        />
      );
    }

    if (isFileEditorAppId(tab.appId) && tab.appInstanceId !== undefined) {
      const state = fileEditorModel.getState(tab.appInstanceId);
      if (state === null) {
        return null;
      }
      const activeEditorWorkItem = fileEditorReview?.resolveActiveEditorWorkItem(state.filePath);
      return (
        <FileEditorSurface
          state={state}
          labels={fileEditorLabels}
          model={fileEditorModel}
          themeSignature={resolvedThemeId}
          {...(fileEditorReview === undefined
            ? {}
            : {
                editorWorkAcceptLabel: fileEditorReview.editorWorkAcceptLabel,
                editorWorkRejectLabel: fileEditorReview.editorWorkRejectLabel,
                editorWorkUndoLabel: fileEditorReview.editorWorkUndoLabel,
                editorWorkPrevLabel: fileEditorReview.editorWorkPrevLabel,
                editorWorkNextLabel: fileEditorReview.editorWorkNextLabel,
                editorWorkAcceptAllLabel: fileEditorReview.editorWorkAcceptAllLabel,
                canGoToPreviousEditorWorkItem: fileEditorReview.canGoToPreviousEditorWorkItem,
                canGoToNextEditorWorkItem: fileEditorReview.canGoToNextEditorWorkItem,
                canAcceptAllEditorWorkItems: fileEditorReview.canAcceptAllEditorWorkItems,
                ...(activeEditorWorkItem === undefined
                  ? {}
                  : { activeEditorWorkItem }),
                onGoToPreviousEditorWorkItem: fileEditorReview.onGoToPreviousEditorWorkItem,
                onGoToNextEditorWorkItem: fileEditorReview.onGoToNextEditorWorkItem,
                onAcceptAllEditorWorkItems: fileEditorReview.onAcceptAllEditorWorkItems,
                onAcceptEditorWorkItem: fileEditorReview.onAcceptEditorWorkItem,
                onRejectEditorWorkItem: fileEditorReview.onRejectEditorWorkItem,
                onUndoEditorWorkItem: fileEditorReview.onUndoEditorWorkItem
              })}
        />
      );
    }

    if (isNotificationCenterAppId(tab.appId)) {
      return (
        <NotificationCenterSurface
          labels={notifications.labels}
          notifications={notifications.model.notifications}
          selectedNotificationId={notifications.model.selectedNotificationId}
          onSelectNotification={notifications.model.selectNotification}
          onMarkAllRead={notifications.model.markAllNotificationsRead}
          onClearAll={notifications.onRequestClearAll}
          onOpenNotificationSource={notifications.onOpenNotificationSource}
        />
      );
    }

    if (isAiMcpAppId(tab.appId)) {
      return <McpCenterSurface model={mcpCenter.model} labels={mcpCenter.labels} />;
    }

    if (isAiSkillsAppId(tab.appId)) {
      return <SkillsCenterSurface model={skillsCenter.model} labels={skillsCenter.labels} />;
    }

    if (isAiHistoryAppId(tab.appId)) {
      return (
        <AiHistorySurface
          desktopApi={desktopApi}
          locale={aiHistory.locale}
          title={aiHistory.title}
          newSessionTitle={aiHistory.newSessionTitle}
          newConversationLabel={aiHistory.newConversationLabel}
          openConversationLabel={aiHistory.openConversationLabel}
          deleteConversationLabel={aiHistory.deleteConversationLabel}
          archiveConversationLabel={aiHistory.archiveConversationLabel}
          archivedConversationLabel={aiHistory.archivedConversationLabel}
          archivedProjectLabel={aiHistory.archivedProjectLabel}
          deleteArchivedConversationTitle={aiHistory.deleteArchivedConversationTitle}
          deleteArchivedConversationDescription={aiHistory.deleteArchivedConversationDescription}
          deleteArchivedConversationConfirm={aiHistory.deleteArchivedConversationConfirm}
          deleteArchivedConversationCancel={aiHistory.deleteArchivedConversationCancel}
          profileLabel={aiHistory.profileLabel}
          sessionIdLabel={aiHistory.sessionIdLabel}
          loadingSessionsLabel={aiHistory.loadingSessionsLabel}
          emptyStateTitle={aiHistory.emptyStateTitle}
          emptyStateDescription={aiHistory.emptyStateDescription}
          scopeGlobalLabel={aiHistory.scopeGlobalLabel}
          scopeProjectLabel={aiHistory.scopeProjectLabel}
          noProjectSessionsEmptyLabel={aiHistory.noProjectSessionsEmptyLabel}
          noProjectsEmptyLabel={aiHistory.noProjectsEmptyLabel}
          projectSessionCountLabel={aiHistory.projectSessionCountLabel}
          backToProjectsLabel={aiHistory.backToProjectsLabel}
          projectPathLabel={aiHistory.projectPathLabel}
          threadPreviewEmptyLabel={aiHistory.threadPreviewEmptyLabel}
          previewEmptyTitle={aiHistory.previewEmptyTitle}
          previewEmptyDescription={aiHistory.previewEmptyDescription}
          previewLoadingLabel={aiHistory.previewLoadingLabel}
          {...(aiHistory.defaultProfileId === undefined
            ? {}
            : { defaultProfileId: aiHistory.defaultProfileId })}
          {...(aiHistory.defaultProviderId === undefined
            ? {}
            : { defaultProviderId: aiHistory.defaultProviderId })}
          {...(aiHistory.openDialog === undefined
            ? {}
            : { openDialog: aiHistory.openDialog })}
        />
      );
    }

    return null;
  };

  const visibleLayout = tabsModel.getVisibleWorkspaceLayout();
  const tabById = new Map(tabsModel.tabs.map((tab) => [tab.id, tab] as const));

  if (visibleLayout.mode === "split") {
    const splitClassName = [
      "lyra-workspace-split",
      `lyra-workspace-split-count-${visibleLayout.visibleTabIds.length}`,
      `lyra-workspace-split-layout-${splitThreePaneLayout}`
    ].join(" ");
    return (
      <div className="lyra-workspace-surface-split">
        <div className={splitClassName} aria-label="workspace-split-layout">
          {visibleLayout.visibleTabIds.map((tabId, index) => {
            const tab = tabById.get(tabId);
            if (tab === undefined) {
              return null;
            }
            const paneClassName = [
              "lyra-workspace-split-pane",
              `lyra-workspace-split-pane-${index + 1}`,
              tab.id === visibleLayout.focusedSplitTabId
                ? "lyra-workspace-split-pane-active"
                : ""
            ]
              .filter((value) => value.length > 0)
              .join(" ");

            return (
              <section
                key={tab.id}
                className={paneClassName}
                onMouseDown={() => {
                  tabsModel.setActiveTab(tab.id);
                }}
              >
                {renderTabSurface(tab)}
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  const targetTab = activeTab ?? tabById.get(visibleLayout.activeTabId);

  return <div className="lyra-workspace-surface-single">{targetTab === undefined ? null : renderTabSurface(targetTab)}</div>;
};
