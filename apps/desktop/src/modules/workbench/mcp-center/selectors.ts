import type { McpServerConfig } from "../../../shared/mcp";
import type { McpCenterState, McpCenterStatusFilter } from "./types";

const serverMatchesFilter = (
  server: McpServerConfig,
  runtimeByServerId: Readonly<Record<string, McpServerConfig["runtimeStatus"]>>,
  filter: McpCenterStatusFilter
): boolean => {
  if (filter === "all") {
    return true;
  }

  const runtimeStatus = runtimeByServerId[server.id] ?? server.runtimeStatus;
  if (filter === "running") {
    return runtimeStatus.phase === "running" || runtimeStatus.phase === "starting";
  }
  if (filter === "error") {
    return runtimeStatus.phase === "error";
  }
  return runtimeStatus.phase === "stopped";
};

export const selectVisibleMcpServers = (
  state: Pick<McpCenterState, "effectiveConfig" | "runtimeByServerId" | "statusFilter">
): readonly McpServerConfig[] =>
  state.effectiveConfig.servers.filter((server) =>
    serverMatchesFilter(server, state.runtimeByServerId, state.statusFilter)
  );
