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
import { useContextMenuModel } from "../context-menu";
import { useGlobalDialogModel } from "../global-dialog";
import { createTranslator, useWorkbenchLocaleSnapshot } from "../i18n";
import { useWorkbenchNotificationModel } from "../notifications";
import { useWorkbenchPreferencesModel } from "../preferences";
import { useWorkbenchLocationModel } from "../location";
import { useTerminalDockModel, useTerminalSessionRestore } from "../terminal-dock";
import { isAgentSessionHistoryAppId } from "../workspace-apps";
import { useWorkspaceTabsModel } from "../workspace-tabs";
import { useWorkbenchUiRuntime } from "../ui-platform";
import { cx } from "../ui-primitives";
import {
  getDesktopApi,
  syncCssVarsToDocumentRoot,
  syncWindowThemeSource
} from "./service";

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
import { useBrowserLayoutAnimationSync } from "./use-browser-layout-animation-sync";
import { useDownloadNotifications } from "./use-download-notifications";
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
import { useWorkbenchFileAppModels } from "./use-workbench-file-app-models";
import { useWorkbenchFileActions } from "./use-workbench-file-actions";
import { useWorkbenchJsReplSetting } from "./use-workbench-js-repl-setting";
import { useWorkbenchLabels } from "./use-workbench-labels";
import { useWorkbenchLinuxCompatNotice } from "./use-workbench-linux-compat-notice";
import { useWorkbenchObservationBridge } from "./use-workbench-observation-bridge";
import { useWorkbenchFileAttachChooser } from "./use-workbench-file-attach-chooser";
import { useWorkbenchProjectBindChooser } from "./use-workbench-project-bind-chooser";
import { useWorkbenchSearchSettings } from "./use-workbench-search-settings";
import { useWorkbenchAgentAppOpeners } from "./use-workbench-agent-app-openers";
import { useAgentEditFollow } from "./use-agent-edit-follow";
import { useWorkbenchSettingsSurfaceProps } from "./use-workbench-settings-surface-props";
import { useWorkbenchSidebarAiSurfaceProps } from "./use-workbench-sidebar-ai-surface-props";
import { useSoftwareCapabilitiesRegistry } from "../software-capabilities";
import { useWorkbenchProviderFaultNotifications } from "./use-workbench-provider-fault-notifications";
import {
  useWorkbenchSystemNotificationPermissionGuard,
  useWorkbenchSystemNotificationPublisher
} from "./use-workbench-system-notifications";
import { useWorkbenchThemeRuntime } from "./use-workbench-theme-runtime";
import { resolveMaterialThemeVars } from "../theme";
import { createInitialWorkbenchPreferences, createWorkbenchBrowserTabsConfig } from "./workbench-shell-defaults";
import { WorkbenchShellStage } from "./workbench-shell-stage";
import { EXPECTED_PROTOCOL_VERSION } from "../../../shared/agent";

const WORKBENCH_BROWSER_LAYOUT_ANIMATION_MS = 260;
const WORKBENCH_BROWSER_LAYOUT_ANIMATION_SYNC_INTERVAL_MS = 33;
const AGENT_HISTORY_BROWSER_PREVIEW_TAB_ID = "lyra-agent-history-browser-preview";

export const WorkbenchShell = () => {
  const desktopApi = getDesktopApi();

  useEffect(() => {
    const api = desktopApi?.agent;
    if (!api) return;
    void api.readProtocolContract().then(
      (contract) => {
        if (contract.protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
          console.warn(
            `[lyra] protocol version mismatch: frontend=${EXPECTED_PROTOCOL_VERSION}, runtime=${contract.protocolVersion}. Please upgrade Lyra.`
          );
        }
      },
      (error: unknown) => {
        console.warn(`[lyra] failed to read protocol contract: ${error}`);
      }
    );
  }, [desktopApi]);

  const preferencesModel = useWorkbenchPreferencesModel(createInitialWorkbenchPreferences());
  const { locale } = useWorkbenchLocaleSnapshot();
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
    () => createTranslator(locale),
    [locale]
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
  const previousThemeVarsRef = useRef(themeVars);
  const [isThemeTransitioning, setIsThemeTransitioning] = useState(false);

  useEffect(() => {
    const previousThemeVars = previousThemeVarsRef.current;
    if (previousThemeVars === themeVars) {
      return;
    }

    const root = rootRef.current;
    if (root !== null) {
      root.style.setProperty(
        "--lyra-theme-transition-from-bg",
        previousThemeVars["--lyra-app-bg"] ?? "transparent"
      );
    }
    previousThemeVarsRef.current = themeVars;
    setIsThemeTransitioning(true);
    const timer = window.setTimeout(() => {
      setIsThemeTransitioning(false);
    }, 440);
    return () => {
      window.clearTimeout(timer);
    };
  }, [themeVars]);

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
  useWorkbenchProviderFaultNotifications({
    desktopApi,
    notificationModel,
    publishNotification,
    t
  });
  useDownloadNotifications({
    desktopApi,
    publishNotification,
    t
  });
  const browserSearchModel = useBrowserSearchModel({
    desktopApi,
    tabsModel,
    searchSettings: searchSettingsFacade.browserSearchSettings
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
    locale,
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
    locale,
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
    onOpenAgentConfigFile,
    onOpenSite: tabsModel.openPageInNewTab,
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
  const onFocusTerminalTabInDock = useCallback((tabId: string): void => {
    terminalModel.setActiveTab(tabId);
    if (!panelLayoutModel.isBottomPanelVisible) {
      panelLayoutModel.toggleBottomPanel();
    }
  }, [terminalModel, panelLayoutModel]);
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
    getTerminalTabPanes: terminalModel.getTabPanes,
    onCloseTerminalTab: terminalWorkspaceActions.closeTerminalTabEverywhere,
    onFocusTerminalTabInDock,
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

  const materialThemeEnabled =
    desktopApi?.appMeta.windowMaterialMode === "native"
    && preferencesModel.preferences.windowMaterialEnabled;
  const rootVars = useMemo(
    () => resolveMaterialThemeVars(
      {
        ...themeVars,
        ...uiRuntime.vars
      },
      materialThemeEnabled,
      resolvedThemeId.endsWith("-dark") ? "dark" : "light"
    ),
    [materialThemeEnabled, resolvedThemeId, themeVars, uiRuntime.vars]
  );
  const rootStyle = rootVars as CSSProperties;

  useLayoutEffect(() => {
    if (getIsLayoutResizing()) {
      return;
    }
    applyPanelLayoutCssVars(rootRef.current, panelLayoutModel.cssVars);
  }, [panelLayoutModel.cssVars]);

  useEffect(() => {
    syncCssVarsToDocumentRoot(rootVars);
    syncWindowThemeSource(desktopApi, preferencesModel.preferences.theme);
    document.documentElement.dataset.lyraThemeTone = resolvedThemeId.endsWith("-dark")
      ? "dark"
      : "light";
    document.documentElement.dataset.lyraWindowMaterial =
      desktopApi?.appMeta.windowMaterialMode ?? "opaque";
    document.documentElement.dataset.lyraMaterialEnabled =
      preferencesModel.preferences.windowMaterialEnabled ? "true" : "false";
  }, [
    desktopApi,
    preferencesModel.preferences.theme,
    preferencesModel.preferences.windowMaterialEnabled,
    resolvedThemeId,
    rootVars
  ]);

  useWorkbenchAppRestoration({
    activeTab,
    tabsModel,
    fileManagerModel,
    fileEditorModel,
    imageViewerModel,
    agentProjectTreeModel
  });

  const rootClassName = cx(
    "lyra-root",
    uiRuntime.rootClassName,
    isThemeTransitioning && "lyra-theme-transition",
    isFullScreen && "lyra-root-fullscreen",
    globalDialogModel.state.isOpen && "lyra-root-modal-open"
  );

  return (
    <WorkbenchShellStage
      activeBrowserTabId={activeBrowserTabId}
      activeFileEditorState={activeFileEditorState}
      activeFileManagerState={activeFileManagerState}
      activePageRuntimeState={activePageRuntimeState}
      activeTab={activeTab}
      activeTabPageKind={activeTabPageKind}
      agentHistoryLocateRequest={agentHistoryLocateRequest}
      agentHistoryRefreshRequestKey={agentHistoryRefreshRequestKey}
      agentHistoryBrowserPreviewTabId={AGENT_HISTORY_BROWSER_PREVIEW_TAB_ID}
      agentPlanBoardModel={agentPlanBoardModel}
      agentProjectTreeModel={agentProjectTreeModel}
      aiSessionTabsModel={aiSessionTabsModel}
      beginBrowserLayoutAnimationSync={beginBrowserLayoutAnimationSync}
      browserAgentVisualState={browserAgentVisualState}
      browserHistoryEntries={browserHistoryEntries}
      browserSearchModel={browserSearchModel}
      composerCitationSinkRef={composerCitationSinkRef}
      contextMenuModel={contextMenuModel}
      desktopApi={desktopApi}
      fileEditorModel={fileEditorModel}
      fileManagerModel={fileManagerModel}
      globalDialogModel={globalDialogModel}
      historyAppSuggestionLabels={historyAppSuggestionLabels}
      imageViewerModel={imageViewerModel}
      isFullScreen={isFullScreen}
      isMaximized={isMaximized}
      labels={labels}
      locale={locale}
      notificationModel={notificationModel}
      onGoBack={onGoBack}
      onGoForward={onGoForward}
      onOpenAgentGit={onOpenAgentGit}
      onOpenFileFromManager={onOpenFileFromManager}
      onReload={onReload}
      onRevealPathInFileManager={onRevealPathInFileManager}
      onRootDragStartCapture={onRootDragStartCapture}
      onRunTerminalCommand={onRunTerminalCommand}
      openDirectoryFromNavigation={openDirectoryFromNavigation}
      openSettingsSectionFromCapability={openSettingsSectionFromCapability}
      pageNavigationState={pageNavigationState}
      panelLayoutModel={panelLayoutModel}
      preferencesModel={preferencesModel}
      refreshBrowserHistoryEntries={refreshBrowserHistoryEntries}
      registerPageHost={registerPageHost}
      resolveFileManagerChooser={resolveFileManagerChooser}
      resolvedThemeId={resolvedThemeId}
      rootClassName={rootClassName}
      rootRef={rootRef}
      rootStyle={rootStyle}
      searchSettingsFacade={searchSettingsFacade}
      setAgentHistoryBrowserPreviewPage={setAgentHistoryBrowserPreviewPage}
      setAgentHistoryLocateRequest={setAgentHistoryLocateRequest}
      setAgentHistoryRefreshRequestKey={setAgentHistoryRefreshRequestKey}
      setStackedBrowserTabs={setStackedBrowserTabs}
      settingsSurfaceProps={settingsSurfaceProps}
      sidebarAiSurfaceProps={sidebarAiSurfaceProps}
      softwareCapabilities={softwareCapabilities}
      stackedBrowserTabs={stackedBrowserTabs}
      t={t}
      tabsModel={tabsModel}
      terminalIdentityByTabId={terminalIdentityByTabId}
      terminalModel={terminalModel}
      terminalWorkspaceActions={terminalWorkspaceActions}
      uiRuntime={uiRuntime}
      visibleWorkspaceLayout={visibleWorkspaceLayout}
      workbenchActions={workbenchActions}
      workbenchChromeLabels={workbenchChromeLabels}
      workspaceAppIdentityByTabId={workspaceAppIdentityByTabId}
    />
  );
};
