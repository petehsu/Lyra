import { useMemo, useRef, type ComponentProps, type ReactNode } from "react";

import type { SearchEngineDefinition } from "../browser-search/types";
import type { BrowserSettingsSurfaceProps } from "../browser-tabs/settings-surface";
import {
  type FileManagerChooserMode,
  type FileManagerModel,
  type FileManagerSurfaceLabels
} from "../file-manager";
import type { FileManagerFavorite } from "../../../shared/file-manager";
import {
  type FileEditorChangeReviewItem,
  type FileEditorLabels,
  type FileEditorModel
} from "../file-editor";
import type { ImageViewerLabels, ImageViewerModel } from "../image-viewer";
import {
  type NotificationCenterLabels,
  type WorkbenchNotificationModel
} from "../notifications";
import type { AgentSessionHistorySurfaceProps } from "../agent-session-history";
import type {
  AgentProjectTreeLabels,
  AgentProjectTreeModel
} from "../agent-project-tree";
import type {
  AgentPlanBoardLabels,
  AgentPlanBoardModel
} from "../agent-plan-board";
import type { AgentGitLabels } from "../agent-git";
import { SoftwareStoreSurface, type SoftwareStoreSurfaceProps } from "../software-store";
import type { WorkbenchSplitThreePaneLayout } from "../preferences";
import type { TerminalDockLabels, TerminalDockModel } from "../terminal-dock/types";
import type { WorkbenchSurfaceAdapters } from "../ui-platform/surface-types";
import type { WorkspaceTab, WorkspaceTabsModel } from "../workspace-tabs/types";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { BrowserSearchModel } from "../browser-search";
import {
  createWorkspaceSurfaceRenderModel,
  type WorkspaceSurfaceRenderModel
} from "./workspace-surface-render-model";
import { WorkbenchTitlebarScopeProvider } from "./titlebar-context";

export type WorkspaceSurfaceSettingsProps = BrowserSettingsSurfaceProps;

export type WorkspaceSurfaceI18nProps = {
  readonly searchPlaceholder: string;
  readonly searchActionLabel: string;
  readonly resultsHeading: string;
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
  readonly resultsAutoTab: string;
  readonly resultsWebTab: string;
  readonly channelIdle: string;
  readonly channelLoading: string;
  readonly channelReady: string;
  readonly channelError: string;
};

export type WorkspaceSurfaceRouterProps = {
  readonly surfaceAdapters: WorkbenchSurfaceAdapters;
  readonly activeTab: WorkspaceTab | undefined;
  readonly tabsModel: WorkspaceTabsModel;
  readonly logoUrl: string;
  readonly browserSearchModel: BrowserSearchModel;
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly autoSearchEngines: readonly SearchEngineDefinition[];
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly onOpenSearchResult: (url: string, title: string) => void;
  readonly onPageHostChange: (tabId: string, element: HTMLElement | null) => void;
  readonly terminalModel: TerminalDockModel;
  readonly desktopApi: LyraDesktopApi | null;
  readonly terminalLabels: TerminalDockLabels;
  readonly resolvedThemeId: string;
  readonly fileManagerModel: FileManagerModel;
  readonly fileManagerLabels: FileManagerSurfaceLabels;
  readonly resolveFileManagerChooser?: (instanceId: string) => FileManagerChooserMode | null;
  readonly fileEditorModel: FileEditorModel;
  readonly fileEditorLabels: FileEditorLabels;
  readonly imageViewerModel: ImageViewerModel;
  readonly imageViewerLabels: ImageViewerLabels;
  readonly agentProjectTreeModel: AgentProjectTreeModel;
  readonly agentProjectTreeLabels: AgentProjectTreeLabels;
  readonly agentPlanBoardModel: AgentPlanBoardModel;
  readonly agentPlanBoardLabels: AgentPlanBoardLabels;
  readonly agentGitLabels: AgentGitLabels;
  readonly onOpenAgentGit: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void;
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
  readonly onOpenFavoriteFromFileManager?: (favorite: FileManagerFavorite) => void;
  readonly onRevealPathInFileManager: (filePath: string) => void;
  readonly splitThreePaneLayout: WorkbenchSplitThreePaneLayout;
  readonly settings: WorkspaceSurfaceSettingsProps;
  readonly searchResultsSourceFilter: "all" | "web";
  readonly onSearchResultsSourceFilterChange: (value: "all" | "web") => void;
  readonly i18n: WorkspaceSurfaceI18nProps;
  readonly notifications: {
    readonly model: WorkbenchNotificationModel;
    readonly labels: NotificationCenterLabels;
    readonly onOpenNotificationSource: (notificationId: string) => void;
    readonly onRequestClearAll: () => void;
  };
  readonly agentSessionHistory: {
    readonly labels: AgentSessionHistorySurfaceProps["labels"];
    readonly activeSessionId: string | null;
    readonly onOpenSession: AgentSessionHistorySurfaceProps["onOpenSession"];
    readonly onSessionDeleted?: AgentSessionHistorySurfaceProps["onSessionDeleted"];
    readonly openDialog: AgentSessionHistorySurfaceProps["openDialog"];
    readonly query: AgentSessionHistorySurfaceProps["query"];
    readonly refreshRequestKey: AgentSessionHistorySurfaceProps["refreshRequestKey"];
    readonly locateRequest: AgentSessionHistorySurfaceProps["locateRequest"];
    readonly browserHistory: AgentSessionHistorySurfaceProps["browserHistory"];
    readonly browserHistoryPreviewPageId: AgentSessionHistorySurfaceProps["browserHistoryPreviewPageId"];
    readonly onBrowserHistoryPreviewChange: AgentSessionHistorySurfaceProps["onBrowserHistoryPreviewChange"];
    readonly onBrowserHistoryPreviewHostChange: AgentSessionHistorySurfaceProps["onBrowserHistoryPreviewHostChange"];
    readonly onOpenBrowserHistoryEntry: AgentSessionHistorySurfaceProps["onOpenBrowserHistoryEntry"];
    readonly locale?: AgentSessionHistorySurfaceProps["locale"];
  };
  readonly loginManager: ComponentProps<WorkbenchSurfaceAdapters["loginManager"]>;
  readonly softwareStore: SoftwareStoreSurfaceProps;
};

/** Max number of tab surfaces kept alive (mounted but hidden) for instant switching. */
const MAX_KEPT_ALIVE_TABS = 6;

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
    case "imageViewer": {
      const Adapter = surfaceAdapters.imageViewer;
      return <Adapter {...model.props} />;
    }
    case "agentProjectTree": {
      const Adapter = surfaceAdapters.agentProjectTree;
      return <Adapter {...model.props} />;
    }
    case "agentPlanBoard": {
      const Adapter = surfaceAdapters.agentPlanBoard;
      return <Adapter {...model.props} />;
    }
    case "agentGit": {
      const Adapter = surfaceAdapters.agentGit;
      return <Adapter {...model.props} />;
    }
    case "notificationCenter": {
      const Adapter = surfaceAdapters.notificationCenter;
      return <Adapter {...model.props} />;
    }
    case "agentSessionHistory": {
      const Adapter = surfaceAdapters.agentSessionHistory;
      return <Adapter {...model.props} />;
    }
    case "loginManager": {
      const Adapter = surfaceAdapters.loginManager;
      return <Adapter {...model.props} />;
    }
    case "softwareStore":
      return <SoftwareStoreSurface {...model.props} />;
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
  const renderTabSurface = (tab: WorkspaceTab): ReactNode => (
    <WorkbenchTitlebarScopeProvider scopeId={tab.id}>
      {renderSurfaceModel(
        createWorkspaceSurfaceRenderModel(tab, {
          ...renderContext,
          tabsModel
        }),
        surfaceAdapters
      )}
    </WorkbenchTitlebarScopeProvider>
  );

  const visibleLayout = tabsModel.getVisibleWorkspaceLayout();
  const tabById = new Map(tabsModel.tabs.map((tab) => [tab.id, tab] as const));

  // --- LRU keepalive for single-mode tab switching ---
  // Track the order in which tabs were activated so we can keep the most
  // recently used ones mounted (display:none) and evict the stalest.
  const lruRef = useRef<readonly string[]>([]);
  const activeId = activeTab?.id ?? visibleLayout.activeTabId;

  // Update LRU during render: move activeId to the end (most recently used).
  if (activeId.length > 0) {
    const current = lruRef.current;
    if (current[current.length - 1] !== activeId) {
      lruRef.current = [...current.filter((id) => id !== activeId), activeId];
    }
  }

  // Compute which tabs to keep alive: filter closed tabs, cap to MAX.
  const keptAliveTabIds = useMemo(() => {
    const existing = new Set(tabsModel.tabs.map((tab) => tab.id));
    const lru = lruRef.current.filter((id) => existing.has(id));
    return lru.slice(-MAX_KEPT_ALIVE_TABS);
  }, [tabsModel.tabs]);

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

  return (
    <div className="lyra-workspace-surface-single">
      {keptAliveTabIds.map((tabId) => {
        const tab = tabById.get(tabId);
        if (tab === undefined) return null;
        const isActive = tabId === (targetTab?.id ?? visibleLayout.activeTabId);
        return (
          <div
            key={tabId}
            className="lyra-workspace-surface-keepalive"
            style={isActive ? undefined : { display: "none" }}
          >
            {renderTabSurface(tab)}
          </div>
        );
      })}
    </div>
  );
};
