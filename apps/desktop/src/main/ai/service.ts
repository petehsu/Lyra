import { BrowserWindow, ipcMain, shell } from "electron";
import os from "node:os";

import {
  LYRA_CHANNELS,
  type AiMemoryConfig,
  type AgentAnswerQuestionRequest,
  type AgentAnswerPlanQuestionRequest,
  type AgentBindSessionProjectRequest,
  type AgentEnterPlanModeRequest,
  type AgentCreateSessionRequest,
  type AgentDeleteSessionRequest,
  type AgentGetPendingInteractionsRequest,
  type AgentGetPlanRequest,
  type AgentGetSessionRequest,
  type AgentPendingInteraction,
  type AgentPlanState,
  type AgentResolvePlanApprovalRequest,
  type AgentRuntimeEvent,
  type AgentSendTurnRequest,
  type AgentSendTurnResult,
  type AgentSession,
  type AgentSessionDetail,
  type CommandApprovalSubmitRequest,
  type AiDeleteProfileRequest,
  type AiDiscoverModelsRequest,
  type AiModelDiscoveryResult,
  type AiProfileValidationResult,
  type AiProviderCatalogItem,
  type AiProviderPreset,
  type AiProviderProfile,
  type AiSetDefaultProfileRequest,
  type AiUpsertProfileRequest,
  type AiValidateProfileRequest
} from "../../shared/desktop-bridge";
import {
  authorizeOpenAiChatGptInBrowser,
  authorizeOpenAiChatGptViaDeviceCode
} from "./openai-auth";
import type { LyraRuntimeClient } from "../runtime-client";
import type {
  AiIpcBridge,
  NativeAgentAnswerQuestionRequest,
  NativeAgentCreateSessionRequest,
  NativeAgentDeleteSessionRequest,
  NativeAgentBindSessionProjectRequest,
  NativeAgentAnswerPlanQuestionRequest,
  NativeAgentGetSessionRequest,
  NativeAgentEnterPlanModeRequest,
  NativeAgentGetPendingInteractionsRequest,
  NativeAgentGetPlanRequest,
  NativeAgentListSessionsRequest,
  NativeAgentMemoryConfigRequest,
  NativeAgentResolvePlanApprovalRequest,
  NativeAgentSendTurnRequest,
  NativeAgentUpdateMemoryConfigRequest,
  NativeCommandApprovalSubmitRequest,
  NativeAiDeleteProfileRequest,
  NativeAiDiscoverModelsRequest,
  NativeAiReadPresetCatalogRequest,
  NativeAiReadProfilesRequest,
  NativeAiReadProviderCatalogRequest,
  NativeAiSetDefaultProfileRequest,
  NativeAiUpsertProfileRequest,
  NativeAiValidateProfileRequest
} from "./types";

const PERSONA_SYNC_BUDGET_MS = 3_000;
const IP_GEO_ENDPOINTS = [
  "https://ipapi.co/json/",
  "https://ipwho.is/"
] as const;

type LocationCandidate = {
  readonly display: string;
  readonly source: string;
  readonly confidence: string;
  readonly detail: string;
  readonly ipAddress?: string;
};

type PersonaContextPayload = {
  readonly personaName: string;
  readonly companyName: string;
  readonly companyDescription: string;
  readonly coworkerLabel: string;
  readonly localTime: string;
  readonly timezone: string;
  readonly locale: string;
  readonly locationDisplay: string;
  readonly locationSource: string;
  readonly locationConfidence: string;
  readonly locationDetail: string;
  readonly physicalLocationDisplay: string;
  readonly ipLocationDisplay: string;
  readonly ipAddress?: string;
  readonly deviceName: string;
  readonly deviceProfile: string;
  readonly osName: string;
  readonly osVersion: string;
  readonly architecture: string;
  readonly cpuModel: string;
  readonly cpuCores: string;
  readonly memoryGb: string;
};

const readTrimmedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readLocaleRegion = (locale: string): string | null => {
  const normalized = locale.trim();
  if (normalized.length === 0) {
    return null;
  }
  const parts = normalized.replace("_", "-").split("-");
  const region = parts.slice(1).find((part) => /^[A-Za-z]{2}$/.test(part));
  return region === undefined ? null : region.toUpperCase();
};

const formatLocalTime = (date: Date): string => {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const platformName = (platform: NodeJS.Platform): string => {
  if (platform === "darwin") return "macOS";
  if (platform === "win32") return "Windows";
  if (platform === "linux") return "Linux";
  return platform;
};

const inferPhysicalLocation = (locale: string, timezone: string): LocationCandidate | null => {
  const normalizedZone = timezone.trim();
  const region = readLocaleRegion(locale);
  const zoneCity = normalizedZone.includes("/")
    ? normalizedZone.split("/").slice(1).join("/").replaceAll("_", " ")
    : null;
  const parts = [zoneCity, region].filter((value): value is string => value !== null && value.length > 0);
  if (parts.length === 0) {
    return null;
  }
  return {
    display: parts.join(", "),
    source: "system_timezone_inference",
    confidence: "0.74",
    detail: `timezone=${normalizedZone || "unknown"}; locale=${locale || "unknown"}`
  };
};

const fetchJsonWithTimeout = async (
  url: string,
  timeoutMs: number
): Promise<Record<string, unknown> | null> => {
  if (timeoutMs <= 0) {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json"
      }
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const parseIpLocationCandidate = (
  endpoint: string,
  payload: Record<string, unknown>
): LocationCandidate | null => {
  const city = readTrimmedString(payload.city);
  const region = readTrimmedString(payload.region) ?? readTrimmedString(payload.region_name);
  const country =
    readTrimmedString(payload.country_name)
    ?? readTrimmedString(payload.country)
    ?? readTrimmedString(payload.country_code);
  const ipAddress = readTrimmedString(payload.ip) ?? undefined;
  const latitude = readTrimmedString(payload.latitude) ?? readTrimmedString(payload.lat);
  const longitude = readTrimmedString(payload.longitude) ?? readTrimmedString(payload.lon);
  const location = [city, region, country].filter((value): value is string => value !== null);
  if (location.length === 0) {
    return null;
  }
  const coordinate =
    latitude !== null && longitude !== null ? `${latitude},${longitude}` : null;
  const detail = [
    `location=${location.join(", ")}`,
    coordinate === null ? null : `coord=${coordinate}`,
    ipAddress === undefined ? null : `ip=${ipAddress}`,
  ].filter((value): value is string => value !== null);
  return {
    display: location.join(", "),
    source: endpoint.includes("ipwho.is") ? "ipwho.is" : "ipapi.co",
    confidence: "0.41",
    detail: detail.join("; "),
    ...(ipAddress === undefined ? {} : { ipAddress }),
  };
};

const resolveIpLocation = async (
  budgetStart: number
): Promise<LocationCandidate | null> => {
  for (const endpoint of IP_GEO_ENDPOINTS) {
    const elapsed = Date.now() - budgetStart;
    const remaining = PERSONA_SYNC_BUDGET_MS - elapsed;
    if (remaining <= 300) {
      return null;
    }
    const payload = await fetchJsonWithTimeout(endpoint, Math.min(1_200, remaining - 100));
    if (payload === null) {
      continue;
    }
    const candidate = parseIpLocationCandidate(endpoint, payload);
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
};

const toMemoryGb = (bytes: number): string => (bytes / (1024 ** 3)).toFixed(1);

const buildPersonaContextPayload = async (): Promise<PersonaContextPayload> => {
  const now = new Date();
  const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? "unknown";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "unknown";
  const hostName = os.hostname().trim().length > 0 ? os.hostname().trim() : "Lyra";
  const cpuList = os.cpus();
  const cpuModel = cpuList[0]?.model?.trim().length
    ? cpuList[0].model.trim()
    : "unknown";
  const cpuCores = cpuList.length > 0 ? String(cpuList.length) : "unknown";
  const osName = platformName(process.platform);
  const osVersion = os.release();
  const architecture = process.arch;
  const memoryGb = toMemoryGb(os.totalmem());
  const deviceProfile = `${osName} ${osVersion} (${architecture}), CPU ${cpuModel} x${cpuCores}, RAM ${memoryGb} GB`;
  const physicalLocation = inferPhysicalLocation(locale, timezone);
  const ipLocation = await resolveIpLocation(Date.now());
  const primaryLocation = physicalLocation ?? ipLocation;
  const locationDetailParts = [
    physicalLocation === null ? null : `physical=${physicalLocation.detail}`,
    ipLocation === null ? null : `ip=${ipLocation.detail}`
  ].filter((value): value is string => value !== null);

  return {
    personaName: hostName,
    companyName: "Lyra",
    companyDescription:
      "Lyra is a full-spectrum company that spans engineering, operations, research, product delivery, and cross-functional execution.",
    coworkerLabel: "coworker",
    localTime: formatLocalTime(now),
    timezone,
    locale,
    locationDisplay: primaryLocation?.display ?? "unknown",
    locationSource: primaryLocation?.source ?? "unknown",
    locationConfidence: primaryLocation?.confidence ?? "0.20",
    locationDetail: locationDetailParts.length > 0 ? locationDetailParts.join(" | ") : "unknown",
    physicalLocationDisplay: physicalLocation?.display ?? "unknown",
    ipLocationDisplay: ipLocation?.display ?? "unknown",
    ...(ipLocation?.ipAddress === undefined ? {} : { ipAddress: ipLocation.ipAddress }),
    deviceName: hostName,
    deviceProfile,
    osName,
    osVersion,
    architecture,
    cpuModel,
    cpuCores,
    memoryGb
  };
};

export const createAiIpcBridge = (
  storageRoot: string,
  runtimeClient: LyraRuntimeClient
): AiIpcBridge => {
  const requestRuntime = async <T>(method: string, payload: unknown): Promise<T> =>
    await runtimeClient.request<T>(method, payload);
  const syncPersonaContext = async (): Promise<void> => {
    try {
      const payload = await buildPersonaContextPayload();
      await requestRuntime("agent.persona_context.sync", payload);
    } catch {
      // Best-effort sync: turn execution should continue even when context probing fails.
    }
  };

  ipcMain.handle(LYRA_CHANNELS.aiReadProfiles, async () =>
    await requestRuntime<readonly AiProviderProfile[]>("profiles.read", {
      storageRoot
    } satisfies NativeAiReadProfilesRequest)
  );

  ipcMain.handle(LYRA_CHANNELS.aiReadProviderCatalog, async () =>
    await requestRuntime<readonly AiProviderCatalogItem[]>("providers.catalog.read", {
      storageRoot
    } satisfies NativeAiReadProviderCatalogRequest)
  );

  ipcMain.handle(LYRA_CHANNELS.aiReadPresetCatalog, async () =>
    await requestRuntime<readonly AiProviderPreset[]>("providers.presets.read", {
      storageRoot
    } satisfies NativeAiReadPresetCatalogRequest)
  );

  ipcMain.handle(LYRA_CHANNELS.aiAuthorizeOpenAiChatGpt, async () =>
    await authorizeOpenAiChatGptInBrowser(async (url) => {
      await shell.openExternal(url);
      return true;
    })
  );

  ipcMain.handle(LYRA_CHANNELS.aiAuthorizeOpenAiChatGptDeviceCode, async () =>
    await authorizeOpenAiChatGptViaDeviceCode(async (url) => {
      await shell.openExternal(url);
      return true;
    })
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiUpsertProfile,
    async (_event, request: AiUpsertProfileRequest) =>
      await requestRuntime<AiProviderProfile>("profiles.upsert", {
        storageRoot,
        ...request
      } satisfies NativeAiUpsertProfileRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiDeleteProfile,
    async (_event, request: AiDeleteProfileRequest) => {
      await requestRuntime<null>("profiles.delete", {
        storageRoot,
        ...request
      } satisfies NativeAiDeleteProfileRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiSetDefaultProfile,
    async (_event, request: AiSetDefaultProfileRequest) =>
      await requestRuntime<AiProviderProfile>("profiles.set_default", {
        storageRoot,
        ...request
      } satisfies NativeAiSetDefaultProfileRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiValidateProfile,
    async (_event, request: AiValidateProfileRequest) =>
      await requestRuntime<AiProfileValidationResult>("profiles.validate", {
        storageRoot,
        ...request
      } satisfies NativeAiValidateProfileRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiDiscoverModels,
    async (_event, request: AiDiscoverModelsRequest) =>
      await requestRuntime<AiModelDiscoveryResult>("models.discover", {
        storageRoot,
        ...request
      } satisfies NativeAiDiscoverModelsRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.aiRefreshDiscoveredModels,
    async (_event, request: AiDiscoverModelsRequest) =>
      await requestRuntime<AiModelDiscoveryResult>("models.discover", {
        storageRoot,
        ...request,
        forceRefresh: true
      } satisfies NativeAiDiscoverModelsRequest)
  );

  ipcMain.handle(LYRA_CHANNELS.agentListSessions, async () =>
    await requestRuntime<readonly AgentSession[]>("agent.sessions.list", {
      storageRoot
    } satisfies NativeAgentListSessionsRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentCreateSession,
    async (_event, request?: AgentCreateSessionRequest) =>
      await requestRuntime<AgentSession>("agent.sessions.create", {
        storageRoot,
        ...(request ?? {})
      } satisfies NativeAgentCreateSessionRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentGetSession,
    async (_event, request: AgentGetSessionRequest) =>
      await requestRuntime<AgentSessionDetail>("agent.sessions.get", {
        storageRoot,
        ...request
      } satisfies NativeAgentGetSessionRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentBindSessionProject,
    async (_event, request: AgentBindSessionProjectRequest) =>
      await requestRuntime<AgentSession>("agent.sessions.bind_project", {
        storageRoot,
        ...request
      } satisfies NativeAgentBindSessionProjectRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentDeleteSession,
    async (_event, request: AgentDeleteSessionRequest) => {
      await requestRuntime<null>("agent.sessions.delete", {
        storageRoot,
        ...request
      } satisfies NativeAgentDeleteSessionRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentSendTurn,
    async (_event, request: AgentSendTurnRequest) => {
      await syncPersonaContext();
      return await requestRuntime<AgentSendTurnResult>("agent.turns.send", {
        storageRoot,
        ...request
      } satisfies NativeAgentSendTurnRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentEnterPlanMode,
    async (_event, request: AgentEnterPlanModeRequest) => {
      await syncPersonaContext();
      return await requestRuntime<AgentSessionDetail>("agent.plan.enter", {
        storageRoot,
        ...request
      } satisfies NativeAgentEnterPlanModeRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentGetPlan,
    async (_event, request: AgentGetPlanRequest) =>
      await requestRuntime<AgentPlanState | null>("agent.plan.get", {
        storageRoot,
        ...request
      } satisfies NativeAgentGetPlanRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentGetPendingInteractions,
    async (_event, request: AgentGetPendingInteractionsRequest) =>
      await requestRuntime<readonly AgentPendingInteraction[]>("agent.interactions.get_pending", {
        storageRoot,
        ...request
      } satisfies NativeAgentGetPendingInteractionsRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentAnswerQuestion,
    async (_event, request: AgentAnswerQuestionRequest) => {
      await requestRuntime<void>("agent.questions.answer", {
        storageRoot,
        ...request
      } satisfies NativeAgentAnswerQuestionRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentAnswerPlanQuestion,
    async (_event, request: AgentAnswerPlanQuestionRequest) => {
      await requestRuntime<void>("agent.plan.answer_question", {
        storageRoot,
        ...request
      } satisfies NativeAgentAnswerPlanQuestionRequest);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentResolvePlanApproval,
    async (_event, request: AgentResolvePlanApprovalRequest) => {
      await syncPersonaContext();
      return await requestRuntime<AgentSendTurnResult | null>("agent.plan.resolve_approval", {
        storageRoot,
        ...request
      } satisfies NativeAgentResolvePlanApprovalRequest);
    }
  );

  ipcMain.handle(LYRA_CHANNELS.agentGetMemoryConfig, async () =>
    await requestRuntime<AiMemoryConfig>("agent.memory.getConfig", {
      storageRoot
    } satisfies NativeAgentMemoryConfigRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentUpdateMemoryConfig,
    async (_event, config: AiMemoryConfig) =>
      await requestRuntime<AiMemoryConfig>("agent.memory.updateConfig", {
        storageRoot,
        config
      } satisfies NativeAgentUpdateMemoryConfigRequest)
  );

  ipcMain.handle(
    LYRA_CHANNELS.agentSubmitCommandApproval,
    async (_event, request: CommandApprovalSubmitRequest) =>
      await requestRuntime<void>("agent.command_approval.submit", {
        storageRoot,
        ...request
      } satisfies NativeCommandApprovalSubmitRequest)
  );

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== "agent.runtime") {
      return;
    }
    const event = payload as AgentRuntimeEvent;
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue;
      }
      window.webContents.send(LYRA_CHANNELS.agentEvent, event);
    }
  });

  return {
    dispose: () => {
      unsubscribeRuntimeEvents();
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadProfiles);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadProviderCatalog);
      ipcMain.removeHandler(LYRA_CHANNELS.aiReadPresetCatalog);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAuthorizeOpenAiChatGpt);
      ipcMain.removeHandler(LYRA_CHANNELS.aiAuthorizeOpenAiChatGptDeviceCode);
      ipcMain.removeHandler(LYRA_CHANNELS.aiUpsertProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDeleteProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiSetDefaultProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiValidateProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.aiDiscoverModels);
      ipcMain.removeHandler(LYRA_CHANNELS.aiRefreshDiscoveredModels);
      ipcMain.removeHandler(LYRA_CHANNELS.agentListSessions);
      ipcMain.removeHandler(LYRA_CHANNELS.agentCreateSession);
      ipcMain.removeHandler(LYRA_CHANNELS.agentGetSession);
      ipcMain.removeHandler(LYRA_CHANNELS.agentBindSessionProject);
      ipcMain.removeHandler(LYRA_CHANNELS.agentDeleteSession);
      ipcMain.removeHandler(LYRA_CHANNELS.agentSendTurn);
      ipcMain.removeHandler(LYRA_CHANNELS.agentEnterPlanMode);
      ipcMain.removeHandler(LYRA_CHANNELS.agentGetPlan);
      ipcMain.removeHandler(LYRA_CHANNELS.agentAnswerPlanQuestion);
      ipcMain.removeHandler(LYRA_CHANNELS.agentResolvePlanApproval);
      ipcMain.removeHandler(LYRA_CHANNELS.agentGetMemoryConfig);
      ipcMain.removeHandler(LYRA_CHANNELS.agentUpdateMemoryConfig);
      ipcMain.removeHandler(LYRA_CHANNELS.agentSubmitCommandApproval);
    }
  };
};
