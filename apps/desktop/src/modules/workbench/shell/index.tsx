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
  BrowserTabStrip,
  type BrowserPageNavigationState,
  type BrowserPageNavigator
} from "../browser-tabs";
import {
  AiPanelSurface
} from "../ai-panel";
import { useAiComputerModel } from "../ai-panel/computer";
import { useAiPanelSessionStore } from "../ai-panel/session-store";
import { WORKBENCH_CONFIG } from "../config";
import { ContextMenuHost, useContextMenuModel } from "../context-menu";
import {
  useFileEditorModel,
  type FileEditorChangeReviewItem
} from "../file-editor";
import { useWorkbenchFeedbackModel } from "../feedback";
import { useFileManagerModel } from "../file-manager";
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
import { useWorkbenchAiController } from "./ai-controller";
import { useBrowserSearchModel } from "./use-browser-search-model";
import { usePanelLayoutModel } from "./use-panel-layout";
import { useScrollbarVisibilityGuard } from "./use-scrollbar-visibility-guard";
import { useTerminalWorkspaceActions } from "./use-terminal-workspace-actions";
import { WorkspaceSurfaceRouter } from "./workspace-surface-router";

const DEFAULT_PAGE_NAVIGATION_STATE: BrowserPageNavigationState = {
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
    splitOverflowPolicy: "block_with_notice"
  });

  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    readSystemPrefersDark()
  );
  const [isMaximized, setIsMaximized] = useState(false);
  const [stackedBrowserTabs, setStackedBrowserTabs] = useState(false);
  const [pageNavigationState, setPageNavigationState] =
    useState<BrowserPageNavigationState>(DEFAULT_PAGE_NAVIGATION_STATE);

  const t = useMemo(
    () => createTranslator(preferencesModel.preferences.locale),
    [preferencesModel.preferences.locale]
  );
  const pageNavigatorRef = useRef<BrowserPageNavigator | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const restoredFileManagerInstanceIdsRef = useRef<Set<string>>(new Set());
  const restoredFileEditorInstanceIdsRef = useRef<Set<string>>(new Set());

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
      modelSourceCustom: t("settings.aiModelSourceCustom")
    }),
    [t]
  );
  const engineById = useMemo(
    () =>
      new Map(
        WORKBENCH_CONFIG.browser.searchEngines.map((engine) => [
          engine.id,
          engine
        ])
      ),
    []
  );

  const browserSearchModel = useBrowserSearchModel({
    desktopApi,
    tabsModel
  });
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
      viewLarge: t("files.viewLarge")
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
  const feedbackModel = useWorkbenchFeedbackModel();
  const notificationModel = useWorkbenchNotificationModel();
  const publishNotification = notificationModel.publishNotification;
  const markNotificationRead = notificationModel.markNotificationRead;
  const clearNotifications = notificationModel.clearNotifications;
  const selectNotification = notificationModel.selectNotification;
  const acknowledgeTopbarPreview = notificationModel.acknowledgeTopbarPreview;
  const getNotification = notificationModel.getNotification;
  const aiSessionModel = useAiPanelSessionStore({
    desktopApi,
    fileEditorModel,
    defaultSessionTitle: t("ai.tabTitle"),
    publishFeedback: feedbackModel.publishFeedback
  });
  const aiComputerModel = useAiComputerModel({
    desktopApi,
    sessionIds: aiSessionModel.sessions.map((session) => session.id)
  });
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
    if (activePageTabId.length > 0) {
      return;
    }
    pageNavigatorRef.current = null;
    setPageNavigationState(DEFAULT_PAGE_NAVIGATION_STATE);
  }, [activePageTabId]);

  useEffect(() => {
    const unsubscribe = feedbackModel.subscribe((event) => {
      publishNotification(mapFeedbackEventToNotification(event));
    });
    return () => {
      unsubscribe();
    };
  }, [feedbackModel, publishNotification]);

  const onPageMetaChange = useCallback(
    (tabId: string, meta: { readonly title?: string; readonly faviconUrl?: string }) => {
      tabsModel.updatePageMeta(tabId, meta);
    },
    [tabsModel.updatePageMeta]
  );

  const onPageNavigatorReady = useCallback(
    (tabId: string, navigator: BrowserPageNavigator | null) => {
      if (tabId !== activePageTabId) {
        return;
      }
      pageNavigatorRef.current = navigator;
    },
    [activePageTabId]
  );

  const onPageNavigationStateChange = useCallback(
    (tabId: string, state: BrowserPageNavigationState) => {
      if (tabId !== activePageTabId) {
        return;
      }
      setPageNavigationState(state);
    },
    [activePageTabId]
  );

  const onGoBack = useCallback(() => {
    pageNavigatorRef.current?.goBack();
  }, []);

  const onGoForward = useCallback(() => {
    pageNavigatorRef.current?.goForward();
  }, []);

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
    const aiWorkspaceSessionIds = tabsModel.tabs
      .filter(
        (tab) =>
          tab.pageKind === "app" &&
          tab.appId === "ai-panel" &&
          tab.appInstanceId !== undefined
      )
      .map((tab) => tab.appInstanceId as string);
    aiSessionModel.syncWorkspaceTabSessions(aiWorkspaceSessionIds);
  }, [aiSessionModel, tabsModel.tabs]);

  useEffect(() => {
    fileManagerModel.syncExternalInstances(aiComputerModel.externalFileManagerInstanceIds);
  }, [
    aiComputerModel.externalFileManagerInstanceIds,
    fileManagerModel.syncExternalInstances
  ]);

  useEffect(() => {
    fileEditorModel.syncExternalInstances([
      ...aiSessionModel.externalEditorInstanceIds,
      ...aiComputerModel.externalFileEditorInstanceIds
    ]);
  }, [
    aiComputerModel.externalFileEditorInstanceIds,
    aiSessionModel.externalEditorInstanceIds,
    fileEditorModel.syncExternalInstances
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
    (filePath: string): void => {
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
          void fileEditorModel.hydrateIfNeeded(existingTab.appInstanceId);
        }
        return;
      }

      const nextEditor = fileEditorModel.createInstance(filePath);
      tabsModel.openAppTab(nextEditor);
      void fileEditorModel.openFile(nextEditor.appInstanceId, filePath);
    },
    [fileEditorModel, tabsModel]
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
      | "ai-panel"
      | "ai-mcp"
      | "ai-skills"
      | "notification-center"
  ) => {
    switch (appId) {
      case "file-manager":
        return "file-manager-home" as const;
      case "file-editor":
        return "file-editor-code" as const;
      case "ai-mcp":
        return "ai-panel-mcp" as const;
      case "ai-skills":
        return "ai-panel-skills" as const;
      case "notification-center":
        return "notification-center-default" as const;
      case "ai-panel":
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

  const {
    sidebarAiSurfaceProps,
    resolveWorkspaceAiSurfaceProps,
    aiFileChangeReviewItems,
    onAcceptAiFileChangeReviewItem,
    onRejectAiFileChangeReviewItem,
    onUndoAiFileChangeReviewItem
  } = useWorkbenchAiController({
    t,
    desktopApi,
    tabsModel,
    aiSessionModel,
    aiComputerModel,
    fileEditorModel,
    fileEditorLabels,
    fileManagerModel,
    fileManagerLabels,
    terminalLabels,
    terminalThemeSignature,
    terminalThemePreset: preferencesModel.preferences.terminalThemePreset,
    resolvedThemeId,
    onOpenFileFromManager,
    onOpenMessageContextMenu: contextMenuModel.openMenu
  });

  const rootClassName = globalDialogModel.state.isOpen
    ? "lyra-root lyra-root-modal-open"
    : "lyra-root";

  return (
    <main
      ref={rootRef}
      className={rootClassName}
      style={rootStyle}
      onDragStartCapture={onRootDragStartCapture}
    >
      <header className="lyra-titlebar">
        <div />
        <WorkbenchNotificationTopbar
          labels={notificationTopbarLabels}
          unreadCount={notificationModel.unreadCount}
          preview={notificationModel.topbarPreview}
          onOpenCenter={onOpenNotificationCenter}
          onOpenPreview={onOpenNotificationPreview}
        />
        <div className="lyra-window-controls lyra-no-drag">
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
        </div>
      </header>

      <section className="lyra-main">
        {panelLayoutModel.isLeftPanelVisible ? (
          <aside className="lyra-panel lyra-panel-left" aria-label="left-panel">
            {sidebarAiSurfaceProps === null ? null : (
              <AiPanelSurface
                variant="sidebar"
                {...sidebarAiSurfaceProps}
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
              onPageMetaChange={onPageMetaChange}
              onPageNavigatorReady={onPageNavigatorReady}
              onPageNavigationStateChange={onPageNavigationStateChange}
              terminalModel={terminalModel}
              desktopApi={desktopApi}
              terminalLabels={terminalLabels}
              terminalThemeSignature={terminalThemeSignature}
              terminalThemePreset={preferencesModel.preferences.terminalThemePreset}
              resolvedThemeId={resolvedThemeId}
              fileManagerModel={fileManagerModel}
              fileManagerLabels={fileManagerLabels}
              fileEditorModel={fileEditorModel}
              fileEditorLabels={fileEditorLabels}
              splitThreePaneLayout={preferencesModel.preferences.splitThreePaneLayout}
              settings={{
                title: t("settings.pageTitle"),
                aiCategoryLabel: t("settings.aiCategoryLabel"),
                languageLabel: t("settings.languageLabel"),
                themeLabel: t("settings.themeLabel"),
                terminalThemeLabel: t("settings.terminalThemeLabel"),
                splitTriggerModeLabel: t("settings.splitTriggerModeLabel"),
                splitThreePaneLayoutLabel: t("settings.splitThreePaneLayoutLabel"),
                splitOverflowPolicyLabel: t("settings.splitOverflowPolicyLabel"),
                localeValue: preferencesModel.preferences.locale,
                themeValue: preferencesModel.preferences.theme,
                terminalThemeValue:
                  preferencesModel.preferences.terminalThemePreset,
                splitTriggerModeValue: preferencesModel.preferences.splitTriggerMode,
                splitThreePaneLayoutValue:
                  preferencesModel.preferences.splitThreePaneLayout,
                splitOverflowPolicyValue:
                  preferencesModel.preferences.splitOverflowPolicy,
                localeOptions: settingLocaleOptions,
                themeOptions: settingThemeOptions,
                terminalThemeOptions: settingTerminalThemeOptions,
                splitTriggerModeOptions: settingSplitTriggerModeOptions,
                splitThreePaneLayoutOptions: settingSplitThreePaneLayoutOptions,
                splitOverflowPolicyOptions: settingSplitOverflowPolicyOptions,
                aiLabels: settingsAiLabels,
                aiModel: settingsAiModel,
                onLocaleChange: preferencesModel.setLocale,
                onThemeChange: preferencesModel.setTheme,
                onTerminalThemeChange: preferencesModel.setTerminalThemePreset,
                onSplitTriggerModeChange: preferencesModel.setSplitTriggerMode,
                onSplitThreePaneLayoutChange:
                  preferencesModel.setSplitThreePaneLayout,
                onSplitOverflowPolicyChange:
                  preferencesModel.setSplitOverflowPolicy
              }}
              onOpenFileFromManager={onOpenFileFromManager}
              i18n={{
                searchPlaceholder: t("browser.searchPlaceholder"),
                searchActionLabel: t("browser.searchAction"),
                resultsHeading: t("browser.resultsHeading"),
                resultsBlendTitle: t("browser.resultsBlendTitle"),
                resultsEngineOverview: t("browser.resultsEngineOverview"),
                resultsNoResults: t("browser.resultsNoResults"),
                resultsEngineError: t("browser.resultsEngineError")
              }}
              aiPanel={{
                taskCardAcceptLabel: t("ai.editorWorkAccept"),
                taskCardRejectLabel: t("ai.editorWorkReject"),
                taskCardUndoLabel: t("ai.editorWorkUndo"),
                fileChangeReviewItems: aiFileChangeReviewItems,
                onAcceptFileChangeReviewItem: onAcceptAiFileChangeReviewItem,
                onRejectFileChangeReviewItem: onRejectAiFileChangeReviewItem,
                onUndoFileChangeReviewItem: onUndoAiFileChangeReviewItem,
                resolveSurfaceProps: resolveWorkspaceAiSurfaceProps
              }}
              mcpCenter={{
                model: mcpCenterModel,
                labels: mcpCenterLabels
              }}
              skillsCenter={{
                model: skillsCenterModel,
                labels: skillsCenterLabels
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
