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
  PersistedMcpEnvironmentEntry,
  PersistedMcpScopeDocument,
  PersistedMcpSecretStore,
  PersistedMcpServerConfig
} from "./types";
import type { FilesNativeBindings } from "../files/types";
import { createWorkbenchFsPort, type WorkbenchFsPort } from "../runtime/workbench-fs-port";
import { loadMcpNativeBindings } from "./native-loader";

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
      { name: "read_file", description: "Read text file contents." },
      { name: "write_file", description: "Write or patch local files." },
      { name: "list_directory", description: "Enumerate directory entries." }
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
      { name: "fetch", description: "Fetch remote URLs with server-side controls." }
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
      { name: "git_status", description: "Read repository working tree status." },
      { name: "git_diff", description: "Inspect working tree or commit diffs." }
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
    tools: [{ name: "time_now", description: "Read current date and time." }],
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
    id: "memory",
    title: "Memory",
    summary: "Persist lightweight structured memory for Lyra AI.",
    description: "Useful when you want long-lived scratch memory outside a single chat.",
    iconKey: "memory",
    official: true,
    transports: ["stdio"],
    installKind: "npm",
    recommendedScope: "global",
    defaultCommand: "npx",
    defaultArgs: ["-y", "@modelcontextprotocol/server-memory"],
    defaultEnvironment: [],
    permissions: ["storage:lyra-userdata"],
    tools: [
      { name: "memory_search", description: "Search saved memory entries." },
      { name: "memory_write", description: "Store a memory entry." }
    ],
    resources: [],
    prompts: []
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
    note: "V1 exposes curated capability hints until live MCP introspection is enabled.",
    tools: template.tools,
    resources: template.resources,
    prompts: template.prompts
  };
};


export const createMcpIpcBridge = (
  storageRoot: string,
  getWindow: () => BrowserWindow | null,
  filesNativeBindings: FilesNativeBindings
): McpIpcBridge => {
  const workbenchFsPort = createWorkbenchFsPort(filesNativeBindings);
  const nativeLoadResult = loadMcpNativeBindings();
  if (nativeLoadResult.ok === false) {
    throw new Error(
      `mcp native unavailable: ${nativeLoadResult.errorMessage}\ntried paths:\n${nativeLoadResult.triedPaths.join("\n")}`
    );
  }
  const nativeBindings = nativeLoadResult.bindings;

  const publishEvent = (event: McpRuntimeEvent): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.mcpEvent, event);
  };

  nativeBindings.registerMcpEventCallback((eventJson) => {
    try {
      publishEvent(JSON.parse(eventJson) as McpRuntimeEvent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publishEvent({
        kind: "log",
        serverId: "mcp-native",
        level: "error",
        message: `Failed to decode MCP runtime event: ${message}`,
        timestamp: nowIso()
      });
    }
  });

  const readSecretStorePort = async (): Promise<PersistedMcpSecretStore> => {
    return JSON.parse(
      nativeBindings.readMcpSecretStoreJson(
        JSON.stringify({
          storageRoot
        })
      )
    ) as PersistedMcpSecretStore;
  };

  const writeSecretStorePort = async (payload: PersistedMcpSecretStore): Promise<void> => {
    nativeBindings.writeMcpSecretStoreJson(
      JSON.stringify({
        storageRoot,
        store: payload
      })
    );
  };

  const readRuntimeStatusesPort = (): ReadonlyMap<string, McpRuntimeStatus> =>
    new Map(
      (
        JSON.parse(nativeBindings.readMcpRuntimeStatusesJson()) as readonly McpRuntimeStatus[]
      ).map((status) => [status.serverId, status])
    );

  const readScopeDocumentPort = async (
    scope: McpScope,
    projectRoot?: string
  ): Promise<PersistedMcpScopeDocument> => {
    return JSON.parse(
      nativeBindings.readMcpScopeDocumentJson(
        JSON.stringify({
          storageRoot,
          scope,
          ...(projectRoot === undefined ? {} : { projectRoot })
        })
      )
    ) as PersistedMcpScopeDocument;
  };

  const writeScopeDocumentPort = async (
    payload: PersistedMcpScopeDocument
  ): Promise<void> => {
    nativeBindings.writeMcpScopeDocumentJson(
      JSON.stringify({
        storageRoot,
        document: payload
      })
    );
  };

  const sanitizeEnvironmentPort = (
    entries: readonly PersistedMcpEnvironmentEntry[],
    secretStore: PersistedMcpSecretStore
  ): readonly McpEnvironmentEntry[] => {
    return JSON.parse(
      nativeBindings.sanitizeMcpEnvironmentJson(
        JSON.stringify({
          entries,
          secretStore
        })
      )
    ) as readonly McpEnvironmentEntry[];
  };

  const decoratePersistedServer = (
    server: PersistedMcpServerConfig,
    secretStore: PersistedMcpSecretStore,
    runtimeStatuses: ReadonlyMap<string, McpRuntimeStatus>
  ): McpServerConfig => ({
    ...server,
    environment: sanitizeEnvironmentPort(server.environment, secretStore),
    runtimeStatus: runtimeStatuses.get(server.id) ?? defaultRuntimeStatus(server)
  });

  const normalizeEnvironmentInputPort = async (
    nextEntries: readonly McpEnvironmentInput[],
    previousEntries: readonly PersistedMcpEnvironmentEntry[]
  ): Promise<readonly PersistedMcpEnvironmentEntry[]> => {
    const secretStore = await readSecretStorePort();
    const timestamp = nowIso();
    const result = JSON.parse(
      nativeBindings.normalizeMcpEnvironmentInputJson(
        JSON.stringify({
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
        })
      )
    ) as {
      readonly environment: readonly PersistedMcpEnvironmentEntry[];
      readonly secretStore: PersistedMcpSecretStore;
    };
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
    const nextSecretStore = JSON.parse(
      nativeBindings.deleteMcpSecretRefsJson(
        JSON.stringify({
          secretStore,
          refs
        })
      )
    ) as PersistedMcpSecretStore;
    await writeSecretStorePort(nextSecretStore);
  };

  const mergeEffectiveConfigPort = async (
    resolvedProjectRoot: string | undefined,
    globalDocument: PersistedMcpScopeDocument,
    projectDocument: PersistedMcpScopeDocument
  ): Promise<McpEffectiveConfig> => {
    const secretStore = await readSecretStorePort();
    const runtimeStatuses = Array.from(readRuntimeStatusesPort().values());
    return JSON.parse(
      nativeBindings.mergeMcpEffectiveConfigJson(
        JSON.stringify({
          ...(resolvedProjectRoot === undefined ? {} : { resolvedProjectRoot }),
          globalDocument,
          projectDocument,
          secretStore,
          runtimeStatuses
        })
      )
    ) as McpEffectiveConfig;
  };

  const writeManagedManifestPort = async (
    server: PersistedMcpServerConfig
  ): Promise<void> => {
    nativeBindings.writeMcpManagedManifestJson(
      JSON.stringify({
        storageRoot,
        server,
        generatedAt: nowIso()
      })
    );
  };

  const validatePersistedServerPort = async (
    server: PersistedMcpServerConfig
  ): Promise<McpValidationResult> => {
    const secretStore = await readSecretStorePort();
    const availableExternalKeys = Object.entries(process.env)
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([key]) => key);
    return JSON.parse(
      nativeBindings.validateMcpServerJson(
        JSON.stringify({
          server,
          checkedAt: nowIso(),
          secretStore,
          availableExternalKeys
        })
      )
    ) as McpValidationResult;
  };

  const createServerFromTemplatePort = (
    request: McpInstallTemplateRequest,
    catalogItem: McpCatalogItem,
    resolvedScope: { readonly scope: McpScope; readonly projectRoot?: string }
  ): PersistedMcpServerConfig =>
    JSON.parse(
      nativeBindings.createMcpServerFromTemplateJson(
        JSON.stringify({
          catalogItem,
          ...(request.title === undefined ? {} : { title: request.title }),
          ...(request.serverKey === undefined ? {} : { serverKey: request.serverKey }),
          setupValues: normalizeSetupValues(request.setupValues),
          ...(request.enabled === undefined ? {} : { enabled: request.enabled }),
          ...(request.autoStart === undefined ? {} : { autoStart: request.autoStart }),
          resolvedScope,
          nowIso: nowIso()
        })
      )
    ) as PersistedMcpServerConfig;

  const readDecoratedScopeServers = async (
    scope: McpScope,
    projectRoot?: string
  ): Promise<readonly McpServerConfig[]> => {
    const resolvedScope = withResolvedScope(workbenchFsPort, scope, projectRoot);
    const secretStore = await readSecretStorePort();
    const runtimeStatuses = readRuntimeStatusesPort();
    const document = await readScopeDocumentPort(resolvedScope.scope, resolvedScope.projectRoot);

    return document.servers.map((server) =>
      decoratePersistedServer(server, secretStore, runtimeStatuses)
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
    const runtimeStatuses = readRuntimeStatusesPort();
    return decoratePersistedServer(server, secretStore, runtimeStatuses);
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
    const result = JSON.parse(
      nativeBindings.startMcpRuntimeJson(
        JSON.stringify({
          server,
          checkedAt: nowIso(),
          secretStore,
          availableExternalKeys: buildAvailableExternalKeys(),
          baseEnv: buildBaseEnvironment(),
          introspectionSnapshot: buildCatalogIntrospection(server.id, server.templateId)
        })
      )
    ) as {
      readonly validation: McpValidationResult;
      readonly status: McpRuntimeStatus;
    };

    await updatePersistedLastError(
      request,
      result.validation.ok ? undefined : result.validation.summary
    );
    return decorateServer(server);
  };

  const stopRuntimePort = async (
    server: PersistedMcpServerConfig,
    reason: string
  ): Promise<McpRuntimeStatus> =>
    JSON.parse(
      nativeBindings.stopMcpRuntimeJson(
        JSON.stringify({
          serverId: server.id,
          transport: server.transport,
          reason
        })
      )
    ) as McpRuntimeStatus;

  const restartRuntimePort = async (
    request: McpServerRequest,
    server: PersistedMcpServerConfig
  ): Promise<McpServerConfig> => {
    const secretStore = await readSecretStorePort();
    const result = JSON.parse(
      nativeBindings.restartMcpRuntimeJson(
        JSON.stringify({
          server,
          checkedAt: nowIso(),
          secretStore,
          availableExternalKeys: buildAvailableExternalKeys(),
          baseEnv: buildBaseEnvironment(),
          introspectionSnapshot: buildCatalogIntrospection(server.id, server.templateId)
        })
      )
    ) as {
      readonly validation: McpValidationResult;
      readonly status: McpRuntimeStatus;
    };

    await updatePersistedLastError(
      request,
      result.validation.ok ? undefined : result.validation.summary
    );
    return decorateServer(server);
  };

  const readRuntimeIntrospectionPort = async (
    server: PersistedMcpServerConfig
  ): Promise<McpIntrospectionSnapshot> => {
    const snapshot = JSON.parse(
      nativeBindings.readMcpRuntimeIntrospectionJson(
        JSON.stringify({
          serverId: server.id,
          fallbackSnapshot: buildCatalogIntrospection(server.id, server.templateId)
        })
      )
    ) as McpIntrospectionSnapshot | null;

    return snapshot ?? buildCatalogIntrospection(server.id, server.templateId);
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

        const nextServer = createServerFromTemplatePort(request, catalogItem, resolvedScope);
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
    dispose: async () => {
      nativeBindings.shutdownMcpRuntime();
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
    }
  };
};
