import type { ReactNode } from "react";

import { BrowserResultSurface } from "../browser-search";
import type { SearchEngineDefinition } from "../browser-search/types";
import { AiPanelSurface } from "../ai-panel";
import type { AiPanelSurfaceProps } from "../ai-panel/types";
import {
  BrowserPageSurface,
  BrowserSearchSurface,
  BrowserSettingsSurface,
  type BrowserPageNavigationState,
  type BrowserPageNavigator
} from "../browser-tabs";
import type { BrowserSettingsSurfaceProps } from "../browser-tabs/settings-surface";
import { FileManagerSurface, type FileManagerModel, type FileManagerSurfaceLabels } from "../file-manager";
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
import type { TerminalThemePresetId } from "../terminal-theme";
import type { WorkbenchThemeId } from "../theme";
import {
  isAiMcpAppId,
  isAiPanelAppId,
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

type TerminalThemeChoiceOption = ChoiceOption<TerminalThemePresetId> & {
  readonly swatches: readonly string[];
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
};

export type WorkspaceSurfaceAiPanelProps = {
  readonly taskCardAcceptLabel: string;
  readonly taskCardRejectLabel: string;
  readonly taskCardUndoLabel: string;
  readonly fileChangeReviewItems?: readonly FileEditorChangeReviewItem[];
  readonly onAcceptFileChangeReviewItem?: (item: FileEditorChangeReviewItem) => void;
  readonly onRejectFileChangeReviewItem?: (item: FileEditorChangeReviewItem) => void;
  readonly onUndoFileChangeReviewItem?: (item: FileEditorChangeReviewItem) => void;
  readonly resolveSurfaceProps: (
    sessionId: string
  ) => Omit<AiPanelSurfaceProps, "variant"> | null;
};

export type WorkspaceSurfaceRouterProps = {
  readonly activeTab: WorkspaceTab | undefined;
  readonly tabsModel: WorkspaceTabsModel;
  readonly logoUrl: string;
  readonly browserSearchModel: BrowserSearchModel;
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly onOpenSearchResult: (url: string, title: string) => void;
  readonly onPageMetaChange: (
    tabId: string,
    meta: { readonly title?: string; readonly faviconUrl?: string }
  ) => void;
  readonly onPageNavigatorReady: (
    tabId: string,
    navigator: BrowserPageNavigator | null
  ) => void;
  readonly onPageNavigationStateChange: (
    tabId: string,
    state: BrowserPageNavigationState
  ) => void;
  readonly terminalModel: TerminalDockModel;
  readonly desktopApi: LyraDesktopApi | null;
  readonly terminalLabels: TerminalDockLabels;
  readonly terminalThemeSignature: string;
  readonly terminalThemePreset: TerminalThemePresetId;
  readonly resolvedThemeId: string;
  readonly fileManagerModel: FileManagerModel;
  readonly fileManagerLabels: FileManagerSurfaceLabels;
  readonly fileEditorModel: FileEditorModel;
  readonly fileEditorLabels: FileEditorLabels;
  readonly onOpenFileFromManager: (filePath: string) => void;
  readonly splitThreePaneLayout: WorkbenchSplitThreePaneLayout;
  readonly settings: WorkspaceSurfaceSettingsProps;
  readonly i18n: WorkspaceSurfaceI18nProps;
  readonly aiPanel: WorkspaceSurfaceAiPanelProps;
  readonly mcpCenter: {
    readonly model: McpCenterModel;
    readonly labels: McpCenterLabels;
  };
  readonly skillsCenter: {
    readonly model: SkillsCenterModel;
    readonly labels: SkillsCenterLabels;
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
  onPageMetaChange,
  onPageNavigatorReady,
  onPageNavigationStateChange,
  terminalModel,
  desktopApi,
  terminalLabels,
  terminalThemeSignature,
  terminalThemePreset,
  resolvedThemeId,
  fileManagerModel,
  fileManagerLabels,
  fileEditorModel,
  fileEditorLabels,
  onOpenFileFromManager,
  splitThreePaneLayout,
  settings,
  i18n,
  aiPanel,
  mcpCenter,
  skillsCenter,
  notifications
}: WorkspaceSurfaceRouterProps) => {
  const isAiPanelWorkspaceTab = (tab: WorkspaceTab): boolean =>
    tab.pageKind === "app" && tab.appId !== undefined && isAiPanelAppId(tab.appId);

  const renderTabSurface = (tab: WorkspaceTab): ReactNode => {
    if (tab.pageKind === "results") {
      return (
        <BrowserResultSurface
          logoUrl={logoUrl}
          inputValue={tab.inputValue}
          placeholder={i18n.searchPlaceholder}
          searchActionLabel={i18n.searchActionLabel}
          headingLabel={i18n.resultsHeading}
          blendLabel={i18n.resultsBlendTitle}
          engineOverviewLabel={i18n.resultsEngineOverview}
          emptyLabel={
            browserSearchModel.searchError === null
              ? i18n.resultsNoResults
              : `${i18n.resultsNoResults} · ${browserSearchModel.searchError}`
          }
          engineErrorLabel={i18n.resultsEngineError}
          isLoading={browserSearchModel.isSearching}
          payload={browserSearchModel.searchPayload}
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
      return (
        <BrowserPageSurface
          tabId={tab.id}
          address={tab.displayAddress}
          onPageMetaChange={onPageMetaChange}
          onNavigatorReady={onPageNavigatorReady}
          onNavigationStateChange={onPageNavigationStateChange}
        />
      );
    }

    if (tab.pageKind === "search") {
      return (
        <BrowserSearchSurface
          logoUrl={logoUrl}
          inputValue={tab.inputValue}
          placeholder={i18n.searchPlaceholder}
          searchActionLabel={i18n.searchActionLabel}
          onPillRef={(element) => {
            browserSearchModel.searchPillRef.current = element;
          }}
          onInputChange={tabsModel.updateActiveInput}
          onSubmit={browserSearchModel.onSearchSurfaceSubmit}
        />
      );
    }

    if (tab.pageKind === "settings") {
      return (
        <BrowserSettingsSurface
          title={settings.title}
          aiCategoryLabel={settings.aiCategoryLabel}
          languageLabel={settings.languageLabel}
          themeLabel={settings.themeLabel}
          terminalThemeLabel={settings.terminalThemeLabel}
          splitTriggerModeLabel={settings.splitTriggerModeLabel}
          splitThreePaneLayoutLabel={settings.splitThreePaneLayoutLabel}
          splitOverflowPolicyLabel={settings.splitOverflowPolicyLabel}
          localeValue={settings.localeValue}
          themeValue={settings.themeValue}
          terminalThemeValue={settings.terminalThemeValue}
          splitTriggerModeValue={settings.splitTriggerModeValue}
          splitThreePaneLayoutValue={settings.splitThreePaneLayoutValue}
          splitOverflowPolicyValue={settings.splitOverflowPolicyValue}
          localeOptions={settings.localeOptions}
          themeOptions={settings.themeOptions}
          terminalThemeOptions={settings.terminalThemeOptions}
          splitTriggerModeOptions={settings.splitTriggerModeOptions}
          splitThreePaneLayoutOptions={settings.splitThreePaneLayoutOptions}
          splitOverflowPolicyOptions={settings.splitOverflowPolicyOptions}
          aiLabels={settings.aiLabels}
          aiModel={settings.aiModel}
          onLocaleChange={settings.onLocaleChange}
          onThemeChange={settings.onThemeChange}
          onTerminalThemeChange={settings.onTerminalThemeChange}
          onSplitTriggerModeChange={settings.onSplitTriggerModeChange}
          onSplitThreePaneLayoutChange={settings.onSplitThreePaneLayoutChange}
          onSplitOverflowPolicyChange={settings.onSplitOverflowPolicyChange}
        />
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
        />
      );
    }

    if (isFileEditorAppId(tab.appId) && tab.appInstanceId !== undefined) {
      const state = fileEditorModel.getState(tab.appInstanceId);
      if (state === null) {
        return null;
      }
      const fileChangeReviewItem = aiPanel.fileChangeReviewItems?.find(
        (item) => item.filePath === state.filePath
      );
      return (
        <FileEditorSurface
          state={state}
          labels={fileEditorLabels}
          model={fileEditorModel}
          themeSignature={resolvedThemeId}
          editorWorkAcceptLabel={aiPanel.taskCardAcceptLabel}
          editorWorkRejectLabel={aiPanel.taskCardRejectLabel}
          editorWorkUndoLabel={aiPanel.taskCardUndoLabel}
          {...(fileChangeReviewItem === undefined
            ? {}
            : { activeEditorWorkItem: fileChangeReviewItem })}
          {...(aiPanel.onAcceptFileChangeReviewItem === undefined
            ? {}
            : { onAcceptEditorWorkItem: aiPanel.onAcceptFileChangeReviewItem })}
          {...(aiPanel.onRejectFileChangeReviewItem === undefined
            ? {}
            : { onRejectEditorWorkItem: aiPanel.onRejectFileChangeReviewItem })}
          {...(aiPanel.onUndoFileChangeReviewItem === undefined
            ? {}
            : { onUndoEditorWorkItem: aiPanel.onUndoFileChangeReviewItem })}
        />
      );
    }

    if (isAiPanelAppId(tab.appId)) {
      const sessionId = tab.appInstanceId ?? "";
      const surfaceProps = aiPanel.resolveSurfaceProps(sessionId);
      if (surfaceProps === null) {
        return null;
      }
      return (
        <AiPanelSurface
          variant="workspace"
          {...surfaceProps}
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

    return null;
  };

  const visibleLayout = tabsModel.getVisibleWorkspaceLayout();
  const tabById = new Map(tabsModel.tabs.map((tab) => [tab.id, tab] as const));
  const aiPanelWorkspaceTabs = tabsModel.tabs.filter(isAiPanelWorkspaceTab);

  const renderAiPanelKeepAliveLayer = (
    visibleAiTabIds: ReadonlySet<string>,
    showVisibleAiTabs: boolean
  ): ReactNode => {
    if (aiPanelWorkspaceTabs.length === 0) {
      return null;
    }
    return (
      <section className="lyra-workspace-surface-keepalive" aria-label="workspace-ai-keepalive">
        {aiPanelWorkspaceTabs.map((tab) => {
          const isVisible = visibleAiTabIds.has(tab.id);
          if (!showVisibleAiTabs && isVisible) {
            return null;
          }
          const paneClassName = isVisible && showVisibleAiTabs
            ? "lyra-workspace-surface-keepalive-pane lyra-workspace-surface-keepalive-pane-active"
            : "lyra-workspace-surface-keepalive-pane lyra-workspace-surface-keepalive-pane-hidden";
          return (
            <section key={tab.id} className={paneClassName}>
              {renderTabSurface(tab)}
            </section>
          );
        })}
      </section>
    );
  };

  if (visibleLayout.mode === "split") {
    const splitClassName = [
      "lyra-workspace-split",
      `lyra-workspace-split-count-${visibleLayout.visibleTabIds.length}`,
      `lyra-workspace-split-layout-${splitThreePaneLayout}`
    ].join(" ");
    const visibleAiTabIds = new Set(
      visibleLayout.visibleTabIds.filter((tabId) => {
        const tab = tabById.get(tabId);
        return tab !== undefined && isAiPanelWorkspaceTab(tab);
      })
    );

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
        {renderAiPanelKeepAliveLayer(visibleAiTabIds, false)}
      </div>
    );
  }

  const targetTab = activeTab ?? tabById.get(visibleLayout.activeTabId);
  const activeAiTabId = targetTab !== undefined && isAiPanelWorkspaceTab(targetTab)
    ? targetTab.id
    : null;
  const singleVisibleAiTabIds = activeAiTabId === null
    ? new Set<string>()
    : new Set([activeAiTabId]);

  return (
    <div className="lyra-workspace-surface-single">
      {targetTab === undefined || activeAiTabId !== null ? null : renderTabSurface(targetTab)}
      {renderAiPanelKeepAliveLayer(singleVisibleAiTabIds, true)}
    </div>
  );
};
