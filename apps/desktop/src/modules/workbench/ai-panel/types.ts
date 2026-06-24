import type { MutableRefObject } from "react";

import type {
  AgentSessionCreateRequest,
  AgentSessionSnapshot,
  AgentPlanSnapshot,
  AgentProjectTodoSnapshot
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { GlobalDialogModel } from "../global-dialog";
import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchLocationControls } from "../location";
import type { SettingsAiModel } from "../settings-ai";
import type { ComposerCitationSink } from "../shell/use-browser-page-context-menu";
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
  readonly onUpdateDraftWorkingDir?: (tabId: string, workingDir: string) => void;
  readonly onOpenProjectTree?: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void;
  readonly onOpenPlanBoard?: (request: {
    readonly sessionId: string;
    readonly plan: AgentPlanSnapshot;
    readonly projectTodo?: AgentProjectTodoSnapshot | null;
  }) => Promise<void> | void;
  readonly onOpenProjectPlanManager?: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void;
  readonly onRevealProjectPath?: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
    readonly path: string;
    readonly location?: { readonly line: number; readonly endLine?: number };
    readonly mode: "reveal" | "open-file";
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
  readonly onRevealPathInWorkbench?: ((filePath: string) => Promise<void> | void) | undefined;
  readonly openDialog?: GlobalDialogModel["openDialog"];
  readonly locale?: WorkbenchLocale;
  readonly aiRichRenderingEnabled?: boolean;
  readonly title: string;
  readonly emptyThreadLabel: string;
  readonly aiPanelSide?: AiPanelSide;
  readonly onToggleAiPanelSide?: () => void;
  readonly movePanelToLeftLabel?: string;
  readonly movePanelToRightLabel?: string;
  readonly composerCitationSinkRef?: MutableRefObject<ComposerCitationSink | null>;
  readonly onSetActiveBrowserTab?: (tabId: string) => void;
  readonly resolveActiveWorkspaceTab?: () => import("../workspace-tabs/types").WorkspaceTab | undefined;
  readonly onPickFileFromFileManager?: () => Promise<string | null>;
  readonly listWorkspaceTabs?: () => readonly import("../workspace-tabs/types").WorkspaceTab[];
  readonly listTerminalTabs?: () => readonly import("../terminal-dock/types").TerminalDockTab[];
  readonly locationControls?: WorkbenchLocationControls;
};

export type AiPanelAppId = never;
export type AiPanelAppIconKey = "ai-panel-default";
