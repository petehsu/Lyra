import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent
} from "react";

import { WORKBENCH_CONFIG } from "../config";
import { ContextMenuHost, useContextMenuModel } from "../context-menu";
import {
  GlobalDialogHost,
  useGlobalDialogModel
} from "../global-dialog";
import { createTranslator } from "../i18n";
import { useWorkbenchNotificationModel } from "../notifications";
import { useWorkbenchPreferencesModel } from "../preferences";
import { useWorkbenchLocationModel } from "../location";
import { useTerminalDockModel, useTerminalSessionRestore } from "../terminal-dock";
import { isAgentSessionHistoryAppId } from "../workspace-apps";
import { useWorkspaceTabsModel } from "../workspace-tabs";
import { useWorkbenchUiRuntime } from "../ui-platform";
import { cx } from "../ui-primitives";
import { getDesktopApi, syncCssVarsToDocumentRoot } from "./service";

import { TitlebarElementPickerButton } from "./titlebar-element-picker-button";
import { WorkbenchTitlebarContextProvider, WorkbenchTitlebarContextSlot } from "./titlebar-context";
import { TitlebarNavigation } from "./titlebar-navigation";
import { createTitlebarSecurityLabels } from "./titlebar-security-labels";
import { useBrowserSearchModel } from "../browser-search";
import {
  useBrowserPageContextMenu,
  type ComposerCitationSink
} from "./use-browser-page-context-menu";
import { usePageDragCitationBridge } from "./use-page-drag-citation-bridge";
import { readBrowserHistoryEntries } from "../browser-history/service";
import { useWorkbenchAiSessionTabs } from "../ai-panel/session-tabs";
import { useAgentPlanBoardModel } from "../agent-plan-board";
import type { BrowserSettingsCategoryFocusRequest } from "../browser-tabs/settings-surface";
import {
  type AgentSessionHistoryBrowserPreviewPage,
  type AgentSessionHistoryLocateRequest
} from "../agent-session-history";
import { AgentBrowserActivityOverlay } from "./agent-browser-activity-overlay";
import { useBrowserLayoutAnimationSync } from "./use-browser-layout-animation-sync";
import { useLocalSearchIndexStatus } from "./use-local-search-index-status";
import { useWorkbenchActiveAppContext } from "./use-workbench-active-app-context";
import { useWorkbenchAppRestoration } from "./use-workbench-app-restoration";
import { useWorkbenchBrowserRuntime } from "./use-workbench-browser-runtime";
import {
  createWorkbenchChromeLabels,
  useWorkbenchActionApi
} from "./use-workbench-action-api";
import { applyPanelLayoutCssVars } from "./panel-layout-shell-vars";
import { getIsLayoutResizing, usePanelLayoutModel } from "./use-panel-layout";
import { useOpenTerminalLiveSession } from "./use-open-terminal-live-session";
import { useSoftwareStoreBuiltinAppOpener } from "./use-software-store-builtin-app-opener";
import { useScrollbarVisibilityGuard } from "./use-scrollbar-visibility-guard";
import { useTerminalWorkspaceActions } from "./use-terminal-workspace-actions";
import { useTerminalIdentityProjection } from "./use-terminal-identity-projection";
import { useWorkspaceAppIdentityProjection } from "./use-workspace-app-identity-projection";
import { useWorkbenchAiLaunchProps } from "./use-workbench-ai-launch-props";
import { useWorkbenchFileAppModels } from "./use-workbench-file-app-models";
import { useWorkbenchEditorReviewModel } from "./use-workbench-editor-review-model";
import { useWorkbenchEmptyAppTabGuards } from "./use-workbench-empty-app-tab-guards";
import { useWorkbenchFileActions } from "./use-workbench-file-actions";
import { useWorkbenchJsReplSetting } from "./use-workbench-js-repl-setting";
import { useWorkbenchLabels } from "./use-workbench-labels";
import { useWorkbenchLinuxCompatNotice } from "./use-workbench-linux-compat-notice";
import { useWorkbenchNotificationNavigation } from "./use-workbench-notification-navigation";
import { useWorkbenchObservationBridge } from "./use-workbench-observation-bridge";
import { useWorkbenchFileAttachChooser } from "./use-workbench-file-attach-chooser";
import { useWorkbenchProjectBindChooser } from "./use-workbench-project-bind-chooser";
import { useWorkbenchSearchSettings } from "./use-workbench-search-settings";
import { useWorkbenchAgentAppOpeners } from "./use-workbench-agent-app-openers";
import { useAgentEditFollow } from "./use-agent-edit-follow";
import { useWorkbenchShellAdapterProps } from "./use-workbench-shell-adapter-props";
import { useWorkbenchSettingsSurfaceProps } from "./use-workbench-settings-surface-props";
import { useWorkbenchShellSlots } from "./use-workbench-shell-slots";
import { useWorkbenchSidebarAiSurfaceProps } from "./use-workbench-sidebar-ai-surface-props";
import { useSoftwareCapabilitiesRegistry } from "../software-capabilities";
import { useWorkbenchProviderFaultNotifications } from "./use-workbench-provider-fault-notifications";
import {
  useWorkbenchSystemNotificationActivation,
  useWorkbenchSystemNotificationPermissionGuard,
  useWorkbenchSystemNotificationPublisher
} from "./use-workbench-system-notifications";
import { useWorkbenchThemeRuntime } from "./use-workbench-theme-runtime";
import { useWorkbenchWorkspaceTabsProps } from "./use-workbench-workspace-tabs-props";
import { useWorkspaceSurfaceRouterProps } from "./use-workspace-surface-router-props";
import { useTitlebarElementPickerModel } from "./use-titlebar-element-picker-model";
import { useTitlebarNavigationModel } from "./use-titlebar-navigation-model";
import { createInitialWorkbenchPreferences, createWorkbenchBrowserTabsConfig } from "./workbench-shell-defaults";

const WORKBENCH_BROWSER_LAYOUT_ANIMATION_MS = 260;
const WORKBENCH_BROWSER_LAYOUT_ANIMATION_SYNC_INTERVAL_MS = 33;
const AGENT_HISTORY_BROWSER_PREVIEW_TAB_ID = "lyra-agent-history-browser-preview";

export const WorkbenchShell = () => {
  const desktopApi = getDesktopApi();
  const preferencesModel = useWorkbenchPreferencesModel(createInitialWorkbenchPreferences());
  const { jsReplEnabled, updateJsReplSetting } = useWorkbenchJsReplSetting(desktopApi);
  const [settingsFocusRequest, setSettingsFocusRequest] =
    useState<BrowserSettingsCategoryFocusRequest | null>(null);

  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [stackedBrowserTabs, setStackedBrowserTabs] = useState(false);
  const aiSessionTabsModel = useWorkbenchAiSessionTabs(desktopApi);
  const [agentHistoryRefreshRequestKey, setAgentHistoryRefreshRequestKey] = useState(0);
  const [agentHistoryLocateRequest, setAgentHistoryLocateRequest] =
    useState<AgentSessionHistoryLocateRequest | null>(null);
  const [agentHistoryBrowserPreviewPage, setAgentHistoryBrowserPreviewPage] =
    useState<AgentSessionHistoryBrowserPreviewPage | null>(null);
  const [browserHistoryEntries, setBrowserHistoryEntries] = useState(() =>
    readBrowserHistoryEntries()
  );

  const t = useMemo(
    () => createTranslator(preferencesModel.preferences.locale),
    [preferencesModel.preferences.locale]
  );
  const labels = useWorkbenchLabels(t);
  const rootRef = useRef<HTMLElement | null>(null);
  const browserTabsConfig = useMemo(() => createWorkbenchBrowserTabsConfig(t), [t]);
  const browserTabsOptions = useMemo(() => ({
    splitOverflowPolicy: preferencesModel.preferences.splitOverflowPolicy
  }), [preferencesModel.preferences.splitOverflowPolicy]);
  const tabsModel = useWorkspaceTabsModel(browserTabsConfig, browserTabsOptions);
  const activeTab = tabsModel.activeTab;
  const activeTabPageKind = activeTab?.pageKind ?? "search";
  const activePageTabId = activeTab?.pageKind === "page" ? activeTab.id : "";
  const activeBrowserTabId = activeTab?.pageKind === "page" ? activeTab.id : null;
  const visibleWorkspaceLayout = tabsModel.getVisibleWorkspaceLayout();
  const terminalModel = useTerminalDockModel();
  useTerminalSessionRestore({
    desktopApi,
    terminalModel
  });
  const terminalIdentityByTabId = useTerminalIdentityProjection({
    desktopApi,
    terminalModel,
    aiSessionTabs: aiSessionTabsModel.tabs
  });
  const workspaceAppIdentityByTabId = useWorkspaceAppIdentityProjection({
    desktopApi,
    tabs: tabsModel.tabs
  });
  const contextMenuModel = useContextMenuModel();
  const composerCitationSinkRef = useRef<ComposerCitationSink | null>(null);
  const panelLayoutModel = usePanelLayoutModel(rootRef);
  const {
themeVars,
resolvedThemeId,
  } = useWorkbenchThemeRuntime(
    preferencesModel.preferences.theme,
  );
  const workbenchChromeLabels = useMemo(
    () => createWorkbenchChromeLabels(t),
    [t]
  );
  const historyAppSuggestionLabels = useMemo(() => ({
    sessions: labels.agentSessionHistory.categorySessions,
    archivedSessions: labels.agentSessionHistory.categoryArchivedSessions,
    browserHistory: labels.agentSessionHistory.categoryBrowserHistory
  }), [labels.agentSessionHistory]);
  const refreshBrowserHistoryEntries = useCallback((): void => {
    setBrowserHistoryEntries(readBrowserHistoryEntries());
  }, []);
  const agentSessionHistoryTabVisible = useMemo(
    () => visibleWorkspaceLayout.visibleTabIds.some((tabId) => {
      const tab = tabsModel.tabs.find((candidate) => candidate.id === tabId);
      return tab?.pageKind === "app"
        && tab.appId !== undefined
        && isAgentSessionHistoryAppId(tab.appId);
    }),
    [tabsModel.tabs, visibleWorkspaceLayout.visibleTabIds]
  );
  const embeddedBrowserPages = useMemo(
    () => agentHistoryBrowserPreviewPage === null || agentSessionHistoryTabVisible === false
      ? []
      : [
          {
            tabId: agentHistoryBrowserPreviewPage.tabId,
            address: agentHistoryBrowserPreviewPage.url,
            titleHint: agentHistoryBrowserPreviewPage.title
          }
        ],
    [agentHistoryBrowserPreviewPage, agentSessionHistoryTabVisible]
  );
  useEffect(() => {
    if (agentSessionHistoryTabVisible || agentHistoryBrowserPreviewPage === null) {
      return;
    }
    setAgentHistoryBrowserPreviewPage(null);
  }, [agentHistoryBrowserPreviewPage, agentSessionHistoryTabVisible]);
  const {
    activePageRuntimeState,
    browserAgentVisualState,
    pageNavigationState,
    registerPageHost,
    scheduleBrowserLayoutSync,
    onGoBack,
    onGoForward,
    onReload
  } = useWorkbenchBrowserRuntime({
    desktopApi,
    tabsModel,
    activeBrowserTabId,
    activePageTabId,
    visibleWorkspaceLayout,
    embeddedBrowserPages,
    themeVars,
    forceWebPageThemingEnabled:
      preferencesModel.preferences.forceWebPageThemingEnabled,
    onBrowserHistoryChange: refreshBrowserHistoryEntries
  });
  const beginBrowserLayoutAnimationSync = useBrowserLayoutAnimationSync({
    panelLayoutModel,
    scheduleBrowserLayoutSync,
    stackedBrowserTabs,
    activeTabId: tabsModel.activeTabId,
    animationDurationMs: WORKBENCH_BROWSER_LAYOUT_ANIMATION_MS,
    animationSyncIntervalMs: WORKBENCH_BROWSER_LAYOUT_ANIMATION_SYNC_INTERVAL_MS
  });
  const searchSettingsFacade = useWorkbenchSearchSettings(preferencesModel.preferences);
  const notificationModel = useWorkbenchNotificationModel();
  const publishNotification = useWorkbenchSystemNotificationPublisher({
    desktopApi,
    notificationModel,
    preferences: preferencesModel.preferences,
    t
  });
  const localSearchIndexStatus = useLocalSearchIndexStatus({
    desktopApi,
    publishNotification,
    t
  });
  useWorkbenchProviderFaultNotifications({
    desktopApi,
    notificationModel,
    publishNotification,
    t
  });
  const browserSearchModel = useBrowserSearchModel({
    desktopApi,
    tabsModel,
    searchSettings: searchSettingsFacade.browserSearchSettings,
    localSearchReady: localSearchIndexStatus.ready
  });
  useBrowserPageContextMenu({
    desktopApi,
    composerCitationSinkRef
  });
  usePageDragCitationBridge({ desktopApi });
  const terminalWorkspaceActions = useTerminalWorkspaceActions({
    desktopApi,
    tabsModel,
    terminalModel,
    contextMenuModel,
    t
  });
  const {
    fileManagerModel,
    fileEditorModel,
    imageViewerModel,
    agentProjectTreeModel
  } = useWorkbenchFileAppModels({
    desktopApi,
    contextMenuModel,
    fileManagerLabels: labels.fileManager,
    tabsModel
  });
  const agentPlanBoardModel = useAgentPlanBoardModel({
    desktopApi,
    onMetaChange: tabsModel.updateAppTabMeta
  });
  const openSettingsSectionFromCapability = useCallback((categoryId: BrowserSettingsCategoryFocusRequest["categoryId"]): void => {
    setSettingsFocusRequest((current) => ({
      categoryId,
      requestId: (current?.requestId ?? 0) + 1
    }));
    tabsModel.openSettingsTab();
  }, [tabsModel]);
  const softwareCapabilities = useSoftwareCapabilitiesRegistry({
    desktopApi,
    labels: labels.softwareStore,
    activeUiPackId: preferencesModel.preferences.uiPackId,
    tabsModel,
    fileManagerModel,
    imageViewerModel,
    terminalModel,
    onOpenSettingsSection: openSettingsSectionFromCapability
  });
  const onOpenSoftwareStoreBuiltinApp = useSoftwareStoreBuiltinAppOpener({
    fileManagerModel,
    labels,
    onOpenSettingsSection: openSettingsSectionFromCapability,
    tabsModel
  });
  const uiRuntime = useWorkbenchUiRuntime(
    preferencesModel.preferences.uiPackId,
    desktopApi,
    softwareCapabilities.createUiPackCapabilities
  );
  const workbenchActions = useWorkbenchActionApi({
    desktopApi,
    tabsModel,
    fileManagerModel,
    panelLayoutModel,
    onBeforePanelLayoutAnimation: beginBrowserLayoutAnimationSync,
    docsEntryAddress: WORKBENCH_CONFIG.browser.docsEntryAddress,
    docsTabTitle: t("docs.tabTitle"),
    agentSessionHistoryTitle: t("agentHistory.tabTitle"),
    onOpenSoftwareStore: () => {
      openSettingsSectionFromCapability("softwareStore");
    },
    onOpenLoginManager: () => {
      openSettingsSectionFromCapability("loginManager");
    },
    locale: preferencesModel.preferences.locale,
    resolvedThemeId
  });
  useWorkbenchObservationBridge({
    desktopApi,
    tabsModel,
    fileEditorModel,
    fileManagerModel,
    imageViewerModel,
    terminalModel
  });
  useWorkbenchSystemNotificationPermissionGuard({
    desktopApi,
    preferencesModel
  });
  const globalDialogDefaults = useMemo(
    () => ({
      copyActionLabel: t("dialog.copyAction"),
      copiedActionLabel: t("dialog.copiedAction")
    }),
    [t]
  );
  const globalDialogModel = useGlobalDialogModel(globalDialogDefaults);
  const locationControls = useWorkbenchLocationModel({
    desktopApi,
    openDialog: globalDialogModel.openDialog,
    locale: preferencesModel.preferences.locale,
    t
  });

  const {
    onOpenFileFromManager,
    onRevealPathInFileManager,
    openDirectoryFromNavigation
  } = useWorkbenchFileActions({
    desktopApi,
    activeTab,
    tabsModel,
    fileManagerModel,
    fileEditorModel,
    imageViewerModel
  });
  const onOpenAgentConfigFile = useCallback((filePath: string): void => {
    onOpenFileFromManager(filePath, undefined, { forceReloadIfOpen: true });
  }, [onOpenFileFromManager]);
  const {
    activeFileManagerState,
    activeFileEditorState,
    settingsAiModel
  } = useWorkbenchActiveAppContext({
    activeTab,
    desktopApi,
    fileManagerModel,
    fileEditorModel,
    labels,
    onOpenAgentConfigFile
  });
  const settingsSurfaceProps = useWorkbenchSettingsSurfaceProps({
    labels,
    desktopApi,
    preferencesModel,
    settingsAiModel,
    softwareCapabilities,
    jsReplEnabled,
    focusCategoryRequest: settingsFocusRequest,
    openDialog: globalDialogModel.openDialog,
    publishNotification,
    onOpenSite: tabsModel.openPageInNewTab,
    onOpenSoftwareStoreBuiltinApp,
    onOpenDocs: workbenchActions.openDocs,
    onJsReplChange: updateJsReplSetting
  });
  useWorkbenchLinuxCompatNotice({
    desktopApi,
    labels,
    openDialog: globalDialogModel.openDialog,
    publishNotification
  });
  const { requestProjectBind, resolveFileManagerChooser: resolveProjectBindChooser } =
    useWorkbenchProjectBindChooser({
      fileManagerModel,
      tabsModel,
      confirmLabel: t("ai.bindProjectConfirm"),
      promptLabel: t("ai.bindProjectLabel"),
      selectPlaceholder: labels.fileManager.chooserSelectDirectoryPlaceholder
    });
  const { requestFileAttach, resolveFileManagerChooser: resolveFileAttachChooser } =
    useWorkbenchFileAttachChooser({
      fileManagerModel,
      tabsModel,
      confirmLabel: t("ai.attachFileConfirm"),
      promptLabel: t("ai.attachFileLabel"),
      selectPlaceholder: t("ai.attachFileSelectPlaceholder")
    });
  const resolveFileManagerChooser = useCallback(
    (instanceId: string) =>
      resolveProjectBindChooser(instanceId) ?? resolveFileAttachChooser(instanceId),
    [resolveFileAttachChooser, resolveProjectBindChooser]
  );
  const listWorkspaceTabs = useCallback(() => tabsModel.tabs, [tabsModel.tabs]);
  const listTerminalTabs = useCallback(
    () => [...terminalModel.dockTabs, ...terminalModel.workspaceTabs],
    [terminalModel.dockTabs, terminalModel.workspaceTabs]
  );
  const {
    onOpenAgentProjectTree,
    onOpenAgentGit,
    onOpenAgentPlanBoard,
    onOpenAgentProjectPlanManager,
    onRevealAgentProjectPath,
  } = useWorkbenchAgentAppOpeners({
    desktopApi,
    tabsModel,
    agentProjectTreeModel,
    agentPlanBoardModel,
  });
  useAgentEditFollow({
    desktopApi,
    activeSessionId: aiSessionTabsModel.activeSessionId,
    fileEditorModel,
    agentProjectTreeModel,
    onOpenFileFromManager,
    onRevealAgentProjectPath
  });
  const onOpenAgentModelSettings = useCallback((): void => {
    setSettingsFocusRequest((current) => ({
      categoryId: "models",
      requestId: (current?.requestId ?? 0) + 1
    }));
    tabsModel.openSettingsTab();
  }, [tabsModel]);
  const onOpenAgentUrlInWorkbench = useCallback((request: {
    readonly url: string;
    readonly title?: string;
  }): void => {
    tabsModel.openPageInNewTab(request.url, request.title ?? request.url);
  }, [tabsModel]);
  const onRunTerminalCommand = useCallback((command: string): void => {
    const trimmed = command.trim();
    if (trimmed.length === 0) {
      return;
    }
    const { tab } = terminalModel.openTabWithPlacement({
      placement: "workspace",
      title: trimmed,
      mode: "command",
      command: trimmed
    });
    tabsModel.openTerminalTab(tab.id, tab.title);
  }, [tabsModel, terminalModel]);
  const onOpenTerminalLiveSession = useOpenTerminalLiveSession({
    terminalModel,
    terminalWorkspaceActions
  });
  const sidebarAiSurfaceProps = useWorkbenchSidebarAiSurfaceProps({
    desktopApi,
    preferences: preferencesModel.preferences,
    settingsAiModel,
    aiPanelSide: panelLayoutModel.aiPanelSide,
    onToggleAiPanelSide: () => {
      beginBrowserLayoutAnimationSync();
      panelLayoutModel.toggleAiPanelSide();
    },
    onRequestProjectBind: requestProjectBind,
    onOpenProjectTree: onOpenAgentProjectTree,
    onOpenPlanBoard: onOpenAgentPlanBoard,
    onOpenProjectPlanManager: onOpenAgentProjectPlanManager,
    onRevealProjectPath: onRevealAgentProjectPath,
    onOpenModelSettings: onOpenAgentModelSettings,
    onOpenUrlInWorkbench: onOpenAgentUrlInWorkbench,
    onOpenTerminalLiveSession,
    onOpenFile: onOpenFileFromManager,
    onRevealPathInWorkbench: onRevealPathInFileManager,
    resolveActiveWorkspaceTab: () => tabsModel.activeTab,
    onPickFileFromFileManager: requestFileAttach,
    listWorkspaceTabs,
    listTerminalTabs,
    locationControls,
    openDialog: globalDialogModel.openDialog,
    t
  });
  useScrollbarVisibilityGuard(rootRef);

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }
    const unsubscribe = desktopApi.shellEvents.onWindowStateChange((state) => {
      setIsMaximized(state.isMaximized);
      setIsFullScreen(state.isFullScreen === true);
    });
    return () => {
      unsubscribe();
    };
  }, [desktopApi]);

  const onRootDragStartCapture = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (uiRuntime.interactions.workbenchDrag.shouldPreventDragStart(event.target)) {
      event.preventDefault();
    }
  }, [uiRuntime.interactions.workbenchDrag]);

  const rootStyle = useMemo(
    () =>
      ({
        ...themeVars,
        ...uiRuntime.vars
      }) as CSSProperties,
    [themeVars, uiRuntime.vars]
  );

  useLayoutEffect(() => {
    if (getIsLayoutResizing()) {
      return;
    }
    applyPanelLayoutCssVars(rootRef.current, panelLayoutModel.cssVars);
  }, [panelLayoutModel.cssVars]);

  useEffect(() => {
    syncCssVarsToDocumentRoot({
      ...themeVars,
      ...uiRuntime.vars
    } as Record<`--${string}`, string>);
    document.documentElement.dataset.lyraThemeTone = resolvedThemeId.endsWith("-dark")
      ? "dark"
      : "light";
    document.documentElement.dataset.lyraWindowMaterial =
      desktopApi?.appMeta.windowMaterialMode ?? "opaque";
  }, [desktopApi, resolvedThemeId, themeVars, uiRuntime.vars]);

  useWorkbenchAppRestoration({
    activeTab,
    tabsModel,
    fileManagerModel,
    fileEditorModel,
    imageViewerModel,
    agentProjectTreeModel
  });

  const {
    editorReviewItems,
    activeEditorReviewIndex,
    resolveActiveEditorWorkItem,
    onGoToPreviousEditorWorkItem,
    onGoToNextEditorWorkItem,
    onAcceptAllEditorWorkItems,
    onAcceptEditorWorkItem,
    onRejectEditorWorkItem,
    onUndoEditorWorkItem
  } = useWorkbenchEditorReviewModel({
    desktopApi,
    onOpenFileFromManager
  });

  const titlebarNavigation = useTitlebarNavigationModel({
    desktopApi,
    activeTab,
    activePageRuntimeState,
    activeFileEditorState,
    activeFileManagerState,
    tabsModel,
    searchEngines: searchSettingsFacade.registeredSearchEngines,
    autoSearchEngines: searchSettingsFacade.integratedSearchEngines,
    localSearchReady: localSearchIndexStatus.ready,
    omniboxNonBrowserSubmitTarget:
      preferencesModel.preferences.omniboxNonBrowserSubmitTarget,
    placeholder: t("navigation.titlebarPlaceholder"),
    ariaLabel: t("navigation.titlebarAriaLabel"),
    submitLabel: t("navigation.submitAction"),
    reloadLabel: t("navigation.reloadAction"),
    onReload,
    historyAppPlaceholder: labels.agentSessionHistory.searchPlaceholder,
    historyAppSuggestionLabels,
    onHistoryAppReload: () => {
      refreshBrowserHistoryEntries();
      setAgentHistoryRefreshRequestKey((current) => current + 1);
    },
    onHistoryAppSuggestionSelect: (target) => {
      setAgentHistoryLocateRequest((current) => ({
        requestKey: (current?.requestKey ?? 0) + 1,
        target
      }));
    },
    onOpenFilePath: (path) => onOpenFileFromManager(path),
    onOpenDirectoryPath: openDirectoryFromNavigation,
    onRunTerminalCommand
  });
  const titlebarElementPicker = useTitlebarElementPickerModel({
    desktopApi,
    activeTab,
    enableLabel: t("navigation.elementPickerEnable"),
    disableLabel: t("navigation.elementPickerDisable"),
    activeLabel: t("navigation.elementPickerActive"),
    inspectLabel: t("navigation.elementPickerInspect"),
    layoutLabel: t("navigation.elementPickerLayout")
  });
  const aiLaunchProps = useWorkbenchAiLaunchProps(t);
  const sidebarAiSurfacePropsWithFileOpen = {
    ...sidebarAiSurfaceProps,
    composerCitationSinkRef,
    onSetActiveBrowserTab: tabsModel.setActiveTab,
    activeSessionTabId: aiSessionTabsModel.activeTabId,
    activeSessionId: aiSessionTabsModel.activeSessionId,
    sessionTabs: aiSessionTabsModel.tabs,
    onActiveSessionChange: aiSessionTabsModel.activateSession,
    onActivateSessionTab: aiSessionTabsModel.activateSession,
    onCloseSessionTab: aiSessionTabsModel.closeSession, onReorderSessionTabs: aiSessionTabsModel.reorderSessionTabs,
    onCreateDraftSessionTab: aiSessionTabsModel.createDraftSession,
    onCreateSessionTab: aiSessionTabsModel.createSession, onMissingSession: aiSessionTabsModel.removeSession,
    onUpdateDraftWorkingDir: aiSessionTabsModel.setDraftWorkingDir, onSessionSnapshotChange: aiSessionTabsModel.upsertSnapshot
  };
  useWorkbenchEmptyAppTabGuards({
    tabsModel,
    notificationCount: notificationModel.notifications.length
  });

  const {
    onOpenNotificationCenter,
    onOpenNotificationPreview,
    onOpenNotificationSource,
    onRequestClearNotifications
  } = useWorkbenchNotificationNavigation({
    tabsModel,
    fileManagerModel,
    fileEditorModel,
    notificationModel,
    openDialog: globalDialogModel.openDialog,
    t
  });

  useWorkbenchSystemNotificationActivation({
    desktopApi,
    notificationModel,
    onOpenNotificationCenter,
    onOpenNotificationSource
  });

  const onOpenAgentSession = useCallback((sessionId: string): void => {
    const trimmedSessionId = sessionId.trim();
    if (trimmedSessionId.length === 0) {
      return;
    }
    aiSessionTabsModel.openSession(trimmedSessionId);
    if (!panelLayoutModel.isLeftPanelVisible) {
      beginBrowserLayoutAnimationSync();
      panelLayoutModel.toggleLeftPanel();
    }
  }, [
    aiSessionTabsModel,
    beginBrowserLayoutAnimationSync,
    panelLayoutModel.isLeftPanelVisible,
    panelLayoutModel.toggleLeftPanel
  ]);

  const workspaceSurfaceProps = useWorkspaceSurfaceRouterProps({
    activeTab,
    tabsModel,
    browserSearchModel,
    searchEngines: searchSettingsFacade.registeredSearchEngines,
    autoSearchEngines: searchSettingsFacade.integratedSearchEngines,
    engineById: searchSettingsFacade.engineById,
    onPageHostChange: registerPageHost,
    terminalModel,
    desktopApi,
    resolvedThemeId,
    fileManagerModel,
    resolveFileManagerChooser,
    fileEditorModel,
    imageViewerModel,
    agentProjectTreeModel,
    agentPlanBoardModel,
    activeEditorReviewIndex,
    editorReviewItems,
    resolveActiveEditorWorkItem,
    onGoToPreviousEditorWorkItem,
    onGoToNextEditorWorkItem,
    onAcceptAllEditorWorkItems,
    onAcceptEditorWorkItem,
    onRejectEditorWorkItem,
    onUndoEditorWorkItem,
    preferencesModel,
    settings: settingsSurfaceProps,
    onOpenSettingsSection: openSettingsSectionFromCapability,
    notificationModel,
    localSearchReady: localSearchIndexStatus.ready,
    labels,
    softwareCapabilities,
    onOpenFileFromManager,
    onRevealPathInFileManager,
    onOpenNotificationSource,
    onRequestClearNotifications,
    onOpenAgentGit,
    agentSessionHistory: {
      labels: labels.agentSessionHistory,
      activeSessionId: aiSessionTabsModel.activeSessionId,
      onOpenSession: onOpenAgentSession,
      onSessionDeleted: aiSessionTabsModel.removeSession,
      openDialog: globalDialogModel.openDialog,
      query: activeTab?.pageKind === "app" && activeTab.appId === "agent-session-history"
        ? activeTab.inputValue
        : "",
      refreshRequestKey: agentHistoryRefreshRequestKey,
      locateRequest: agentHistoryLocateRequest,
      browserHistory: browserHistoryEntries,
      browserHistoryPreviewPageId: AGENT_HISTORY_BROWSER_PREVIEW_TAB_ID,
      onBrowserHistoryPreviewChange: setAgentHistoryBrowserPreviewPage,
      onBrowserHistoryPreviewHostChange: registerPageHost,
      onOpenBrowserHistoryEntry: (entry) => {
        tabsModel.openPageInNewTab(entry.url, entry.title);
      },
      locale: preferencesModel.preferences.locale
    }
  });
  const rootClassName = cx(
    "lyra-root",
    uiRuntime.rootClassName,
    isFullScreen && "lyra-root-fullscreen",
    globalDialogModel.state.isOpen && "lyra-root-modal-open"
  );
  const isMac = desktopApi?.appMeta.platform === "darwin";
  const workbenchPresentationState = useMemo(
    () => ({
      isMac,
      isMaximized,
      isFullScreen,
      isAiPanelVisible: panelLayoutModel.isLeftPanelVisible,
      isTerminalPanelVisible: panelLayoutModel.isBottomPanelVisible,
      terminalPanelSide: panelLayoutModel.terminalPanelSide
    }),
    [
      isMac,
      isFullScreen,
      isMaximized,
      panelLayoutModel.isBottomPanelVisible,
      panelLayoutModel.isLeftPanelVisible,
      panelLayoutModel.terminalPanelSide
    ]
  );
  const AiPanelAdapter = uiRuntime.adapters.aiPanel;
  const ShellAdapter = uiRuntime.adapters.shell;
  const TerminalDockAdapter = uiRuntime.adapters.terminalDock;
  const WorkspaceSurfaceAdapter = uiRuntime.adapters.workspaceSurface;
  const WorkspaceTabsAdapter = uiRuntime.adapters.workspaceTabs;
  const workspaceTabsLabels = useMemo(
    () => ({
      goBackLabel: t("browser.goBack"),
      goForwardLabel: t("browser.goForward"),
      toggleTabStackLabel: t("browser.toggleTabStack"),
      openNewTabLabel: t("browser.openNewTab"),
      closeTabLabel: t("browser.closeTab")
    }),
    [t]
  );
  const titlebarSecurityLabels = useMemo(() => createTitlebarSecurityLabels(t), [t]);
  const workspaceTabsProps = useWorkbenchWorkspaceTabsProps({
    tabsModel,
    terminalIdentityByTabId,
    workspaceAppIdentityByTabId,
    activeTabPageKind,
    canGoBack: pageNavigationState.canGoBack,
    canGoForward: pageNavigationState.canGoForward,
    stackedMode: stackedBrowserTabs,
    setStackedMode: setStackedBrowserTabs,
    labels: workspaceTabsLabels,
    splitTriggerMode: preferencesModel.preferences.splitTriggerMode,
    interactionPolicy: uiRuntime.interactions.workspaceTabs,
    terminalWorkspaceActions,
    workbenchActions,
    onGoBack,
    onGoForward
  });
  const notificationTopbarProps = useMemo(
    () => ({
      labels: labels.notificationTopbar,
      notificationCount: notificationModel.notifications.length,
      unreadCount: notificationModel.unreadCount,
      preview: notificationModel.topbarPreview,
      onOpenCenter: onOpenNotificationCenter,
      onOpenPreview: onOpenNotificationPreview
    }),
    [
      labels.notificationTopbar,
      notificationModel.notifications.length,
      notificationModel.topbarPreview,
      notificationModel.unreadCount,
      onOpenNotificationCenter,
      onOpenNotificationPreview
    ]
  );
  const workbenchChromeSlots = useWorkbenchShellSlots({
    titlebarNavigation: null,
    titlebarContext: null,
    leftPanel: sidebarAiSurfacePropsWithFileOpen === null ? null : (
      <AiPanelAdapter {...sidebarAiSurfacePropsWithFileOpen} />
    ),
    workspace: (
      <>
        <WorkspaceSurfaceAdapter
          {...workspaceSurfaceProps}
          surfaceAdapters={uiRuntime.adapters.surfaces}
        />
        <AgentBrowserActivityOverlay
          state={browserAgentVisualState}
        />
      </>
    ),
    browserTabs: (
      <WorkspaceTabsAdapter
        {...workspaceTabsProps}
        agentActiveTabId={browserAgentVisualState.active ? browserAgentVisualState.tabId : null}
        toolbarContextControl={<WorkbenchTitlebarContextSlot />}
        navigationControl={
          <TitlebarNavigation
            {...titlebarNavigation}
            activeBrowserTabId={activeBrowserTabId}
            browserChromePopoverBridge={desktopApi?.workbenchBrowser}
            locale={preferencesModel.preferences.locale}
            securityLabels={titlebarSecurityLabels}
            trailingControl={
              titlebarElementPicker.visible ? (
                <TitlebarElementPickerButton
                  active={titlebarElementPicker.enabled}
                  mode={titlebarElementPicker.mode}
                  ariaLabel={titlebarElementPicker.ariaLabel}
                  activeDescription={titlebarElementPicker.activeDescription}
                  onToggle={titlebarElementPicker.onToggle}
                />
              ) : undefined
            }
          />
        }
      />
    ),
    terminalPanel: (
      <TerminalDockAdapter
        desktopApi={desktopApi}
        labels={labels.terminal}
        themeSignature={preferencesModel.preferences.theme}
        uiThemeId={resolvedThemeId}
        model={terminalModel}
        terminalIdentityByTabId={terminalIdentityByTabId}
        terminalPanelSide={panelLayoutModel.terminalPanelSide}
        onRequestCloseTab={terminalWorkspaceActions.closeTerminalTabEverywhere}
        onRequestTabContextMenu={(request) => {
          terminalWorkspaceActions.openDockTabContextMenu(
            request.tabId,
            request.anchorX,
            request.anchorY
          );
        }}
        onToggleTerminalPanelSide={workbenchActions.toggleTerminalPanelSide}
        onDropWorkspaceTerminalTab={terminalWorkspaceActions.openTerminalTabInDock}
      />
    ),
    overlays: (
      <>
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
      </>
    )
  });
  const shellAdapterProps = useWorkbenchShellAdapterProps({
    rootRef,
    rootClassName,
    rootStyle,
    uiRuntime,
    actions: workbenchActions,
    labels: workbenchChromeLabels,
    presentationState: workbenchPresentationState,
    isMac,
    panelLayoutModel,
    slots: workbenchChromeSlots,
    notificationTopbar: notificationTopbarProps,
    aiLaunch: aiLaunchProps,
    onRootDragStartCapture
  });

  return (
    <WorkbenchTitlebarContextProvider activeScopeId={visibleWorkspaceLayout.mode === "split" ? visibleWorkspaceLayout.focusedSplitTabId : visibleWorkspaceLayout.activeTabId}>
      <ShellAdapter {...shellAdapterProps} />
    </WorkbenchTitlebarContextProvider>
  );
};
