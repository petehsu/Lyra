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
import { useFileEditorModel } from "../file-editor";
import { useWorkbenchFeedbackModel } from "../feedback";
import { useFileManagerModel } from "../file-manager";
import {
  GlobalDialogHost,
  useGlobalDialogModel
} from "../global-dialog";
import { createTranslator } from "../i18n";
import {
  mapFeedbackEventToNotification,
  useWorkbenchNotificationModel
} from "../notifications";
import { useWorkbenchPreferencesModel } from "../preferences";
import { useTerminalDockModel } from "../terminal-dock";
import { useWorkspaceTabsModel } from "../workspace-tabs";
import { useWorkbenchUiRuntime } from "../ui-platform";
import { cx } from "../ui-primitives";
import {
  LOGO_URL,
  getDesktopApi,
  syncCssVarsToDocumentRoot
} from "./service";
import { TitlebarElementPickerButton } from "./titlebar-element-picker-button";
import { TitlebarNavigation } from "./titlebar-navigation";
import { useBrowserSearchModel } from "../browser-search";
import { useWorkbenchActiveAppContext } from "./use-workbench-active-app-context";
import { useWorkbenchAiSurfaceBridge } from "./use-workbench-ai-surface-bridge";
import { useWorkbenchAppRestoration } from "./use-workbench-app-restoration";
import { useWorkbenchBrowserRuntime } from "./use-workbench-browser-runtime";
import {
  createWorkbenchChromeLabels,
  useWorkbenchActionApi
} from "./use-workbench-action-api";
import { usePanelLayoutModel } from "./use-panel-layout";
import { useScrollbarVisibilityGuard } from "./use-scrollbar-visibility-guard";
import { useTerminalWorkspaceActions } from "./use-terminal-workspace-actions";
import { useWorkbenchEditorReviewModel } from "./use-workbench-editor-review-model";
import { useWorkbenchFileActions } from "./use-workbench-file-actions";
import { useWorkbenchJsReplSetting } from "./use-workbench-js-repl-setting";
import { useWorkbenchLabels } from "./use-workbench-labels";
import { useWorkbenchNotificationNavigation } from "./use-workbench-notification-navigation";
import { useWorkbenchProjectBindChooser } from "./use-workbench-project-bind-chooser";
import { useWorkbenchPlanReviewModel } from "./use-workbench-plan-review-model";
import { useWorkbenchSearchIndexStatus } from "./use-workbench-search-index-status";
import { useWorkbenchSearchSettings } from "./use-workbench-search-settings";
import { useWorkbenchShellAdapterProps } from "./use-workbench-shell-adapter-props";
import { useWorkbenchSettingsSurfaceProps } from "./use-workbench-settings-surface-props";
import { useWorkbenchShellSlots } from "./use-workbench-shell-slots";
import { useWorkbenchSidebarAiSurfaceProps } from "./use-workbench-sidebar-ai-surface-props";
import { useWorkbenchThemeRuntime } from "./use-workbench-theme-runtime";
import { useWorkbenchWorkspaceTabsProps } from "./use-workbench-workspace-tabs-props";
import { useWorkspaceSurfaceRouterProps } from "./use-workspace-surface-router-props";
import { useTitlebarElementPickerModel } from "./use-titlebar-element-picker-model";
import { useTitlebarNavigationModel } from "./use-titlebar-navigation-model";
import { attachWorkbenchObservationBridge } from "../observation/service";

export const WorkbenchShell = () => {
  const desktopApi = getDesktopApi();
  const preferencesModel = useWorkbenchPreferencesModel({
    locale: WORKBENCH_CONFIG.locale,
    theme: WORKBENCH_CONFIG.theme,
    uiPackId: WORKBENCH_CONFIG.uiPackId,
    terminalThemePreset: WORKBENCH_CONFIG.terminalThemePreset,
    splitTriggerMode: "ctrl_left_drag",
    splitThreePaneLayout: "adaptive",
    splitOverflowPolicy: "block_with_notice",
    aiRichRenderingEnabled: true,
    aiStopBehavior: "turn_only",
    preventSleepEnabled: true,
    forceWebPageThemingEnabled: true,
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
  const { jsReplEnabled, updateJsReplSetting } = useWorkbenchJsReplSetting(desktopApi);

  const [isMaximized, setIsMaximized] = useState(false);
  const [stackedBrowserTabs, setStackedBrowserTabs] = useState(false);

  const t = useMemo(
    () => createTranslator(preferencesModel.preferences.locale),
    [preferencesModel.preferences.locale]
  );
  const labels = useWorkbenchLabels(t);
  const rootRef = useRef<HTMLElement | null>(null);
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
  const visibleWorkspaceLayout = tabsModel.getVisibleWorkspaceLayout();
  const terminalModel = useTerminalDockModel();
  const contextMenuModel = useContextMenuModel();
  const panelLayoutModel = usePanelLayoutModel();
  const uiRuntime = useWorkbenchUiRuntime(
    preferencesModel.preferences.uiPackId,
    desktopApi
  );
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
    pageNavigationState,
    registerPageHost,
    scheduleBrowserLayoutSync,
    onGoBack,
    onGoForward
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
  const fileManagerModel = useFileManagerModel({
    desktopApi,
    contextMenuModel,
    labels: labels.fileManager,
    onMetaChange: tabsModel.updateAppTabMeta
  });
  const fileEditorModel = useFileEditorModel({
    desktopApi,
    onMetaChange: tabsModel.updateAppTabMeta
  });
  const workbenchActions = useWorkbenchActionApi({
    desktopApi,
    tabsModel,
    fileManagerModel,
    panelLayoutModel,
    docsEntryAddress: WORKBENCH_CONFIG.browser.docsEntryAddress,
    docsTabTitle: t("docs.tabTitle"),
    locale: preferencesModel.preferences.locale,
    resolvedThemeId
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
  const globalDialogModel = useGlobalDialogModel();
  const {
    activeFileManagerState,
    activeFileEditorState,
    mcpCenterModel,
    skillsCenterModel,
    pluginsCenterModel,
    settingsAiModel
  } = useWorkbenchActiveAppContext({
    activeTab,
    desktopApi,
    fileManagerModel,
    fileEditorModel,
    labels
  });
  const settingsSurfaceProps = useWorkbenchSettingsSurfaceProps({
    labels,
    desktopApi,
    preferencesModel,
    settingsAiModel,
    jsReplEnabled,
    searchIndexStatus,
    searchRebuildIndexPending,
    onJsReplChange: updateJsReplSetting,
    onSearchRebuildIndex
  });
  const { requestProjectBind, resolveFileManagerChooser } =
    useWorkbenchProjectBindChooser({
      fileManagerModel,
      tabsModel,
      confirmLabel: t("ai.bindProjectConfirm")
    });
  const aiFileMentionFallbackRoots = useMemo(
    () => {
      const currentPath = activeFileManagerState?.currentLocation?.path?.trim();
      return currentPath === undefined || currentPath.length === 0 ? [] : [currentPath];
    },
    [activeFileManagerState?.currentLocation?.path]
  );
  const planReview = useWorkbenchPlanReviewModel({
    openAppTab: tabsModel.openAppTab,
    title: t("ai.planReviewTitle")
  });
  const sidebarAiSurfaceProps = useWorkbenchSidebarAiSurfaceProps({
    desktopApi,
    preferences: preferencesModel.preferences,
    settingsAiModel,
    resolvedThemeId,
    aiPanelSide: panelLayoutModel.aiPanelSide,
    fileMentionFallbackRoots: aiFileMentionFallbackRoots,
    onToggleAiPanelSide: panelLayoutModel.toggleAiPanelSide,
    openAppTab: tabsModel.openAppTab,
    onRequestProjectBind: requestProjectBind,
    onOpenPlanApprovalWorkspace: planReview.openPlanReview,
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
    });
    return () => {
      unsubscribe();
    };
  }, [desktopApi]);

  useEffect(() => {
    const unsubscribe = feedbackModel.subscribe((event) => {
      publishNotification(mapFeedbackEventToNotification(event));
    });
    return () => {
      unsubscribe();
    };
  }, [feedbackModel, publishNotification]);

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
    scheduleBrowserLayoutSync({
      force: true,
      followUpFrames: 4
    });
  }, [
    panelLayoutModel.aiPanelSide,
    panelLayoutModel.terminalPanelSide,
    panelLayoutModel.cssVars,
    scheduleBrowserLayoutSync,
    stackedBrowserTabs,
    tabsModel.activeTabId
  ]);

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
    fileEditorModel
  });

  const {
    onOpenFileFromManager,
    onRevealPathInFileManager,
    openDirectoryFromNavigation
  } = useWorkbenchFileActions({
    activeTab,
    tabsModel,
    fileManagerModel,
    fileEditorModel
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
    onUndoEditorWorkItem,
    recordCompletedEditorWorkItem
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

  const aiLaunchVerbs = useMemo<readonly string[]>(
    () => [
      t("ai.launchVerbDiscuss"),
      t("ai.launchVerbCode"),
      t("ai.launchVerbThink"),
      t("ai.launchVerbExplore"),
      t("ai.launchVerbBuild"),
      t("ai.launchVerbDebug"),
      t("ai.launchVerbCollaborate"),
      t("ai.launchVerbChat")
    ],
    [t]
  );

  const sidebarAiSurfacePropsWithFileOpen = useWorkbenchAiSurfaceBridge({
    desktopApi,
    sidebarAiSurfaceProps,
    fileEditorModel,
    terminalModel,
    onOpenFileFromManager,
    recordCompletedEditorWorkItem
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
    mcpCenterModel,
    skillsCenterModel,
    pluginsCenterModel,
    settingsAiModel,
    planReviewModel: planReview.model,
    notificationModel,
    labels,
    openDialog: globalDialogModel.openDialog,
    onOpenFileFromManager,
    onRevealPathInFileManager,
    onOpenNotificationSource,
    onRequestClearNotifications
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
      unreadCount: notificationModel.unreadCount,
      preview: notificationModel.topbarPreview,
      onOpenCenter: onOpenNotificationCenter,
      onOpenPreview: onOpenNotificationPreview
    }),
    [
      labels.notificationTopbar,
      notificationModel.topbarPreview,
      notificationModel.unreadCount,
      onOpenNotificationCenter,
      onOpenNotificationPreview
    ]
  );
  const aiLaunchProps = useMemo(
    () => ({
      logoUrl: LOGO_URL,
      prefix: t("ai.launchPrefix"),
      verbs: aiLaunchVerbs
    }),
    [aiLaunchVerbs, t]
  );
  const workbenchChromeSlots = useWorkbenchShellSlots({
    titlebarNavigation: (
      <TitlebarNavigation
        {...titlebarNavigation}
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
    ),
    leftPanel: (
      <>
        {sidebarAiSurfacePropsWithFileOpen === null ? null : (
          <AiPanelAdapter
            variant="sidebar"
            {...sidebarAiSurfacePropsWithFileOpen}
          />
        )}
      </>
    ),
    workspace: (
      <WorkspaceSurfaceAdapter
        {...workspaceSurfaceProps}
        surfaceAdapters={uiRuntime.adapters.surfaces}
      />
    ),
    browserTabs: (
      <WorkspaceTabsAdapter {...workspaceTabsProps} />
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
    <ShellAdapter {...shellAdapterProps} />
  );
};
