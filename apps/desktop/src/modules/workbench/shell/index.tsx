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
import { useWorkbenchFeedbackModel } from "../feedback";
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
import {
  getDesktopApi,
  syncCssVarsToDocumentRoot
} from "./service";
import type { AgentComposerWorkbenchTabMention } from "../ai-panel";
import { TitlebarElementPickerButton } from "./titlebar-element-picker-button";
import { WorkbenchTitlebarContextProvider, WorkbenchTitlebarContextSlot } from "./titlebar-context";
import { TitlebarNavigation } from "./titlebar-navigation";
import { useBrowserSearchModel } from "../browser-search";
import { useWorkbenchActiveAppContext } from "./use-workbench-active-app-context";
import { useWorkbenchAiFileMentionFallbackRoots } from "./use-workbench-ai-file-mention-fallback-roots";
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
import { useWorkbenchPlanReviewModel } from "./use-workbench-plan-review-model";
import { useWorkbenchResourceRegistration } from "./use-workbench-resource-registration";
import { useWorkbenchSearchIndexStatus } from "./use-workbench-search-index-status";
import { useWorkbenchSearchSettings } from "./use-workbench-search-settings";
import { useWorkbenchShellAdapterProps } from "./use-workbench-shell-adapter-props";
import { useWorkbenchSettingsSurfaceProps } from "./use-workbench-settings-surface-props";
import { useWorkbenchShellSlots } from "./use-workbench-shell-slots";
import { useWorkbenchSidebarAiSurfaceProps } from "./use-workbench-sidebar-ai-surface-props";
import {
  useWorkbenchFeedbackNotifications,
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

export const WorkbenchShell = () => {
  const desktopApi = getDesktopApi();
  const preferencesModel = useWorkbenchPreferencesModel(createInitialWorkbenchPreferences());
  const { jsReplEnabled, updateJsReplSetting } = useWorkbenchJsReplSetting(desktopApi);

  const [isMaximized, setIsMaximized] = useState(false);
  const [stackedBrowserTabs, setStackedBrowserTabs] = useState(false);

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
  const { fileManagerModel, fileEditorModel, imageViewerModel } = useWorkbenchFileAppModels({
    desktopApi,
    contextMenuModel,
    fileManagerLabels: labels.fileManager,
    tabsModel
  });
  useWorkbenchResourceRegistration({
    desktopApi,
    tabsModel,
    visibleWorkspaceLayout,
    fileManagerModel,
    fileEditorModel,
    imageViewerModel,
    terminalModel
  });
  const workbenchActions = useWorkbenchActionApi({
    desktopApi,
    tabsModel,
    fileManagerModel,
    panelLayoutModel,
    docsEntryAddress: WORKBENCH_CONFIG.browser.docsEntryAddress,
    docsTabTitle: t("docs.tabTitle"),
    activityMonitorTitle: t("resources.activityMonitorTitle"),
    locale: preferencesModel.preferences.locale,
    resolvedThemeId
  });
  useWorkbenchObservationBridge({
    desktopApi,
    tabsModel,
    fileEditorModel,
    fileManagerModel,
    terminalModel
  });
  const feedbackModel = useWorkbenchFeedbackModel();
  const notificationModel = useWorkbenchNotificationModel();
  const publishNotification = useWorkbenchSystemNotificationPublisher({
    desktopApi,
    notificationModel,
    preferences: preferencesModel.preferences,
    t
  });
  useWorkbenchFeedbackNotifications({
    feedbackModel,
    publishNotification
  });
  useWorkbenchSystemNotificationPermissionGuard({
    desktopApi,
    preferencesModel
  });
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
  const aiFileMentionFallbackRoots = useWorkbenchAiFileMentionFallbackRoots({
    currentPath: activeFileManagerState?.currentLocation?.path,
    tabs: tabsModel.tabs
  });
  const planReview = useWorkbenchPlanReviewModel({
    openAppTab: tabsModel.openAppTab,
    title: t("ai.planReviewTitle")
  });
  const workbenchTabMentions = useMemo<readonly AgentComposerWorkbenchTabMention[]>(() => {
    const visibleTabIds = new Set(visibleWorkspaceLayout.visibleTabIds);
    return tabsModel.tabs.map((tab) => ({
      tabId: tab.id,
      title: tab.title,
      kind: tab.pageKind,
      active: tab.id === tabsModel.activeTabId,
      visible: visibleTabIds.has(tab.id),
      ...(tab.displayAddress.trim().length === 0 ? {} : { address: tab.displayAddress }),
      ...(tab.inputValue.trim().length === 0 ? {} : { inputValue: tab.inputValue }),
      ...(tab.query === undefined ? {} : { query: tab.query }),
      ...(tab.filePath === undefined ? {} : { filePath: tab.filePath }),
      ...(tab.appId === undefined ? {} : { appId: tab.appId }),
      ...(tab.appIconKey === undefined ? {} : { appIconKey: tab.appIconKey }),
      ...(tab.terminalTabId === undefined ? {} : { terminalTabId: tab.terminalTabId }),
      ...(tab.faviconUrl === undefined ? {} : { faviconUrl: tab.faviconUrl }),
    }));
  }, [tabsModel.activeTabId, tabsModel.tabs, visibleWorkspaceLayout.visibleTabIds]);
  const sidebarAiSurfaceProps = useWorkbenchSidebarAiSurfaceProps({
    desktopApi,
    preferences: preferencesModel.preferences,
    settingsAiModel,
    aiPanelSide: panelLayoutModel.aiPanelSide,
    fileMentionFallbackRoots: aiFileMentionFallbackRoots,
    workbenchTabMentions,
    onToggleAiPanelSide: panelLayoutModel.toggleAiPanelSide,
    openAppTab: tabsModel.openAppTab,
    onRequestProjectBind: requestProjectBind,
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
    fileEditorModel,
    imageViewerModel
  });

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

  const sidebarAiSurfacePropsWithFileOpen = sidebarAiSurfaceProps;
  const emptyAppTabGuards = useWorkbenchEmptyAppTabGuards({
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
    planReviewModel: planReview.model,
    notificationModel,
    labels,
    openDialog: globalDialogModel.openDialog,
    onOpenFileFromManager,
    onRevealPathInFileManager,
    onOpenNotificationSource,
    onRequestClearNotifications,
    onHistoryEmptied: emptyAppTabGuards.onHistoryEmptied
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
    titlebarContext: <WorkbenchTitlebarContextSlot />,
    leftPanel: sidebarAiSurfacePropsWithFileOpen === null ? null : (
      <AiPanelAdapter {...sidebarAiSurfacePropsWithFileOpen} />
    ),
    workspace: (
      <WorkspaceSurfaceAdapter
        {...workspaceSurfaceProps}
        surfaceAdapters={uiRuntime.adapters.surfaces}
      />
    ),
    browserTabs: <WorkspaceTabsAdapter {...workspaceTabsProps} />,
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
