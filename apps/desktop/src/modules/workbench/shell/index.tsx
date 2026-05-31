import {
  useCallback,
  useEffect,
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
import { useTerminalDockModel } from "../terminal-dock";
import { useWorkspaceTabsModel } from "../workspace-tabs";
import { useWorkbenchUiRuntime } from "../ui-platform";
import { cx } from "../ui-primitives";
import { getDesktopApi, syncCssVarsToDocumentRoot } from "./service";
import { TitlebarElementPickerButton } from "./titlebar-element-picker-button";
import { WorkbenchTitlebarContextProvider, WorkbenchTitlebarContextSlot } from "./titlebar-context";
import { TitlebarNavigation } from "./titlebar-navigation";
import { useBrowserSearchModel } from "../browser-search";
import type { BrowserSettingsCategoryFocusRequest } from "../browser-tabs/settings-surface";
import { AgentBrowserActivityOverlay } from "./agent-browser-activity-overlay";
import { useBrowserLayoutAnimationSync } from "./use-browser-layout-animation-sync";
import { useWorkbenchActiveAppContext } from "./use-workbench-active-app-context";
import { useWorkbenchAppRestoration } from "./use-workbench-app-restoration";
import { useWorkbenchBrowserRuntime } from "./use-workbench-browser-runtime";
import {
  createWorkbenchChromeLabels,
  useWorkbenchActionApi
} from "./use-workbench-action-api";
import { usePanelLayoutModel } from "./use-panel-layout";
import { useScrollbarVisibilityGuard } from "./use-scrollbar-visibility-guard";
import { useTerminalWorkspaceActions } from "./use-terminal-workspace-actions";
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
import { useWorkbenchProjectBindChooser } from "./use-workbench-project-bind-chooser";
import { useWorkbenchSearchIndexStatus } from "./use-workbench-search-index-status";
import { useWorkbenchSearchSettings } from "./use-workbench-search-settings";
import { useWorkbenchShellAdapterProps } from "./use-workbench-shell-adapter-props";
import { useWorkbenchSettingsSurfaceProps } from "./use-workbench-settings-surface-props";
import { useWorkbenchShellSlots } from "./use-workbench-shell-slots";
import { useWorkbenchSidebarAiSurfaceProps } from "./use-workbench-sidebar-ai-surface-props";
import { createAgentProjectTreeAppRequest } from "../agent-project-tree";
import { createAgentGitAppRequest } from "../agent-git";
import { createAgentSelfDevAppRequest } from "../agent-selfdev";
import { createAgentOvernightAppRequest } from "../agent-overnight";
import { useSoftwareCapabilitiesRegistry } from "../software-capabilities";
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
const WORKBENCH_BROWSER_LAYOUT_ANIMATION_SYNC_INTERVAL_MS = 16;

export const WorkbenchShell = () => {
  const desktopApi = getDesktopApi();
  const preferencesModel = useWorkbenchPreferencesModel(createInitialWorkbenchPreferences());
  const { jsReplEnabled, updateJsReplSetting } = useWorkbenchJsReplSetting(desktopApi);
  const [settingsFocusRequest, setSettingsFocusRequest] =
    useState<BrowserSettingsCategoryFocusRequest | null>(null);

  const [isMaximized, setIsMaximized] = useState(false);
  const [stackedBrowserTabs, setStackedBrowserTabs] = useState(false);
  const [activeAgentSessionId, setActiveAgentSessionId] = useState<string | null>(null);

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
  const contextMenuModel = useContextMenuModel();
  const panelLayoutModel = usePanelLayoutModel();
  const {
    themeVars,
    resolvedThemeId,
    terminalThemeVars,
    terminalThemeSignature
  } = useWorkbenchThemeRuntime(
    preferencesModel.preferences.theme,
    preferencesModel.preferences.terminalThemePreset
  );
  const workbenchChromeLabels = useMemo(
    () => createWorkbenchChromeLabels(t),
    [t]
  );
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
    themeVars,
    forceWebPageThemingEnabled:
      preferencesModel.preferences.forceWebPageThemingEnabled
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
  const {
    searchIndexStatus,
    searchRebuildIndexPending,
    onSearchRebuildIndex
  } = useWorkbenchSearchIndexStatus({
    desktopApi,
    scopePreset: preferencesModel.preferences.searchScopePreset,
    customRoots: preferencesModel.preferences.searchCustomRoots,
    includeHidden: preferencesModel.preferences.searchIncludeHidden
  });

  const browserSearchModel = useBrowserSearchModel({
    desktopApi,
    tabsModel,
    searchSettings: searchSettingsFacade.browserSearchSettings
  });
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
    softwareStoreTitle: t("softwareStore.tabTitle"),
    loginManagerTitle: t("loginManager.tabTitle"),
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
  const notificationModel = useWorkbenchNotificationModel();
  const publishNotification = useWorkbenchSystemNotificationPublisher({
    desktopApi,
    notificationModel,
    preferences: preferencesModel.preferences,
    t
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
  const {
    onOpenFileFromManager,
    onRevealPathInFileManager,
    openDirectoryFromNavigation
  } = useWorkbenchFileActions({
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
    jsReplEnabled,
    searchIndexStatus,
    searchRebuildIndexPending,
    focusCategoryRequest: settingsFocusRequest,
    openDialog: globalDialogModel.openDialog,
    publishNotification,
    onJsReplChange: updateJsReplSetting,
    onSearchRebuildIndex
  });
  useWorkbenchLinuxCompatNotice({
    desktopApi,
    labels,
    openDialog: globalDialogModel.openDialog,
    publishNotification
  });
  const { requestProjectBind, resolveFileManagerChooser } =
    useWorkbenchProjectBindChooser({
      fileManagerModel,
      tabsModel,
      confirmLabel: t("ai.bindProjectConfirm")
    });
  const onOpenAgentProjectTree = useCallback((request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }): void => {
    const sessionId = request.sessionId.trim();
    const workingDir = request.workingDir.trim();
    if (sessionId.length === 0 || workingDir.length === 0) {
      return;
    }
    const nextApp = createAgentProjectTreeAppRequest(sessionId, workingDir);
    agentProjectTreeModel.ensureInstance(nextApp.appInstanceId, {
      agentSessionId: sessionId,
      rootPath: workingDir,
      title: nextApp.title
    });
    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === nextApp.appId &&
        tab.appInstanceId === nextApp.appInstanceId
    );
    if (existingTab !== undefined) {
      tabsModel.updateAppTabMeta(nextApp);
      tabsModel.setActiveTab(existingTab.id);
      return;
    }
    tabsModel.openAppTab(nextApp);
  }, [
    agentProjectTreeModel,
    tabsModel
  ]);
  const onOpenAgentGit = useCallback((request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }): void => {
    const sessionId = request.sessionId.trim();
    const workingDir = request.workingDir.trim();
    if (sessionId.length === 0 || workingDir.length === 0) {
      return;
    }
    const nextApp = createAgentGitAppRequest(sessionId, workingDir);
    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === nextApp.appId &&
        tab.appInstanceId === nextApp.appInstanceId
    );
    if (existingTab !== undefined) {
      tabsModel.updateAppTabMeta(nextApp);
      tabsModel.setActiveTab(existingTab.id);
      return;
    }
    tabsModel.openAppTab(nextApp);
  }, [tabsModel]);
  const onOpenAgentSelfDevLab = useCallback((request: {
    readonly parentSessionId: string | null;
  }): void => {
    const parentSessionId = request.parentSessionId?.trim() || null;
    const nextApp = createAgentSelfDevAppRequest(
      labels.agentSelfDev.title,
      parentSessionId
    );
    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === nextApp.appId &&
        tab.appInstanceId === nextApp.appInstanceId
    );
    if (existingTab !== undefined) {
      tabsModel.updateAppTabMeta(nextApp);
      tabsModel.setActiveTab(existingTab.id);
      return;
    }
    tabsModel.openAppTab(nextApp);
  }, [
    labels.agentSelfDev.title,
    tabsModel
  ]);
  const onOpenAgentOvernightLab = useCallback((request: {
    readonly parentSessionId: string | null;
  }): void => {
    const parentSessionId = request.parentSessionId?.trim() || null;
    const nextApp = createAgentOvernightAppRequest(
      labels.agentOvernight.title,
      parentSessionId
    );
    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === nextApp.appId &&
        tab.appInstanceId === nextApp.appInstanceId
    );
    if (existingTab !== undefined) {
      tabsModel.updateAppTabMeta(nextApp);
      tabsModel.setActiveTab(existingTab.id);
      return;
    }
    tabsModel.openAppTab(nextApp);
  }, [
    labels.agentOvernight.title,
    tabsModel
  ]);
  const onOpenAgentModelSettings = useCallback((): void => {
    setSettingsFocusRequest((current) => ({
      categoryId: "ai",
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
    onOpenSelfDevLab: onOpenAgentSelfDevLab,
    onOpenOvernightLab: onOpenAgentOvernightLab,
    onOpenModelSettings: onOpenAgentModelSettings,
    onOpenUrlInWorkbench: onOpenAgentUrlInWorkbench,
    onOpenFile: onOpenFileFromManager,
    t
  });
  useScrollbarVisibilityGuard(rootRef);

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

  const onRootDragStartCapture = useCallback((event: ReactDragEvent<HTMLElement>) => {
    if (uiRuntime.interactions.workbenchDrag.shouldPreventDragStart(event.target)) {
      event.preventDefault();
    }
  }, [uiRuntime.interactions.workbenchDrag]);

  const rootStyle = useMemo(
    () =>
      ({
        ...themeVars,
        ...terminalThemeVars,
        ...uiRuntime.vars,
        ...panelLayoutModel.cssVars
      }) as CSSProperties,
    [panelLayoutModel.cssVars, terminalThemeVars, themeVars, uiRuntime.vars]
  );

  useEffect(() => {
    syncCssVarsToDocumentRoot({
      ...themeVars,
      ...terminalThemeVars,
      ...uiRuntime.vars
    } as Record<`--${string}`, string>);
    document.documentElement.dataset.lyraThemeTone = resolvedThemeId.endsWith("-dark")
      ? "dark"
      : "light";
  }, [resolvedThemeId, terminalThemeVars, themeVars, uiRuntime.vars]);

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
    omniboxNonBrowserSubmitTarget:
      preferencesModel.preferences.omniboxNonBrowserSubmitTarget,
    placeholder: t("navigation.titlebarPlaceholder"),
    ariaLabel: t("navigation.titlebarAriaLabel"),
    submitLabel: t("navigation.submitAction"),
    reloadLabel: t("navigation.reloadAction"),
    onReload,
    onOpenFilePath: (path) => onOpenFileFromManager(path),
    onOpenDirectoryPath: openDirectoryFromNavigation
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
    activeSessionId: activeAgentSessionId,
    onActiveSessionChange: setActiveAgentSessionId
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
    setActiveAgentSessionId(trimmedSessionId);
    if (!panelLayoutModel.isLeftPanelVisible) {
      beginBrowserLayoutAnimationSync();
      panelLayoutModel.toggleLeftPanel();
    }
  }, [
    beginBrowserLayoutAnimationSync,
    panelLayoutModel.isLeftPanelVisible,
    panelLayoutModel.toggleLeftPanel
  ]);

  const workspaceSurfaceProps = useWorkspaceSurfaceRouterProps({
    activeTab,
    tabsModel,
    browserSearchModel,
    engineById: searchSettingsFacade.engineById,
    onPageHostChange: registerPageHost,
    terminalModel,
    desktopApi,
    terminalThemeSignature,
    resolvedThemeId,
    fileManagerModel,
    resolveFileManagerChooser,
    fileEditorModel,
    imageViewerModel,
    agentProjectTreeModel,
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
    notificationModel,
    labels,
    softwareCapabilities,
    onOpenFileFromManager,
    onRevealPathInFileManager,
    onOpenNotificationSource,
    onRequestClearNotifications,
    onOpenAgentGit,
    agentSessionHistory: {
      labels: labels.agentSessionHistory,
      activeSessionId: activeAgentSessionId,
      onOpenSession: onOpenAgentSession,
      openDialog: globalDialogModel.openDialog,
      locale: preferencesModel.preferences.locale
    }
  });

  const rootClassName = cx(
    "lyra-root",
    uiRuntime.rootClassName,
    globalDialogModel.state.isOpen && "lyra-root-modal-open"
  );
  const isMac = desktopApi?.appMeta.platform === "darwin";
  const workbenchPresentationState = useMemo(
    () => ({
      isMac,
      isMaximized,
      isAiPanelVisible: panelLayoutModel.isLeftPanelVisible,
      isTerminalPanelVisible: panelLayoutModel.isBottomPanelVisible,
      terminalPanelSide: panelLayoutModel.terminalPanelSide
    }),
    [
      isMac,
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
  const workspaceTabsProps = useWorkbenchWorkspaceTabsProps({
    tabsModel,
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
          recoveryFailure={activePageRuntimeState?.recoveryFailure}
        />
      </>
    ),
    browserTabs: (
      <WorkspaceTabsAdapter
        {...workspaceTabsProps}
        toolbarContextControl={<WorkbenchTitlebarContextSlot />}
        navigationControl={
          <TitlebarNavigation
            {...titlebarNavigation}
            activeBrowserTabId={activeBrowserTabId}
            browserChromePopoverBridge={desktopApi?.workbenchBrowser}
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
        themeSignature={terminalThemeSignature}
        themePresetId={preferencesModel.preferences.terminalThemePreset}
        uiThemeId={resolvedThemeId}
        model={terminalModel}
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
