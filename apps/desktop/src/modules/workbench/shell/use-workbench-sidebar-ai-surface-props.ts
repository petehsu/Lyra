import { useMemo } from "react";

import {
  createAiHistoryAppRequest,
  createAiMcpAppRequest,
  createAiPluginsAppRequest,
  createAiSkillsAppRequest,
  type AgentComposerWorkbenchTabMention
} from "../ai-panel";
import { readAiHistoryHasThreads } from "../ai-history/availability";
import type { I18nKey } from "../i18n";
import type { WorkbenchPreferences } from "../preferences";
import type { SettingsAiModel } from "../settings-ai";
import type { WorkspaceTabsModel } from "../workspace-tabs";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { AiPanelSide } from "./use-panel-layout";
import type { AiPanelSurfaceProps } from "../ai-panel";

type SidebarAiPreferences = Pick<
  WorkbenchPreferences,
  "locale" | "aiStopBehavior"
>;

type UseWorkbenchSidebarAiSurfacePropsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly preferences: SidebarAiPreferences;
  readonly settingsAiModel: SettingsAiModel;
  readonly aiPanelSide: AiPanelSide;
  readonly fileMentionFallbackRoots: readonly string[];
  readonly workbenchTabMentions: readonly AgentComposerWorkbenchTabMention[];
  readonly onToggleAiPanelSide: () => void;
  readonly openAppTab: WorkspaceTabsModel["openAppTab"];
  readonly onRequestProjectBind: (
    currentPath?: string
  ) => Promise<string | null>;
  readonly t: (key: I18nKey) => string;
};

export const useWorkbenchSidebarAiSurfaceProps = ({
  desktopApi,
  preferences,
  settingsAiModel,
  aiPanelSide,
  fileMentionFallbackRoots,
  workbenchTabMentions,
  onToggleAiPanelSide,
  openAppTab,
  onRequestProjectBind,
  t
}: UseWorkbenchSidebarAiSurfacePropsParams): AiPanelSurfaceProps =>
  useMemo(
    () => ({
      variant: "sidebar",
      desktopApi,
      locale: preferences.locale,
      title: t("ai.tabTitle"),
      stopBehavior: preferences.aiStopBehavior,
      newSessionTitle: t("ai.sessionDefaultTitle"),
      defaultProfileId: settingsAiModel.defaultProfileId,
      defaultProviderId: settingsAiModel.defaultProviderId,
      defaultModelNames: settingsAiModel.defaultModelNames,
      configuredProfiles: settingsAiModel.profiles,
      onDefaultProfileSelect: settingsAiModel.setDefaultProfile,
      fileMentionFallbackRoots,
      workbenchTabMentions,
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
      emptyThreadLabel: t("ai.startBySending"),
      onOpenHistory: () => {
        void readAiHistoryHasThreads(desktopApi).then((hasThreads) => {
          if (hasThreads) {
            openAppTab(createAiHistoryAppRequest(t("ai.historyTitle")));
          }
        });
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
      onRequestProjectBind
    }),
    [
      aiPanelSide,
      desktopApi,
      fileMentionFallbackRoots,
      workbenchTabMentions,
      onRequestProjectBind,
      onToggleAiPanelSide,
      openAppTab,
      preferences.aiStopBehavior,
      preferences.locale,
      settingsAiModel.defaultModelNames,
      settingsAiModel.defaultProfileId,
      settingsAiModel.defaultProviderId,
      settingsAiModel.profiles,
      settingsAiModel.setDefaultProfile,
      t
    ]
  );
