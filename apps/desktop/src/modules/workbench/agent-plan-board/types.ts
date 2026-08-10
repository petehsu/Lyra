import type {
  AgentPlanAnnotation,
  AgentProjectPlanSummary,
  AgentPlanSnapshot,
  AgentProjectTodoSnapshot
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { GlobalDialogModel } from "../global-dialog";

export type AgentPlanBoardAppId = "agent-plan-board";
export type AgentPlanBoardAppIconKey = "agent-plan-board-default";

/**
 * Which half of a plan/todo board is in focus. "both" keeps the combined
 * list+detail view (e.g. the header "Plans and Todos" entry); "plan" and
 * "todo" open a focused interface that shows only that side of the detail.
 */
export type AgentPlanBoardView = "plan" | "todo" | "both";

export type AgentPlanBoardLabels = {
  readonly title: string;
  readonly plan: string;
  readonly todo: string;
  readonly noTodo: string;
  readonly status: string;
  readonly phase: string;
  readonly version: string;
  readonly currentStep: string;
  readonly editLine: string;
  readonly commentLine: string;
  readonly manager: string;
  readonly openPlan: string;
  readonly deletePlan: string;
  readonly deleteConfirmTitle: string;
  readonly deleteConfirmDescription: string;
  readonly deleteConfirmAction: string;
  readonly noPlans: string;
  readonly resumePlan: string;
  readonly setAsideBadge: string;
  readonly updated: string;
  readonly loading: string;
  readonly refresh: string;
  readonly save: string;
  readonly cancel: string;
  readonly commentPlaceholder: string;
  readonly editPlaceholder: string;
  readonly tempChatTitle: string;
  readonly tempChatOpen: string;
  readonly tempChatPlaceholder: string;
  readonly tempChatSend: string;
  readonly tempChatClose: string;
  readonly tempChatApplyToPlan: string;
  readonly tempChatApplied: string;
  readonly tempChatExplainOnly: string;
  readonly tempChatBusy: string;
  readonly tempChatBridgeUnavailable: string;
  readonly tempChatStartFailed: string;
  readonly tempChatSendFailed: string;
  readonly tempChatApplyFailed: string;
};

export type AgentPlanBoardDetailState = {
  readonly mode: "detail";
  readonly instanceId: string;
  readonly agentSessionId: string;
  readonly title: string;
  readonly plan: AgentPlanSnapshot;
  readonly projectTodo: AgentProjectTodoSnapshot | null;
};

export type AgentPlanBoardManagerState = {
  readonly mode: "manager";
  readonly instanceId: string;
  readonly agentSessionId: string;
  readonly workingDir: string;
  readonly title: string;
  readonly view: AgentPlanBoardView;
  readonly projectKey: string | null;
  readonly plans: readonly AgentProjectPlanSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedPlan: AgentPlanSnapshot | null;
  readonly selectedProjectTodo: AgentProjectTodoSnapshot | null;
};

export type AgentPlanBoardAppState =
  | AgentPlanBoardDetailState
  | AgentPlanBoardManagerState;

export type AgentPlanBoardRevisionRequest = {
  readonly markdown: string;
  readonly annotations: readonly AgentPlanAnnotation[];
  readonly source: "user_edit" | "temp_chat" | "revision";
  readonly summary?: string | null;
};

export type AgentPlanBoardModel = {
  readonly getState: (instanceId: string) => AgentPlanBoardAppState | null;
  readonly ensureInstance: (
    instanceId: string,
    options: {
      readonly agentSessionId: string;
      readonly title?: string;
      readonly plan: AgentPlanSnapshot;
      readonly projectTodo?: AgentProjectTodoSnapshot | null;
    }
  ) => void;
  readonly ensureManagerInstance: (
    instanceId: string,
    options: {
      readonly agentSessionId: string;
      readonly workingDir: string;
      readonly title?: string;
      readonly view?: AgentPlanBoardView;
    }
  ) => void;
  readonly refreshManager: (instanceId: string) => Promise<void>;
  readonly openManagedPlan: (instanceId: string, planId: string) => Promise<void>;
  readonly deleteManagedPlan: (instanceId: string, planId: string) => Promise<void>;
  readonly revisePlan: (
    instanceId: string,
    request: AgentPlanBoardRevisionRequest
  ) => Promise<void>;
  readonly syncTabInstances: (instanceIds: readonly string[]) => void;
};

export type AgentPlanBoardSurfaceProps = {
  readonly labels: AgentPlanBoardLabels;
  readonly state: AgentPlanBoardAppState;
  readonly desktopApi: LyraDesktopApi | null;
  readonly onOpenManagedPlan?: (planId: string) => Promise<void>;
  readonly onDeleteManagedPlan?: (planId: string) => Promise<void>;
  readonly onRefreshManager?: () => Promise<void>;
  readonly onRevisePlan?: (request: AgentPlanBoardRevisionRequest) => Promise<void>;
  readonly openDialog?: GlobalDialogModel["openDialog"];
};
