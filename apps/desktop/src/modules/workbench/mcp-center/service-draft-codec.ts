import type {
  McpCreateServerRequest,
  McpEnvironmentEntry,
  McpEnvironmentInput,
  McpInstallKind,
  McpScope,
  McpServerConfig,
  McpTransport
} from "../../../shared/mcp";
import type {
  McpCenterDraft,
  McpCenterEnvironmentDraft,
  McpCenterPresetDraft
} from "./types";
import { createDraftId } from "./service-model-state";

const splitLines = (value: string): readonly string[] =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const joinLines = (values: readonly string[]): string => values.join("\n");

export const createEmptyDraft = (
  scope: McpScope,
  mode: "custom" | "edit"
): McpCenterDraft => ({
  mode,
  serverId: null,
  scope,
  title: "",
  summary: "",
  description: "",
  iconKey: "custom-command",
  transport: "stdio",
  installKind: "manual",
  command: "",
  argsText: "",
  cwd: "",
  url: "",
  enabled: true,
  autoStart: false,
  permissionsText: "",
  environment: [],
  advancedMode: false,
  rawValue: ""
});

export const createPresetDraft = (
  templateId: string,
  scope: McpScope,
  defaults: Readonly<Record<string, string>>
): McpCenterPresetDraft => ({
  templateId,
  scope,
  title: "",
  enabled: true,
  autoStart: false,
  values: defaults
});

const mapEnvironmentToDraft = (
  environment: readonly McpEnvironmentEntry[]
): readonly McpCenterEnvironmentDraft[] =>
  environment.map((entry) => {
    if (entry.mode === "plain") {
      return {
        id: createDraftId(),
        key: entry.key,
        mode: "plain",
        value: entry.value
      };
    }
    if (entry.mode === "external") {
      return {
        id: createDraftId(),
        key: entry.key,
        mode: "external",
        value: entry.externalKey
      };
    }
    return {
      id: createDraftId(),
      key: entry.key,
      mode: "secret",
      value: "",
      secretRefId: entry.secretRef.secretRefId
    };
  });

export const draftFromServer = (
  server: McpServerConfig
): McpCenterDraft => ({
  mode: "edit",
  serverId: server.id,
  scope: server.scope,
  title: server.title,
  summary: server.summary,
  description: server.description ?? "",
  iconKey: server.iconKey,
  transport: server.transport,
  installKind: server.installKind,
  command: server.command ?? "",
  argsText: joinLines(server.args),
  cwd: server.cwd ?? "",
  url: server.url ?? "",
  enabled: server.enabled,
  autoStart: server.autoStart,
  permissionsText: joinLines(server.permissions),
  environment: mapEnvironmentToDraft(server.environment),
  advancedMode: false,
  rawValue: ""
});

export const serializeDraftToPayload = (
  draft: McpCenterDraft
): Omit<McpCreateServerRequest, "scope"> & { readonly scope: McpScope } => ({
  scope: draft.scope,
  title: draft.title.trim(),
  summary: draft.summary.trim(),
  description: draft.description.trim(),
  iconKey: draft.iconKey.trim(),
  transport: draft.transport,
  installKind: draft.installKind,
  command: draft.command.trim(),
  args: splitLines(draft.argsText),
  cwd: draft.cwd.trim(),
  url: draft.url.trim(),
  environment: draft.environment
    .filter((entry) => entry.key.trim().length > 0)
    .map<McpEnvironmentInput>((entry) => {
      if (entry.mode === "plain") {
        return {
          key: entry.key.trim(),
          mode: "plain",
          value: entry.value
        };
      }
      if (entry.mode === "external") {
        return {
          key: entry.key.trim(),
          mode: "external",
          externalKey: entry.value.trim()
        };
      }
      return {
        key: entry.key.trim(),
        mode: "secret",
        ...(entry.value.trim().length > 0 ? { secretValue: entry.value } : {}),
        ...(entry.secretRefId === undefined ? {} : { secretRefId: entry.secretRefId })
      };
    }),
  permissions: splitLines(draft.permissionsText),
  enabled: draft.enabled,
  autoStart: draft.autoStart
});

export const serializeDraftToRaw = (draft: McpCenterDraft): string =>
  JSON.stringify(serializeDraftToPayload(draft), null, 2);

export const parseDraftRaw = (
  value: string,
  fallbackMode: "custom" | "edit",
  fallbackScope: McpScope,
  fallbackServerId?: string
): McpCenterDraft => {
  const candidate = JSON.parse(value) as Partial<McpCreateServerRequest>;
  const transport = candidate.transport;
  const installKind = candidate.installKind;
  const normalizedTransport: McpTransport =
    transport === "sse" || transport === "http" || transport === "stdio"
      ? transport
      : "stdio";
  const normalizedInstallKind: McpInstallKind =
    installKind === "npm" ||
    installKind === "uv" ||
    installKind === "docker" ||
    installKind === "binary" ||
    installKind === "manual"
      ? installKind
      : "manual";

  const environment = Array.isArray(candidate.environment)
    ? candidate.environment.map<McpCenterEnvironmentDraft>((entry) => {
        const key = typeof entry.key === "string" ? entry.key : "";
        if (entry.mode === "plain") {
          return {
            id: createDraftId(),
            key,
            mode: "plain",
            value: typeof entry.value === "string" ? entry.value : ""
          };
        }
        if (entry.mode === "external") {
          return {
            id: createDraftId(),
            key,
            mode: "external",
            value: typeof entry.externalKey === "string" ? entry.externalKey : ""
          };
        }
        return {
          id: createDraftId(),
          key,
          mode: "secret",
          value: typeof entry.secretValue === "string" ? entry.secretValue : "",
          ...(typeof entry.secretRefId === "string"
            ? { secretRefId: entry.secretRefId }
            : {})
        };
      })
    : [];

  return {
    mode: fallbackMode,
    serverId: fallbackServerId ?? null,
    scope:
      candidate.scope === "project" || candidate.scope === "global"
        ? candidate.scope
        : fallbackScope,
    title: typeof candidate.title === "string" ? candidate.title : "",
    summary: typeof candidate.summary === "string" ? candidate.summary : "",
    description:
      typeof candidate.description === "string" ? candidate.description : "",
    iconKey: typeof candidate.iconKey === "string" ? candidate.iconKey : "custom-command",
    transport: normalizedTransport,
    installKind: normalizedInstallKind,
    command: typeof candidate.command === "string" ? candidate.command : "",
    argsText: joinLines(Array.isArray(candidate.args) ? candidate.args : []),
    cwd: typeof candidate.cwd === "string" ? candidate.cwd : "",
    url: typeof candidate.url === "string" ? candidate.url : "",
    enabled: candidate.enabled ?? true,
    autoStart: candidate.autoStart ?? false,
    permissionsText: joinLines(Array.isArray(candidate.permissions) ? candidate.permissions : []),
    environment,
    advancedMode: true,
    rawValue: value
  };
};
