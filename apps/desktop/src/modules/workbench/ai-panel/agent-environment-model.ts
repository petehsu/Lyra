import type {
  AgentExecutionTarget,
  AgentPermissionMode
} from "./agent-ui-types";

export type AgentEnvironmentState = {
  readonly permissionMode: AgentPermissionMode;
  readonly executionTarget: AgentExecutionTarget;
};

export const DEFAULT_AGENT_ENVIRONMENT: AgentEnvironmentState = {
  permissionMode: "sandbox",
  executionTarget: "host",
};

export const AGENT_PERMISSION_MODE_OPTIONS = [
  { value: "sandbox", label: "Sandbox" },
  { value: "full_access", label: "Full Access" },
] as const satisfies readonly {
  readonly value: AgentPermissionMode;
  readonly label: string;
}[];

export const AGENT_EXECUTION_TARGET_OPTIONS = [
  { value: "host", label: "Host" },
  { value: "agent_vm", label: "Agent VM" },
] as const satisfies readonly {
  readonly value: AgentExecutionTarget;
  readonly label: string;
}[];
