import type { LyraAppManifest } from "@lyra/capability-protocol";

import type { LyraRuntimeClient } from "../../runtime-client";
import type { CapabilityRegistry } from "../registry";

const CODE_INTEL_APP_ID = "code-intel";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const readBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readStringArray = (value: unknown): readonly string[] | undefined => {
  if (Array.isArray(value) === false) {
    return undefined;
  }
  const normalized = value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => entry !== undefined);
  return normalized.length > 0 ? normalized : undefined;
};

const readRootHints = (
  payload: Record<string, unknown>,
  context: { readonly projectRoot?: string; readonly workspaceRoot?: string } | undefined
): {
  readonly projectRoot?: string;
  readonly roots?: readonly string[];
} => {
  const projectRoot = readString(payload.projectRoot)
    ?? context?.projectRoot
    ?? context?.workspaceRoot;
  const roots = readStringArray(payload.roots);
  return {
    ...(projectRoot === undefined ? {} : { projectRoot }),
    ...(roots === undefined ? {} : { roots })
  };
};

export const registerCodeIntelCapabilities = (
  registry: CapabilityRegistry,
  runtimeClient: LyraRuntimeClient,
  storageRoot: string
): LyraAppManifest => {
  registry.register(
    {
      id: "code.search.text",
      domain: "code",
      kind: "resource",
      title: "Search Code Text",
      appId: CODE_INTEL_APP_ID,
      operation: "search.text",
      description: "Search text across indexed code files using the local code index.",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          pattern: { type: "string" },
          projectRoot: { type: "string" },
          roots: { type: "array", items: { type: "string" } },
          path: { type: "string" },
          glob: { type: "string" },
          limit: { type: "number" },
          caseSensitive: { type: "boolean" },
          includeHidden: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const query = readString(payload.query) ?? readString(payload.pattern);
      if (query === undefined) {
        throw new Error("query is required");
      }
      const limit = readNumber(payload.limit);
      const includeHidden = readBoolean(payload.includeHidden);
      const caseSensitive = readBoolean(payload.caseSensitive);
      const glob = readString(payload.glob);
      const path = readString(payload.path);
      return await runtimeClient.request("code.search.text", {
        storageRoot,
        query,
        ...(path === undefined ? {} : { path }),
        ...(glob === undefined ? {} : { glob }),
        ...(limit === undefined ? {} : { limit }),
        ...(caseSensitive === undefined ? {} : { caseSensitive }),
        ...(includeHidden === undefined ? {} : { includeHidden }),
        ...readRootHints(payload, request.context)
      });
    }
  );

  registry.register(
    {
      id: "code.search.symbol",
      domain: "code",
      kind: "resource",
      title: "Search Code Symbols",
      appId: CODE_INTEL_APP_ID,
      operation: "search.symbol",
      description: "Search symbol definitions in the local code index.",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          symbol: { type: "string" },
          projectRoot: { type: "string" },
          roots: { type: "array", items: { type: "string" } },
          limit: { type: "number" },
          kind: { type: "string" },
          language: { type: "string" },
          includeHidden: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const query = readString(payload.query) ?? readString(payload.symbol);
      if (query === undefined) {
        throw new Error("query is required");
      }
      const limit = readNumber(payload.limit);
      const kind = readString(payload.kind);
      const language = readString(payload.language);
      const includeHidden = readBoolean(payload.includeHidden);
      return await runtimeClient.request("code.search.symbol", {
        storageRoot,
        query,
        ...(limit === undefined ? {} : { limit }),
        ...(kind === undefined ? {} : { kind }),
        ...(language === undefined ? {} : { language }),
        ...(includeHidden === undefined ? {} : { includeHidden }),
        ...readRootHints(payload, request.context)
      });
    }
  );

  registry.register(
    {
      id: "code.graph.expand",
      domain: "code",
      kind: "resource",
      title: "Expand Symbol Graph",
      appId: CODE_INTEL_APP_ID,
      operation: "graph.expand",
      description: "Expand definition-reference graph around a symbol using the local code index.",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          query: { type: "string" },
          projectRoot: { type: "string" },
          roots: { type: "array", items: { type: "string" } },
          depth: { type: "number" },
          limit: { type: "number" },
          includeHidden: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const symbol = readString(payload.symbol) ?? readString(payload.query);
      if (symbol === undefined) {
        throw new Error("symbol is required");
      }
      const depth = readNumber(payload.depth);
      const limit = readNumber(payload.limit);
      const includeHidden = readBoolean(payload.includeHidden);
      return await runtimeClient.request("code.graph.expand", {
        storageRoot,
        symbol,
        ...(depth === undefined ? {} : { depth }),
        ...(limit === undefined ? {} : { limit }),
        ...(includeHidden === undefined ? {} : { includeHidden }),
        ...readRootHints(payload, request.context)
      });
    }
  );

  registry.register(
    {
      id: "code.index.status",
      domain: "code",
      kind: "resource",
      title: "Read Code Index Status",
      appId: CODE_INTEL_APP_ID,
      operation: "index.status",
      description: "Read current status of the local code index.",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async () => await runtimeClient.request("code.index.status", { storageRoot })
  );

  registry.register(
    {
      id: "code.index.rebuild",
      domain: "code",
      kind: "action",
      title: "Rebuild Code Index",
      appId: CODE_INTEL_APP_ID,
      operation: "index.rebuild",
      description: "Rebuild local code index for the selected workspace roots.",
      permissions: ["filesystem:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "read",
      inputSchema: {
        type: "object",
        properties: {
          projectRoot: { type: "string" },
          roots: { type: "array", items: { type: "string" } },
          includeHidden: { type: "boolean" },
          force: { type: "boolean" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const includeHidden = readBoolean(payload.includeHidden);
      const force = readBoolean(payload.force);
      return await runtimeClient.request("code.index.rebuild", {
        storageRoot,
        ...(includeHidden === undefined ? {} : { includeHidden }),
        ...(force === undefined ? {} : { force }),
        ...readRootHints(payload, request.context)
      });
    }
  );

  return {
    id: CODE_INTEL_APP_ID,
    title: "Code Intel",
    version: "0.1.0",
    source: "builtin",
    permissions: ["filesystem:read"],
    capabilities: [
      "code.search.text",
      "code.search.symbol",
      "code.graph.expand",
      "code.index.status",
      "code.index.rebuild"
    ],
    compatibility: {
      minApiVersion: "0.1.0",
      platforms: ["macos", "windows", "linux"]
    },
    contributes: {
      surfaces: ["workspace"]
    }
  };
};
