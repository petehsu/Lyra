import type { WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type { AgentOvernightAppIconKey } from "./types";

export const AGENT_OVERNIGHT_APP_ID = "agent-overnight" as const;
export const AGENT_OVERNIGHT_INSTANCE_ID = "agent-overnight" as const;
export const AGENT_OVERNIGHT_ICON_KEY =
  "agent-overnight-default" as const satisfies AgentOvernightAppIconKey;

export const createAgentOvernightAppRequest = (
  title: string,
  parentSessionId: string | null
): WorkspaceAppTabOpenRequest => {
  const trimmedParentSessionId = parentSessionId?.trim() ?? "";
  return {
    appId: AGENT_OVERNIGHT_APP_ID,
    appInstanceId: AGENT_OVERNIGHT_INSTANCE_ID,
    title,
    iconKey: AGENT_OVERNIGHT_ICON_KEY,
    ...(trimmedParentSessionId.length === 0
      ? {}
      : { fileSessionId: trimmedParentSessionId })
  };
};

export type { AgentOvernightAppIconKey };
