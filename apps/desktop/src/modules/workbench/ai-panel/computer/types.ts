import type {
  AiComputerAppKind,
  AiComputerHostStatus,
  AiComputerSessionState,
  AiComputerWindowFrame,
  LyraDesktopApi,
  LyraSystemResolvedSession
} from "../../../../shared/desktop-bridge";
import type {
  FileManagerModel,
  FileManagerSurfaceLabels
} from "../../file-manager";
import type {
  FileEditorLabels,
  FileEditorModel
} from "../../file-editor";
import type { TerminalDockLabels } from "../../terminal-dock";
import type { TerminalThemePresetId } from "../../terminal-theme";

export type AiComputerLabels = {
  readonly menuTitle: string;
  readonly menuHost: string;
  readonly menuState: string;
  readonly menuLyra: string;
  readonly menuFile: string;
  readonly menuEdit: string;
  readonly menuView: string;
  readonly menuWindow: string;
  readonly menuHelp: string;
  readonly stateOff: string;
  readonly stateBooting: string;
  readonly stateOn: string;
  readonly stateShuttingDown: string;
  readonly idleTitle: string;
  readonly idleDescription: string;
  readonly missingSystemTitle: string;
  readonly missingSystemDescription: string;
  readonly installOfficialSystem: string;
  readonly powerOn: string;
  readonly desktopHint: string;
  readonly desktopFiles: string;
  readonly desktopBrowser: string;
  readonly desktopTerminal: string;
  readonly desktopEditor: string;
  readonly desktopStandby: string;
  readonly desktopStatusReady: string;
  readonly launcher: string;
  readonly search: string;
  readonly taskbarTray: string;
  readonly dockNewWindow: string;
  readonly dockUnpin: string;
  readonly dockCloseAllWindows: string;
  readonly openInWorkspace: string;
  readonly browserPlaceholder: string;
  readonly browserSearchAction: string;
  readonly browserSearchPlaceholder: string;
  readonly terminalPlaceholder: string;
  readonly fileManagerTitle: string;
  readonly fileEditorTitle: string;
  readonly minimizeWindow: string;
  readonly maximizeWindow: string;
  readonly restoreWindow: string;
  readonly closeWindow: string;
};

export type AiComputerModel = {
  readonly hostStatus: AiComputerHostStatus | null;
  readonly getSessionState: (sessionId: string) => AiComputerSessionState | null;
  readonly externalFileManagerInstanceIds: readonly string[];
  readonly externalFileEditorInstanceIds: readonly string[];
  readonly readSession: (sessionId: string) => Promise<AiComputerSessionState | null>;
  readonly ensurePoweredOn: (
    sessionId: string,
    reason: "user" | "ai"
  ) => Promise<AiComputerSessionState | null>;
  readonly powerOn: (
    sessionId: string,
    reason: "user" | "ai"
  ) => Promise<AiComputerSessionState | null>;
  readonly powerOff: (sessionId: string) => Promise<AiComputerSessionState | null>;
  readonly openApp: (
    sessionId: string,
    request: {
      readonly kind: Exclude<AiComputerAppKind, "desktop">;
      readonly title?: string;
      readonly appInstanceId?: string;
      readonly filePath?: string;
      readonly directoryPath?: string;
      readonly address?: string;
    }
  ) => Promise<AiComputerSessionState | null>;
  readonly focusApp: (
    sessionId: string,
    appInstanceId: string
  ) => Promise<AiComputerSessionState | null>;
  readonly closeApp: (
    sessionId: string,
    appInstanceId: string
  ) => Promise<AiComputerSessionState | null>;
  readonly moveAppWindow: (
    sessionId: string,
    appInstanceId: string,
    frame: AiComputerWindowFrame
  ) => Promise<AiComputerSessionState | null>;
  readonly resizeAppWindow: (
    sessionId: string,
    appInstanceId: string,
    frame: AiComputerWindowFrame
  ) => Promise<AiComputerSessionState | null>;
  readonly minimizeApp: (
    sessionId: string,
    appInstanceId: string
  ) => Promise<AiComputerSessionState | null>;
  readonly maximizeApp: (
    sessionId: string,
    appInstanceId: string
  ) => Promise<AiComputerSessionState | null>;
  readonly restoreApp: (
    sessionId: string,
    appInstanceId: string
  ) => Promise<AiComputerSessionState | null>;
  readonly ensureOfficialSystemInstalled: (
    sessionId: string
  ) => Promise<LyraSystemResolvedSession | null>;
};

export type UseAiComputerModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly sessionIds: readonly string[];
};

export type AiPanelComputerSurfaceProps = {
  readonly sessionId: string;
  readonly labels: AiComputerLabels;
  readonly desktopApi: LyraDesktopApi | null;
  readonly computerState: AiComputerSessionState | null;
  readonly computerHostStatus: AiComputerHostStatus | null;
  readonly fileManagerModel: FileManagerModel;
  readonly fileManagerLabels: FileManagerSurfaceLabels;
  readonly fileEditorModel: FileEditorModel;
  readonly fileEditorLabels: FileEditorLabels;
  readonly terminalLabels: TerminalDockLabels;
  readonly terminalThemeSignature: string;
  readonly terminalThemePreset: TerminalThemePresetId;
  readonly uiThemeId: string;
  readonly onPowerOn: () => void;
  readonly onPowerOff: () => void;
  readonly onInstallOfficialSystem: () => void;
  readonly onOpenApp: (
    request: {
      readonly kind: Exclude<AiComputerAppKind, "desktop">;
      readonly title?: string;
      readonly appInstanceId?: string;
      readonly filePath?: string;
      readonly directoryPath?: string;
      readonly address?: string;
    }
  ) => void;
  readonly onFocusApp: (appInstanceId: string) => void;
  readonly onCloseApp: (appInstanceId: string) => void;
  readonly onMoveAppWindow: (appInstanceId: string, frame: AiComputerWindowFrame) => void;
  readonly onResizeAppWindow: (appInstanceId: string, frame: AiComputerWindowFrame) => void;
  readonly onMinimizeApp: (appInstanceId: string) => void;
  readonly onMaximizeApp: (appInstanceId: string) => void;
  readonly onRestoreApp: (appInstanceId: string) => void;
  readonly onOpenFileInWorkspace: (filePath: string) => void;
};
