import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";

export type AiPanelSurfaceVariant = "sidebar" | "workspace" | "detached";
export type AiPanelSide = "left" | "right";

export type AiPanelSurfaceProps = {
  readonly variant: AiPanelSurfaceVariant;
  readonly desktopApi: LyraDesktopApi | null;
  readonly locale?: WorkbenchLocale;
  readonly title: string;
  readonly emptyThreadLabel: string;
  readonly aiPanelSide?: AiPanelSide;
  readonly onToggleAiPanelSide?: () => void;
  readonly movePanelToLeftLabel?: string;
  readonly movePanelToRightLabel?: string;
};

export type AiPanelAppId = never;
export type AiPanelAppIconKey = "ai-panel-default";
