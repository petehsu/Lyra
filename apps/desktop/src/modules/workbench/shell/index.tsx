import { BookText, Folder, Minus, PanelBottom, PanelLeft, Settings2, Square, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent
} from "react";

import {
  BrowserTabStrip
} from "../browser-tabs";
import {
  AiPanelSurface,
  createAiHistoryAppRequest,
  createAiMcpAppRequest,
  createAiSkillsAppRequest,
  type AiPanelWriteStreamEvent
} from "../ai-panel";
import { WORKBENCH_CONFIG } from "../config";
import { ContextMenuHost, useContextMenuModel } from "../context-menu";
import {
  useFileEditorModel,
  type FileEditorChangeReviewItem,
  type FileEditorRevealLocation
} from "../file-editor";
import { useWorkbenchFeedbackModel } from "../feedback";
import { useFileManagerModel, type FileManagerChooserMode } from "../file-manager";
import {
  GlobalDialogHost,
  useGlobalDialogModel
} from "../global-dialog";
import { createTranslator } from "../i18n";
import { shouldPreventWorkbenchDragStart } from "../interaction-policy";
import { useMcpCenterModel } from "../mcp-center";
import {
  WorkbenchNotificationTopbar,
  createNotificationCenterAppRequest,
  mapFeedbackEventToNotification,
  useWorkbenchNotificationModel,
  type WorkbenchNotificationItem
} from "../notifications";
import { useWorkbenchPreferencesModel } from "../preferences";
import { useSkillsCenterModel } from "../skills-center";
import { useSettingsAiModel } from "../settings-ai";
import { TerminalDock, useTerminalDockModel } from "../terminal-dock";
import { useWorkspaceTabsModel } from "../workspace-tabs";
import type { SearchEngineDefinition } from "../browser-search/types";
import {
  observeSystemPrefersDark,
  readSystemPrefersDark,
  resolveThemeVars,
  resolveWorkbenchThemeId
} from "../theme";
import { resolveTerminalThemeVars } from "../terminal-theme";
import {
  LOGO_URL,
  createSettingLocaleOptions,
  createSettingSplitOverflowPolicyOptions,
  createSettingSplitThreePaneLayoutOptions,
  createSettingSplitTriggerModeOptions,
  createSettingTerminalThemeOptions,
  createSettingThemeOptions,
  getDesktopApi,
  resolveDocsEntryUrl,
  syncCssVarsToDocumentRoot
} from "./service";
import { useWorkbenchBrowserLayoutSync } from "./browser-layout-sync";
import { TitlebarElementPickerButton } from "./titlebar-element-picker-button";
import { TitlebarNavigation } from "./titlebar-navigation";
import { useBrowserSearchModel } from "./use-browser-search-model";
import { usePanelLayoutModel } from "./use-panel-layout";
import { useScrollbarVisibilityGuard } from "./use-scrollbar-visibility-guard";
import { useTerminalWorkspaceActions } from "./use-terminal-workspace-actions";
import { useTitlebarElementPickerModel } from "./use-titlebar-element-picker-model";
import { useTitlebarNavigationModel } from "./use-titlebar-navigation-model";
import { WorkspaceSurfaceRouter } from "./workspace-surface-router";
import { attachWorkbenchObservationBridge } from "../observation/service";
import type { WorkbenchBrowserPageRuntimeState } from "../../../shared/desktop-bridge";

type PageNavigationState = {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
};

const DEFAULT_PAGE_NAVIGATION_STATE: PageNavigationState = {
  canGoBack: false,
  canGoForward: false
};

export const WorkbenchShell = () => {
  const desktopApi = getDesktopApi();
  const preferencesModel = useWorkbenchPreferencesModel({
    locale: WORKBENCH_CONFIG.locale,
    theme: WORKBENCH_CONFIG.theme,
    terminalThemePreset: WORKBENCH_CONFIG.terminalThemePreset,
    splitTriggerMode: "ctrl_left_drag",
    splitThreePaneLayout: "adaptive",
    splitOverflowPolicy: "block_with_notice",
    aiRichRenderingEnabled: true,
    searchScopePreset: "home",
    searchCustomRoots: [],
    searchEnableFuzzy: true,
    searchEnableContent: true,
    searchIncludeHidden: false,
    searchWebEngineIds: WORKBENCH_CONFIG.browser.searchEngines.map((engine) => engine.id),
    searchAutoIndexEnabled: true,
    deepSearchDefaultBudget: "medium",
    deepSearchRestoreViewport: false,
    deepSearchLocalOpenBehavior: "open_file",
    deepSearchSiteExpansionEnabled: true,
    deepSearchProactiveDomainGuessingEnabled: true,
    deepSearchCrawlPolicy: "accessibility_only",
    searchResultsSourceFilter: "all",
    omniboxNonBrowserSubmitTarget: "new_tab"
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    readSystemPrefersDark()
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const [stackedBrowserTabs, setStackedBrowserTabs] = useState(false);
  const [pageNavigationState, setPageNavigationState] =
    useState<PageNavigationState>(DEFAULT_PAGE_NAVIGATION_STATE);
  const [pageRuntimeStateByTabId, setPageRuntimeStateByTabId] = useState<
    Readonly<Record<string, WorkbenchBrowserPageRuntimeState>>
  >({});

  const t = useMemo(
    () => createTranslator(preferencesModel.preferences.locale),
    [preferencesModel.preferences.locale]
  );
  const rootRef = useRef<HTMLElement | null>(null);
  const restoredFileManagerInstanceIdsRef = useRef<Set<string>>(new Set());
  const restoredFileEditorInstanceIdsRef = useRef<Set<string>>(new Set());
  const pendingProjectBindResolverRef = useRef<((path: string | null) => void) | null>(null);
  const writeStreamByToolCallRef = useRef<
    Record<
      string,
      {
        instanceId: string;
        toolCallId: string;
        filePath: string;
        turnId: string;
        toolName: string;
        startedAt: number;
        baselineContent?: string;
        created?: boolean;
        content: string;
        bytesWritten?: number;
        bytesTotal?: number;
        /** Queued chunk texts awaiting paced delivery */
        chunkQueue: string[];
        /** Interval timer ID for paced chunk delivery */
        paceTimerId: ReturnType<typeof setInterval> | null;
        /** Whether the stream has finished (flush remaining immediately) */
        finished: boolean;
      }
    >
  >({});
  const [editorReviewItems, setEditorReviewItems] = useState<readonly FileEditorChangeReviewItem[]>([]);
  const [activeEditorReviewId, setActiveEditorReviewId] = useState<string | null>(null);
  const [projectBindChooserInstanceId, setProjectBindChooserInstanceId] = useState<string | null>(null);
  const [searchIndexStatus, setSearchIndexStatus] = useState<{
    readonly state: "idle" | "building" | "ready" | "failed";
    readonly indexedFiles: number;
    readonly indexedDirs: number;
    readonly lastBuiltAt?: string;
    readonly progress?: number;
    readonly error?: string;
  } | null>(null);
  const [searchRebuildIndexPending, setSearchRebuildIndexPending] = useState(false);

  const browserTabsConfig = useMemo(
    () => ({
      homeTabTitle: t("browser.homeTabTitle"),
      settingsTabTitle: t("settings.tabTitle"),
      homeSearchAddress: WORKBENCH_CONFIG.browser.homeSearchAddress,
      maxSearchTitleLength: WORKBENCH_CONFIG.browser.maxSearchTitleLength
    }),
    [t]
  );
  const tabsModel = useWorkspaceTabsModel(browserTabsConfig, {
    splitOverflowPolicy: preferencesModel.preferences.splitOverflowPolicy
  });
  const activeTab = tabsModel.activeTab;
  const activeTabPageKind = activeTab?.pageKind ?? "search";
  const activePageTabId = activeTab?.pageKind === "page" ? activeTab.id : "";
  const activeBrowserTabId = activeTab?.pageKind === "page" ? activeTab.id : null;
  const activePageRuntimeState =
    activeBrowserTabId === null
      ? null
      : (pageRuntimeStateByTabId[activeBrowserTabId] ?? null);
  const visibleWorkspaceLayout = tabsModel.getVisibleWorkspaceLayout();
  const visibleBrowserPageDescriptors = useMemo(
    () =>
      visibleWorkspaceLayout.visibleTabIds
        .map((tabId, index) => {
          const tab = tabsModel.tabs.find((candidate) => candidate.id === tabId);
          if (tab?.pageKind !== "page") {
            return null;
          }
          return {
            tabId,
            zIndex: index,
            isFocusedPane:
              visibleWorkspaceLayout.mode === "split"
                ? visibleWorkspaceLayout.focusedSplitTabId === tabId
                : visibleWorkspaceLayout.activeTabId === tabId
          };
        })
        .filter((value): value is { tabId: string; zIndex: number; isFocusedPane: boolean } => value !== null),
    [tabsModel.tabs, visibleWorkspaceLayout]
  );
  const terminalModel = useTerminalDockModel();
  const contextMenuModel = useContextMenuModel();
  const panelLayoutModel = usePanelLayoutModel();

  const themeVars = useMemo(
    () =>
      resolveThemeVars(
        preferencesModel.preferences.theme,
        systemPrefersDark
      ),
    [preferencesModel.preferences.theme, systemPrefersDark]
  );
  const resolvedThemeId = useMemo(
    () =>
      resolveWorkbenchThemeId(
        preferencesModel.preferences.theme,
        systemPrefersDark
      ),
    [preferencesModel.preferences.theme, systemPrefersDark]
  );
  const terminalThemeVars = useMemo(
    () =>
      resolveTerminalThemeVars(preferencesModel.preferences.terminalThemePreset),
    [preferencesModel.preferences.terminalThemePreset]
  );
  const terminalThemeSignature = `${preferencesModel.preferences.theme}:${systemPrefersDark ? "dark" : "light"}:${preferencesModel.preferences.terminalThemePreset}`;
  const { registerPageHost, scheduleBrowserLayoutSync } = useWorkbenchBrowserLayoutSync({
    desktopApi,
    descriptors: visibleBrowserPageDescriptors
  });

  const terminalLabels = useMemo(
    () => ({
      newTab: t("terminal.newTab"),
      splitHorizontal: t("terminal.splitHorizontal"),
      splitVertical: t("terminal.splitVertical"),
      closeTab: t("terminal.closeTab"),
      emptyDock: t("terminal.emptyDock"),
      unavailable: t("terminal.unavailable")
    }),
    [t]
  );
  const settingLocaleOptions = useMemo(
    () => createSettingLocaleOptions(t),
    [t]
  );
  const settingThemeOptions = useMemo(() => createSettingThemeOptions(t), [t]);
  const settingTerminalThemeOptions = useMemo(
    () => createSettingTerminalThemeOptions(t),
    [t]
  );
  const settingSplitTriggerModeOptions = useMemo(
    () => createSettingSplitTriggerModeOptions(t),
    [t]
  );
  const settingSplitThreePaneLayoutOptions = useMemo(
    () => createSettingSplitThreePaneLayoutOptions(t),
    [t]
  );
  const settingSplitOverflowPolicyOptions = useMemo(
    () => createSettingSplitOverflowPolicyOptions(t),
    [t]
  );
  const settingsAiLabels = useMemo(
    () => ({
      categoryLabel: t("settings.aiCategoryLabel"),
      profilesTitle: t("settings.aiProfilesTitle"),
      providerTitle: t("settings.aiProviderTitle"),
      connectionTitle: t("settings.aiConnectionTitle"),
      statusTitle: t("settings.aiStatusTitle"),
      addProfile: t("settings.aiAddProfile"),
      saveProfile: t("settings.aiSaveProfile"),
      deleteProfile: t("settings.aiDeleteProfile"),
      setDefaultProfile: t("settings.aiSetDefaultProfile"),
      clearApiKey: t("settings.aiClearApiKey"),
      testConnection: t("settings.aiTestConnection"),
      discoverModels: t("settings.aiDiscoverModels"),
      refreshModels: t("settings.aiRefreshModels"),
      authorizeChatGpt: t("settings.aiAuthorizeChatGpt"),
      authorizeChatGptDeviceCode: t("settings.aiAuthorizeChatGptDeviceCode"),
      profileNameLabel: t("settings.aiProfileNameLabel"),
      profileNamePlaceholder: t("settings.aiProfileNamePlaceholder"),
      modelLabel: t("settings.aiModelLabel"),
      modelPlaceholder: t("settings.aiModelPlaceholder"),
      headersLabel: t("settings.aiHeadersLabel"),
      headersPlaceholder: t("settings.aiHeadersPlaceholder"),
      customModelsLabel: t("settings.aiCustomModelsLabel"),
      customModelsPlaceholder: t("settings.aiCustomModelsPlaceholder"),
      defaultBadge: t("settings.aiDefaultBadge"),
      defaultProfileLabel: t("settings.aiDefaultProfileLabel"),
      statusIdle: t("settings.aiStatusIdle"),
      statusSaved: t("settings.aiStatusSaved"),
      statusDeleted: t("settings.aiStatusDeleted"),
      statusDefaultUpdated: t("settings.aiStatusDefaultUpdated"),
      statusChatGptAuthorized: t("settings.aiStatusChatGptAuthorized"),
      statusLastChecked: t("settings.aiStatusLastChecked"),
      emptyTitle: t("settings.aiEmptyTitle"),
      emptyDescription: t("settings.aiEmptyDescription"),
      recommendedSection: t("settings.aiRecommendedSection"),
      allSection: t("settings.aiAllSection"),
      customSection: t("settings.aiCustomSection"),
      secretConfigured: t("settings.aiSecretConfigured"),
      secretMissing: t("settings.aiSecretMissing"),
      noDiscoveredModels: t("settings.aiNoDiscoveredModels"),
      capabilityLabel: t("settings.aiCapabilityLabel"),
      capabilityFull: t("settings.aiCapabilityFull"),
      capabilityStatic: t("settings.aiCapabilityStatic"),
      capabilityPending: t("settings.aiCapabilityPending"),
      modelSourceDynamic: t("settings.aiModelSourceDynamic"),
      modelSourcePreset: t("settings.aiModelSourcePreset"),
      modelSourceCustom: t("settings.aiModelSourceCustom"),
      memoryConfigTitle: t("settings.aiMemoryConfigTitle"),
      memoryConfigDescription: t("settings.aiMemoryConfigDescription"),
      memoryConfigPlaceholder: t("settings.aiMemoryConfigPlaceholder"),
      memoryConfigLoad: t("settings.aiMemoryConfigLoad"),
      memoryConfigSave: t("settings.aiMemoryConfigSave"),
      memoryConfigStatusIdle: t("settings.aiMemoryConfigStatusIdle"),
      memoryConfigStatusLoaded: t("settings.aiMemoryConfigStatusLoaded"),
      memoryConfigStatusSaved: t("settings.aiMemoryConfigStatusSaved"),
      memoryConfigStatusInvalidJson: t("settings.aiMemoryConfigStatusInvalidJson")
    }),
    [t]
  );
  const allSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => {
      const engines: SearchEngineDefinition[] = [...WORKBENCH_CONFIG.browser.searchEngines];
      const searxngEndpoint = preferencesModel.preferences.searchSearxngEndpoint?.trim();
      if (searxngEndpoint !== undefined && searxngEndpoint.length > 0) {
        engines.push({
          id: "searxng",
          label: "SearXNG",
          accentColor: "#4F8F5B",
          endpoint: searxngEndpoint
        });
      }
      return engines;
    },
    [preferencesModel.preferences.searchSearxngEndpoint]
  );
  const activeSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => {
      const enabledEngineIds = preferencesModel.preferences.searchWebEngineIds;
      const lookup = new Map(allSearchEngines.map((engine) => [engine.id, engine]));
      const preferred =
        enabledEngineIds.length > 0
          ? enabledEngineIds.map((id) => lookup.get(id)).filter((engine): engine is SearchEngineDefinition => engine !== undefined)
          : [];
      if (preferred.length > 0) {
        return preferred;
      }
      return allSearchEngines;
    },
    [allSearchEngines, preferencesModel.preferences.searchWebEngineIds]
  );
  const engineById = useMemo(
    () => new Map(allSearchEngines.map((engine) => [engine.id, engine])),
    [allSearchEngines]
  );

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }
    const pages = tabsModel.tabs
      .filter((tab) => tab.pageKind === "page")
      .map((tab) => ({
        tabId: tab.id,
        address: tab.displayAddress,
        titleHint: tab.title,
        isActive: tab.id === activeBrowserTabId,
      }));
    void desktopApi.workbenchBrowser.syncTopology({
      activeTabId: activeBrowserTabId,
      pages
    });
  }, [activeBrowserTabId, desktopApi, tabsModel.tabs]);

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }
      return desktopApi.workbenchBrowser.onEvent((event) => {
      if (event.kind === "page-runtime-state") {
        setPageRuntimeStateByTabId((current) => {
          const existing = current[event.page.tabId];
          if (
            existing !== undefined
            && existing.address === event.page.address
            && existing.title === event.page.title
            && existing.faviconUrl === event.page.faviconUrl
            && existing.isActive === event.page.isActive
            && existing.isVisible === event.page.isVisible
            && existing.isLoading === event.page.isLoading
            && existing.canGoBack === event.page.canGoBack
            && existing.canGoForward === event.page.canGoForward
            && existing.isHtmlFullscreen === event.page.isHtmlFullscreen
          ) {
            return current;
          }
          return {
            ...current,
            [event.page.tabId]: event.page
          };
        });
        const currentTab = tabsModel.tabs.find((tab) => tab.id === event.page.tabId);
        if (currentTab?.pageKind === "page") {
          const nextFaviconUrl = event.page.faviconUrl;
          if (
            currentTab.displayAddress !== event.page.address
            || currentTab.title !== event.page.title
            || currentTab.faviconUrl !== nextFaviconUrl
          ) {
            tabsModel.syncPageRuntimeState(event.page.tabId, {
              address: event.page.address,
              title: event.page.title,
              ...(nextFaviconUrl === undefined
                ? {}
                : { faviconUrl: nextFaviconUrl })
            });
          }
        }
        return;
      }
      if (event.kind === "page-closed") {
        setPageRuntimeStateByTabId((current) => {
          const next = { ...current };
          delete next[event.tabId];
          return next;
        });
        return;
      }
      if (event.kind === "request-open-tab") {
        tabsModel.openPageInNewTab(event.address, event.title);
      }
    });
  }, [desktopApi, tabsModel]);

  const browserSearchModel = useBrowserSearchModel({
    desktopApi,
    tabsModel,
    searchSettings: {
      searchEngines: activeSearchEngines,
      resultsPerEngine: WORKBENCH_CONFIG.browser.resultsPerEngine,
      localScopePreset: preferencesModel.preferences.searchScopePreset,
      localCustomRoots: preferencesModel.preferences.searchCustomRoots,
      localIncludeHidden: preferencesModel.preferences.searchIncludeHidden,
      localEnableFuzzy: preferencesModel.preferences.searchEnableFuzzy,
      localEnableContent: preferencesModel.preferences.searchEnableContent,
      localEnableExtensionMatch: true,
      deepBudgetPreset: preferencesModel.preferences.deepSearchDefaultBudget,
      deepSiteExpansionEnabled: preferencesModel.preferences.deepSearchSiteExpansionEnabled,
      deepProactiveDomainGuessingEnabled:
        preferencesModel.preferences.deepSearchProactiveDomainGuessingEnabled,
      deepCrawlPolicy: preferencesModel.preferences.deepSearchCrawlPolicy
    }
  });
  const settingSearchScopeOptions = useMemo(
    () => ([
      {
        value: "home",
        label: t("settings.searchScopeHomeLabel"),
        description: t("settings.searchScopeHomeDescription")
      },
      {
        value: "full_system",
        label: t("settings.searchScopeFullSystemLabel"),
        description: t("settings.searchScopeFullSystemDescription")
      },
      {
        value: "workspace",
        label: t("settings.searchScopeWorkspaceLabel"),
        description: t("settings.searchScopeWorkspaceDescription")
      },
      {
        value: "custom",
        label: t("settings.searchScopeCustomLabel"),
        description: t("settings.searchScopeCustomDescription")
      }
    ] as const),
    [t]
  );
  const settingSearchWebEngineOptions = useMemo(
    () => ([
      { value: "bing", label: t("settings.searchWebEngineBing") },
      { value: "brave", label: t("settings.searchWebEngineBrave") },
      { value: "duckduckgo", label: t("settings.searchWebEngineDuckDuckGo") },
      { value: "searxng", label: t("settings.searchWebEngineSearxng") }
    ] as const),
    [t]
  );
  const settingDeepSearchBudgetOptions = useMemo(
    () => ([
      { value: "low", label: t("settings.deepSearchBudgetLowLabel") },
      { value: "medium", label: t("settings.deepSearchBudgetMediumLabel") },
      { value: "high", label: t("settings.deepSearchBudgetHighLabel") }
    ] as const),
    [t]
  );
  const settingOmniboxNonBrowserSubmitTargetOptions = useMemo(
    () => [
      {
        value: "new_tab" as const,
        label: t("settings.omniboxNonBrowserSubmitTargetNewTabLabel")
      },
      {
        value: "replace_active_tab" as const,
        label: t("settings.omniboxNonBrowserSubmitTargetReplaceActiveLabel")
      }
    ],
    [t]
  );
  const settingDeepSearchLocalOpenBehaviorOptions = useMemo(
    () => ([
      { value: "open_file", label: t("settings.deepSearchOpenFileLabel") },
      { value: "reveal_in_manager", label: t("settings.deepSearchRevealInManagerLabel") }
    ] as const),
    [t]
  );
  const settingDeepSearchCrawlPolicyOptions = useMemo(
    () => ([
      {
        value: "accessibility_only",
        label: t("settings.deepSearchCrawlPolicyAccessibilityOnlyLabel")
      }
    ] as const),
    [t]
  );
  useEffect(() => {
    if (desktopApi === null) {
      return;
    }
    let disposed = false;
    const readStatus = async (): Promise<void> => {
      try {
        const status = await desktopApi.search.readIndexStatus();
        if (disposed) {
          return;
        }
        setSearchIndexStatus(status);
      } catch (_error) {
        // Keep index status best-effort and non-disruptive.
      }
    };
    void readStatus();
    const timer = setInterval(() => {
      void readStatus();
    }, 3_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [desktopApi]);
  const onSearchRebuildIndex = useCallback(() => {
    if (desktopApi === null || searchRebuildIndexPending) {
      return;
    }
    setSearchRebuildIndexPending(true);
    void desktopApi.search.rebuildIndex({
      scopePreset: preferencesModel.preferences.searchScopePreset,
      customRoots: preferencesModel.preferences.searchCustomRoots,
      includeHidden: preferencesModel.preferences.searchIncludeHidden,
      force: true
    })
      .then((response) => {
        setSearchIndexStatus(response.status);
      })
      .finally(() => {
        setSearchRebuildIndexPending(false);
      });
  }, [
    desktopApi,
    preferencesModel.preferences.searchCustomRoots,
    preferencesModel.preferences.searchIncludeHidden,
    preferencesModel.preferences.searchScopePreset,
    searchRebuildIndexPending
  ]);
  const terminalWorkspaceActions = useTerminalWorkspaceActions({
    desktopApi,
    tabsModel,
    terminalModel,
    contextMenuModel,
    t
  });
  const fileManagerLabels = useMemo(
    () => ({
      title: t("files.title"),
      locationHome: t("files.locationHome"),
      locationDesktop: t("files.locationDesktop"),
      locationDocuments: t("files.locationDocuments"),
      locationDownloads: t("files.locationDownloads"),
      locationTrash: t("files.locationTrash"),
      homeSectionFavorites: t("files.homeSectionFavorites"),
      homeSectionLocations: t("files.homeSectionLocations"),
      homeSectionDevices: t("files.homeSectionDevices"),
      homeSectionRecent: t("files.homeSectionRecent"),
      navigationBack: t("files.navigationBack"),
      navigationForward: t("files.navigationForward"),
      navigationUp: t("files.navigationUp"),
      refresh: t("files.refresh"),
      addFavorite: t("files.addFavorite"),
      removeFavorite: t("files.removeFavorite"),
      newFolder: t("files.newFolder"),
      newFile: t("files.newFile"),
      delete: t("files.delete"),
      restore: t("files.restore"),
      emptyTrash: t("files.emptyTrash"),
      noRecentLocations: t("files.noRecentLocations"),
      emptyDirectory: t("files.emptyDirectory"),
      emptyTrashState: t("files.emptyTrashState"),
      loading: t("files.loading"),
      unavailable: t("files.unavailable"),
      diskAvailable: t("files.diskAvailable"),
      diskKindSystem: t("files.diskKindSystem"),
      diskKindLocal: t("files.diskKindLocal"),
      diskKindRemovable: t("files.diskKindRemovable"),
      diskKindExternal: t("files.diskKindExternal"),
      deviceUnmounted: t("files.deviceUnmounted"),
      nameColumn: t("files.nameColumn"),
      locationColumn: t("files.locationColumn"),
      originalLocationColumn: t("files.originalLocationColumn"),
      createPlaceholderFile: t("files.createPlaceholderFile"),
      createPlaceholderDirectory: t("files.createPlaceholderDirectory"),
      createConfirm: t("files.createConfirm"),
      createCancel: t("files.createCancel"),
      contextOpen: t("files.contextOpen"),
      contextMountDevice: t("files.contextMountDevice"),
      contextMoveToTrash: t("files.contextMoveToTrash"),
      contextRestore: t("files.contextRestore"),
      contextEmptyTrash: t("files.contextEmptyTrash"),
      contextEjectDevice: t("files.contextEjectDevice"),
      viewList: t("files.viewList"),
      viewLarge: t("files.viewLarge"),
      chooserBindProjectLabel: t("files.chooserBindProjectLabel")
    }),
    [t]
  );
  const fileEditorLabels = useMemo(
    () => ({
      loading: t("editor.loading"),
      unsupported: t("editor.unsupported"),
      unavailable: t("editor.unavailable"),
      readOnly: t("editor.readOnly"),
      conflict: t("editor.conflict"),
      retry: t("editor.retry"),
      save: t("editor.save"),
      openDiff: t("editor.openDiff"),
      closeDiff: t("editor.closeDiff")
    }),
    [t]
  );
  const fileEditorReviewLabels = useMemo(
    () => ({
      accept: t("ai.editorWorkAccept"),
      reject: t("ai.editorWorkReject"),
      undo: t("ai.editorWorkUndo"),
      previous: t("ai.editorWorkPrevious"),
      next: t("ai.editorWorkNext"),
      acceptAll: t("ai.editorWorkAcceptAll")
    }),
    [t]
  );
  const notificationTopbarLabels = useMemo(
    () => ({
      openCenter: t("notification.topbarOpenCenter"),
      openPreview: t("notification.topbarOpenPreview")
    }),
    [t]
  );
  const notificationCenterLabels = useMemo(
    () => ({
      title: t("notification.centerTitle"),
      listTitle: t("notification.centerListTitle"),
      emptyState: t("notification.centerEmptyState"),
      detailEmpty: t("notification.centerDetailEmpty"),
      markAllRead: t("notification.centerMarkAllRead"),
      clearAll: t("notification.centerClearAll"),
      openSource: t("notification.centerOpenSource"),
      sourceFallback: t("notification.centerSourceFallback"),
      unread: t("notification.centerUnread")
    }),
    [t]
  );
  const fileManagerModel = useFileManagerModel({
    desktopApi,
    contextMenuModel,
    labels: fileManagerLabels,
    onMetaChange: tabsModel.updateAppTabMeta
  });
  const fileEditorModel = useFileEditorModel({
    desktopApi,
    onMetaChange: tabsModel.updateAppTabMeta
  });
  useEffect(() => {
    return attachWorkbenchObservationBridge({
      desktopApi,
      tabsModel,
      fileEditorModel,
      fileManagerModel,
      terminalModel
    });
  }, [desktopApi, fileEditorModel, fileManagerModel, tabsModel, terminalModel]);
  const feedbackModel = useWorkbenchFeedbackModel();
  const notificationModel = useWorkbenchNotificationModel();
  const publishNotification = notificationModel.publishNotification;
  const markNotificationRead = notificationModel.markNotificationRead;
  const clearNotifications = notificationModel.clearNotifications;
  const selectNotification = notificationModel.selectNotification;
  const acknowledgeTopbarPreview = notificationModel.acknowledgeTopbarPreview;
  const getNotification = notificationModel.getNotification;
  const globalDialogModel = useGlobalDialogModel();
  const activeFileManagerState =
    activeTab?.pageKind === "app" &&
    activeTab.appId === "file-manager" &&
    activeTab.appInstanceId !== undefined
      ? fileManagerModel.getState(activeTab.appInstanceId)
      : null;
  const activeFileEditorState =
    activeTab?.pageKind === "app" &&
    activeTab.appId === "file-editor" &&
    activeTab.appInstanceId !== undefined
      ? fileEditorModel.getState(activeTab.appInstanceId)
      : null;
  const mcpProjectHintPath = useMemo(() => {
    if (activeFileEditorState !== null) {
      return activeFileEditorState.filePath;
    }
    if (activeFileManagerState?.currentLocation?.path !== undefined) {
      return activeFileManagerState.currentLocation.path;
    }
    return activeTab?.filePath;
  }, [activeFileEditorState, activeFileManagerState, activeTab?.filePath]);
  const mcpCenterModel = useMcpCenterModel({
    desktopApi,
    ...(mcpProjectHintPath === undefined ? {} : { projectHintPath: mcpProjectHintPath })
  });
  const skillsCenterLabels = useMemo(
    () => ({
      title: t("skills.title"),
      sidebarDescription: t("skills.sidebarDescription"),
      sidebarScope: t("skills.sidebarScope"),
      sidebarStatus: t("skills.sidebarStatus"),
      sidebarSources: t("skills.sidebarSources"),
      sidebarCategories: t("skills.sidebarCategories"),
      sidebarBuiltin: t("skills.sidebarBuiltin"),
      sidebarInstalledGlobal: t("skills.sidebarInstalledGlobal"),
      sidebarInstalledProject: t("skills.sidebarInstalledProject"),
      scopeGlobal: t("skills.scopeGlobal"),
      scopeProject: t("skills.scopeProject"),
      scopeProjectUnavailable: t("skills.scopeProjectUnavailable"),
      statusAll: t("skills.statusAll"),
      statusEnabled: t("skills.statusEnabled"),
      statusDisabled: t("skills.statusDisabled"),
      statusUntrusted: t("skills.statusUntrusted"),
      sourceAll: t("skills.sourceAll"),
      sourceBuiltin: t("skills.sourceBuiltin"),
      sourceLyra: t("skills.sourceLyra"),
      sourceClaude: t("skills.sourceClaude"),
      sourceContinue: t("skills.sourceContinue"),
      toolbarInstalled: t("skills.toolbarInstalled"),
      toolbarInstalledDescription: t("skills.toolbarInstalledDescription"),
      actionOpenCatalog: t("skills.actionOpenCatalog"),
      actionOpenImport: t("skills.actionOpenImport"),
      actionOpenCreate: t("skills.actionOpenCreate"),
      actionRefresh: t("skills.actionRefresh"),
      actionInstallBuiltin: t("skills.actionInstallBuiltin"),
      actionDiscoverImport: t("skills.actionDiscoverImport"),
      actionImportSelected: t("skills.actionImportSelected"),
      actionCreateSkill: t("skills.actionCreateSkill"),
      actionCancel: t("skills.actionCancel"),
      actionTrust: t("skills.actionTrust"),
      actionUntrust: t("skills.actionUntrust"),
      actionEnable: t("skills.actionEnable"),
      actionDisable: t("skills.actionDisable"),
      actionDelete: t("skills.actionDelete"),
      actionViewDetails: t("skills.actionViewDetails"),
      catalog: t("skills.catalog"),
      details: t("skills.details"),
      importTitle: t("skills.importTitle"),
      importDescription: t("skills.importDescription"),
      createTitle: t("skills.createTitle"),
      createDescription: t("skills.createDescription"),
      fieldName: t("skills.fieldName"),
      fieldDescription: t("skills.fieldDescription"),
      fieldCategory: t("skills.fieldCategory"),
      fieldAuthor: t("skills.fieldAuthor"),
      fieldSkillType: t("skills.fieldSkillType"),
      fieldTriggerSummary: t("skills.fieldTriggerSummary"),
      fieldContent: t("skills.fieldContent"),
      fieldSource: t("skills.fieldSource"),
      fieldVersion: t("skills.fieldVersion"),
      fieldTrust: t("skills.fieldTrust"),
      fieldEnable: t("skills.fieldEnable"),
      fieldFiles: t("skills.fieldFiles"),
      fieldScripts: t("skills.fieldScripts"),
      fieldCompatibility: t("skills.fieldCompatibility"),
      fieldEntry: t("skills.fieldEntry"),
      fieldPath: t("skills.fieldPath"),
      fieldLastError: t("skills.fieldLastError"),
      fieldPackagePath: t("skills.fieldPackagePath"),
      fieldOverride: t("skills.fieldOverride"),
      fieldContentPreview: t("skills.fieldContentPreview"),
      importPathLabel: t("skills.importPathLabel"),
      importPathPlaceholder: t("skills.importPathPlaceholder"),
      importPreviewTitle: t("skills.importPreviewTitle"),
      importPreviewEmpty: t("skills.importPreviewEmpty"),
      importPreviewScripts: t("skills.importPreviewScripts"),
      importPreviewResources: t("skills.importPreviewResources"),
      importPreviewErrors: t("skills.importPreviewErrors"),
      emptySelection: t("skills.emptySelection"),
      emptyInstalled: t("skills.emptyInstalled"),
      emptyCatalog: t("skills.emptyCatalog"),
      emptyImport: t("skills.emptyImport"),
      typePrompt: t("skills.typePrompt"),
      typeWorkflow: t("skills.typeWorkflow"),
      typeResource: t("skills.typeResource"),
      typeToolGuidance: t("skills.typeToolGuidance"),
      trustTrusted: t("skills.trustTrusted"),
      trustUntrusted: t("skills.trustUntrusted"),
      enableEnabled: t("skills.enableEnabled"),
      enableDisabled: t("skills.enableDisabled"),
      overrideInherited: t("skills.overrideInherited"),
      overrideProjectOnly: t("skills.overrideProjectOnly"),
      overrideGlobalOnly: t("skills.overrideGlobalOnly"),
      untrustedWarning: t("skills.untrustedWarning"),
      createDefaultContent: t("skills.createDefaultContent")
    }),
    [t]
  );
  const skillsCenterModel = useSkillsCenterModel({
    desktopApi,
    ...(mcpProjectHintPath === undefined ? {} : { projectHintPath: mcpProjectHintPath }),
    labels: skillsCenterLabels
  });
  const settingsAiModel = useSettingsAiModel({
    desktopApi,
    labels: settingsAiLabels
  });
  const defaultAiProfile = useMemo(
    () =>
      settingsAiModel.profiles.find((profile) => profile.isDefault)
      ?? settingsAiModel.profiles[0]
      ?? null,
    [settingsAiModel.profiles]
  );
  const requestProjectBind = useCallback(
    (currentPath?: string): Promise<string | null> =>
      new Promise((resolve) => {
        if (pendingProjectBindResolverRef.current !== null) {
          const previousResolver = pendingProjectBindResolverRef.current;
          pendingProjectBindResolverRef.current = null;
          previousResolver(null);
        }

        const picker = fileManagerModel.createInstance();
        const pickerInstanceId = picker.appInstanceId;
        pendingProjectBindResolverRef.current = resolve;
        setProjectBindChooserInstanceId(pickerInstanceId);
        tabsModel.openAppTab(picker);

        const normalizedPath =
          typeof currentPath === "string" ? currentPath.trim() : "";
        if (normalizedPath.length > 0) {
          void fileManagerModel.openDirectory(pickerInstanceId, normalizedPath, false);
          return;
        }
        void fileManagerModel.openHome(pickerInstanceId, false);
      }),
    [fileManagerModel, tabsModel]
  );

  const resolveFileManagerChooser = useCallback(
    (instanceId: string): FileManagerChooserMode | null => {
      if (projectBindChooserInstanceId === null || projectBindChooserInstanceId !== instanceId) {
        return null;
      }
      return {
        kind: "ai-project-bind",
        confirmLabel: t("ai.bindProjectConfirm"),
        onConfirm: () => {
          const state = fileManagerModel.getState(instanceId);
          const selectedPath =
            state?.viewKind === "directory"
            && typeof state.currentLocation?.path === "string"
              ? state.currentLocation.path.trim()
              : "";
          if (selectedPath.length === 0) {
            return;
          }

          const chooserTab = tabsModel.tabs.find(
            (tab) =>
              tab.pageKind === "app"
              && tab.appId === "file-manager"
              && tab.appInstanceId === instanceId
          );
          if (chooserTab !== undefined) {
            tabsModel.closeTab(chooserTab.id);
          }

          const resolver = pendingProjectBindResolverRef.current;
          pendingProjectBindResolverRef.current = null;
          setProjectBindChooserInstanceId(null);
          resolver?.(selectedPath);
        }
      };
    },
    [fileManagerModel, projectBindChooserInstanceId, t, tabsModel]
  );

  useEffect(() => {
    if (projectBindChooserInstanceId === null) {
      return;
    }
    const chooserTabStillOpen = tabsModel.tabs.some(
      (tab) =>
        tab.pageKind === "app"
        && tab.appId === "file-manager"
        && tab.appInstanceId === projectBindChooserInstanceId
    );
    if (chooserTabStillOpen) {
      return;
    }
    if (pendingProjectBindResolverRef.current !== null) {
      const resolver = pendingProjectBindResolverRef.current;
      pendingProjectBindResolverRef.current = null;
      resolver(null);
    }
    setProjectBindChooserInstanceId(null);
  }, [projectBindChooserInstanceId, tabsModel.tabs]);

  const sidebarAiSurfaceProps = useMemo(() => {
    return {
      desktopApi,
      locale: preferencesModel.preferences.locale,
      title: t("ai.tabTitle"),
      description: t("settings.aiCategoryLabel"),
      themeSignature: resolvedThemeId,
      richRenderingEnabled: preferencesModel.preferences.aiRichRenderingEnabled,
      newSessionTitle: t("ai.sessionDefaultTitle"),
      defaultProfileId: defaultAiProfile?.id ?? null,
      defaultProfileName: defaultAiProfile?.name ?? null,
      defaultModelName: defaultAiProfile?.model ?? null,
      profileLabel: t("ai.profileLabel"),
      modelLabel: t("ai.modelLabel"),
      openSettingsLabel: t("settings.tabTitle"),
      openHistoryLabel: t("ai.openHistory"),
      openMcpLabel: t("ai.openMcp"),
      openSkillsLabel: t("ai.openSkills"),
      bindProjectLabel: t("ai.bindProjectLabel"),
      composeAriaLabel: t("sidebar.composeAriaLabel"),
      composePlaceholder: t("sidebar.composePlaceholder"),
      composeSendLabel: t("sidebar.composeSend"),
      emptyStateTitle: t("settings.aiEmptyTitle"),
      emptyStateDescription: t("settings.aiEmptyDescription"),
      readOnlyBannerLabel: t("ai.readonlyBanner"),
      loadingSessionLabel: t("ai.loadingSession"),
      emptyThreadLabel: t("ai.startBySending"),
      turnNoToolCallsLabel: t("ai.turnNoToolCalls"),
      turnWorkingLabel: t("ai.turnWorking"),
      turnFailedLabel: t("ai.turnFailed"),
      turnWorkedForPrefix: t("ai.turnWorkedForPrefix"),
      runtimeQueuedLabel: t("ai.runtimeQueued"),
      runtimeStartedLabel: t("ai.runtimeStarted"),
      runtimeRunningPrefix: t("ai.runtimeRunningPrefix"),
      runtimeCompletedPrefix: t("ai.runtimeCompletedPrefix"),
      runtimeFailedPrefix: t("ai.runtimeFailedPrefix"),
      runtimeCompletedTurnLabel: t("ai.runtimeCompletedTurn"),
      runtimeFailedTurnLabel: t("ai.runtimeFailedTurn"),
      runtimePhasePrefixLabel: t("ai.runtimePhasePrefix"),
      runtimePhaseIdleLabel: t("ai.runtimePhaseIdle"),
      runtimePhaseAcceptedLabel: t("ai.runtimePhaseAccepted"),
      runtimePhaseStartedLabel: t("ai.runtimePhaseStarted"),
      runtimePhaseToolStartedLabel: t("ai.runtimePhaseToolStarted"),
      runtimePhaseToolFinishedLabel: t("ai.runtimePhaseToolFinished"),
      runtimePhaseCompletedLabel: t("ai.runtimePhaseCompleted"),
      runtimePhaseFailedLabel: t("ai.runtimePhaseFailed"),
      runtimeToolFallbackLabel: t("ai.runtimeToolFallback"),
      toolNameSearchLabel: t("ai.toolNameSearch"),
      toolNameReadRangeLabel: t("ai.toolNameReadRange"),
      toolNameListLabel: t("ai.toolNameList"),
      toolNameGlobLabel: t("ai.toolNameGlob"),
      toolNameWriteLabel: t("ai.toolNameWrite"),
      toolNameEditLabel: t("ai.toolNameEdit"),
      toolNameMultiEditLabel: t("ai.toolNameMultiEdit"),
      toolStatusRunningLabel: t("ai.toolStatusRunning"),
      toolStatusCompletedLabel: t("ai.toolStatusCompleted"),
      toolStatusFailedLabel: t("ai.toolStatusFailed"),
      onOpenHistory: () => {
        tabsModel.openAppTab(createAiHistoryAppRequest(t("ai.historyTitle")));
      },
      onOpenMcp: () => {
        tabsModel.openAppTab(createAiMcpAppRequest(t("ai.mcpTabTitle")));
      },
      onOpenSkills: () => {
        tabsModel.openAppTab(createAiSkillsAppRequest(t("ai.skillsTabTitle")));
      },
      onRequestProjectBind: requestProjectBind,
      onOpenSettings: () => {
        tabsModel.openSettingsTab();
      }
    };
  }, [
    defaultAiProfile,
    desktopApi,
    requestProjectBind,
    resolvedThemeId,
    preferencesModel.preferences.aiRichRenderingEnabled,
    preferencesModel.preferences.locale,
    t,
    tabsModel
  ]);
  const mcpCenterLabels = useMemo(
    () => ({
      title: t("mcp.title"),
      sidebarDescription: t("mcp.sidebarDescription"),
      sidebarScope: t("mcp.sidebarScope"),
      sidebarStatus: t("mcp.sidebarStatus"),
      sidebarSources: t("mcp.sidebarSources"),
      sidebarProjectRoot: t("mcp.sidebarProjectRoot"),
      sidebarGlobalCount: t("mcp.sidebarGlobalCount"),
      sidebarProjectCount: t("mcp.sidebarProjectCount"),
      sidebarOfficialCatalog: t("mcp.sidebarOfficialCatalog"),
      sidebarCustomServers: t("mcp.sidebarCustomServers"),
      scopeGlobal: t("mcp.scopeGlobal"),
      scopeProject: t("mcp.scopeProject"),
      scopeProjectUnavailable: t("mcp.scopeProjectUnavailable"),
      statusAll: t("mcp.statusAll"),
      statusRunning: t("mcp.statusRunning"),
      statusStopped: t("mcp.statusStopped"),
      statusError: t("mcp.statusError"),
      toolbarInstalled: t("mcp.toolbarInstalled"),
      toolbarInstalledDescription: t("mcp.toolbarInstalledDescription"),
      installed: t("mcp.installed"),
      details: t("mcp.details"),
      catalog: t("mcp.catalog"),
      catalogDescription: t("mcp.catalogDescription"),
      emptySelection: t("mcp.emptySelection"),
      emptyInstalled: t("mcp.emptyInstalled"),
      emptyCatalog: t("mcp.emptyCatalog"),
      fieldTitle: t("mcp.fieldTitle"),
      fieldTransport: t("mcp.fieldTransport"),
      fieldInstallKind: t("mcp.fieldInstallKind"),
      fieldCommand: t("mcp.fieldCommand"),
      fieldArguments: t("mcp.fieldArguments"),
      fieldCwd: t("mcp.fieldCwd"),
      fieldUrl: t("mcp.fieldUrl"),
      fieldConnection: t("mcp.fieldConnection"),
      fieldEnvironment: t("mcp.fieldEnvironment"),
      fieldPermissions: t("mcp.fieldPermissions"),
      fieldRuntime: t("mcp.fieldRuntime"),
      fieldOverride: t("mcp.fieldOverride"),
      fieldSource: t("mcp.fieldSource"),
      fieldValidation: t("mcp.fieldValidation"),
      fieldCapabilities: t("mcp.fieldCapabilities"),
      fieldTools: t("mcp.fieldTools"),
      fieldResources: t("mcp.fieldResources"),
      fieldPrompts: t("mcp.fieldPrompts"),
      fieldLastError: t("mcp.fieldLastError"),
      actionEdit: t("mcp.actionEdit"),
      actionStart: t("mcp.actionStart"),
      actionStop: t("mcp.actionStop"),
      actionRestart: t("mcp.actionRestart"),
      actionValidate: t("mcp.actionValidate"),
      actionDelete: t("mcp.actionDelete"),
      actionSave: t("mcp.actionSave"),
      actionCancel: t("mcp.actionCancel"),
      actionInstall: t("mcp.actionInstall"),
      actionRefresh: t("mcp.actionRefresh"),
      actionOpenCustom: t("mcp.actionOpenCustom"),
      actionAddEnvironment: t("mcp.actionAddEnvironment"),
      actionReadCapabilities: t("mcp.actionReadCapabilities"),
      toggleAdvanced: t("mcp.toggleAdvanced"),
      advancedInvalid: t("mcp.advancedInvalid"),
      validationOk: t("mcp.validationOk"),
      validationFailed: t("mcp.validationFailed"),
      validationIdle: t("mcp.validationIdle"),
      noIntrospection: t("mcp.noIntrospection"),
      noEnvironment: t("mcp.noEnvironment"),
      noPermissions: t("mcp.noPermissions"),
      sourceOfficial: t("mcp.sourceOfficial"),
      sourceCustom: t("mcp.sourceCustom"),
      recommendedScope: t("mcp.recommendedScope"),
      enabled: t("mcp.enabled"),
      autoStart: t("mcp.autoStart"),
      modePlain: t("mcp.modePlain"),
      modeSecret: t("mcp.modeSecret"),
      modeExternal: t("mcp.modeExternal"),
      transportStdio: t("mcp.transportStdio"),
      transportSse: t("mcp.transportSse"),
      transportHttp: t("mcp.transportHttp"),
      installKindNpm: t("mcp.installKindNpm"),
      installKindUv: t("mcp.installKindUv"),
      installKindDocker: t("mcp.installKindDocker"),
      installKindBinary: t("mcp.installKindBinary"),
      installKindManual: t("mcp.installKindManual"),
      runtimeStarting: t("mcp.runtimeStarting"),
      runtimeRunning: t("mcp.runtimeRunning"),
      runtimeStopped: t("mcp.runtimeStopped"),
      runtimeError: t("mcp.runtimeError"),
      runtimeValidating: t("mcp.runtimeValidating"),
      projectOverrideInactive: t("mcp.projectOverrideInactive"),
      inheritedFromGlobal: t("mcp.inheritedFromGlobal"),
      formNew: t("mcp.formNew"),
      formEdit: t("mcp.formEdit"),
      formSummary: t("mcp.formSummary"),
      formDescription: t("mcp.formDescription"),
      formIconKey: t("mcp.formIconKey"),
      formEnvironmentKey: t("mcp.formEnvironmentKey"),
      formEnvironmentValue: t("mcp.formEnvironmentValue"),
      formEnvironmentExternal: t("mcp.formEnvironmentExternal"),
      formEnvironmentSecret: t("mcp.formEnvironmentSecret"),
      formRaw: t("mcp.formRaw"),
      customDescription: t("mcp.customDescription"),
      fieldSummary: t("mcp.fieldSummary"),
      fieldDescription: t("mcp.fieldDescription"),
      fieldIconKey: t("mcp.fieldIconKey"),
      presetTitle: t("mcp.presetTitle"),
      presetDescription: t("mcp.presetDescription"),
      actionQuickSetup: t("mcp.actionQuickSetup"),
      presetFieldRootPath: t("mcp.presetFieldRootPath"),
      presetFieldRepoPath: t("mcp.presetFieldRepoPath"),
      presetFieldTimezone: t("mcp.presetFieldTimezone"),
      presetHintProjectDefault: t("mcp.presetHintProjectDefault"),
      presetPlaceholderPath: t("mcp.presetPlaceholderPath"),
      presetPlaceholderTimezone: t("mcp.presetPlaceholderTimezone")
    }),
    [t]
  );

  useScrollbarVisibilityGuard(rootRef);

  useEffect(() => {
    const unsubscribe = observeSystemPrefersDark((prefersDark) => {
      setSystemPrefersDark(prefersDark);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }
    const unsubscribe = desktopApi.shellEvents.onWindowStateChange((state) => {
      setIsMaximized(state.isMaximized);
    });
    return () => {
      unsubscribe();
    };
  }, [desktopApi]);

  useEffect(() => {
    if (activePageTabId.length === 0) {
      setPageNavigationState(DEFAULT_PAGE_NAVIGATION_STATE);
      return;
    }
    const runtimeState = pageRuntimeStateByTabId[activePageTabId];
    if (runtimeState === undefined) {
      setPageNavigationState(DEFAULT_PAGE_NAVIGATION_STATE);
      return;
    }
    setPageNavigationState({
      canGoBack: runtimeState.canGoBack,
      canGoForward: runtimeState.canGoForward
    });
  }, [activePageTabId, pageRuntimeStateByTabId]);

  useEffect(() => {
    const validPageTabIds = new Set(
      tabsModel.tabs.filter((tab) => tab.pageKind === "page").map((tab) => tab.id)
    );
    setPageRuntimeStateByTabId((current) => {
      const nextEntries = Object.entries(current).filter(([tabId]) => validPageTabIds.has(tabId));
      if (nextEntries.length === Object.keys(current).length) {
        return current;
      }
      return Object.fromEntries(nextEntries);
    });
  }, [tabsModel.tabs]);

  useEffect(() => {
    const unsubscribe = feedbackModel.subscribe((event) => {
      publishNotification(mapFeedbackEventToNotification(event));
    });
    return () => {
      unsubscribe();
    };
  }, [feedbackModel, publishNotification]);

  useEffect(
    () => () => {
      if (pendingProjectBindResolverRef.current === null) {
        return;
      }
      const resolver = pendingProjectBindResolverRef.current;
      pendingProjectBindResolverRef.current = null;
      resolver(null);
    },
    []
  );

  const onGoBack = useCallback(() => {
    if (desktopApi === null || activePageTabId.length === 0) {
      return;
    }
    void desktopApi.workbenchBrowser.goBack({ tabId: activePageTabId });
  }, [activePageTabId, desktopApi]);

  const onGoForward = useCallback(() => {
    if (desktopApi === null || activePageTabId.length === 0) {
      return;
    }
    void desktopApi.workbenchBrowser.goForward({ tabId: activePageTabId });
  }, [activePageTabId, desktopApi]);

  const onRootDragStartCapture = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (shouldPreventWorkbenchDragStart(event.target)) {
      event.preventDefault();
    }
  }, []);

  const rootStyle = useMemo(
    () =>
      ({
        ...themeVars,
        ...terminalThemeVars,
        ...panelLayoutModel.cssVars
      }) as CSSProperties,
    [panelLayoutModel.cssVars, terminalThemeVars, themeVars]
  );

  useEffect(() => {
    scheduleBrowserLayoutSync();
  }, [panelLayoutModel.cssVars, scheduleBrowserLayoutSync, stackedBrowserTabs, tabsModel.activeTabId]);

  useEffect(() => {
    syncCssVarsToDocumentRoot({
      ...themeVars,
      ...terminalThemeVars
    });
    document.documentElement.dataset.lyraThemeTone = resolvedThemeId.endsWith("-dark")
      ? "dark"
      : "light";
  }, [resolvedThemeId, terminalThemeVars, themeVars]);

  useEffect(() => {
    const fileManagerTabs = tabsModel.tabs
      .filter(
        (tab) =>
          tab.pageKind === "app" &&
          tab.appId === "file-manager" &&
          tab.appInstanceId !== undefined
      );
    const fileManagerInstanceIds = fileManagerTabs
      .map((tab) => tab.appInstanceId as string);
    fileManagerModel.syncTabInstances(fileManagerInstanceIds);

    for (const tab of fileManagerTabs) {
      const instanceId = tab.appInstanceId;
      if (
        instanceId === undefined ||
        restoredFileManagerInstanceIdsRef.current.has(instanceId)
      ) {
        continue;
      }

      restoredFileManagerInstanceIdsRef.current.add(instanceId);
      if (fileManagerModel.getState(instanceId) !== null) {
        continue;
      }
      fileManagerModel.ensureInstance(instanceId);
      if (typeof tab.filePath === "string" && tab.filePath.trim().length > 0) {
        void fileManagerModel.openDirectory(instanceId, tab.filePath, false);
      } else {
        void fileManagerModel.openHome(instanceId, false);
      }
    }

    const activeIds = new Set(fileManagerInstanceIds);
    for (const instanceId of [...restoredFileManagerInstanceIdsRef.current]) {
      if (activeIds.has(instanceId) === false) {
        restoredFileManagerInstanceIdsRef.current.delete(instanceId);
      }
    }
  }, [
    fileManagerModel.syncTabInstances,
    fileManagerModel.getState,
    fileManagerModel.ensureInstance,
    fileManagerModel.openDirectory,
    fileManagerModel.openHome,
    tabsModel.tabs
  ]);

  useEffect(() => {
    const fileEditorTabs = tabsModel.tabs
      .filter(
        (tab) =>
          tab.pageKind === "app" &&
          tab.appId === "file-editor" &&
          tab.appInstanceId !== undefined
      );
    const fileEditorInstanceIds = fileEditorTabs
      .map((tab) => tab.appInstanceId as string);
    fileEditorModel.syncTabInstances(fileEditorInstanceIds);

    for (const tab of fileEditorTabs) {
      const instanceId = tab.appInstanceId;
      if (
        instanceId === undefined ||
        restoredFileEditorInstanceIdsRef.current.has(instanceId)
      ) {
        continue;
      }
      if (tab.filePath === undefined || tab.filePath.trim().length === 0) {
        continue;
      }

      restoredFileEditorInstanceIdsRef.current.add(instanceId);
      if (fileEditorModel.getState(instanceId) !== null) {
        continue;
      }
      fileEditorModel.ensureInstance(instanceId, {
        filePath: tab.filePath,
        ...(tab.fileSessionId === undefined
          ? {}
          : { fileSessionId: tab.fileSessionId })
      });
      void fileEditorModel.hydrateIfNeeded(instanceId);
    }

    const activeIds = new Set(fileEditorInstanceIds);
    for (const instanceId of [...restoredFileEditorInstanceIdsRef.current]) {
      if (activeIds.has(instanceId) === false) {
        restoredFileEditorInstanceIdsRef.current.delete(instanceId);
      }
    }
  }, [
    fileEditorModel.syncTabInstances,
    fileEditorModel.getState,
    fileEditorModel.ensureInstance,
    fileEditorModel.hydrateIfNeeded,
    tabsModel.tabs
  ]);

  useEffect(() => {
    if (
      activeTab?.pageKind === "app" &&
      activeTab.appId === "file-editor" &&
      activeTab.appInstanceId !== undefined
    ) {
      fileEditorModel.touchInstance(activeTab.appInstanceId);
      void fileEditorModel.hydrateIfNeeded(activeTab.appInstanceId);
    }
  }, [activeTab?.appId, activeTab?.appInstanceId, activeTab?.pageKind, fileEditorModel]);

  const onOpenFileFromManager = useCallback(
    (
      filePath: string,
      location?: FileEditorRevealLocation,
      options?: {
        readonly forceReloadIfOpen?: boolean;
        readonly allowMissing?: boolean;
      }
    ): string | null => {
      const existingInstanceId = fileEditorModel.findInstanceByPath(filePath);
      const existingTab = tabsModel.tabs.find(
        (tab) =>
          tab.pageKind === "app" &&
          tab.appId === "file-editor" &&
          tab.appInstanceId !== undefined &&
          (existingInstanceId !== null
            ? tab.appInstanceId === existingInstanceId
            : tab.filePath === filePath)
      );
      if (existingTab !== undefined) {
        tabsModel.setActiveTab(existingTab.id);
        if (existingTab.appInstanceId !== undefined) {
          const state = fileEditorModel.getState(existingTab.appInstanceId);
          const allowMissing = options?.allowMissing === true;
          const shouldReload =
            allowMissing === false &&
            options?.forceReloadIfOpen === true &&
            state !== null &&
            state.isDirty === false;
          if (allowMissing) {
            fileEditorModel.ensureInstance(existingTab.appInstanceId, {
              filePath
            });
          } else if (shouldReload) {
            void fileEditorModel.openFile(existingTab.appInstanceId, filePath);
          } else {
            void fileEditorModel.hydrateIfNeeded(existingTab.appInstanceId);
          }
          if (location !== undefined) {
            fileEditorModel.revealLocation(existingTab.appInstanceId, location);
          }
          return existingTab.appInstanceId;
        }
        return null;
      }

      const nextEditor = fileEditorModel.createInstance(filePath);
      tabsModel.openAppTab(nextEditor);
      if (options?.allowMissing === true) {
        fileEditorModel.ensureInstance(nextEditor.appInstanceId, {
          filePath
        });
      } else {
        void fileEditorModel.openFile(nextEditor.appInstanceId, filePath);
      }
      if (location !== undefined) {
        fileEditorModel.revealLocation(nextEditor.appInstanceId, location);
      }
      return nextEditor.appInstanceId;
    },
    [fileEditorModel, tabsModel]
  );

  const onRevealPathInFileManager = useCallback(async (filePath: string): Promise<void> => {
    const normalized = filePath.trim();
    if (normalized.length === 0) {
      return;
    }
    const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
    const parentPath = slashIndex <= 0 ? normalized : normalized.slice(0, slashIndex);
    const instance = fileManagerModel.createInstance();
    tabsModel.openAppTab(instance);
    await fileManagerModel.openDirectory(instance.appInstanceId, parentPath);
    const state = fileManagerModel.getState(instance.appInstanceId);
    const entry = state?.entries.find((item) => item.path === normalized);
    if (entry !== undefined) {
      fileManagerModel.selectEntry(instance.appInstanceId, entry.id);
    }
  }, [fileManagerModel, tabsModel]);

  const openDirectoryFromNavigation = useCallback(async (path: string): Promise<void> => {
    const normalizedPath = path.trim();
    if (normalizedPath.length === 0) {
      return;
    }

    if (
      activeTab?.pageKind === "app" &&
      activeTab.appId === "file-manager" &&
      activeTab.appInstanceId !== undefined
    ) {
      tabsModel.setActiveTab(activeTab.id);
      await fileManagerModel.openDirectory(activeTab.appInstanceId, normalizedPath, false);
      return;
    }

    const instance = fileManagerModel.createInstance();
    tabsModel.openAppTab(instance);
    await fileManagerModel.openDirectory(instance.appInstanceId, normalizedPath, false);
  }, [activeTab, fileManagerModel, tabsModel]);

  const titlebarNavigation = useTitlebarNavigationModel({
    desktopApi,
    activeTab,
    activePageRuntimeState,
    activeFileEditorState,
    activeFileManagerState,
    tabsModel,
    omniboxNonBrowserSubmitTarget:
      preferencesModel.preferences.omniboxNonBrowserSubmitTarget,
    placeholder: t("navigation.titlebarPlaceholder"),
    ariaLabel: t("navigation.titlebarAriaLabel"),
    onOpenFilePath: (path) => onOpenFileFromManager(path),
    onOpenDirectoryPath: openDirectoryFromNavigation
  });
  const titlebarElementPicker = useTitlebarElementPickerModel({
    desktopApi,
    activeTab,
    enableLabel: t("navigation.elementPickerEnable"),
    disableLabel: t("navigation.elementPickerDisable"),
    activeLabel: t("navigation.elementPickerActive")
  });

  const activeEditorReviewIndex = useMemo(
    () => editorReviewItems.findIndex((item) => item.id === activeEditorReviewId),
    [activeEditorReviewId, editorReviewItems]
  );
  const activeEditorReviewItem = useMemo(
    () =>
      activeEditorReviewIndex === -1
        ? null
        : (editorReviewItems[activeEditorReviewIndex] ?? null),
    [activeEditorReviewIndex, editorReviewItems]
  );

  useEffect(() => {
    if (editorReviewItems.length === 0) {
      if (activeEditorReviewId !== null) {
        setActiveEditorReviewId(null);
      }
      return;
    }
    if (
      activeEditorReviewId === null ||
      editorReviewItems.some((item) => item.id === activeEditorReviewId) === false
    ) {
      setActiveEditorReviewId(editorReviewItems[editorReviewItems.length - 1]!.id);
    }
  }, [activeEditorReviewId, editorReviewItems]);

  const focusEditorReviewItem = useCallback((item: FileEditorChangeReviewItem): void => {
    setActiveEditorReviewId(item.id);
    onOpenFileFromManager(
      item.filePath,
      item.firstChangedLine === undefined ? undefined : { line: item.firstChangedLine },
      { forceReloadIfOpen: true }
    );
  }, [onOpenFileFromManager]);

  const onGoToPreviousEditorWorkItem = useCallback((): void => {
    if (editorReviewItems.length === 0 || activeEditorReviewIndex <= 0) {
      return;
    }
    const next = editorReviewItems[activeEditorReviewIndex - 1];
    if (next === undefined) {
      return;
    }
    focusEditorReviewItem(next);
  }, [activeEditorReviewIndex, editorReviewItems, focusEditorReviewItem]);

  const onGoToNextEditorWorkItem = useCallback((): void => {
    if (
      editorReviewItems.length === 0 ||
      activeEditorReviewIndex < 0 ||
      activeEditorReviewIndex >= editorReviewItems.length - 1
    ) {
      return;
    }
    const next = editorReviewItems[activeEditorReviewIndex + 1];
    if (next === undefined) {
      return;
    }
    focusEditorReviewItem(next);
  }, [activeEditorReviewIndex, editorReviewItems, focusEditorReviewItem]);

  const onAcceptEditorWorkItem = useCallback((item: FileEditorChangeReviewItem): void => {
    setEditorReviewItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, decision: "accepted" as const }
          : entry
      )
    );
  }, []);

  const onUndoEditorWorkItem = useCallback((item: FileEditorChangeReviewItem): void => {
    setEditorReviewItems((current) =>
      current.map((entry) => {
        if (entry.id !== item.id) {
          return entry;
        }
        const nextEntry = { ...entry };
        delete nextEntry.decision;
        return nextEntry;
      })
    );
  }, []);

  const onRejectEditorWorkItem = useCallback((item: FileEditorChangeReviewItem): void => {
    setEditorReviewItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, decision: "rejected" as const }
          : entry
      )
    );

    if (desktopApi === null) {
      return;
    }

    void (async () => {
      try {
        if (item.created) {
          await desktopApi.files.moveToTrash({ paths: [item.filePath] });
        } else {
          await desktopApi.files.writeTextFile({
            path: item.filePath,
            content: item.baselineContent ?? "",
            encoding: "utf8"
          });
        }
      } catch (_error) {
        // Ignore rollback errors; keep the review decision visible to the user.
      } finally {
        if (item.created) {
          return;
        }
        onOpenFileFromManager(
          item.filePath,
          item.firstChangedLine === undefined ? undefined : { line: item.firstChangedLine },
          { forceReloadIfOpen: true }
        );
      }
    })();
  }, [desktopApi, onOpenFileFromManager]);

  const onAcceptAllEditorWorkItems = useCallback((): void => {
    setEditorReviewItems((current) =>
      current.map((entry) =>
        entry.status === "completed"
          ? { ...entry, decision: "accepted" as const }
          : entry
      )
    );
  }, []);

  const resolveActiveEditorWorkItem = useCallback(
    (filePath: string): FileEditorChangeReviewItem | undefined => {
      if (activeEditorReviewItem === null) {
        return undefined;
      }
      return activeEditorReviewItem.filePath === filePath
        ? activeEditorReviewItem
        : undefined;
    },
    [activeEditorReviewItem]
  );

  const onAiWriteStreamEvent = useCallback((event: AiPanelWriteStreamEvent): void => {
    /** Apply accumulated content to the editor and scroll to end */
    const applyContent = (entry: NonNullable<ReturnType<typeof ensureStreamEntry>>) => {
      fileEditorModel.applyExternalContent(entry.instanceId, entry.content, {
        markHydrated: true
      });
      const lineCount = entry.content.split("\n").length;
      fileEditorModel.revealLocation(entry.instanceId, { line: Math.max(0, lineCount - 1) });
    };

    /** Run post-completion logic (review items, disk reload, cleanup) after all chunks are drained */
    const runPostCompletion = (entry: NonNullable<ReturnType<typeof ensureStreamEntry>>) => {
      // Clear the pace timer
      if (entry.paceTimerId !== null) {
        clearInterval(entry.paceTimerId);
        entry.paceTimerId = null;
      }

      // Reload from disk to ensure final content is consistent
      onOpenFileFromManager(
        entry.filePath,
        entry.firstChangedLine === undefined ? undefined : { line: entry.firstChangedLine },
        { forceReloadIfOpen: true }
      );

      // Create review item
      const reviewItemId = `editor-work-${entry.toolCallId}`;
      const reviewItem: FileEditorChangeReviewItem = {
        id: reviewItemId,
        status: "completed",
        filePath: entry.filePath,
        created: entry.created,
        addedLines: entry.addedLines ?? 0,
        removedLines: entry.removedLines ?? 0,
        createdAt: entry.completedAt ?? entry.startedAt,
        ...(entry.firstChangedLine === undefined
          ? {}
          : { firstChangedLine: entry.firstChangedLine }),
        ...(entry.baselineContent !== undefined
          ? { baselineContent: entry.baselineContent }
          : {})
      };
      setEditorReviewItems((current) => {
        const existingIndex = current.findIndex((item) => item.id === reviewItemId);
        if (existingIndex === -1) {
          return [...current, reviewItem];
        }
        const next = [...current];
        next[existingIndex] = reviewItem;
        return next;
      });
      setActiveEditorReviewId(reviewItemId);

      // Clean up the stream entry
      delete writeStreamByToolCallRef.current[entry.toolCallId];
    };

    /** Start or restart the paced delivery interval */
    const ensurePaceTimer = (entry: NonNullable<ReturnType<typeof ensureStreamEntry>>) => {
      if (entry.paceTimerId !== null) {
        return; // already running
      }
      entry.paceTimerId = setInterval(() => {
        if (entry.chunkQueue.length === 0) {
          if (entry.finished) {
            // All chunks drained and stream finished — run post-completion
            runPostCompletion(entry);
          }
          return;
        }
        // Consume one chunk per tick for smooth visible progression
        const chunk = entry.chunkQueue.shift()!;
        entry.content += chunk;
        applyContent(entry);
      }, 60); // ~60ms per chunk gives a visible "typing" cadence
    };

    const ensureStreamEntry = (): {
      instanceId: string;
      toolCallId: string;
      filePath: string;
      turnId: string;
      toolName: string;
      startedAt: number;
      baselineContent?: string;
      created?: boolean;
      content: string;
      bytesWritten?: number;
      bytesTotal?: number;
      chunkQueue: string[];
      paceTimerId: ReturnType<typeof setInterval> | null;
      finished: boolean;
      firstChangedLine?: number;
      addedLines?: number;
      removedLines?: number;
      completedAt?: number;
    } | null => {
      const existing = writeStreamByToolCallRef.current[event.toolCallId];
      if (existing !== undefined) {
        return existing;
      }
      const instanceId = onOpenFileFromManager(event.filePath, undefined, { allowMissing: true });
      if (instanceId === null) {
        return null;
      }
      const createdEntry = {
        instanceId,
        toolCallId: event.toolCallId,
        filePath: event.filePath,
        turnId: event.turnId,
        toolName: event.toolName,
        startedAt: event.timestamp,
        content: "",
        chunkQueue: [] as string[],
        paceTimerId: null as ReturnType<typeof setInterval> | null,
        finished: false
      };
      writeStreamByToolCallRef.current[event.toolCallId] = createdEntry;
      return createdEntry;
    };

    if (event.kind === "started") {
      const entry = ensureStreamEntry();
      if (entry === null) {
        return;
      }
      if (event.baselineContent !== undefined) {
        entry.baselineContent = event.baselineContent;
        entry.content = event.baselineContent;
        fileEditorModel.applyExternalContent(entry.instanceId, entry.content, {
          markHydrated: true
        });
      }
      if (typeof event.created === "boolean") {
        entry.created = event.created;
      }
      return;
    }

    if (event.kind === "delta") {
      const entry = ensureStreamEntry();
      if (entry === null) {
        return;
      }
      // Queue the chunk for paced delivery instead of applying immediately
      entry.chunkQueue.push(event.chunkText);
      if (typeof event.firstChangedLine === "number") {
        entry.firstChangedLine = event.firstChangedLine;
      }
      if (typeof event.bytesWritten === "number") {
        entry.bytesWritten = event.bytesWritten;
      }
      if (typeof event.bytesTotal === "number") {
        entry.bytesTotal = event.bytesTotal;
      }
      ensurePaceTimer(entry);
      return;
    }

    // finished / failed
    const entry = ensureStreamEntry();
    if (entry === null) {
      return;
    }

    entry.finished = true;
    entry.completedAt = event.timestamp;

    if (event.status === "failed") {
      // On failure, flush immediately so the editor shows what was written
      if (entry.paceTimerId !== null) {
        clearInterval(entry.paceTimerId);
        entry.paceTimerId = null;
      }
      while (entry.chunkQueue.length > 0) {
        entry.content += entry.chunkQueue.shift()!;
      }
      applyContent(entry);
      delete writeStreamByToolCallRef.current[event.toolCallId];
    }
    // For "completed": the pace timer will drain remaining chunks and then
    // call runPostCompletion when the queue empties. This creates the Zed-like
    // gradual content appearance effect.
  }, [fileEditorModel, onOpenFileFromManager]);

  const sidebarAiSurfacePropsWithFileOpen = useMemo(
    () =>
      sidebarAiSurfaceProps === null
        ? null
        : {
            ...sidebarAiSurfaceProps,
            onWriteStreamEvent: onAiWriteStreamEvent,
            onOpenFilePath: (
              filePath: string,
              options?: {
                readonly forceReloadIfOpen?: boolean;
                readonly allowMissing?: boolean;
                readonly location?: FileEditorRevealLocation;
              }
            ) => {
              onOpenFileFromManager(filePath, options?.location, options);
            },
            onTerminalExecStarted: (
              command: string,
              _cwd: string | undefined,
              _toolCallId: string,
              _turnId: string,
              _sessionId: string
            ) => {
              if (desktopApi === null) {
                return;
              }
              const prevActiveTab = terminalModel.activeDockTab;
              terminalModel.openTab();

              const newTab = terminalModel.activeDockTab;
              if (newTab === null || newTab === prevActiveTab) {
                return;
              }

              const paneId = newTab.activePaneId ?? newTab.paneIds[0];
              if (paneId === undefined) {
                return;
              }

              const terminalSessionId = `session-${paneId}`;
              const commandToSend = `${command}\n`;

              setTimeout(() => {
                void desktopApi.terminal
                  .write({
                    sessionId: terminalSessionId,
                    data: commandToSend,
                    source: "user"
                  })
                  .catch((_error) => {
                    // session may not be ready yet; best-effort delivery
                  });
              }, 300);
            }
          },
    [onAiWriteStreamEvent, onOpenFileFromManager, sidebarAiSurfaceProps, desktopApi, terminalModel]
  );

  const notificationCenterTabTitle = t("notification.centerTabTitle");

  const openNotificationCenterTab = useCallback((notificationId?: string): void => {
    const trimmedNotificationId =
      typeof notificationId === "string" ? notificationId.trim() : "";
    if (trimmedNotificationId.length > 0) {
      selectNotification(trimmedNotificationId);
    }

    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === "notification-center" &&
        tab.appInstanceId === "notification-center"
    );

    if (existingTab !== undefined) {
      tabsModel.setActiveTab(existingTab.id);
      return;
    }

    tabsModel.openAppTab(createNotificationCenterAppRequest(notificationCenterTabTitle));
  }, [
    notificationCenterTabTitle,
    selectNotification,
    tabsModel.openAppTab,
    tabsModel.setActiveTab,
    tabsModel.tabs
  ]);

  const resolveNotificationAppIconKey = useCallback((
    appId:
      | "file-manager"
      | "file-editor"
      | "ai-history"
      | "ai-mcp"
      | "ai-skills"
      | "notification-center"
  ) => {
    switch (appId) {
      case "file-manager":
        return "file-manager-home" as const;
      case "file-editor":
        return "file-editor-code" as const;
      case "ai-history":
        return "ai-panel-history" as const;
      case "ai-mcp":
        return "ai-panel-mcp" as const;
      case "ai-skills":
        return "ai-panel-skills" as const;
      case "notification-center":
        return "notification-center-default" as const;
      default:
        return "ai-panel-default" as const;
    }
  }, []);

  const attemptNotificationNavigation = useCallback((notification: WorkbenchNotificationItem): boolean => {
    const target = notification.target;
    if (target.kind === "none") {
      return false;
    }

    if (target.kind === "page-tab") {
      tabsModel.openPageInNewTab(target.address, target.title);
      return true;
    }

    if (target.appId === "notification-center") {
      openNotificationCenterTab(notification.id);
      return true;
    }

    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === target.appId &&
        tab.appInstanceId === target.appInstanceId
    );
    if (existingTab !== undefined) {
      tabsModel.setActiveTab(existingTab.id);
      return true;
    }

    tabsModel.openAppTab({
      appId: target.appId,
      appInstanceId: target.appInstanceId,
      title: target.title ?? notification.source.title,
      iconKey: target.iconKey ?? resolveNotificationAppIconKey(target.appId),
      ...(target.filePath === undefined ? {} : { filePath: target.filePath }),
      ...(target.fileSessionId === undefined ? {} : { fileSessionId: target.fileSessionId }),
      ...(target.isDirty === undefined ? {} : { isDirty: target.isDirty })
    });

    if (target.appId === "file-manager") {
      fileManagerModel.ensureInstance(target.appInstanceId);
      if (target.filePath !== undefined && target.filePath.trim().length > 0) {
        void fileManagerModel.openDirectory(target.appInstanceId, target.filePath, false);
      } else {
        void fileManagerModel.openHome(target.appInstanceId, false);
      }
    }

    if (
      target.appId === "file-editor" &&
      target.filePath !== undefined &&
      target.filePath.trim().length > 0
    ) {
      fileEditorModel.ensureInstance(target.appInstanceId, {
        filePath: target.filePath,
        ...(target.fileSessionId === undefined ? {} : { fileSessionId: target.fileSessionId })
      });
      void fileEditorModel.openFile(target.appInstanceId, target.filePath);
    }

    return true;
  }, [
    fileEditorModel,
    fileManagerModel,
    openNotificationCenterTab,
    resolveNotificationAppIconKey,
    tabsModel
  ]);

  const onOpenNotificationCenter = useCallback((): void => {
    acknowledgeTopbarPreview();
    openNotificationCenterTab();
  }, [acknowledgeTopbarPreview, openNotificationCenterTab]);

  const onOpenNotificationPreview = useCallback((): void => {
    const preview = notificationModel.topbarPreview;
    if (preview === null) {
      openNotificationCenterTab();
      return;
    }

    markNotificationRead(preview.id);
    acknowledgeTopbarPreview();
    const didNavigate = attemptNotificationNavigation(preview);
    if (didNavigate === false) {
      openNotificationCenterTab(preview.id);
    }
  }, [
    acknowledgeTopbarPreview,
    attemptNotificationNavigation,
    markNotificationRead,
    notificationModel.topbarPreview,
    openNotificationCenterTab
  ]);

  const onOpenNotificationSource = useCallback((notificationId: string): void => {
    const notification = getNotification(notificationId);
    if (notification === null) {
      return;
    }
    markNotificationRead(notification.id);
    const didNavigate = attemptNotificationNavigation(notification);
    if (didNavigate === false) {
      openNotificationCenterTab(notification.id);
    }
  }, [
    attemptNotificationNavigation,
    getNotification,
    markNotificationRead,
    openNotificationCenterTab
  ]);

  const onRequestClearNotifications = useCallback((): void => {
    globalDialogModel.openDialog({
      title: t("notification.centerClearConfirmTitle"),
      description: t("notification.centerClearConfirmDescription"),
      source: {
        title: t("notification.centerTabTitle"),
        subtitle: t("notification.centerTitle"),
        iconLabel: "NTF",
        iconTone: "danger"
      },
      actions: [
        {
          id: "notification-clear-cancel",
          label: t("notification.centerClearConfirmCancel")
        },
        {
          id: "notification-clear-confirm",
          label: t("notification.centerClearConfirmAction"),
          tone: "danger",
          onSelect: clearNotifications
        }
      ]
    });
  }, [clearNotifications, globalDialogModel, t]);

  const rootClassName = globalDialogModel.state.isOpen
    ? "lyra-root lyra-root-modal-open"
    : "lyra-root";
  const isMac = desktopApi?.appMeta.platform === "darwin";
  const titlebarClassName = isMac ? "lyra-titlebar lyra-titlebar-macos" : "lyra-titlebar";

  return (
    <main
      ref={rootRef}
      className={rootClassName}
      style={rootStyle}
      onDragStartCapture={onRootDragStartCapture}
    >
      <header className={titlebarClassName}>
        {isMac ? (
          <div
            className="lyra-titlebar-traffic-spacer"
            aria-hidden="true"
          />
        ) : null}
        <TitlebarNavigation
          {...titlebarNavigation}
          trailingControl={
            titlebarElementPicker.visible ? (
              <TitlebarElementPickerButton
                active={titlebarElementPicker.enabled}
                ariaLabel={titlebarElementPicker.ariaLabel}
                activeDescription={titlebarElementPicker.activeDescription}
                onToggle={titlebarElementPicker.onToggle}
              />
            ) : undefined
          }
        />
        <div className="lyra-titlebar-fill" aria-hidden="true" />
        <div className="lyra-window-controls lyra-no-drag">
          <WorkbenchNotificationTopbar
            labels={notificationTopbarLabels}
            unreadCount={notificationModel.unreadCount}
            preview={notificationModel.topbarPreview}
            onOpenCenter={onOpenNotificationCenter}
            onOpenPreview={onOpenNotificationPreview}
          />
          <button
            className="lyra-window-button"
            aria-label={t("panel.toggleLeft")}
            onClick={panelLayoutModel.toggleLeftPanel}
          >
            <PanelLeft size={14} />
          </button>
          <button
            className="lyra-window-button"
            aria-label={t("panel.toggleBottom")}
            onClick={panelLayoutModel.toggleBottomPanel}
          >
            <PanelBottom size={14} />
          </button>
          <button
            className="lyra-window-button"
            aria-label={t("settings.open")}
            onClick={() => {
              tabsModel.openSettingsTab();
            }}
          >
            <Settings2 size={14} />
          </button>
          <button
            className="lyra-window-button"
            aria-label={t("files.open")}
            onClick={() => {
              const nextApp = fileManagerModel.createInstance();
              tabsModel.openAppTab(nextApp);
              void fileManagerModel.openHome(nextApp.appInstanceId);
            }}
          >
            <Folder size={14} />
          </button>
          <button
            className="lyra-window-button"
            aria-label={t("docs.open")}
            onClick={() => {
              const docsEntryUrl = resolveDocsEntryUrl(
                WORKBENCH_CONFIG.browser.docsEntryAddress,
                {
                  locale: preferencesModel.preferences.locale,
                  themeId: resolvedThemeId
                }
              );
              tabsModel.openPageInNewTab(
                docsEntryUrl,
                t("docs.tabTitle")
              );
            }}
          >
            <BookText size={14} />
          </button>
          {isMac ? null : (
            <>
              <button
                className="lyra-window-button"
                aria-label={t("window.minimize")}
                onClick={() => {
                  void desktopApi?.windowControls.minimize();
                }}
              >
                <Minus size={14} />
              </button>
              <button
                className="lyra-window-button"
                aria-label={t("window.toggleMaximize")}
                onClick={() => {
                  void desktopApi?.windowControls.toggleMaximize();
                }}
              >
                <Square size={11} fill={isMaximized ? "currentColor" : "none"} />
              </button>
              <button
                className="lyra-window-button lyra-window-button-close"
                aria-label={t("window.close")}
                onClick={() => {
                  void desktopApi?.windowControls.close();
                }}
              >
                <X size={14} />
              </button>
            </>
          )}
        </div>
      </header>

      <section className="lyra-main">
        {panelLayoutModel.isLeftPanelVisible ? (
          <aside className="lyra-panel lyra-panel-left" aria-label="left-panel">
            {sidebarAiSurfacePropsWithFileOpen === null ? null : (
              <AiPanelSurface
                variant="sidebar"
                {...sidebarAiSurfacePropsWithFileOpen}
              />
            )}
          </aside>
        ) : null}
        {panelLayoutModel.isLeftPanelVisible ? (
          <div
            className="lyra-resizer lyra-resizer-vertical"
            role="separator"
            aria-label="left-resizer"
            aria-orientation="vertical"
            onMouseDown={panelLayoutModel.onLeftResizeMouseDown}
          />
        ) : null}

        <section className="lyra-center-stack">
          <section className="lyra-workspace" aria-label="workspace">
            <WorkspaceSurfaceRouter
              activeTab={activeTab}
              tabsModel={tabsModel}
              logoUrl={LOGO_URL}
              browserSearchModel={browserSearchModel}
              engineById={engineById}
              onOpenSearchResult={tabsModel.openPageInNewTab}
              onPageHostChange={registerPageHost}
              terminalModel={terminalModel}
              desktopApi={desktopApi}
              terminalLabels={terminalLabels}
              terminalThemeSignature={terminalThemeSignature}
              terminalThemePreset={preferencesModel.preferences.terminalThemePreset}
              resolvedThemeId={resolvedThemeId}
              fileManagerModel={fileManagerModel}
              fileManagerLabels={fileManagerLabels}
              resolveFileManagerChooser={resolveFileManagerChooser}
              fileEditorModel={fileEditorModel}
              fileEditorLabels={fileEditorLabels}
              fileEditorReview={{
                editorWorkAcceptLabel: fileEditorReviewLabels.accept,
                editorWorkRejectLabel: fileEditorReviewLabels.reject,
                editorWorkUndoLabel: fileEditorReviewLabels.undo,
                editorWorkPrevLabel: fileEditorReviewLabels.previous,
                editorWorkNextLabel: fileEditorReviewLabels.next,
                editorWorkAcceptAllLabel: fileEditorReviewLabels.acceptAll,
                canGoToPreviousEditorWorkItem: activeEditorReviewIndex > 0,
                canGoToNextEditorWorkItem:
                  activeEditorReviewIndex >= 0
                  && activeEditorReviewIndex < editorReviewItems.length - 1,
                canAcceptAllEditorWorkItems: editorReviewItems.some(
                  (item) => item.status === "completed" && item.decision !== "accepted"
                ),
                resolveActiveEditorWorkItem,
                onGoToPreviousEditorWorkItem,
                onGoToNextEditorWorkItem,
                onAcceptAllEditorWorkItems,
                onAcceptEditorWorkItem,
                onRejectEditorWorkItem,
                onUndoEditorWorkItem
              }}
              splitThreePaneLayout={preferencesModel.preferences.splitThreePaneLayout}
              searchResultsSourceFilter={preferencesModel.preferences.searchResultsSourceFilter}
              onSearchResultsSourceFilterChange={preferencesModel.setSearchResultsSourceFilter}
              settings={{
                title: t("settings.pageTitle"),
                aiCategoryLabel: t("settings.aiCategoryLabel"),
                languageLabel: t("settings.languageLabel"),
                themeLabel: t("settings.themeLabel"),
                terminalThemeLabel: t("settings.terminalThemeLabel"),
                splitTriggerModeLabel: t("settings.splitTriggerModeLabel"),
                splitThreePaneLayoutLabel: t("settings.splitThreePaneLayoutLabel"),
                splitOverflowPolicyLabel: t("settings.splitOverflowPolicyLabel"),
                aiRichRenderLabel: t("settings.aiRichRenderLabel"),
                aiRichRenderDescription: t("settings.aiRichRenderDescription"),
                aiRichRenderEnabledLabel: t("settings.aiRichRenderEnabled"),
                aiRichRenderDisabledLabel: t("settings.aiRichRenderDisabled"),
                searchCategoryLabel: t("settings.searchCategoryLabel"),
                searchScopeLabel: t("settings.searchScopeLabel"),
                searchCustomRootsLabel: t("settings.searchCustomRootsLabel"),
                searchCustomRootsPlaceholder: t("settings.searchCustomRootsPlaceholder"),
                searchWebEnginesLabel: t("settings.searchWebEnginesLabel"),
                searchSearxngEndpointLabel: t("settings.searchSearxngEndpointLabel"),
                searchDeepBudgetLabel: t("settings.deepSearchDefaultBudgetLabel"),
                deepSearchRestoreViewportLabel: t("settings.deepSearchRestoreViewportLabel"),
                deepSearchLocalOpenBehaviorLabel: t("settings.deepSearchLocalOpenBehaviorLabel"),
                deepSearchSiteExpansionLabel: t("settings.deepSearchSiteExpansionLabel"),
                deepSearchProactiveGuessLabel: t("settings.deepSearchProactiveGuessLabel"),
                deepSearchCrawlPolicyLabel: t("settings.deepSearchCrawlPolicyLabel"),
                searchEnableFuzzyLabel: t("settings.searchEnableFuzzyLabel"),
                searchEnableContentLabel: t("settings.searchEnableContentLabel"),
                searchIncludeHiddenLabel: t("settings.searchIncludeHiddenLabel"),
                searchAutoIndexLabel: t("settings.searchAutoIndexLabel"),
                searchIndexStatusLabel: t("settings.searchIndexStatusLabel"),
                searchRebuildIndexLabel: t("settings.searchRebuildIndexLabel"),
                omniboxNonBrowserSubmitTargetLabel: t("settings.omniboxNonBrowserSubmitTargetLabel"),
                localeValue: preferencesModel.preferences.locale,
                themeValue: preferencesModel.preferences.theme,
                terminalThemeValue:
                  preferencesModel.preferences.terminalThemePreset,
                splitTriggerModeValue: preferencesModel.preferences.splitTriggerMode,
                splitThreePaneLayoutValue:
                  preferencesModel.preferences.splitThreePaneLayout,
                splitOverflowPolicyValue:
                  preferencesModel.preferences.splitOverflowPolicy,
                aiRichRenderValue:
                  preferencesModel.preferences.aiRichRenderingEnabled,
                searchScopeValue: preferencesModel.preferences.searchScopePreset,
                searchCustomRootsValue: preferencesModel.preferences.searchCustomRoots.join("\n"),
                searchWebEngineIds: preferencesModel.preferences.searchWebEngineIds,
                searchSearxngEndpointValue: preferencesModel.preferences.searchSearxngEndpoint ?? "",
                searchDeepBudgetValue: preferencesModel.preferences.deepSearchDefaultBudget,
                deepSearchRestoreViewportValue: preferencesModel.preferences.deepSearchRestoreViewport,
                deepSearchLocalOpenBehaviorValue: preferencesModel.preferences.deepSearchLocalOpenBehavior,
                deepSearchSiteExpansionValue: preferencesModel.preferences.deepSearchSiteExpansionEnabled,
                deepSearchProactiveGuessValue:
                  preferencesModel.preferences.deepSearchProactiveDomainGuessingEnabled,
                deepSearchCrawlPolicyValue: preferencesModel.preferences.deepSearchCrawlPolicy,
                searchEnableFuzzyValue: preferencesModel.preferences.searchEnableFuzzy,
                searchEnableContentValue: preferencesModel.preferences.searchEnableContent,
                searchIncludeHiddenValue: preferencesModel.preferences.searchIncludeHidden,
                searchAutoIndexValue: preferencesModel.preferences.searchAutoIndexEnabled,
                searchIndexStatusValue:
                  searchIndexStatus === null
                    ? "idle"
                    : `${searchIndexStatus.state} · files ${searchIndexStatus.indexedFiles} · dirs ${searchIndexStatus.indexedDirs}${typeof searchIndexStatus.progress === "number" ? ` · ${Math.round(searchIndexStatus.progress * 100)}%` : ""}${typeof searchIndexStatus.error === "string" ? ` · ${searchIndexStatus.error}` : ""}`,
                searchRebuildIndexPending,
                omniboxNonBrowserSubmitTargetValue:
                  preferencesModel.preferences.omniboxNonBrowserSubmitTarget,
                localeOptions: settingLocaleOptions,
                themeOptions: settingThemeOptions,
                terminalThemeOptions: settingTerminalThemeOptions,
                splitTriggerModeOptions: settingSplitTriggerModeOptions,
                splitThreePaneLayoutOptions: settingSplitThreePaneLayoutOptions,
                splitOverflowPolicyOptions: settingSplitOverflowPolicyOptions,
                searchScopeOptions: settingSearchScopeOptions,
                searchDeepBudgetOptions: settingDeepSearchBudgetOptions,
                deepSearchLocalOpenBehaviorOptions: settingDeepSearchLocalOpenBehaviorOptions,
                deepSearchCrawlPolicyOptions: settingDeepSearchCrawlPolicyOptions,
                searchWebEngineOptions: settingSearchWebEngineOptions,
                omniboxNonBrowserSubmitTargetOptions:
                  settingOmniboxNonBrowserSubmitTargetOptions,
                aiLabels: settingsAiLabels,
                aiModel: settingsAiModel,
                onLocaleChange: preferencesModel.setLocale,
                onThemeChange: preferencesModel.setTheme,
                onTerminalThemeChange: preferencesModel.setTerminalThemePreset,
                onSplitTriggerModeChange: preferencesModel.setSplitTriggerMode,
                onSplitThreePaneLayoutChange:
                  preferencesModel.setSplitThreePaneLayout,
                onSplitOverflowPolicyChange:
                  preferencesModel.setSplitOverflowPolicy,
                onAiRichRenderChange:
                  preferencesModel.setAiRichRenderingEnabled,
                onSearchScopeChange: preferencesModel.setSearchScopePreset,
                onSearchCustomRootsChange: (value: string) => {
                  preferencesModel.setSearchCustomRoots(
                    value
                      .split(/\r?\n/g)
                      .map((entry) => entry.trim())
                      .filter((entry) => entry.length > 0)
                  );
                },
                onSearchWebEnginesChange: preferencesModel.setSearchWebEngineIds,
                onSearchSearxngEndpointChange: (value: string) => {
                  preferencesModel.setSearchSearxngEndpoint(value);
                },
                onSearchDeepBudgetChange: preferencesModel.setDeepSearchDefaultBudget,
                onDeepSearchRestoreViewportChange: preferencesModel.setDeepSearchRestoreViewport,
                onDeepSearchLocalOpenBehaviorChange: preferencesModel.setDeepSearchLocalOpenBehavior,
                onDeepSearchSiteExpansionChange: preferencesModel.setDeepSearchSiteExpansionEnabled,
                onDeepSearchProactiveGuessChange: preferencesModel.setDeepSearchProactiveDomainGuessingEnabled,
                onDeepSearchCrawlPolicyChange: preferencesModel.setDeepSearchCrawlPolicy,
                onSearchEnableFuzzyChange: preferencesModel.setSearchEnableFuzzy,
                onSearchEnableContentChange: preferencesModel.setSearchEnableContent,
                onSearchIncludeHiddenChange: preferencesModel.setSearchIncludeHidden,
                onSearchAutoIndexChange: preferencesModel.setSearchAutoIndexEnabled,
                onSearchRebuildIndex,
                onOmniboxNonBrowserSubmitTargetChange:
                  preferencesModel.setOmniboxNonBrowserSubmitTarget
              }}
              onOpenFileFromManager={onOpenFileFromManager}
              onRevealPathInFileManager={(filePath) => {
                void onRevealPathInFileManager(filePath);
              }}
              i18n={{
                searchPlaceholder: t("browser.searchPlaceholder"),
                searchActionLabel: t("browser.searchAction"),
                resultsHeading: t("browser.resultsHeading"),
                resultsBlendTitle: t("browser.resultsBlendTitle"),
                resultsEngineOverview: t("browser.resultsEngineOverview"),
                resultsNoResults: t("browser.resultsNoResults"),
                resultsEngineError: t("browser.resultsEngineError"),
                resultsOfficial: t("browser.resultsOfficial"),
                resultsOfficialHomepage: t("browser.resultsOfficialHomepage"),
                resultsOfficialSubsite: t("browser.resultsOfficialSubsite"),
                resultsOfficialDocs: t("browser.resultsOfficialDocs"),
                resultsOfficialLogin: t("browser.resultsOfficialLogin"),
                resultsOfficialDownload: t("browser.resultsOfficialDownload"),
                resultsOfficialSupport: t("browser.resultsOfficialSupport"),
                resultsSourceFilter: t("browser.resultsSourceFilter"),
                resultsAllTab: t("browser.resultsAllTab"),
                resultsWebTab: t("browser.resultsWebTab"),
                resultsLocalTab: t("browser.resultsLocalTab"),
                resultsLocalTitle: t("browser.resultsLocalTitle"),
                resultsLocalPanelTitle: t("browser.resultsLocalPanelTitle"),
                resultsLocalNoMatches: t("browser.resultsLocalNoMatches"),
                resultsLocalSearchingMore: t("browser.resultsLocalSearchingMore"),
                resultsLocalScope: t("browser.resultsLocalScope"),
                resultsLocalScannedFiles: t("browser.resultsLocalScannedFiles"),
                resultsLocalScannedDirs: t("browser.resultsLocalScannedDirs"),
                resultsLocalContentScans: t("browser.resultsLocalContentScans"),
                resultsLocalMatched: t("browser.resultsLocalMatched"),
                resultsLocalIndex: t("browser.resultsLocalIndex"),
                resultsLocalScore: t("browser.resultsLocalScore"),
                resultsLocalLine: t("browser.resultsLocalLine"),
                channelIdle: t("browser.channelIdle"),
                channelLoading: t("browser.channelLoading"),
                channelReady: t("browser.channelReady"),
                channelError: t("browser.channelError"),
                deepSearchToggle: t("browser.deepSearchToggle"),
                deepSearchChip: t("browser.deepSearchChip"),
                deepSearchHeading: t("browser.deepSearchHeading"),
                deepSearchStop: t("browser.deepSearchStop"),
                deepSearchFitView: t("browser.deepSearchFitView"),
                deepSearchResetLayout: t("browser.deepSearchResetLayout"),
                deepSearchLoading: t("browser.deepSearchLoading"),
                deepSearchEmpty: t("browser.deepSearchEmpty"),
                deepSearchOverview: t("browser.deepSearchOverview"),
                deepSearchSelectedNode: t("browser.deepSearchSelectedNode"),
                deepSearchPhase: t("browser.deepSearchPhase"),
                deepSearchBudget: t("browser.deepSearchBudget"),
                deepSearchWebStatus: t("browser.deepSearchWebStatus"),
                deepSearchLocalStatus: t("browser.deepSearchLocalStatus"),
                deepSearchDeduped: t("browser.deepSearchDeduped"),
                deepSearchDerived: t("browser.deepSearchDerived"),
                deepSearchRounds: t("browser.deepSearchRounds"),
                deepSearchOpen: t("browser.deepSearchOpen"),
                deepSearchExpand: t("browser.deepSearchExpand"),
                deepSearchCenter: t("browser.deepSearchCenter"),
                deepSearchNoSelection: t("browser.deepSearchNoSelection"),
                deepSearchAll: t("browser.deepSearchAll"),
                deepSearchSnippet: t("browser.deepSearchSnippet"),
                deepSearchSource: t("browser.deepSearchSource"),
                deepSearchConnectedLinks: t("browser.deepSearchConnectedLinks"),
                deepSearchEdgeFilters: t("browser.deepSearchEdgeFilters"),
                deepSearchDirection: t("browser.deepSearchDirection"),
                deepSearchIncoming: t("browser.deepSearchIncoming"),
                deepSearchOutgoing: t("browser.deepSearchOutgoing"),
                deepSearchBoth: t("browser.deepSearchBoth"),
                deepSearchDiscovered: t("browser.deepSearchDiscovered"),
                deepSearchExpanded: t("browser.deepSearchExpanded"),
                deepSearchRelated: t("browser.deepSearchRelated"),
                deepSearchHostsSubdomain: t("browser.deepSearchHostsSubdomain"),
                deepSearchContainsPage: t("browser.deepSearchContainsPage"),
                deepSearchLineage: t("browser.deepSearchLineage"),
                deepSearchAlternateLinks: t("browser.deepSearchAlternateLinks"),
                deepSearchRevealInManager: t("browser.deepSearchRevealInManager"),
                deepSearchMatchKind: t("browser.deepSearchMatchKind"),
                deepSearchLine: t("browser.deepSearchLine"),
                deepSearchSharedTerms: t("browser.deepSearchSharedTerms"),
                deepSearchDomain: t("browser.deepSearchDomain"),
                deepSearchSubdomain: t("browser.deepSearchSubdomain"),
                deepSearchPage: t("browser.deepSearchPage"),
                deepSearchVerified: t("browser.deepSearchVerified"),
                deepSearchGuessed: t("browser.deepSearchGuessed"),
                deepSearchDiscoveredBy: t("browser.deepSearchDiscoveredBy"),
                deepSearchVerificationScore: t("browser.deepSearchVerificationScore"),
                deepSearchGuessedDomains: t("browser.deepSearchGuessedDomains"),
                deepSearchVerifiedDomains: t("browser.deepSearchVerifiedDomains"),
                deepSearchSubdomains: t("browser.deepSearchSubdomains"),
                deepSearchVisitedPages: t("browser.deepSearchVisitedPages"),
                deepSearchQueuedPages: t("browser.deepSearchQueuedPages"),
                deepSearchDroppedPages: t("browser.deepSearchDroppedPages"),
                deepSearchSiteExpansionStatus: t("browser.deepSearchSiteExpansionStatus")
              }}
              mcpCenter={{
                model: mcpCenterModel,
                labels: mcpCenterLabels
              }}
              skillsCenter={{
                model: skillsCenterModel,
                labels: skillsCenterLabels
              }}
              aiHistory={{
                locale: preferencesModel.preferences.locale,
                title: t("ai.historyTitle"),
                newSessionTitle: t("ai.sessionDefaultTitle"),
                openSettingsLabel: t("settings.tabTitle"),
                newConversationLabel: t("ai.newConversation"),
                openConversationLabel: t("ai.openConversation"),
                deleteConversationLabel: t("ai.deleteConversation"),
                profileLabel: t("ai.profileLabel"),
                sessionIdLabel: t("ai.historySessionIdLabel"),
                loadingSessionsLabel: t("ai.historyLoadingSessions"),
                emptyStateTitle: t("settings.aiEmptyTitle"),
                emptyStateDescription: t("settings.aiEmptyDescription"),
                defaultProfileId: defaultAiProfile?.id ?? null,
                onOpenSettings: () => {
                  tabsModel.openSettingsTab();
                }
              }}
              notifications={{
                model: notificationModel,
                labels: notificationCenterLabels,
                onOpenNotificationSource,
                onRequestClearAll: onRequestClearNotifications
              }}
            />

            <BrowserTabStrip
              tabs={tabsModel.tabs}
              splitGroupTabIds={tabsModel.splitGroupTabIds}
              activeTabId={tabsModel.activeTabId}
              goBackLabel={t("browser.goBack")}
              goForwardLabel={t("browser.goForward")}
              toggleTabStackLabel={t("browser.toggleTabStack")}
              stackedMode={stackedBrowserTabs}
              canGoBack={
                activeTabPageKind === "page" && pageNavigationState.canGoBack
              }
              canGoForward={
                activeTabPageKind === "page" && pageNavigationState.canGoForward
              }
              openNewTabLabel={t("browser.openNewTab")}
              closeTabLabel={t("browser.closeTab")}
              splitTriggerMode={preferencesModel.preferences.splitTriggerMode}
              isTabInSplit={tabsModel.isTabInSplit}
              onGoBack={onGoBack}
              onGoForward={onGoForward}
              onToggleStackedMode={() => {
                setStackedBrowserTabs((current) => !current);
              }}
              onTabContextMenu={(tab, anchorX, anchorY) => {
                if (tab.pageKind !== "terminal") {
                  return;
                }
                terminalWorkspaceActions.onWorkspaceTabContextMenu(
                  tab.id,
                  anchorX,
                  anchorY
                );
              }}
              onActivateTab={tabsModel.setActiveTab}
              onCloseTab={terminalWorkspaceActions.onBrowserTabClose}
              onOpenNewTab={tabsModel.openNewTab}
              onDropTerminalDockTab={(request) => {
                terminalWorkspaceActions.openTerminalTabInWorkspace(
                  request.terminalTabId,
                  request.targetIndex
                );
              }}
              onReorderTabs={tabsModel.reorderTab}
              onSplitTabs={tabsModel.splitTabWithTarget}
              onDetachTabFromSplit={tabsModel.detachTabFromSplit}
            />
          </section>

          {panelLayoutModel.isBottomPanelVisible ? (
            <div
              className="lyra-resizer lyra-resizer-horizontal"
              role="separator"
              aria-label="bottom-resizer"
              aria-orientation="horizontal"
              onMouseDown={panelLayoutModel.onBottomResizeMouseDown}
            />
          ) : null}
          {panelLayoutModel.isBottomPanelVisible ? (
            <footer className="lyra-panel lyra-panel-bottom" aria-label="bottom-panel">
              <TerminalDock
                desktopApi={desktopApi}
                labels={terminalLabels}
                themeSignature={terminalThemeSignature}
                themePresetId={preferencesModel.preferences.terminalThemePreset}
                uiThemeId={resolvedThemeId}
                model={terminalModel}
                onRequestCloseTab={terminalWorkspaceActions.closeTerminalTabEverywhere}
                onRequestTabContextMenu={(request) => {
                  terminalWorkspaceActions.openDockTabContextMenu(
                    request.tabId,
                    request.anchorX,
                    request.anchorY
                  );
                }}
                onDropWorkspaceTerminalTab={terminalWorkspaceActions.openTerminalTabInDock}
              />
            </footer>
          ) : null}
        </section>
      </section>

      <ContextMenuHost
        state={contextMenuModel.state}
        onClose={contextMenuModel.closeMenu}
        onSelectItem={contextMenuModel.selectItem}
      />
      <GlobalDialogHost
        state={globalDialogModel.state}
        onClose={globalDialogModel.closeDialog}
        onSelectAction={globalDialogModel.selectAction}
      />
    </main>
  );
};
