import type { WorkspaceAppTabOpenRequest } from "../workspace-tabs";

export const AGENT_SESSION_HISTORY_APP_ID = "agent-session-history" as const;
export const AGENT_SESSION_HISTORY_INSTANCE_ID = "agent-session-history" as const;
export const AGENT_SESSION_HISTORY_ICON_KEY = "agent-session-history-default" as const;

export const createAgentSessionHistoryAppRequest = (
  title: string
): WorkspaceAppTabOpenRequest => ({
  appId: AGENT_SESSION_HISTORY_APP_ID,
  appInstanceId: AGENT_SESSION_HISTORY_INSTANCE_ID,
  title,
  iconKey: AGENT_SESSION_HISTORY_ICON_KEY
});
