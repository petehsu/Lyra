import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  McpCatalogItem,
  McpCreateServerRequest,
  McpDeleteServerRequest,
  McpEffectiveConfig,
  McpEffectiveServerConfig,
  McpEnvironmentEntry,
  McpEnvironmentInput,
  McpInstallKind,
  McpInstallTemplateRequest,
  McpIntrospectionItem,
  McpIntrospectionSnapshot,
  McpReadEffectiveServersRequest,
  McpReadServersRequest,
  McpRuntimeEvent,
  McpRuntimePhase,
  McpRuntimeStatus,
  McpScope,
  McpServerConfig,
  McpServerRequest,
  McpTransport,
  McpUpdateServerRequest,
  McpValidationResult
} from "../../shared/mcp";
import type {
  McpIpcBridge,
  McpToolCallRequest,
  McpToolCallResult,
  PersistedMcpEnvironmentEntry,
  PersistedMcpScopeDocument,
  PersistedMcpSecretStore,
  PersistedMcpServerConfig
} from "./types";
import type { FilesNativeBindings } from "../files/types";
import { createWorkbenchFsPort, type WorkbenchFsPort } from "../runtime/workbench-fs-port";
import type { LyraRuntimeClient } from "../runtime-client";

const MCP_STORAGE_VERSION = 1;
const MCP_DEFAULT_ICON_KEY = "custom-command";
const MCP_SCOPE_GLOBAL: McpScope = "global";
const MCP_SCOPE_PROJECT: McpScope = "project";

const MCP_CATALOG: readonly McpCatalogItem[] = [
  {
    id: "filesystem",
    title: "Filesystem",
    summary: "Expose bounded local folders to Lyra AI.",
    description: "Recommended when Lyra needs controlled read or write access to project files.",
    iconKey: "filesystem",
    official: true,
    transports: ["stdio"],
    installKind: "npm",
    recommendedScope: "project",
    defaultCommand: "npx",
    defaultArgs: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    defaultEnvironment: [],
    permissions: ["filesystem:project-root"],
    tools: [
      createReadOnlyTool(
        "read_file",
        "Read text file contents.",
        {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string" }
          },
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            content: { type: "string" }
          }
        }
      ),
      createWorkspaceWriteTool(
        "write_file",
        "Write or patch local files.",
        {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string" },
            content: { type: "string" }
          },
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            ok: { type: "boolean" }
          }
        }
      ),
      createReadOnlyTool(
        "list_directory",
        "Enumerate directory entries.",
        {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string" }
          },
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            entries: { type: "array" }
          }
        }
      )
    ],
    resources: [{ name: "workspace-tree", description: "Project directory snapshot." }],
    prompts: [],
    quickSetup: {
      fields: [
        {
          id: "rootPath",
          kind: "path",
          required: true,
          preferProjectRoot: true
        }
      ]
    }
  },
  {
    id: "fetch",
    title: "Fetch",
    summary: "Let Lyra fetch and summarize remote HTTP content.",
    description: "Useful for reading web pages or APIs through a single controlled server.",
    iconKey: "fetch",
    official: true,
    transports: ["stdio"],
    installKind: "npm",
    recommendedScope: "global",
    defaultCommand: "npx",
    defaultArgs: ["-y", "@modelcontextprotocol/server-fetch"],
    defaultEnvironment: [],
    permissions: ["network:http"],
    tools: [
      createNetworkReadTool(
        "fetch",
        "Fetch remote URLs with server-side controls.",
        {
          type: "object",
          required: ["url"],
          properties: {
            url: { type: "string" },
            method: { type: "string" }
          },
          additionalProperties: true
        },
        {
          type: "object",
          properties: {
            status: { type: "number" },
            body: { type: "string" }
          }
        }
      )
    ],
    resources: [],
    prompts: []
  },
  {
    id: "git",
    title: "Git",
    summary: "Expose repository state, history, and diffs to Lyra AI.",
    description: "Best used in project scope so the server is anchored to one repository.",
    iconKey: "git",
    official: true,
    transports: ["stdio"],
    installKind: "npm",
    recommendedScope: "project",
    defaultCommand: "npx",
    defaultArgs: ["-y", "@modelcontextprotocol/server-git", "."],
    defaultEnvironment: [],
    permissions: ["git:repo"],
    tools: [
      createReadOnlyTool(
        "git_status",
        "Read repository working tree status.",
        {
          type: "object",
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            files: { type: "array" }
          }
        }
      ),
      createReadOnlyTool(
        "git_diff",
        "Inspect working tree or commit diffs.",
        {
          type: "object",
          properties: {
            revision: { type: "string" }
          },
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            diff: { type: "string" }
          }
        }
      )
    ],
    resources: [{ name: "repo-head", description: "Current HEAD reference." }],
    prompts: [],
    quickSetup: {
      fields: [
        {
          id: "repoPath",
          kind: "path",
          required: true,
          preferProjectRoot: true
        }
      ]
    }
  },
  {
    id: "time",
    title: "Time",
    summary: "Provide timezone-aware time queries for automation and planning.",
    description: "A lightweight helper server for scheduling or date-sensitive prompts.",
    iconKey: "clock",
    official: true,
    transports: ["stdio"],
    installKind: "npm",
    recommendedScope: "global",
    defaultCommand: "npx",
    defaultArgs: ["-y", "@modelcontextprotocol/server-time"],
    defaultEnvironment: [],
    permissions: [],
    tools: [
      createReadOnlyTool(
        "time_now",
        "Read current date and time.",
        {
          type: "object",
          properties: {
            timezone: { type: "string" }
          },
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            iso: { type: "string" }
          }
        }
      )
    ],
    resources: [],
    prompts: [],
    quickSetup: {
      fields: [
        {
          id: "timezone",
          kind: "text",
          required: false
        }
      ]
    }
  },
  {
    id: "python-runner",
    title: "Python Runner",
    summary: "Run a Python-based MCP server through uv-managed runtime.",
    description: "A reference preset for uvx-based custom Python MCP servers.",
    iconKey: "python",
    official: false,
    transports: ["stdio"],
    installKind: "uv",
    recommendedScope: "project",
    defaultCommand: "uvx",
    defaultArgs: ["mcp-server-python"],
    defaultEnvironment: [],
    permissions: ["runtime:python"],
    tools: [],
    resources: [],
    prompts: []
  }
];

const isScope = (value: unknown): value is McpScope =>
  value === MCP_SCOPE_GLOBAL || value === MCP_SCOPE_PROJECT;

const isTransport = (value: unknown): value is McpTransport =>
  value === "stdio" || value === "sse" || value === "http";

const isInstallKind = (value: unknown): value is McpInstallKind =>
  value === "npm" ||
  value === "uv" ||
  value === "docker" ||
  value === "binary" ||
  value === "manual";

const nowIso = (): string => new Date().toISOString();

const createId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const MCP_DEFAULT_TOOL_TIMEOUT_MS = 60_000;

function createReadOnlyTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>
): McpIntrospectionItem {
  return {
  name,
  description,
  inputSchema,
  outputSchema,
  executionMode: "parallel_readonly",
  approvalMode: "auto",
  sideEffects: {
    level: "read_only",
    mutatesWorkspace: false,
    mutatesMemory: false,
    mutatesExternalSystems: false,
    mutatesSessionState: false,
    opensInteractiveSession: false,
    readsNetwork: false
  }
  };
}

function createWorkspaceWriteTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>
): McpIntrospectionItem {
  return {
  name,
  description,
  inputSchema,
  outputSchema,
  executionMode: "serial",
  approvalMode: "ask",
  sideEffects: {
    level: "workspace_write",
    mutatesWorkspace: true,
    mutatesMemory: false,
    mutatesExternalSystems: false,
    mutatesSessionState: false,
    opensInteractiveSession: false,
    readsNetwork: false
  }
  };
}

function createNetworkReadTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  outputSchema: Record<string, unknown>
): McpIntrospectionItem {
  return {
  name,
  description,
  inputSchema,
  outputSchema,
  executionMode: "parallel_readonly",
  approvalMode: "auto",
  sideEffects: {
    level: "network_read",
    mutatesWorkspace: false,
    mutatesMemory: false,
    mutatesExternalSystems: false,
    mutatesSessionState: false,
    opensInteractiveSession: false,
    readsNetwork: true
  }
  };
}

const trimOrUndefined = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeTitle = (value: unknown, fallback: string): string => {
  const trimmed = trimOrUndefined(value);
  return trimmed ?? fallback;
};

const normalizeArgs = (value: readonly string[] | undefined): readonly string[] => {
  if (Array.isArray(value) === false) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
};

const normalizeSetupValues = (
  value: Readonly<Record<string, string>> | undefined
): Readonly<Record<string, string>> => {
  if (value === undefined) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, rawValue]) => {
      if (typeof rawValue !== "string") {
        return [];
      }
      return [[key, rawValue.trim()]];
    })
  );
};

const createServerKey = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : `server-${randomUUID().slice(0, 8)}`;
};

const hashProjectRoot = (projectRoot: string): string =>
  createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);

const buildManagedServerDirectory = (
  storageRoot: string,
  installKind: McpInstallKind,
  serverKey: string
): string => path.join(storageRoot, "managed", installKind, serverKey);

const buildDefaultScopeDocument = (
  scope: McpScope,
  projectRoot?: string
): PersistedMcpScopeDocument => ({
  version: MCP_STORAGE_VERSION,
  scope,
  ...(projectRoot === undefined ? {} : { projectRoot }),
  servers: []
});

const resolveProjectRoot = (
  workbenchFsPort: WorkbenchFsPort,
  projectRootHint: string | undefined
): string | undefined => workbenchFsPort.probePath(projectRootHint)?.projectRoot;

const findCatalogItem = (templateId: string): McpCatalogItem => {
  const catalogItem = MCP_CATALOG.find((item) => item.id === templateId);
  if (catalogItem === undefined) {
    throw new Error(`unknown MCP template: ${templateId}`);
  }
  return catalogItem;
};

const defaultRuntimeStatus = (
  server: PersistedMcpServerConfig
): McpRuntimeStatus => ({
  serverId: server.id,
  phase: "stopped",
  transport: server.transport,
  updatedAt: server.updatedAt,
  ...(server.lastError === undefined ? {} : { message: server.lastError })
});

const collectSecretRefs = (
  entries: readonly PersistedMcpEnvironmentEntry[]
): readonly string[] =>
  entries.flatMap((entry) =>
    entry.mode === "secret" ? [entry.secretRefId] : []
  );

const withResolvedScope = (
  workbenchFsPort: WorkbenchFsPort,
  scope: McpScope,
  projectRootHint?: string
): { readonly scope: McpScope; readonly projectRoot?: string } => {
  if (scope === MCP_SCOPE_GLOBAL) {
    return { scope };
  }
  const projectRoot = resolveProjectRoot(workbenchFsPort, projectRootHint);
  if (projectRoot === undefined) {
    throw new Error("project scope is unavailable until Lyra can resolve a project root");
  }
  return {
    scope,
    projectRoot
  };
};


const buildCatalogIntrospection = (
  serverId: string,
  templateId: string | undefined
): McpIntrospectionSnapshot => {
  if (templateId === undefined) {
    return {
      serverId,
      fetchedAt: nowIso(),
      source: "none",
      note: "No MCP capability snapshot is available yet.",
      tools: [],
      resources: [],
      prompts: []
    };
  }

  const template = findCatalogItem(templateId);
  return {
    serverId,
    fetchedAt: nowIso(),
    source: "catalog",
    note: "Catalog fallback exposes curated MCP tool schemas and side-effect hints until live introspection is enabled.",
    tools: template.tools,
    resources: template.resources,
    prompts: template.prompts
  };
};


export const createMcpIpcBridge = (
  storageRoot: string,
  runtimeClient: LyraRuntimeClient,
  getWindow: () => BrowserWindow | null,
  filesNativeBindings: FilesNativeBindings
): McpIpcBridge => {
  const workbenchFsPort = createWorkbenchFsPort(filesNativeBindings);
  const requestRuntime = async <T>(method: string, payload?: unknown): Promise<T> =>
    await runtimeClient.request<T>(method, payload ?? {});

  const publishEvent = (event: McpRuntimeEvent): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.mcpEvent, event);
  };

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== "mcp.runtime") {
      return;
    }
    if (payload !== null && typeof payload === "object") {
      publishEvent(payload as McpRuntimeEvent);
      return;
    }
    const message =
      payload instanceof Error ? payload.message : `Unexpected MCP runtime payload: ${String(payload)}`;
    publishEvent({
      kind: "log",
      serverId: "lyrad",
      level: "error",
      message,
      timestamp: nowIso()
    });
  });

  const readSecretStorePort = async (): Promise<PersistedMcpSecretStore> => {
    return await requestRuntime<PersistedMcpSecretStore>("mcp.read_secret_store", {
      storageRoot
    });
  };

  const writeSecretStorePort = async (payload: PersistedMcpSecretStore): Promise<void> => {
    await requestRuntime<void>("mcp.write_secret_store", {
      storageRoot,
      store: payload
    });
  };

  const readRuntimeStatusesPort = async (): Promise<ReadonlyMap<string, McpRuntimeStatus>> =>
    new Map(
      (await requestRuntime<readonly McpRuntimeStatus[]>("mcp.read_runtime_statuses")).map(
        (status) => [status.serverId, status]
      )
    );

  const readScopeDocumentPort = async (
    scope: McpScope,
    projectRoot?: string
  ): Promise<PersistedMcpScopeDocument> => {
    return await requestRuntime<PersistedMcpScopeDocument>("mcp.read_scope_document", {
      storageRoot,
      scope,
      ...(projectRoot === undefined ? {} : { projectRoot })
    });
  };

  const writeScopeDocumentPort = async (
    payload: PersistedMcpScopeDocument
  ): Promise<void> => {
    await requestRuntime<void>("mcp.write_scope_document", {
      storageRoot,
      document: payload
    });
  };

  const sanitizeEnvironmentPort = (
    entries: readonly PersistedMcpEnvironmentEntry[],
    secretStore: PersistedMcpSecretStore
  ): Promise<readonly McpEnvironmentEntry[]> =>
    requestRuntime<readonly McpEnvironmentEntry[]>("mcp.sanitize_environment", {
      entries,
      secretStore
    });

  const decoratePersistedServer = (
    server: PersistedMcpServerConfig,
    secretStore: PersistedMcpSecretStore,
    runtimeStatuses: ReadonlyMap<string, McpRuntimeStatus>
  ): Promise<McpServerConfig> => sanitizeEnvironmentPort(server.environment, secretStore).then((environment) => ({
    ...server,
    environment,
    runtimeStatus: runtimeStatuses.get(server.id) ?? defaultRuntimeStatus(server)
  }));

  const normalizeEnvironmentInputPort = async (
    nextEntries: readonly McpEnvironmentInput[],
    previousEntries: readonly PersistedMcpEnvironmentEntry[]
  ): Promise<readonly PersistedMcpEnvironmentEntry[]> => {
    const secretStore = await readSecretStorePort();
    const timestamp = nowIso();
    const result = await requestRuntime<{
      readonly environment: readonly PersistedMcpEnvironmentEntry[];
      readonly secretStore: PersistedMcpSecretStore;
    }>("mcp.normalize_environment_input", {
      nextEntries: nextEntries.map((entry) => {
        if (entry.mode !== "secret") {
          return entry;
        }
        return {
          key: entry.key,
          mode: "secret" as const,
          ...(entry.secretRefId === undefined ? {} : { secretRefId: entry.secretRefId }),
          ...(entry.secretValue === undefined ? {} : { secretValue: entry.secretValue }),
          lastUpdatedAt: timestamp
        };
      }),
      previousEntries,
      secretStore,
      nowIso: timestamp
    });
    await writeSecretStorePort(result.secretStore);
    return result.environment;
  };

  const deleteSecretsForEnvironmentPort = async (
    entries: readonly PersistedMcpEnvironmentEntry[]
  ): Promise<void> => {
    const refs = collectSecretRefs(entries);
    if (refs.length === 0) {
      return;
    }
    const secretStore = await readSecretStorePort();
    const nextSecretStore = await requestRuntime<PersistedMcpSecretStore>(
      "mcp.delete_secret_refs",
      {
        secretStore,
        refs
      }
    );
    await writeSecretStorePort(nextSecretStore);
  };

  const mergeEffectiveConfigPort = async (
    resolvedProjectRoot: string | undefined,
    globalDocument: PersistedMcpScopeDocument,
    projectDocument: PersistedMcpScopeDocument
  ): Promise<McpEffectiveConfig> => {
    const secretStore = await readSecretStorePort();
    const runtimeStatuses = Array.from((await readRuntimeStatusesPort()).values());
    return await requestRuntime<McpEffectiveConfig>("mcp.merge_effective_config", {
      ...(resolvedProjectRoot === undefined ? {} : { resolvedProjectRoot }),
      globalDocument,
      projectDocument,
      secretStore,
      runtimeStatuses
    });
  };

  const writeManagedManifestPort = async (
    server: PersistedMcpServerConfig
  ): Promise<void> => {
    await requestRuntime<void>("mcp.write_managed_manifest", {
      storageRoot,
      server,
      generatedAt: nowIso()
    });
  };

  const validatePersistedServerPort = async (
    server: PersistedMcpServerConfig
  ): Promise<McpValidationResult> => {
    const secretStore = await readSecretStorePort();
    const availableExternalKeys = Object.entries(process.env)
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([key]) => key);
    return await requestRuntime<McpValidationResult>("mcp.validate_server", {
      server,
      checkedAt: nowIso(),
      secretStore,
      availableExternalKeys
    });
  };

  const createServerFromTemplatePort = (
    request: McpInstallTemplateRequest,
    catalogItem: McpCatalogItem,
    resolvedScope: { readonly scope: McpScope; readonly projectRoot?: string }
  ): Promise<PersistedMcpServerConfig> =>
    requestRuntime<PersistedMcpServerConfig>("mcp.create_server_from_template", {
      catalogItem,
      ...(request.title === undefined ? {} : { title: request.title }),
      ...(request.serverKey === undefined ? {} : { serverKey: request.serverKey }),
      setupValues: normalizeSetupValues(request.setupValues),
      ...(request.enabled === undefined ? {} : { enabled: request.enabled }),
      ...(request.autoStart === undefined ? {} : { autoStart: request.autoStart }),
      resolvedScope,
      nowIso: nowIso()
    });

  const readDecoratedScopeServers = async (
    scope: McpScope,
    projectRoot?: string
  ): Promise<readonly McpServerConfig[]> => {
    const resolvedScope = withResolvedScope(workbenchFsPort, scope, projectRoot);
    const secretStore = await readSecretStorePort();
    const runtimeStatuses = await readRuntimeStatusesPort();
    const document = await readScopeDocumentPort(resolvedScope.scope, resolvedScope.projectRoot);

    return await Promise.all(
      document.servers.map((server) =>
        decoratePersistedServer(server, secretStore, runtimeStatuses)
      )
    );
  };

  const resolvePersistedServer = async (
    request: McpServerRequest
  ): Promise<{
    readonly resolvedScope: { readonly scope: McpScope; readonly projectRoot?: string };
    readonly document: PersistedMcpScopeDocument;
    readonly server: PersistedMcpServerConfig;
  }> => {
    const resolvedScope = withResolvedScope(workbenchFsPort, request.scope, request.projectRoot);
    const document = await readScopeDocumentPort(resolvedScope.scope, resolvedScope.projectRoot);
    const server = document.servers.find((entry) => entry.id === request.serverId);
    if (server === undefined) {
      throw new Error(`MCP server not found: ${request.serverId}`);
    }
    return {
      resolvedScope,
      document,
      server
    };
  };

  const persistScopeServers = async (
    scope: McpScope,
    projectRoot: string | undefined,
    servers: readonly PersistedMcpServerConfig[]
  ): Promise<void> => {
    await writeScopeDocumentPort({
      version: MCP_STORAGE_VERSION,
      scope,
      ...(projectRoot === undefined ? {} : { projectRoot }),
      servers
    });
  };

  const decorateServer = async (server: PersistedMcpServerConfig): Promise<McpServerConfig> => {
    const secretStore = await readSecretStorePort();
    const runtimeStatuses = await readRuntimeStatusesPort();
    return await decoratePersistedServer(server, secretStore, runtimeStatuses);
  };

  const updatePersistedLastError = async (
    request: McpServerRequest,
    errorMessage: string | undefined
  ): Promise<void> => {
    try {
      const { resolvedScope, document, server } = await resolvePersistedServer(request);
      const nextServers = document.servers.map((entry) =>
        entry.id !== server.id
          ? entry
          : (() => {
              const { lastError: _previousLastError, ...rest } = entry;
              return {
                ...rest,
                updatedAt: nowIso(),
                ...(errorMessage === undefined ? {} : { lastError: errorMessage })
              };
            })()
      );
      await persistScopeServers(resolvedScope.scope, resolvedScope.projectRoot, nextServers);
    } catch (_error) {
      // Keep runtime alive even if persisting diagnostics fails.
    }
  };

  const buildAvailableExternalKeys = (): readonly string[] =>
    Object.entries(process.env)
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([key]) => key);

  const buildBaseEnvironment = (): NodeJS.ProcessEnv =>
    Object.fromEntries(
      Object.entries(process.env).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : []
      )
    );

  const startRuntimePort = async (
    request: McpServerRequest,
    server: PersistedMcpServerConfig
  ): Promise<McpServerConfig> => {
    const secretStore = await readSecretStorePort();
    const result = await requestRuntime<{
      readonly validation: McpValidationResult;
      readonly status: McpRuntimeStatus;
    }>("mcp.start_runtime", {
      server,
      checkedAt: nowIso(),
      secretStore,
      availableExternalKeys: buildAvailableExternalKeys(),
      baseEnv: buildBaseEnvironment(),
      introspectionSnapshot: buildCatalogIntrospection(server.id, server.templateId)
    });

    await updatePersistedLastError(
      request,
      result.validation.ok ? undefined : result.validation.summary
    );
    const decorated = decorateServer(server);
    if (result.validation.ok) {
      await syncMcpToolsToAgent(server);
    }
    return decorated;
  };

  const stopRuntimePort = async (
    server: PersistedMcpServerConfig,
    reason: string
  ): Promise<McpRuntimeStatus> => {
    const status = await requestRuntime<McpRuntimeStatus>("mcp.stop_runtime", {
      serverId: server.id,
      transport: server.transport,
      reason
    });
    await removeMcpToolsFromAgent(server.id);
    return status;
  };

  const restartRuntimePort = async (
    request: McpServerRequest,
    server: PersistedMcpServerConfig
  ): Promise<McpServerConfig> => {
    const secretStore = await readSecretStorePort();
    const result = await requestRuntime<{
      readonly validation: McpValidationResult;
      readonly status: McpRuntimeStatus;
    }>("mcp.restart_runtime", {
      server,
      checkedAt: nowIso(),
      secretStore,
      availableExternalKeys: buildAvailableExternalKeys(),
      baseEnv: buildBaseEnvironment(),
      introspectionSnapshot: buildCatalogIntrospection(server.id, server.templateId)
    });

    await updatePersistedLastError(
      request,
      result.validation.ok ? undefined : result.validation.summary
    );
    const decorated = decorateServer(server);
    if (result.validation.ok) {
      await syncMcpToolsToAgent(server);
    }
    return decorated;
  };

  const readRuntimeIntrospectionPort = async (
    server: PersistedMcpServerConfig
  ): Promise<McpIntrospectionSnapshot> => {
    const snapshot = await requestRuntime<McpIntrospectionSnapshot | null>(
      "mcp.read_runtime_introspection",
      {
        serverId: server.id,
        fallbackSnapshot: buildCatalogIntrospection(server.id, server.templateId)
      }
    );

    return snapshot ?? buildCatalogIntrospection(server.id, server.templateId);
  };

  // --- MCP ↔ Agent tool bridge ---

  const syncMcpToolsToAgent = async (server: PersistedMcpServerConfig): Promise<void> => {
    try {
      const snapshot = await readRuntimeIntrospectionPort(server);
      await requestRuntime("agent.mcp_bridge.sync", {
        server,
        tools: snapshot.tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          ...(t.inputSchema === undefined ? {} : { inputSchema: t.inputSchema }),
          ...(t.outputSchema === undefined ? {} : { outputSchema: t.outputSchema }),
          ...(t.executionMode === undefined ? {} : { executionMode: t.executionMode }),
          ...(t.approvalMode === undefined ? {} : { approvalMode: t.approvalMode }),
          ...(t.sideEffects === undefined ? {} : { sideEffects: t.sideEffects })
        }))
      });
    } catch {
      // Non-fatal: agent bridge sync failure should not break MCP lifecycle.
    }
  };

  const removeMcpToolsFromAgent = async (serverId: string): Promise<void> => {
    try {
      await requestRuntime("agent.mcp_bridge.remove", { serverId });
    } catch {
      // Non-fatal.
    }
  };

  const callToolPort = async (
    request: McpToolCallRequest
  ): Promise<McpToolCallResult> => {
    const { server } = await resolvePersistedServer(request);
    if (server.transport !== "stdio") {
      throw new Error(
        `MCP tool execution is currently supported only for stdio servers. ${server.id} uses ${server.transport}.`
      );
    }
    const toolName = trimOrUndefined(request.toolName);
    if (toolName === undefined) {
      throw new Error("toolName is required");
    }
    const snapshot = await readRuntimeIntrospectionPort(server);
    if (snapshot.tools.some((tool) => tool.name === toolName) === false) {
      throw new Error(`tool not found in MCP snapshot: ${toolName}`);
    }
    const toolArguments =
      request.arguments !== undefined
      && request.arguments !== null
      && Array.isArray(request.arguments) === false
      ? request.arguments
      : {};
    const timeoutMs =
      typeof request.timeoutMs === "number" && Number.isFinite(request.timeoutMs)
        ? Math.max(1_000, Math.round(request.timeoutMs))
        : MCP_DEFAULT_TOOL_TIMEOUT_MS;
    return await requestRuntime<McpToolCallResult>("mcp.call_tool", {
      server,
      toolName,
      arguments: toolArguments,
      timeoutMs,
      ...(request.aiSessionId === undefined ? {} : { aiSessionId: request.aiSessionId })
    });
  };

  const handlers: Array<readonly [string, (event: IpcMainInvokeEvent, payload?: unknown) => Promise<unknown>]> = [
    [
      LYRA_CHANNELS.mcpReadCatalog,
      async () => MCP_CATALOG
    ],
    [
      LYRA_CHANNELS.mcpReadServers,
      async (_event, payload) => {
        const request = payload as McpReadServersRequest;
        const scope = isScope(request.scope) ? request.scope : MCP_SCOPE_GLOBAL;
        return readDecoratedScopeServers(scope, request.projectRoot);
      }
    ],
    [
      LYRA_CHANNELS.mcpReadEffectiveServers,
      async (_event, payload) => {
        const request = (payload ?? {}) as McpReadEffectiveServersRequest;
        const resolvedProjectRoot = resolveProjectRoot(workbenchFsPort, request.projectRoot);
        const globalDocument = await readScopeDocumentPort(MCP_SCOPE_GLOBAL);
        const projectDocument =
          resolvedProjectRoot === undefined
            ? buildDefaultScopeDocument(MCP_SCOPE_PROJECT)
            : await readScopeDocumentPort(MCP_SCOPE_PROJECT, resolvedProjectRoot);

        return mergeEffectiveConfigPort(resolvedProjectRoot, globalDocument, projectDocument);
      }
    ],
    [
      LYRA_CHANNELS.mcpInstallTemplate,
      async (_event, payload) => {
        const request = payload as McpInstallTemplateRequest;
        const resolvedScope = withResolvedScope(
          workbenchFsPort,
          isScope(request.scope) ? request.scope : MCP_SCOPE_GLOBAL,
          request.projectRoot
        );
        const catalogItem = findCatalogItem(request.templateId);
        const document = await readScopeDocumentPort(resolvedScope.scope, resolvedScope.projectRoot);
        const nextServer = await createServerFromTemplatePort(request, catalogItem, resolvedScope);
        const existing = document.servers.find(
          (server) => server.serverKey === nextServer.serverKey
        );
        const persistedServer = existing ?? nextServer;
        const nextServers =
          existing === undefined
            ? [...document.servers, persistedServer]
            : document.servers;
        await persistScopeServers(resolvedScope.scope, resolvedScope.projectRoot, nextServers);
        await writeManagedManifestPort(persistedServer);
        return decorateServer(persistedServer);
      }
    ],
    [
      LYRA_CHANNELS.mcpCreateServer,
      async (_event, payload) => {
        const request = payload as McpCreateServerRequest;
        const resolvedScope = withResolvedScope(
          workbenchFsPort,
          isScope(request.scope) ? request.scope : MCP_SCOPE_GLOBAL,
          request.projectRoot
        );
        const timestamp = nowIso();
        const environment = await normalizeEnvironmentInputPort(request.environment, []);
        const description = trimOrUndefined(request.description);
        const command = trimOrUndefined(request.command);
        const cwd = trimOrUndefined(request.cwd);
        const url = trimOrUndefined(request.url);
        const nextServer: PersistedMcpServerConfig = {
          id: createId("mcp"),
          serverKey:
            trimOrUndefined(request.serverKey) ?? createServerKey(request.title),
          source: "custom",
          title: normalizeTitle(request.title, "Custom MCP"),
          summary: normalizeTitle(request.summary, "Custom MCP server"),
          ...(description === undefined ? {} : { description }),
          iconKey: normalizeTitle(request.iconKey, MCP_DEFAULT_ICON_KEY),
          scope: resolvedScope.scope,
          ...(resolvedScope.projectRoot === undefined
            ? {}
            : { projectRoot: resolvedScope.projectRoot }),
          transport: isTransport(request.transport) ? request.transport : "stdio",
          installKind: isInstallKind(request.installKind) ? request.installKind : "manual",
          ...(command === undefined ? {} : { command }),
          args: normalizeArgs(request.args),
          ...(cwd === undefined ? {} : { cwd }),
          ...(url === undefined ? {} : { url }),
          environment,
          permissions: request.permissions.filter((entry) => entry.trim().length > 0),
          enabled: request.enabled,
          autoStart: request.autoStart,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        const document = await readScopeDocumentPort(resolvedScope.scope, resolvedScope.projectRoot);
        await persistScopeServers(resolvedScope.scope, resolvedScope.projectRoot, [
          ...document.servers,
          nextServer
        ]);
        await writeManagedManifestPort(nextServer);
        return decorateServer(nextServer);
      }
    ],
    [
      LYRA_CHANNELS.mcpUpdateServer,
      async (_event, payload) => {
        const request = payload as McpUpdateServerRequest;
        const resolvedScope = withResolvedScope(
          workbenchFsPort,
          isScope(request.scope) ? request.scope : MCP_SCOPE_GLOBAL,
          request.projectRoot
        );
        const document = await readScopeDocumentPort(resolvedScope.scope, resolvedScope.projectRoot);
        const current = document.servers.find((server) => server.id === request.serverId);
        if (current === undefined) {
          throw new Error(`MCP server not found: ${request.serverId}`);
        }
        const nextEnvironment = await normalizeEnvironmentInputPort(request.environment, current.environment);
        const description = trimOrUndefined(request.description);
        const command = trimOrUndefined(request.command);
        const cwd = trimOrUndefined(request.cwd);
        const url = trimOrUndefined(request.url);
        const { description: _previousDescription, command: _previousCommand, cwd: _previousCwd, url: _previousUrl, lastError: _previousLastError, ...currentBase } =
          current;
        const nextServer: PersistedMcpServerConfig = {
          ...currentBase,
          serverKey:
            trimOrUndefined(request.serverKey) ?? current.serverKey,
          title: normalizeTitle(request.title, current.title),
          summary: normalizeTitle(request.summary, current.summary),
          ...(description === undefined ? {} : { description }),
          iconKey: normalizeTitle(request.iconKey, current.iconKey),
          transport: isTransport(request.transport) ? request.transport : current.transport,
          installKind: isInstallKind(request.installKind) ? request.installKind : current.installKind,
          ...(command === undefined ? {} : { command }),
          args: normalizeArgs(request.args),
          ...(cwd === undefined ? {} : { cwd }),
          ...(url === undefined ? {} : { url }),
          environment: nextEnvironment,
          permissions: request.permissions.filter((entry) => entry.trim().length > 0),
          enabled: request.enabled,
          autoStart: request.autoStart,
          updatedAt: nowIso()
        };
        await persistScopeServers(
          resolvedScope.scope,
          resolvedScope.projectRoot,
          document.servers.map((server) =>
            server.id === nextServer.id ? nextServer : server
          )
        );
        await stopRuntimePort(
          nextServer,
          "Configuration updated. Start the server again to apply changes."
        );
        await writeManagedManifestPort(nextServer);
        return decorateServer(nextServer);
      }
    ],
    [
      LYRA_CHANNELS.mcpDeleteServer,
      async (_event, payload) => {
        const request = payload as McpDeleteServerRequest;
        const { resolvedScope, document, server } = await resolvePersistedServer(request);
        await persistScopeServers(
          resolvedScope.scope,
          resolvedScope.projectRoot,
          document.servers.filter((entry) => entry.id !== server.id)
        );
        await deleteSecretsForEnvironmentPort(server.environment);
        await stopRuntimePort(server, "MCP server removed.");
        await rm(
          buildManagedServerDirectory(storageRoot, server.installKind, server.serverKey),
          { recursive: true, force: true }
        );
      }
    ],
    [
      LYRA_CHANNELS.mcpValidateServer,
      async (_event, payload) => {
        const request = payload as McpServerRequest;
        const { server } = await resolvePersistedServer(request);
        const result = await validatePersistedServerPort(server);
        publishEvent({
          kind: "validation",
          result
        });
        return result;
      }
    ],
    [
      LYRA_CHANNELS.mcpStartServer,
      async (_event, payload) => {
        const request = payload as McpServerRequest;
        const { server } = await resolvePersistedServer(request);
        return startRuntimePort(request, server);
      }
    ],
    [
      LYRA_CHANNELS.mcpStopServer,
      async (_event, payload) => {
        const request = payload as McpServerRequest;
        const { server } = await resolvePersistedServer(request);
        await stopRuntimePort(server, "Stopped by user.");
        return decorateServer(server);
      }
    ],
    [
      LYRA_CHANNELS.mcpRestartServer,
      async (_event, payload) => {
        const request = payload as McpServerRequest;
        const { server } = await resolvePersistedServer(request);
        return restartRuntimePort(request, server);
      }
    ],
    [
      LYRA_CHANNELS.mcpReadServerIntrospection,
      async (_event, payload) => {
        const request = payload as McpServerRequest;
        const { server } = await resolvePersistedServer(request);
        const snapshot = await readRuntimeIntrospectionPort(server);
        publishEvent({
          kind: "introspection",
          snapshot
        });
        return snapshot;
      }
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    readCatalog: () => MCP_CATALOG,
    readServers: async (scope: McpScope, projectRoot?: string) =>
      await readDecoratedScopeServers(scope, projectRoot),
    readEffectiveServers: async (request?: McpReadEffectiveServersRequest) => {
      const resolvedProjectRoot = resolveProjectRoot(workbenchFsPort, request?.projectRoot);
      const globalDocument = await readScopeDocumentPort(MCP_SCOPE_GLOBAL);
      const projectDocument =
        resolvedProjectRoot === undefined
          ? buildDefaultScopeDocument(MCP_SCOPE_PROJECT)
          : await readScopeDocumentPort(MCP_SCOPE_PROJECT, resolvedProjectRoot);

      return await mergeEffectiveConfigPort(
        resolvedProjectRoot,
        globalDocument,
        projectDocument
      );
    },
    readServerIntrospection: async (request: McpServerRequest) => {
      const { server } = await resolvePersistedServer(request);
      return await readRuntimeIntrospectionPort(server);
    },
    callTool: async (request: McpToolCallRequest) => await callToolPort(request),
    dispose: async () => {
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      unsubscribeRuntimeEvents();
    }
  };
};
