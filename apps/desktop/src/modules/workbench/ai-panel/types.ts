import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { FileEditorRevealLocation } from "../file-editor";
import type { WorkbenchLocale } from "../i18n";

export type AiPanelAppId = "ai-mcp" | "ai-skills" | "ai-history";

export type AiPanelAppIconKey =
  | "ai-panel-default"
  | "ai-panel-mcp"
  | "ai-panel-skills"
  | "ai-panel-history";

export type AiPanelAppOpenRequest = {
  readonly appId: AiPanelAppId;
  readonly appInstanceId: string;
  readonly title: string;
  readonly iconKey: AiPanelAppIconKey;
};

export type AiPanelSurfaceVariant = "sidebar" | "workspace" | "detached";

export type AiPanelWriteStreamEvent =
  | {
      readonly kind: "started";
      readonly sessionId: string;
      readonly turnId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly filePath: string;
      readonly timestamp: number;
      readonly created?: boolean;
      readonly baselineContent?: string;
    }
  | {
      readonly kind: "delta";
      readonly sessionId: string;
      readonly turnId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly filePath: string;
      readonly timestamp: number;
      readonly chunkText: string;
      readonly firstChangedLine?: number;
      readonly bytesWritten?: number;
      readonly bytesTotal?: number;
      readonly progress?: number;
    }
  | {
      readonly kind: "finished";
      readonly sessionId: string;
      readonly turnId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly filePath: string;
      readonly timestamp: number;
      readonly status: "completed" | "failed";
      readonly created?: boolean;
      readonly baselineContent?: string;
      readonly firstChangedLine?: number;
      readonly addedLines?: number;
      readonly removedLines?: number;
      readonly errorCode?: string;
      readonly errorMessage?: string;
    };

export type AiPanelSurfaceProps = {
  readonly variant: AiPanelSurfaceVariant;
  readonly desktopApi: LyraDesktopApi | null;
  readonly locale?: WorkbenchLocale;
  readonly title: string;
  readonly description: string;
  readonly themeSignature?: string;
  readonly richRenderingEnabled?: boolean;
  readonly newSessionTitle: string;
  readonly defaultProfileId?: string | null;
  readonly defaultProfileName: string | null;
  readonly defaultModelNames: readonly string[];
  readonly profileLabel: string;
  readonly modelLabel: string;
  readonly modelsLabel: string;
  readonly openHistoryLabel?: string;
  readonly openMcpLabel?: string;
  readonly openSkillsLabel?: string;
  readonly bindProjectLabel?: string;
  readonly composeAriaLabel?: string;
  readonly composePlaceholder?: string;
  readonly composeSendLabel?: string;
  readonly emptyStateTitle: string;
  readonly emptyStateDescription: string;
  readonly readOnlyBannerLabel: string;
  readonly loadingSessionLabel: string;
  readonly emptyThreadLabel: string;
  readonly turnNoToolCallsLabel: string;
  readonly turnWorkingLabel: string;
  readonly turnFailedLabel: string;
  readonly turnWorkedForPrefix: string;
  readonly runtimeQueuedLabel: string;
  readonly runtimeStartedLabel: string;
  readonly runtimeRunningPrefix: string;
  readonly runtimeCompletedPrefix: string;
  readonly runtimeFailedPrefix: string;
  readonly runtimeCompletedTurnLabel: string;
  readonly runtimeFailedTurnLabel: string;
  readonly runtimePhasePrefixLabel: string;
  readonly runtimePhaseIdleLabel: string;
  readonly runtimePhaseAcceptedLabel: string;
  readonly runtimePhaseStartedLabel: string;
  readonly runtimePhaseToolStartedLabel: string;
  readonly runtimePhaseToolFinishedLabel: string;
  readonly runtimePhaseCompletedLabel: string;
  readonly runtimePhaseFailedLabel: string;
  readonly runtimeToolFallbackLabel: string;
  readonly toolNameSearchLabel: string;
  readonly toolNameReadRangeLabel: string;
  readonly toolNameListLabel: string;
  readonly toolNameGlobLabel: string;
  readonly toolNameWriteLabel: string;
  readonly toolNameEditLabel: string;
  readonly toolNameMultiEditLabel: string;
  readonly toolStatusRunningLabel: string;
  readonly toolStatusCompletedLabel: string;
  readonly toolStatusFailedLabel: string;
  readonly onOpenFilePath?: (
    filePath: string,
    options?: {
      readonly forceReloadIfOpen?: boolean;
      readonly allowMissing?: boolean;
      readonly location?: FileEditorRevealLocation;
    }
  ) => void;
  readonly onWriteStreamEvent?: (event: AiPanelWriteStreamEvent) => void;
  readonly onTerminalExecStarted?: (
    command: string,
    cwd: string | undefined,
    toolCallId: string,
    turnId: string,
    sessionId: string
  ) => void;
  readonly onOpenHistory?: () => void;
  readonly onOpenMcp?: () => void;
  readonly onOpenSkills?: () => void;
  readonly onRequestProjectBind?: (currentPath?: string) => Promise<string | null>;
};
