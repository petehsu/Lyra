import type { WorkbenchAgentWebSessionRegistry } from "../agent-session/registry";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type { WorkbenchWebAutomationCallContext } from "../types";

export const readAgentSession = (
  agentSessions: WorkbenchAgentWebSessionRegistry,
  context: WorkbenchWebAutomationCallContext | undefined,
  tabId: string
): WorkbenchAgentWebSession | null => {
  if (!context?.agentSessionId || !context.agentTurnId) {
    return null;
  }
  return agentSessions.read(context.agentSessionId, context.agentTurnId, tabId);
};

export const pointerStateForContext = (
  agentSessions: WorkbenchAgentWebSessionRegistry,
  context: WorkbenchWebAutomationCallContext | undefined,
  tabId: string
): {} | {
  readonly pointerState: NonNullable<WorkbenchAgentWebSession["pointer"]>;
} => {
  const pointer = readAgentSession(agentSessions, context, tabId)?.pointer;
  return pointer === undefined ? {} : { pointerState: pointer };
};
