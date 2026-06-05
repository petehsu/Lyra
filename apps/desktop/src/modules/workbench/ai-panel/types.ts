import type {
  AgentSessionCreateRequest,
  AgentSessionSnapshot
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { WorkbenchLocale } from "../i18n";
import type { SettingsAiModel } from "../settings-ai";
import type { AiPanelSessionTab } from "./session-tabs";

export type AiPanelSurfaceVariant = "sidebar" | "workspace" | "detached";
export type AiPanelSide = "left" | "right";

export type AiPanelSurfaceProps = {
  readonly variant: AiPanelSurfaceVariant;
  readonly desktopApi: LyraDesktopApi | null;
  readonly settingsAiModel?: SettingsAiModel;
  readonly activeSessionTabId?: string | null;
  readonly activeSessionId?: string | null;
  readonly onActiveSessionChange?: (sessionId: string) => void;
  readonly sessionTabs?: readonly AiPanelSessionTab[];
  readonly onActivateSessionTab?: (sessionId: string) => void;
  readonly onCloseSessionTab?: (sessionId: string) => void;
  readonly onReorderSessionTabs?: (sourceTabId: string, targetTabId: string) => void;
  readonly onCreateDraftSessionTab?: (request: AgentSessionCreateRequest) => void;
  readonly onCreateSessionTab?: (
    request: AgentSessionCreateRequest
  ) => Promise<AgentSessionSnapshot> | AgentSessionSnapshot;
  readonly onMissingSession?: (sessionId: string) => void;
  readonly onSessionSnapshotChange?: (snapshot: AgentSessionSnapshot) => void;
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
  readonly onOpenTerminalLiveSession?: (request: {
    readonly sessionId?: string | null;
    readonly terminalTabId?: string | null;
    readonly paneId?: string | null;
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
