import type {
  AgentFollowState,
  AgentMessage,
  AgentPermissionRespondRequest,
  AgentSessionSnapshot,
  AgentToolActivity
} from "../../../shared/agent";

export type AgentDecisionItem = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
};

export type AgentPermissionItem = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
};

export type DataProviderValue = {
  readonly session: AgentSessionSnapshot | null;
  readonly messages: readonly AgentMessage[];
  readonly toolGroups: readonly AgentToolActivity[];
  readonly todos: readonly string[];
  readonly diffFiles: readonly string[];
  readonly decisions: readonly AgentDecisionItem[];
  readonly permissions: readonly AgentPermissionItem[];
  readonly follow: AgentFollowState;
  readonly busy: boolean;
  readonly error: string | null;
  readonly sendMessage: (text: string) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly submitDecisions: (answers: Record<string, string>) => Promise<void>;
  readonly approvePermission: (
    permission: Omit<AgentPermissionRespondRequest, "sessionId" | "allowed">
  ) => Promise<void>;
  readonly denyPermission: (
    permission: Omit<AgentPermissionRespondRequest, "sessionId" | "allowed">
  ) => Promise<void>;
};

export const createEmptyDataProviderValue = (
  overrides: Pick<DataProviderValue, "sendMessage" | "cancel" | "submitDecisions" | "approvePermission" | "denyPermission">
): DataProviderValue => ({
  session: null,
  messages: [],
  toolGroups: [],
  todos: [],
  diffFiles: [],
  decisions: [],
  permissions: [],
  follow: { running: false, activity: null },
  busy: false,
  error: null,
  ...overrides
});
