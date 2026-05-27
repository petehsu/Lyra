import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";
import type { SettingsAiModel } from "../settings-ai";

export type AiPanelSurfaceVariant = "sidebar" | "workspace" | "detached";
export type AiPanelSide = "left" | "right";

export type AiPanelSurfaceProps = {
  readonly variant: AiPanelSurfaceVariant;
  readonly desktopApi: LyraDesktopApi | null;
  readonly settingsAiModel?: SettingsAiModel;
  readonly activeSessionId?: string | null;
  readonly onActiveSessionChange?: (sessionId: string) => void;
  readonly onRequestProjectBind?: (currentPath?: string) => Promise<string | null>;
  readonly onOpenProjectTree?: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void;
  readonly onOpenSelfDevLab?: (request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void;
  readonly onOpenOvernightLab?: (request: {
    readonly parentSessionId: string | null;
  }) => Promise<void> | void;
  readonly onOpenModelSettings?: () => Promise<void> | void;
  readonly onOpenUrlInWorkbench?: (request: {
    readonly url: string;
    readonly title?: string;
  }) => Promise<void> | void;
  readonly onOpenFile?: ((
    filePath: string,
    location?: { readonly line: number; readonly endLine?: number }
  ) => void) | undefined;
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
