import type { McpServerConfig, McpServerRequest } from "../../../shared/mcp";

const createServerRequest = (server: McpServerConfig): McpServerRequest => ({
  serverId: server.id,
  scope: server.scope,
  ...(server.projectRoot === undefined ? {} : { projectRoot: server.projectRoot })
});

export const resolveServerRequest = (
  servers: readonly McpServerConfig[],
  serverId: string
): {
  readonly server: McpServerConfig;
  readonly request: McpServerRequest;
} => {
  const server = servers.find((entry) => entry.id === serverId);
  if (server === undefined) {
    throw new Error("MCP server not found");
  }
  return {
    server,
    request: createServerRequest(server)
  };
};
