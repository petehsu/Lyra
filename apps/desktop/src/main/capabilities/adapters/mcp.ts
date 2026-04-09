import type { LyraAppManifest } from "@lyra/capability-protocol";
import type { McpIpcBridge } from "../../mcp/types";
import type { CapabilityRegistry } from "../registry";

const MCP_APP_ID = "ai-mcp";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const readScope = (
  payload: Record<string, unknown>,
  contextProjectRoot?: string
): { readonly scope: "global" | "project"; readonly projectRoot?: string } => {
  const explicitScope = payload.scope === "project" || payload.scope === "global"
    ? payload.scope
    : undefined;
  const projectRoot = typeof payload.projectRoot === "string" && payload.projectRoot.trim().length > 0
    ? payload.projectRoot.trim()
    : undefined;
  if (explicitScope === "global") {
    return { scope: "global" };
  }
  const resolvedProjectRoot = projectRoot ?? contextProjectRoot;
  if (explicitScope === "project" || resolvedProjectRoot !== undefined) {
    return resolvedProjectRoot === undefined
      ? { scope: "project" }
      : { scope: "project", projectRoot: resolvedProjectRoot };
  }
  return { scope: "global" };
};

export const registerMcpCapabilities = (
  registry: CapabilityRegistry,
  bridge: McpIpcBridge
): LyraAppManifest => {
  registry.register(
    {
      id: "mcp.server.list",
      domain: "mcp",
      kind: "resource",
      title: "List MCP Servers",
      appId: MCP_APP_ID,
      operation: "server.list",
      permissions: ["mcp:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["global", "project"] },
          projectRoot: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const scope = readScope(payload, request.context?.projectRoot);
      return bridge.readEffectiveServers(scope.projectRoot === undefined ? {} : { projectRoot: scope.projectRoot });
    }
  );

  registry.register(
    {
      id: "mcp.resource.read",
      domain: "mcp",
      kind: "resource",
      title: "Read MCP Resource Snapshot",
      appId: MCP_APP_ID,
      operation: "resource.read",
      permissions: ["mcp:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        required: ["serverId"],
        properties: {
          serverId: { type: "string" },
          scope: { type: "string", enum: ["global", "project"] },
          projectRoot: { type: "string" },
          resourceName: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const serverId = typeof payload.serverId === "string" && payload.serverId.trim().length > 0
        ? payload.serverId.trim()
        : "";
      if (serverId.length === 0) {
        throw new Error("serverId is required");
      }
      const scope = readScope(payload, request.context?.projectRoot);
      const snapshot = await bridge.readServerIntrospection({
        serverId,
        scope: scope.scope,
        ...(scope.projectRoot === undefined ? {} : { projectRoot: scope.projectRoot })
      });
      const resourceName = typeof payload.resourceName === "string" && payload.resourceName.trim().length > 0
        ? payload.resourceName.trim()
        : undefined;
      return {
        serverId,
        resourceName: resourceName ?? null,
        resources: resourceName === undefined
          ? snapshot.resources
          : snapshot.resources.filter((resource) => resource.name === resourceName),
        fetchedAt: snapshot.fetchedAt,
        note: "MCP resource.read currently returns the runtime introspection snapshot, not live resource content."
      };
    }
  );

  registry.register(
    {
      id: "mcp.tool.call",
      domain: "mcp",
      kind: "action",
      title: "Call MCP Tool",
      appId: MCP_APP_ID,
      operation: "tool.call",
      permissions: ["mcp:invoke"],
      risk: "command",
      approvalMode: "ask",
      aiExposure: "full",
      inputSchema: {
        type: "object",
        required: ["serverId", "toolName"],
        properties: {
          serverId: { type: "string" },
          toolName: { type: "string" },
          arguments: { type: "object" },
          timeoutMs: { type: "number" },
          scope: { type: "string", enum: ["global", "project"] },
          projectRoot: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const serverId = typeof payload.serverId === "string" && payload.serverId.trim().length > 0
        ? payload.serverId.trim()
        : "";
      const toolName = typeof payload.toolName === "string" && payload.toolName.trim().length > 0
        ? payload.toolName.trim()
        : "";
      if (serverId.length === 0 || toolName.length === 0) {
        throw new Error("serverId and toolName are required");
      }
      const scope = readScope(payload, request.context?.projectRoot);
      const toolArguments =
        payload.arguments !== null
        && typeof payload.arguments === "object"
        && Array.isArray(payload.arguments) === false
          ? payload.arguments as Readonly<Record<string, unknown>>
          : {};
      const timeoutMs = typeof payload.timeoutMs === "number" && Number.isFinite(payload.timeoutMs)
        ? payload.timeoutMs
        : undefined;
      return await bridge.callTool({
        serverId,
        toolName,
        arguments: toolArguments,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
        scope: scope.scope,
        ...(scope.projectRoot === undefined ? {} : { projectRoot: scope.projectRoot }),
        ...(request.context?.aiSessionId === undefined
          ? {}
          : { aiSessionId: request.context.aiSessionId })
      });
    }
  );

  return {
    id: MCP_APP_ID,
    title: "MCP Center",
    version: "0.1.0",
    source: "builtin",
    permissions: ["mcp:read", "mcp:invoke"],
    capabilities: [
      "mcp.server.list",
      "mcp.resource.read",
      "mcp.tool.call"
    ],
    compatibility: {
      minApiVersion: "0.1.0",
      platforms: ["macos", "windows", "linux"]
    },
    contributes: {
      surfaces: ["workspace", "settings"]
    }
  };
};
