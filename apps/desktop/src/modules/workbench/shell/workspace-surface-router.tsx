import type { ReactNode } from "react";

import type { SearchEngineDefinition } from "../browser-search/types";
import type { BrowserSettingsSurfaceProps } from "../browser-tabs/settings-surface";
import type { AiHistorySurfaceProps } from "../ai-history";
import {
  type FileManagerChooserMode,
  type FileManagerModel,
  type FileManagerSurfaceLabels
} from "../file-manager";
import {
  type FileEditorChangeReviewItem,
  type FileEditorLabels,
  type FileEditorModel
} from "../file-editor";
import type { McpCenterLabels, McpCenterModel } from "../mcp-center";
import {
  type NotificationCenterLabels,
  type WorkbenchNotificationModel
} from "../notifications";
import type { PluginsCenterLabels, PluginsCenterModel } from "../plugins-center";
import type { WorkbenchSplitThreePaneLayout } from "../preferences";
import type { SkillsCenterLabels, SkillsCenterModel } from "../skills-center";
import type { TerminalDockLabels, TerminalDockModel } from "../terminal-dock/types";
import type { TerminalThemeMode } from "../terminal-theme";
import type { WorkbenchSurfaceAdapters } from "../ui-platform/surface-types";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs/types";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { BrowserSearchModel } from "../browser-search";
import {
  createWorkspaceSurfaceRenderModel,
  type WorkspaceSurfaceRenderModel
} from "./workspace-surface-render-model";

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
  readonly surfaceAdapters: WorkbenchSurfaceAdapters;
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
  readonly pluginsCenter: {
    readonly model: PluginsCenterModel;
    readonly labels: PluginsCenterLabels;
  };
  readonly aiHistory: {
    readonly locale: string;
    readonly title: string;
    readonly newSessionTitle: string;
    readonly newConversationLabel: string;
    readonly openConversationLabel: string;
    readonly renameConversationLabel?: string;
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
    readonly richRenderingEnabled?: boolean;
    readonly themeSignature?: string;
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

const renderSurfaceModel = (
  model: WorkspaceSurfaceRenderModel,
  surfaceAdapters: WorkbenchSurfaceAdapters
): ReactNode => {
  switch (model.kind) {
    case "searchHome": {
      const Adapter = surfaceAdapters.searchHome;
      return <Adapter {...model.props} />;
    }
    case "searchResults": {
      const Adapter = surfaceAdapters.searchResults;
      return <Adapter {...model.props} />;
    }
    case "deepSearchResults": {
      const Adapter = surfaceAdapters.deepSearchResults;
      return <Adapter {...model.props} />;
    }
    case "browserPage": {
      const Adapter = surfaceAdapters.browserPage;
      return <Adapter {...model.props} />;
    }
    case "settings": {
      const Adapter = surfaceAdapters.settings;
      return <Adapter {...model.props} />;
    }
    case "terminalWorkspace": {
      const Adapter = surfaceAdapters.terminalWorkspace;
      return <Adapter {...model.props} />;
    }
    case "fileManager": {
      const Adapter = surfaceAdapters.fileManager;
      return <Adapter {...model.props} />;
    }
    case "fileEditor": {
      const Adapter = surfaceAdapters.fileEditor;
      return <Adapter {...model.props} />;
    }
    case "notificationCenter": {
      const Adapter = surfaceAdapters.notificationCenter;
      return <Adapter {...model.props} />;
    }
    case "mcpCenter": {
      const Adapter = surfaceAdapters.mcpCenter;
      return <Adapter {...model.props} />;
    }
    case "skillsCenter": {
      const Adapter = surfaceAdapters.skillsCenter;
      return <Adapter {...model.props} />;
    }
    case "pluginsCenter": {
      const Adapter = surfaceAdapters.pluginsCenter;
      return <Adapter {...model.props} />;
    }
    case "aiHistory": {
      const Adapter = surfaceAdapters.aiHistory;
      return <Adapter {...model.props} />;
    }
    case "empty":
      return null;
    default:
      return null;
  }
};

export const WorkspaceSurfaceRouter = ({
  surfaceAdapters,
  activeTab,
  tabsModel,
  splitThreePaneLayout,
  ...renderContext
}: WorkspaceSurfaceRouterProps) => {
  const renderTabSurface = (tab: WorkspaceTab): ReactNode =>
    renderSurfaceModel(
      createWorkspaceSurfaceRenderModel(tab, {
        ...renderContext,
        tabsModel
      }),
      surfaceAdapters
    );

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
