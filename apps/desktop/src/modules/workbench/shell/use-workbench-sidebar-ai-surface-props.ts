import { useMemo } from "react";

import {
  createAiHistoryAppRequest,
  createAiMcpAppRequest,
  createAiPluginsAppRequest,
  createAiSkillsAppRequest,
  type AgentComposerWorkbenchTabMention
} from "../ai-panel";
import type { AiPlanApprovalWorkspaceOpenRequest } from "../ai-panel";
import type { GlobalDialogModel } from "../global-dialog";
import type { I18nKey } from "../i18n";
import type { WorkbenchPreferences } from "../preferences";
import type { SettingsAiModel } from "../settings-ai";
import type { WorkspaceTabsModel } from "../workspace-tabs";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { AiPanelSide } from "./use-panel-layout";
import type { WorkbenchSidebarAiSurfaceProps } from "./use-workbench-ai-surface-bridge";

type SidebarAiPreferences = Pick<
  WorkbenchPreferences,
  "locale" | "aiRichRenderingEnabled" | "aiStopBehavior"
>;

type UseWorkbenchSidebarAiSurfacePropsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly preferences: SidebarAiPreferences;
  readonly settingsAiModel: SettingsAiModel;
  readonly resolvedThemeId: string;
  readonly aiPanelSide: AiPanelSide;
  readonly fileMentionFallbackRoots: readonly string[];
  readonly workbenchTabMentions: readonly AgentComposerWorkbenchTabMention[];
  readonly onToggleAiPanelSide: () => void;
  readonly openAppTab: WorkspaceTabsModel["openAppTab"];
  readonly onRequestProjectBind: (
    currentPath?: string
  ) => Promise<string | null>;
  readonly onOpenPlanApprovalWorkspace: (request: AiPlanApprovalWorkspaceOpenRequest) => void;
  readonly openDialog: GlobalDialogModel["openDialog"];
  readonly t: (key: I18nKey) => string;
};

export const useWorkbenchSidebarAiSurfaceProps = ({
  desktopApi,
  preferences,
  settingsAiModel,
  resolvedThemeId,
  aiPanelSide,
  fileMentionFallbackRoots,
  workbenchTabMentions,
  onToggleAiPanelSide,
  openAppTab,
  onRequestProjectBind,
  onOpenPlanApprovalWorkspace,
  openDialog,
  t
}: UseWorkbenchSidebarAiSurfacePropsParams): WorkbenchSidebarAiSurfaceProps =>
  useMemo(
    () => ({
      desktopApi,
      locale: preferences.locale,
      title: t("ai.tabTitle"),
      description: t("settings.aiCategoryLabel"),
      themeSignature: resolvedThemeId,
      richRenderingEnabled: preferences.aiRichRenderingEnabled,
      stopBehavior: preferences.aiStopBehavior,
      newSessionTitle: t("ai.sessionDefaultTitle"),
      defaultProfileId: settingsAiModel.defaultProfileId,
      defaultProviderId: settingsAiModel.defaultProviderId,
      defaultProfileName: settingsAiModel.defaultProfileLabel,
      defaultModelNames: settingsAiModel.defaultModelNames,
      configuredProfiles: settingsAiModel.profiles,
      onDefaultProfileSelect: settingsAiModel.setDefaultProfile,
      fileMentionFallbackRoots,
      workbenchTabMentions,
      profileLabel: t("ai.profileLabel"),
      modelLabel: t("ai.modelLabel"),
      modelsLabel: t("ai.modelsLabel"),
      openHistoryLabel: t("ai.openHistory"),
      openMcpLabel: t("ai.openMcp"),
      openSkillsLabel: t("ai.openSkills"),
      openPluginsLabel: t("ai.openPlugins"),
      aiPanelSide,
      onToggleAiPanelSide,
      movePanelToLeftLabel: t("ai.movePanelToLeft"),
      movePanelToRightLabel: t("ai.movePanelToRight"),
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
        openAppTab(createAiHistoryAppRequest(t("ai.historyTitle")));
      },
      onOpenMcp: () => {
        openAppTab(createAiMcpAppRequest(t("ai.mcpTabTitle")));
      },
      onOpenSkills: () => {
        openAppTab(createAiSkillsAppRequest(t("ai.skillsTabTitle")));
      },
      onOpenPlugins: () => {
        openAppTab(createAiPluginsAppRequest(t("ai.pluginsTabTitle")));
      },
      onOpenPlanApprovalWorkspace,
      onRequestProjectBind,
      openDialog
    }),
    [
      aiPanelSide,
      desktopApi,
      fileMentionFallbackRoots,
      workbenchTabMentions,
      onRequestProjectBind,
      onOpenPlanApprovalWorkspace,
      onToggleAiPanelSide,
      openAppTab,
      openDialog,
      preferences.aiRichRenderingEnabled,
      preferences.aiStopBehavior,
      preferences.locale,
      resolvedThemeId,
      settingsAiModel.defaultModelNames,
      settingsAiModel.defaultProfileId,
      settingsAiModel.defaultProviderId,
      settingsAiModel.defaultProfileLabel,
      settingsAiModel.profiles,
      settingsAiModel.setDefaultProfile,
      t
    ]
  );
