import type {
  SidebarComposerMode,
  SidebarChangeApprovalLabels,
  SidebarChangeApprovalPanelViewModel,
  SidebarChangeApprovalView,
  SidebarComposerProps,
  SidebarQuestionPanelViewModel,
  SidebarComposerSubmitPayload
} from "../sidebar/types";
import type { ContextMenuOpenRequest } from "../context-menu";
import type { FileEditorLabels, FileEditorModel } from "../file-editor";
import type { FileManagerModel, FileManagerSurfaceLabels } from "../file-manager";
import type { TerminalDockLabels } from "../terminal-dock";
import type { TerminalThemePresetId } from "../terminal-theme";
import type { AiPanelMessage } from "./chat-types";
import type { AiComputerLabels } from "./computer";
import type { AiPanelQuestionFlowState } from "./question-flow";
import type { AiPanelRuntimeItem, AiPanelRuntimeLabels } from "./runtime";
import type {
  AiComputerHostStatus,
  AiComputerSessionState,
  AiComputerWindowFrame,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";

export type AiPanelAppId = "ai-panel" | "ai-mcp" | "ai-skills";

export type AiPanelAppIconKey =
  | "ai-panel-default"
  | "ai-panel-mcp"
  | "ai-panel-skills";

export type AiPanelAppOpenRequest = {
  readonly appId: AiPanelAppId;
  readonly appInstanceId: string;
  readonly title: string;
  readonly iconKey: AiPanelAppIconKey;
};

export type AiPanelSurfaceVariant = "sidebar" | "workspace";

export type AiPanelSessionId = string;
export type AiPanelSessionPlacement = "sidebar-draft" | "workspace-tab";

export type AiPanelHistoryItem = {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly summary: string;
  readonly isOpenInWorkspace?: boolean;
};

export type AiPanelSession = {
  readonly id: AiPanelSessionId;
  readonly title: string;
  readonly updatedAt: number;
  readonly historySummary: string;
  readonly mode: SidebarComposerMode;
  readonly activeTurnId: string | null;
  readonly placement: AiPanelSessionPlacement;
  readonly messages: readonly AiPanelMessage[];
  readonly isReplying: boolean;
  readonly quotedMessage: string | null;
  readonly questionFlow: AiPanelQuestionFlowState | null;
  readonly changeApprovalView: SidebarChangeApprovalView | null;
  readonly runtimeItems: readonly AiPanelRuntimeItem[];
  readonly activeRuntimeItemId: string | null;
};

export type AiPanelSessionViewModel = {
  readonly id: AiPanelSessionId;
  readonly title: string;
  readonly mode: SidebarComposerMode;
  readonly messages: readonly AiPanelMessage[];
  readonly isReplying: boolean;
  readonly quotedMessage: string | null;
  readonly questionPanel: SidebarQuestionPanelViewModel | null;
  readonly changeApprovalPanel: SidebarChangeApprovalPanelViewModel | null;
  readonly historyItems: readonly AiPanelHistoryItem[];
  readonly runtimeItems: readonly AiPanelRuntimeItem[];
  readonly activeRuntimeItemId: string | null;
};

export type AiPanelSessionStoreSnapshot = {
  readonly version: 1;
  readonly sidebarSessionId: AiPanelSessionId;
  readonly sessions: readonly AiPanelSession[];
};

export type AiPanelSurfaceProps = Omit<
  SidebarComposerProps,
  | "quotedMessage"
  | "defaultMode"
  | "isResponding"
  | "questionPanel"
  | "changeApprovalPanel"
  | "changeApprovalLabels"
  | "upperPanelTab"
  | "questionNavigateUpLabel"
  | "questionNavigateDownLabel"
  | "questionCloseLabel"
  | "questionCustomPlaceholder"
  | "questionSubmitCustomLabel"
  | "onQuestionNavigateUp"
  | "onQuestionNavigateDown"
  | "onQuestionClose"
  | "onQuestionSelectOption"
  | "onQuestionCustomDraftChange"
  | "onQuestionSubmitCustom"
  | "onUpperPanelTabChange"
  | "onChangeApprovalViewChange"
  | "onAcceptAllChanges"
  | "onOpenChangedFile"
  | "onModeChange"
  | "onRequestPause"
  | "onSendPayload"
> & {
  readonly variant: AiPanelSurfaceVariant;
  readonly sessionId: AiPanelSessionId;
  readonly sessionTitle: string;
  readonly composerMode: SidebarComposerMode;
  readonly messages: readonly AiPanelMessage[];
  readonly isReplying: boolean;
  readonly quotedMessage: string | null;
  readonly questionPanel?: SidebarQuestionPanelViewModel | null;
  readonly changeApprovalPanel?: SidebarChangeApprovalPanelViewModel | null;
  readonly changeApprovalLabels?: SidebarChangeApprovalLabels;
  readonly questionNavigateUpLabel?: string;
  readonly questionNavigateDownLabel?: string;
  readonly questionCloseLabel?: string;
  readonly questionCustomPlaceholder?: string;
  readonly questionSubmitCustomLabel?: string;
  readonly openHistoryLabel: string;
  readonly openMcpLabel: string;
  readonly openSkillsLabel: string;
  readonly historyTitle: string;
  readonly newConversationLabel: string;
  readonly openConversationLabel: string;
  readonly dropHintTitle: string;
  readonly dropHintDescription: string;
  readonly actionCopyLabel: string;
  readonly actionForkLabel: string;
  readonly actionUndoLabel: string;
  readonly actionEditLabel: string;
  readonly actionQuoteLabel: string;
  readonly actionAriaCopyUser: string;
  readonly actionAriaForkUser: string;
  readonly actionAriaUndoUser: string;
  readonly actionAriaEditUser: string;
  readonly actionAriaQuoteUser: string;
  readonly actionAriaCopyAssistant: string;
  readonly actionAriaQuoteAssistant: string;
  readonly historyWorkspaceBadgeLabel?: string;
  readonly taskCardOpenLabel: string;
  readonly taskCardCopyLabel: string;
  readonly taskCardCopiedLabel: string;
  readonly taskCardAcceptLabel: string;
  readonly taskCardRejectLabel: string;
  readonly taskCardUndoLabel: string;
  readonly onOpenMcp: () => void;
  readonly onOpenSkills: () => void;
  readonly runtimeItems?: readonly AiPanelRuntimeItem[];
  readonly activeRuntimeItemId?: string | null;
  readonly runtimeLabels?: AiPanelRuntimeLabels;
  readonly computerLabels?: AiComputerLabels;
  readonly computerState?: AiComputerSessionState | null;
  readonly computerHostStatus?: AiComputerHostStatus | null;
  readonly desktopApi?: LyraDesktopApi | null;
  readonly fileEditorModel?: FileEditorModel;
  readonly fileEditorLabels?: FileEditorLabels;
  readonly fileManagerModel?: FileManagerModel;
  readonly fileManagerLabels?: FileManagerSurfaceLabels;
  readonly terminalLabels?: TerminalDockLabels;
  readonly terminalThemeSignature?: string;
  readonly terminalThemePreset?: TerminalThemePresetId;
  readonly themeSignature?: string;
  readonly historyRevealToken?: number;
  readonly onSendSessionPayload: (
    sessionId: AiPanelSessionId,
    payload: SidebarComposerSubmitPayload,
    mode: SidebarComposerMode
  ) => void;
  readonly onPauseSession: (sessionId: AiPanelSessionId) => void;
  readonly onCloseQuestionPanel?: (sessionId: AiPanelSessionId) => void;
  readonly onQuestionNavigate?: (
    sessionId: AiPanelSessionId,
    direction: "up" | "down"
  ) => void;
  readonly onQuestionSelectOption?: (
    sessionId: AiPanelSessionId,
    questionId: string,
    optionId: string
  ) => void;
  readonly onQuestionCustomDraftChange?: (
    sessionId: AiPanelSessionId,
    questionId: string,
    value: string
  ) => void;
  readonly onQuestionSubmitCustom?: (
    sessionId: AiPanelSessionId,
    questionId: string
  ) => void;
  readonly onChangeApprovalViewChange?: (
    sessionId: AiPanelSessionId,
    view: SidebarChangeApprovalView
  ) => void;
  readonly onAcceptAllRuntimeFileChanges?: (sessionId: AiPanelSessionId) => void;
  readonly onOpenChangedFile?: (
    sessionId: AiPanelSessionId,
    filePath: string
  ) => void;
  readonly onComposerModeChange?: (
    sessionId: AiPanelSessionId,
    mode: SidebarComposerMode
  ) => void;
  readonly onSetQuotedMessage?: (
    sessionId: AiPanelSessionId,
    value: string | null
  ) => void;
  readonly onStartNewConversation?: () => void;
  readonly onOpenHistoryItem?: (sessionId: AiPanelSessionId) => void;
  readonly onOpenSessionInWorkspace?: () => void;
  readonly onActivateRuntimeItem?: (itemId: string) => void;
  readonly onOpenRuntimeItemInWorkspaceTab?: (filePath: string) => void;
  readonly onPowerOnComputer?: (sessionId: AiPanelSessionId) => void;
  readonly onPowerOffComputer?: (sessionId: AiPanelSessionId) => void;
  readonly onInstallOfficialSystem?: (sessionId: AiPanelSessionId) => void;
  readonly onOpenComputerApp?: (
    sessionId: AiPanelSessionId,
    request: {
      readonly kind: "file-manager" | "file-editor" | "terminal" | "browser";
      readonly title?: string;
      readonly appInstanceId?: string;
      readonly filePath?: string;
      readonly directoryPath?: string;
      readonly address?: string;
    }
  ) => void;
  readonly onFocusComputerApp?: (
    sessionId: AiPanelSessionId,
    appInstanceId: string
  ) => void;
  readonly onCloseComputerApp?: (
    sessionId: AiPanelSessionId,
    appInstanceId: string
  ) => void;
  readonly onMoveComputerAppWindow?: (
    sessionId: AiPanelSessionId,
    appInstanceId: string,
    frame: AiComputerWindowFrame
  ) => void;
  readonly onResizeComputerAppWindow?: (
    sessionId: AiPanelSessionId,
    appInstanceId: string,
    frame: AiComputerWindowFrame
  ) => void;
  readonly onMinimizeComputerApp?: (
    sessionId: AiPanelSessionId,
    appInstanceId: string
  ) => void;
  readonly onMaximizeComputerApp?: (
    sessionId: AiPanelSessionId,
    appInstanceId: string
  ) => void;
  readonly onRestoreComputerApp?: (
    sessionId: AiPanelSessionId,
    appInstanceId: string
  ) => void;
  readonly onAcceptRuntimeItem?: (itemId: string) => void;
  readonly onRejectRuntimeItem?: (itemId: string) => void;
  readonly onUndoRuntimeItem?: (itemId: string) => void;
  readonly topbarActionLabel?: string;
  readonly onTopbarAction?: () => void;
  readonly historyItems?: readonly AiPanelHistoryItem[];
  readonly onOpenMessageContextMenu?: (request: ContextMenuOpenRequest) => void;
};
