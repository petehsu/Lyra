import { useMemo } from "react";

import type { I18nKey } from "../i18n";
import type { WorkbenchPreferences } from "../preferences";
import type { SettingsAiModel } from "../settings-ai";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { AiPanelSide } from "./use-panel-layout";
import type { AiPanelSurfaceProps } from "../ai-panel";

type SidebarAiPreferences = Pick<
  WorkbenchPreferences,
  "locale" | "aiStopBehavior" | "aiRichRenderingEnabled"
>;

type UseWorkbenchSidebarAiSurfacePropsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly preferences: SidebarAiPreferences;
  readonly settingsAiModel: SettingsAiModel;
  readonly aiPanelSide: AiPanelSide;
  readonly themeSignature?: string | undefined;
  readonly onToggleAiPanelSide: () => void;
  readonly onRequestProjectBind: (
    currentPath?: string
  ) => Promise<string | null>;
  readonly onOpenProjectTree: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void;
  readonly onOpenSelfDevLab: (request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void;
  readonly onOpenOvernightLab: (request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void;
  readonly onOpenModelSettings: () => Promise<void> | void;
  readonly t: (key: I18nKey) => string;
};

export const useWorkbenchSidebarAiSurfaceProps = ({
  desktopApi,
  preferences,
  settingsAiModel,
  aiPanelSide,
  onToggleAiPanelSide,
  onRequestProjectBind,
  onOpenProjectTree,
  onOpenSelfDevLab,
  onOpenOvernightLab,
  onOpenModelSettings,
  t
}: UseWorkbenchSidebarAiSurfacePropsParams): AiPanelSurfaceProps =>
  useMemo(
    () => ({
      variant: "sidebar",
      desktopApi,
      settingsAiModel,
      locale: preferences.locale,
      title: t("ai.tabTitle"),
      aiPanelSide,
      onToggleAiPanelSide,
      onRequestProjectBind,
      onOpenProjectTree,
      onOpenSelfDevLab,
      onOpenOvernightLab,
      onOpenModelSettings,
      movePanelToLeftLabel: t("ai.movePanelToLeft"),
      movePanelToRightLabel: t("ai.movePanelToRight"),
      emptyThreadLabel: t("ai.startBySending"),
    }),
    [
      aiPanelSide,
      desktopApi,
      settingsAiModel,
      onToggleAiPanelSide,
      onRequestProjectBind,
      onOpenProjectTree,
      onOpenSelfDevLab,
      onOpenOvernightLab,
      onOpenModelSettings,
      preferences.locale,
      t,
    ]
  );
