import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { AiProviderProfile } from "../../../shared/ai";
import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchAiStopBehavior } from "../preferences";
import type {
  AgentComposerWorkbenchTabMention,
} from "./agent-composer";
import type {
  PlanApprovalRequest,
  PlanInteractionResponse
} from "./agent-ui-types";

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

export type AiPanelSurfaceProps = {
  readonly variant: AiPanelSurfaceVariant;
  readonly desktopApi: LyraDesktopApi | null;
  readonly locale?: WorkbenchLocale;
  readonly title: string;
  readonly stopBehavior?: WorkbenchAiStopBehavior;
  readonly newSessionTitle: string;
  readonly defaultProfileId?: string | null;
  readonly defaultProviderId?: string | null;
  readonly defaultModelNames: readonly string[];
  readonly configuredProfiles?: readonly AiProviderProfile[];
  readonly onDefaultProfileSelect?: (profileId: string) => void | Promise<void>;
  readonly fileMentionFallbackRoots?: readonly string[];
  readonly workbenchTabMentions?: readonly AgentComposerWorkbenchTabMention[];
  readonly openHistoryLabel?: string;
  readonly openMcpLabel?: string;
  readonly openSkillsLabel?: string;
  readonly openPluginsLabel?: string;
  readonly bindProjectLabel?: string;
  readonly composeAriaLabel?: string;
  readonly composePlaceholder?: string;
  readonly composeSendLabel?: string;
  readonly emptyThreadLabel: string;
  readonly onOpenHistory?: () => void;
  readonly onOpenMcp?: () => void;
  readonly onOpenSkills?: () => void;
  readonly onOpenPlugins?: () => void;
  readonly aiPanelSide?: AiPanelSide;
  readonly onToggleAiPanelSide?: () => void;
  readonly movePanelToLeftLabel?: string;
  readonly movePanelToRightLabel?: string;
  readonly onRequestProjectBind?: (currentPath?: string) => Promise<string | null>;
};
