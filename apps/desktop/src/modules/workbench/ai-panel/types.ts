import type {
  LyraDesktopApi,
  PlanApprovalRequest,
  PlanInteractionResponse
} from "../../../shared/desktop-bridge";
import type { AiProviderProfile } from "../../../shared/ai";
import type { FileEditorRevealLocation } from "../file-editor";
import type { GlobalDialogOpenRequest } from "../global-dialog";
import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchNotificationPublishRequest } from "../notifications";
import type { WorkbenchAiStopBehavior } from "../preferences";
import type {
  AgentComposerWorkbenchTabMention,
} from "./agent-composer";

export type AiPanelAppId =
  | "ai-mcp"
  | "ai-skills"
  | "ai-plugins"
  | "ai-history"
  | "ai-plan-review";

export type AiPanelAppIconKey =
  | "ai-panel-default"
  | "ai-panel-mcp"
  | "ai-panel-skills"
  | "ai-panel-plugins"
  | "ai-panel-history"
  | "ai-panel-plan";

export type AiPanelAppOpenRequest = {
  readonly appId: AiPanelAppId;
  readonly appInstanceId: string;
  readonly title: string;
  readonly iconKey: AiPanelAppIconKey;
};

export type AiPanelSurfaceVariant = "sidebar" | "workspace" | "detached";

export type AiPanelSide = "left" | "right";

export type AiPlanApprovalWorkspaceOpenRequest = {
  readonly locale: WorkbenchLocale;
  readonly request: PlanApprovalRequest;
  readonly onDecision: (
    response: PlanInteractionResponse,
    requestOverride?: PlanApprovalRequest
  ) => Promise<void>;
};

export type AiPanelWriteStreamEvent =
  | {
      readonly kind: "started";
      readonly sessionId: string;
      readonly turnId: string;
      readonly toolCallId: string;
      readonly toolName: string;
      readonly filePath: string;
      readonly timestamp: number;
      readonly reveal?: boolean;
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
      readonly reveal?: boolean;
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
      readonly reveal?: boolean;
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
  readonly stopBehavior?: WorkbenchAiStopBehavior;
  readonly newSessionTitle: string;
  readonly defaultProfileId?: string | null;
  readonly defaultProviderId?: string | null;
  readonly defaultProfileName: string | null;
  readonly defaultModelNames: readonly string[];
  readonly configuredProfiles?: readonly AiProviderProfile[];
  readonly onDefaultProfileSelect?: (profileId: string) => void | Promise<void>;
  readonly fileMentionFallbackRoots?: readonly string[];
  readonly workbenchTabMentions?: readonly AgentComposerWorkbenchTabMention[];
  readonly profileLabel: string;
  readonly modelLabel: string;
  readonly modelsLabel: string;
  readonly openHistoryLabel?: string;
  readonly openMcpLabel?: string;
  readonly openSkillsLabel?: string;
  readonly openPluginsLabel?: string;
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
  readonly onAgentRuntimeNotification?: (request: WorkbenchNotificationPublishRequest) => void;
  readonly onOpenHistory?: () => void;
  readonly onOpenMcp?: () => void;
  readonly onOpenSkills?: () => void;
  readonly onOpenPlugins?: () => void;
  readonly onOpenPlanApprovalWorkspace?: (request: AiPlanApprovalWorkspaceOpenRequest) => void;
  readonly aiPanelSide?: AiPanelSide;
  readonly onToggleAiPanelSide?: () => void;
  readonly movePanelToLeftLabel?: string;
  readonly movePanelToRightLabel?: string;
  readonly onRequestProjectBind?: (currentPath?: string) => Promise<string | null>;
  readonly openDialog?: (request: GlobalDialogOpenRequest) => void;
};
