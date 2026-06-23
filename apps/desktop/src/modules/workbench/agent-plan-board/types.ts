import type {
  AgentPlanAnnotation,
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
  readonly save: string;
  readonly cancel: string;
  readonly commentPlaceholder: string;
  readonly editPlaceholder: string;
};

export type AgentPlanBoardAppState = {
  readonly instanceId: string;
  readonly agentSessionId: string;
  readonly title: string;
  readonly plan: AgentPlanSnapshot;
  readonly projectTodo: AgentProjectTodoSnapshot | null;
};

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
  readonly revisePlan: (
    instanceId: string,
    request: AgentPlanBoardRevisionRequest
  ) => Promise<void>;
  readonly syncTabInstances: (instanceIds: readonly string[]) => void;
};

export type AgentPlanBoardSurfaceProps = {
  readonly labels: AgentPlanBoardLabels;
  readonly state: AgentPlanBoardAppState;
  readonly onRevisePlan?: (request: AgentPlanBoardRevisionRequest) => Promise<void>;
};
