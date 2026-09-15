import type { JsonValue } from "@lyra/app-runtime";

import type { AgentSessionSnapshot } from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { WorkspaceAppTabMetaRequest, WorkspaceAppTabOpenRequest } from "../workspace-tabs";

export type AgentSubagentAppId = "agent-subagent";
export type AgentSubagentAppIconKey = "agent-subagent-default";

export type AgentSubagentOpaqueState = {
  readonly parentSessionId: string;
  readonly subagentId: string;
  readonly planId?: string | null;
};

export type AgentSubagentAppState = {
  readonly instanceId: string;
  readonly parentSessionId: string;
  readonly subagentId: string;
  readonly planId: string | null;
  readonly title: string;
};

export type AgentSubagentLabels = {
  readonly title: string;
  readonly loading: string;
  readonly unavailable: string;
  readonly readOnly: string;
};

export type AgentSubagentOpenRequest = {
  readonly parentSessionId: string;
  readonly subagentId: string;
  readonly planId?: string | null;
  readonly title?: string;
};

export type AgentSubagentModel = {
  readonly getState: (instanceId: string) => AgentSubagentAppState | null;
  readonly ensureInstance: (
    instanceId: string,
    options: {
      readonly parentSessionId: string;
      readonly subagentId: string;
      readonly planId?: string | null;
      readonly title?: string;
    }
  ) => void;
  readonly syncTabInstances: (instanceIds: readonly string[]) => void;
};

export type AgentSubagentSurfaceProps = {
  readonly labels: AgentSubagentLabels;
  readonly state: AgentSubagentAppState;
  readonly desktopApi: LyraDesktopApi | null;
  readonly onOpenFile?: (filePath: string) => void;
  readonly onOpenUrl?: (url: string, title?: string) => void;
  readonly onRevealPath?: (filePath: string) => void;
  readonly onOpenSubagent?: (request: AgentSubagentOpenRequest) => void;
};

export type AgentSubagentAppRequest = WorkspaceAppTabOpenRequest;

export type AgentSubagentMetaRequest = WorkspaceAppTabMetaRequest;

export type AgentSubagentJsonState = JsonValue & AgentSubagentOpaqueState;

export type AgentSubagentLiveSnapshot = AgentSessionSnapshot;
