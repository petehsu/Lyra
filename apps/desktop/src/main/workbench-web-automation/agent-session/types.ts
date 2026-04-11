import type { WorkbenchBrowserAgentTargetInfo } from "../../../shared/desktop-bridge";

export type WorkbenchAgentWebSession = {
  readonly sessionKey: string;
  readonly agentSessionId: string;
  readonly agentTurnId: string;
  readonly tabId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly scanSessionId?: string;
  readonly currentTarget?: WorkbenchBrowserAgentTargetInfo;
  readonly lastFailureCode?: string;
};
