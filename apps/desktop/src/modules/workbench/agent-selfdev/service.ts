import type { WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type { AgentSelfDevAppIconKey } from "./types";

export const AGENT_SELFDEV_APP_ID = "agent-selfdev" as const;
export const AGENT_SELFDEV_INSTANCE_ID = "agent-selfdev" as const;
export const AGENT_SELFDEV_ICON_KEY = "agent-selfdev-default" as const satisfies AgentSelfDevAppIconKey;

export const createAgentSelfDevAppRequest = (
  title: string,
  parentSessionId: string | null
): WorkspaceAppTabOpenRequest => {
  const trimmedParentSessionId = parentSessionId?.trim() ?? "";
  return {
    appId: AGENT_SELFDEV_APP_ID,
    appInstanceId: AGENT_SELFDEV_INSTANCE_ID,
    title,
    iconKey: AGENT_SELFDEV_ICON_KEY,
    ...(trimmedParentSessionId.length === 0
      ? {}
      : { fileSessionId: trimmedParentSessionId })
  };
};

export type { AgentSelfDevAppIconKey };
