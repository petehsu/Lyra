import { ipcRenderer } from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type { AgentApi, AgentUsageStats } from "../../shared/agent";

type AgentUsageBridgeApi = Pick<AgentApi, "readUsageStats">;

export const createAgentUsageBridgeApi = (): AgentUsageBridgeApi => ({
  readUsageStats: (request) =>
    ipcRenderer.invoke(LYRA_CHANNELS.agentUsageRead, request) as Promise<AgentUsageStats>
});
