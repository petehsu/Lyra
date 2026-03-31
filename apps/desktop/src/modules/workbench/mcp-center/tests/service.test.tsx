import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type {
  McpCatalogItem,
  McpCreateServerRequest,
  McpEffectiveServerConfig,
  McpEnvironmentEntry,
  McpEnvironmentInput,
  McpInstallTemplateRequest,
  McpIntrospectionSnapshot,
  McpRuntimeEvent,
  McpRuntimePhase,
  McpRuntimeStatus,
  McpScope,
  McpServerConfig,
  McpTransport,
  McpValidationResult
} from "../../../../shared/mcp";
import { useMcpCenterModel } from "../service";
import { selectVisibleMcpServers } from "../selectors";

const FIXED_NOW = "2026-03-28T00:00:00.000Z";
const PROJECT_ROOT = "/workspace/lyra";
const PROJECT_HINT = "/workspace/lyra/apps/desktop/src/main.ts";

const createRuntimeStatus = (
  serverId: string,
  transport: McpTransport,
  phase: McpRuntimePhase,
  message?: string
): McpRuntimeStatus => ({
  serverId,
  transport,
  phase,
  updatedAt: FIXED_NOW,
  ...(message === undefined ? {} : { message })
});

const createCatalogItem = (
  overrides: Partial<McpCatalogItem> & Pick<McpCatalogItem, "id" | "title" | "summary" | "iconKey">
): McpCatalogItem => ({
  id: overrides.id,
  title: overrides.title,
  summary: overrides.summary,
  iconKey: overrides.iconKey,
  official: overrides.official ?? true,
  transports: overrides.transports ?? ["stdio"],
  installKind: overrides.installKind ?? "manual",
  recommendedScope: overrides.recommendedScope ?? "global",
  defaultArgs: overrides.defaultArgs ?? [],
  defaultEnvironment: overrides.defaultEnvironment ?? [],
  permissions: overrides.permissions ?? [],
  tools: overrides.tools ?? [],
  resources: overrides.resources ?? [],
  prompts: overrides.prompts ?? [],
  ...(overrides.quickSetup === undefined ? {} : { quickSetup: overrides.quickSetup }),
  ...(overrides.description === undefined ? {} : { description: overrides.description }),
  ...(overrides.defaultCommand === undefined ? {} : { defaultCommand: overrides.defaultCommand }),
  ...(overrides.defaultCwd === undefined ? {} : { defaultCwd: overrides.defaultCwd }),
  ...(overrides.defaultUrl === undefined ? {} : { defaultUrl: overrides.defaultUrl })
});

const createServer = (
  overrides: Partial<McpServerConfig> &
    Pick<
      McpServerConfig,
      "id" | "serverKey" | "title" | "summary" | "iconKey" | "scope" | "transport" | "installKind"
    >
): McpServerConfig => ({
  id: overrides.id,
  serverKey: overrides.serverKey,
  source: overrides.source ?? "custom",
  title: overrides.title,
  summary: overrides.summary,
  iconKey: overrides.iconKey,
  scope: overrides.scope,
  transport: overrides.transport,
  installKind: overrides.installKind,
  args: overrides.args ?? [],
  environment: overrides.environment ?? [],
  permissions: overrides.permissions ?? [],
  enabled: overrides.enabled ?? true,
  autoStart: overrides.autoStart ?? false,
  createdAt: overrides.createdAt ?? FIXED_NOW,
  updatedAt: overrides.updatedAt ?? FIXED_NOW,
  runtimeStatus:
    overrides.runtimeStatus ??
    createRuntimeStatus(overrides.id, overrides.transport, "stopped"),
  ...(overrides.templateId === undefined ? {} : { templateId: overrides.templateId }),
  ...(overrides.description === undefined ? {} : { description: overrides.description }),
  ...(overrides.projectRoot === undefined ? {} : { projectRoot: overrides.projectRoot }),
  ...(overrides.command === undefined ? {} : { command: overrides.command }),
  ...(overrides.cwd === undefined ? {} : { cwd: overrides.cwd }),
  ...(overrides.url === undefined ? {} : { url: overrides.url }),
  ...(overrides.lastError === undefined ? {} : { lastError: overrides.lastError })
});

const toEffectiveServer = (
  server: McpServerConfig,
  overrides?: Partial<McpEffectiveServerConfig>
): McpEffectiveServerConfig => ({
  ...server,
  effectiveScope: overrides?.effectiveScope ?? server.scope,
  inheritedFromGlobal: overrides?.inheritedFromGlobal ?? false,
  overriddenFields: overrides?.overriddenFields ?? []
});

const toEnvironmentEntries = (
  inputs: readonly McpEnvironmentInput[],
  serverId: string
): readonly McpEnvironmentEntry[] =>
  inputs.map((entry, index) => {
    if (entry.mode === "plain") {
      return {
        key: entry.key,
        mode: "plain",
        value: entry.value
      };
    }
    if (entry.mode === "external") {
      return {
        key: entry.key,
        mode: "external",
        externalKey: entry.externalKey
      };
    }
    return {
      key: entry.key,
      mode: "secret",
      secretRef: {
        secretRefId: entry.secretRefId ?? `${serverId}-secret-${index}`,
        isSet: entry.secretValue !== undefined || entry.secretRefId !== undefined,
        lastUpdatedAt: FIXED_NOW
      }
    };
  });

const catalog = [
  createCatalogItem({
    id: "filesystem",
    title: "Filesystem",
    summary: "Read and write local files",
    iconKey: "filesystem",
    installKind: "binary",
    quickSetup: {
      fields: [
        {
          id: "rootPath",
          kind: "path",
          required: true,
          preferProjectRoot: true
        }
      ]
    },
    permissions: ["filesystem.read", "filesystem.write"],
    tools: [{ name: "read_file" }],
    resources: [{ name: "directory://workspace" }]
  }),
  createCatalogItem({
    id: "memory",
    title: "Memory",
    summary: "Persistent memory store",
    iconKey: "memory",
    installKind: "npm",
    defaultCommand: "npx",
    defaultArgs: ["-y", "@modelcontextprotocol/server-memory"],
    permissions: ["memory.read", "memory.write"],
    prompts: [{ name: "memory_summary" }]
  })
] as const;

const filesystemServer = createServer({
  id: "server-filesystem-global",
  serverKey: "filesystem-global",
  source: "catalog",
  templateId: "filesystem",
  title: "Filesystem",
  summary: "Local workspace bridge",
  iconKey: "filesystem",
  scope: "global",
  transport: "stdio",
  installKind: "binary",
  command: "lyra-filesystem-mcp",
  permissions: ["filesystem.read", "filesystem.write"]
});

const projectMemoryServer = createServer({
  id: "server-memory-project",
  serverKey: "memory-project",
  source: "catalog",
  templateId: "memory",
  title: "Memory",
  summary: "Project memory",
  iconKey: "memory",
  scope: "project",
  projectRoot: PROJECT_ROOT,
  transport: "stdio",
  installKind: "npm",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-memory"],
  permissions: ["memory.read", "memory.write"]
});

const createMcpDesktopApi = ({
  projectEnabled = true
}: {
  readonly projectEnabled?: boolean;
} = {}) => {
  let serial = 0;
  let globalServers: readonly McpServerConfig[] = [filesystemServer];
  let projectServers: readonly McpServerConfig[] = projectEnabled
    ? [projectMemoryServer]
    : [];
  const eventListeners = new Set<(event: McpRuntimeEvent) => void>();

  const buildEffectiveConfig = (requestedProjectRoot?: string) => {
    const resolvedProjectRoot =
      projectEnabled && requestedProjectRoot !== undefined ? PROJECT_ROOT : undefined;
    return {
      ...(resolvedProjectRoot === undefined ? {} : { resolvedProjectRoot }),
      servers: [
        ...globalServers.map((server) =>
          toEffectiveServer(server, {
            effectiveScope: "global"
          })
        ),
        ...(resolvedProjectRoot === undefined
          ? []
          : projectServers.map((server) =>
              toEffectiveServer(server, {
                effectiveScope: "project"
              })
            ))
      ]
    };
  };

  const readCatalog = vi.fn(async () => catalog);
  const readServers = vi.fn(
    async ({
      scope,
      projectRoot
    }: {
      readonly scope: McpScope;
      readonly projectRoot?: string;
    }) => {
      if (scope === "project") {
        return projectEnabled && projectRoot !== undefined ? projectServers : [];
      }
      return globalServers;
    }
  );
  const readEffectiveServers = vi.fn(async (request?: { readonly projectRoot?: string }) =>
    buildEffectiveConfig(request?.projectRoot)
  );

  const createServerMock = vi.fn(async (request: McpCreateServerRequest) => {
    const nextId = `server-custom-${++serial}`;
    const nextServer = createServer({
      id: nextId,
      serverKey: request.serverKey ?? nextId,
      source: "custom",
      title: request.title,
      summary: request.summary,
      iconKey: request.iconKey,
      scope: request.scope,
      transport: request.transport,
      installKind: request.installKind,
      args: request.args,
      environment: toEnvironmentEntries(request.environment, nextId),
      permissions: request.permissions,
      enabled: request.enabled,
      autoStart: request.autoStart,
      ...(request.scope === "project"
        ? { projectRoot: request.projectRoot ?? PROJECT_ROOT }
        : {}),
      ...(request.command === undefined ? {} : { command: request.command }),
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.url === undefined ? {} : { url: request.url })
    });

    if (request.scope === "project") {
      projectServers = [...projectServers, nextServer];
    } else {
      globalServers = [...globalServers, nextServer];
    }

    return nextServer;
  });

  const installTemplate = vi.fn(async (request: McpInstallTemplateRequest) => {
    const template = catalog.find((entry) => entry.id === request.templateId);
    if (template === undefined) {
      throw new Error("template not found");
    }

    const nextId = `server-template-${++serial}`;
    const nextServer = createServer({
      id: nextId,
      serverKey: request.serverKey ?? `${request.templateId}-${serial}`,
      source: "catalog",
      templateId: template.id,
      title: request.title ?? template.title,
      summary: template.summary,
      iconKey: template.iconKey,
      scope: request.scope,
      transport: template.transports[0] ?? "stdio",
      installKind: template.installKind,
      args: template.defaultArgs,
      environment: template.defaultEnvironment,
      permissions: template.permissions,
      enabled: request.enabled ?? true,
      autoStart: request.autoStart ?? false,
      ...(template.description === undefined ? {} : { description: template.description }),
      ...(request.scope === "project"
        ? { projectRoot: request.projectRoot ?? PROJECT_ROOT }
        : {}),
      ...(template.defaultCommand === undefined
        ? {}
        : { command: template.defaultCommand }),
      ...(template.defaultCwd === undefined ? {} : { cwd: template.defaultCwd }),
      ...(template.defaultUrl === undefined ? {} : { url: template.defaultUrl })
    });

    if (request.scope === "project") {
      projectServers = [...projectServers, nextServer];
    } else {
      globalServers = [...globalServers, nextServer];
    }

    return nextServer;
  });

  const updateServer = vi.fn(async () => {
    throw new Error("not implemented in test");
  });
  const deleteServer = vi.fn(async ({ serverId, scope }: { readonly serverId: string; readonly scope: McpScope }) => {
    if (scope === "project") {
      projectServers = projectServers.filter((server) => server.id !== serverId);
      return;
    }
    globalServers = globalServers.filter((server) => server.id !== serverId);
  });
  const validateServer = vi.fn(
    async ({ serverId }: { readonly serverId: string }): Promise<McpValidationResult> => ({
      serverId,
      ok: true,
      checkedAt: FIXED_NOW,
      summary: "Ready",
      diagnostics: []
    })
  );
  const startServer = vi.fn(async () => undefined);
  const stopServer = vi.fn(async () => undefined);
  const restartServer = vi.fn(async () => undefined);
  const readServerIntrospection = vi.fn(
    async ({ serverId }: { readonly serverId: string }): Promise<McpIntrospectionSnapshot> => ({
      serverId,
      fetchedAt: FIXED_NOW,
      source: "live",
      tools: [{ name: "tool.search", description: "Search across the workspace" }],
      resources: [{ name: "resource.workspace", description: "Workspace state" }],
      prompts: [{ name: "prompt.default", description: "Default prompt" }]
    })
  );
  const onEvent = vi.fn((listener: (event: McpRuntimeEvent) => void) => {
    eventListeners.add(listener);
    return () => {
      eventListeners.delete(listener);
    };
  });

  const api = {
    mcp: {
      readCatalog,
      readServers,
      readEffectiveServers,
      createServer: createServerMock,
      updateServer,
      deleteServer,
      installTemplate,
      validateServer,
      startServer,
      stopServer,
      restartServer,
      readServerIntrospection,
      onEvent
    }
  } as unknown as LyraDesktopApi;

  return {
    api,
    projectRoot: PROJECT_ROOT,
    readCatalog,
    readServers,
    readEffectiveServers,
    createServer: createServerMock,
    installTemplate,
    onEvent,
    emit: (event: McpRuntimeEvent) => {
      for (const listener of eventListeners) {
        listener(event);
      }
    }
  };
};

describe("mcp center model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("loads catalog and effective servers with project scope when available", async () => {
    const desktop = createMcpDesktopApi();

    const { result } = renderHook(() =>
      useMcpCenterModel({
        desktopApi: desktop.api,
        projectHintPath: PROJECT_HINT
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });

    expect(result.current.state.catalog).toHaveLength(2);
    expect(result.current.state.effectiveConfig.resolvedProjectRoot).toBe(PROJECT_ROOT);
    expect(result.current.state.globalServers).toHaveLength(1);
    expect(result.current.state.projectServers).toHaveLength(1);
    expect(result.current.state.selectedServerId).toBe("server-filesystem-global");
    expect(selectVisibleMcpServers(result.current.state)).toHaveLength(2);
  });

  test("keeps preferred scope on global when project root is unavailable", async () => {
    const desktop = createMcpDesktopApi({
      projectEnabled: false
    });

    const { result } = renderHook(() =>
      useMcpCenterModel({
        desktopApi: desktop.api,
        projectHintPath: PROJECT_HINT
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });

    expect(result.current.state.effectiveConfig.resolvedProjectRoot).toBeUndefined();
    expect(result.current.state.preferredScope).toBe("global");

    act(() => {
      result.current.setPreferredScope("project");
    });

    expect(result.current.state.preferredScope).toBe("global");
  });

  test("installs a catalog template into the preferred scope and reloads the model", async () => {
    const desktop = createMcpDesktopApi();

    const { result } = renderHook(() =>
      useMcpCenterModel({
        desktopApi: desktop.api,
        projectHintPath: PROJECT_HINT
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });

    act(() => {
      result.current.setPreferredScope("project");
    });

    await act(async () => {
      await result.current.installTemplate("memory");
    });

    expect(desktop.installTemplate).toHaveBeenCalledWith({
      templateId: "memory",
      scope: "project",
      projectRoot: PROJECT_ROOT
    });

    await waitFor(() => {
      expect(
        result.current.state.effectiveConfig.servers.some(
          (server) => server.id !== "server-memory-project" && server.templateId === "memory"
        )
      ).toBe(true);
    });
  });

  test("opens quick setup presets with project-root defaults and installs them with user inputs", async () => {
    const desktop = createMcpDesktopApi();

    const { result } = renderHook(() =>
      useMcpCenterModel({
        desktopApi: desktop.api,
        projectHintPath: PROJECT_HINT
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });

    act(() => {
      result.current.setPreferredScope("project");
      result.current.openPreset("filesystem");
    });

    expect(result.current.state.presetDraft).toMatchObject({
      templateId: "filesystem",
      scope: "project",
      values: {
        rootPath: PROJECT_ROOT
      }
    });

    act(() => {
      result.current.updatePresetField("title", "Workspace Files");
      result.current.updatePresetField("rootPath", "/tmp/lyra-workspace");
      result.current.updatePresetField("enabled", "false");
      result.current.updatePresetField("autoStart", "true");
    });

    await act(async () => {
      await result.current.savePresetInstall();
    });

    expect(desktop.installTemplate).toHaveBeenCalledWith({
      templateId: "filesystem",
      scope: "project",
      projectRoot: PROJECT_ROOT,
      title: "Workspace Files",
      setupValues: {
        rootPath: "/tmp/lyra-workspace"
      },
      enabled: false,
      autoStart: true
    });

    await waitFor(() => {
      expect(result.current.state.presetDraft).toBeNull();
      expect(result.current.state.selectedServerId).toBe("server-template-1");
    });
  });

  test("creates a custom server from the form draft and preserves secret metadata in renderer-safe form", async () => {
    const desktop = createMcpDesktopApi();

    const { result } = renderHook(() =>
      useMcpCenterModel({
        desktopApi: desktop.api
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });

    act(() => {
      result.current.openCustom();
    });

    act(() => {
      result.current.updateDraftField("title", "Workspace Gateway");
      result.current.updateDraftField("summary", "Custom project bridge");
      result.current.updateDraftField("command", "uvx");
      result.current.updateDraftField("argsText", "lyra-mcp-gateway\n--watch");
      result.current.updateDraftField("permissionsText", "filesystem.read\nnetwork.fetch");
      result.current.addDraftEnvironment();
    });

    const environmentId = result.current.state.draft?.environment[0]?.id;
    expect(environmentId).toBeDefined();

    act(() => {
      result.current.updateDraftEnvironment(environmentId!, "key", "OPENAI_API_KEY");
      result.current.updateDraftEnvironment(environmentId!, "mode", "external");
      result.current.updateDraftEnvironment(environmentId!, "value", "OPENAI_API_KEY");
    });

    await act(async () => {
      await result.current.saveDraft();
    });

    expect(desktop.createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Workspace Gateway",
        summary: "Custom project bridge",
        command: "uvx",
        args: ["lyra-mcp-gateway", "--watch"],
        permissions: ["filesystem.read", "network.fetch"],
        environment: [
          {
            key: "OPENAI_API_KEY",
            mode: "external",
            externalKey: "OPENAI_API_KEY"
          }
        ]
      })
    );

    await waitFor(() => {
      expect(
        result.current.state.effectiveConfig.servers.some(
          (server) => server.title === "Workspace Gateway"
        )
      ).toBe(true);
    });

    expect(result.current.state.panelMode).toBe("details");
    expect(result.current.state.draft).toBeNull();
  });

  test("applies runtime events to the status filter without reloading all data", async () => {
    const desktop = createMcpDesktopApi({
      projectEnabled: false
    });

    const { result } = renderHook(() =>
      useMcpCenterModel({
        desktopApi: desktop.api
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });

    act(() => {
      desktop.emit({
        kind: "runtime-status",
        status: createRuntimeStatus("server-filesystem-global", "stdio", "running")
      });
      result.current.setStatusFilter("running");
    });

    await waitFor(() => {
      expect(selectVisibleMcpServers(result.current.state).map((server) => server.id)).toEqual([
        "server-filesystem-global"
      ]);
    });
  });
});
