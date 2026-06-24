import type {
  AgentPlanAnnotation,
  AgentProjectPlanSummary,
  AgentPlanSnapshot,
  AgentProjectTodoSnapshot
} from "../../../shared/agent";

export type AgentPlanBoardAppId = "agent-plan-board";
export type AgentPlanBoardAppIconKey = "agent-plan-board-default";

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
  readonly noPlans: string;
  readonly updated: string;
  readonly loading: string;
  readonly refresh: string;
  readonly save: string;
  readonly cancel: string;
  readonly commentPlaceholder: string;
  readonly editPlaceholder: string;
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
  readonly onOpenManagedPlan?: (planId: string) => Promise<void>;
  readonly onDeleteManagedPlan?: (planId: string) => Promise<void>;
  readonly onRefreshManager?: () => Promise<void>;
  readonly onRevisePlan?: (request: AgentPlanBoardRevisionRequest) => Promise<void>;
};
