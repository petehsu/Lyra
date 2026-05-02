import { BrowserWindow, ipcMain } from "electron";
import os from "node:os";

import {
  LYRA_CHANNELS,
  type LyraClientNotificationPayload,
  type LyraClientRequestPayload,
  type LyraRejectServerRequestPayload,
  type LyraResolveServerRequestPayload,
  type LyraRuntimeEvent,
  type LyraRuntimeHealth
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";
import type { AgentCoreIpcBridge } from "./types";

const IP_GEO_LOOKUP_BUDGET_MS = 3_000;
const IP_GEO_WAIT_BUDGET_MS = 500;
const IP_GEO_CACHE_TTL_MS = 15 * 60 * 1000;
const IP_GEO_FAILURE_CACHE_TTL_MS = 60 * 1000;
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

type IpLocationCache = {
  readonly candidate: LocationCandidate | null;
  readonly expiresAt: number;
};

let ipLocationCache: IpLocationCache | null = null;
let ipLocationInFlight: Promise<LocationCandidate | null> | null = null;

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
  budgetStart: number,
  budgetMs: number
): Promise<LocationCandidate | null> => {
  for (const endpoint of IP_GEO_ENDPOINTS) {
    const elapsed = Date.now() - budgetStart;
    const remaining = budgetMs - elapsed;
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

const refreshIpLocationCache = (): Promise<LocationCandidate | null> => {
  if (ipLocationInFlight !== null) {
    return ipLocationInFlight;
  }
  ipLocationInFlight = resolveIpLocation(Date.now(), IP_GEO_LOOKUP_BUDGET_MS)
    .then((candidate) => {
      ipLocationCache = {
        candidate,
        expiresAt: Date.now() + (candidate === null ? IP_GEO_FAILURE_CACHE_TTL_MS : IP_GEO_CACHE_TTL_MS)
      };
      return candidate;
    })
    .finally(() => {
      ipLocationInFlight = null;
    });
  return ipLocationInFlight;
};

const resolveCachedIpLocation = async (): Promise<LocationCandidate | null> => {
  const now = Date.now();
  if (ipLocationCache !== null && ipLocationCache.expiresAt > now) {
    return ipLocationCache.candidate;
  }

  const refresh = refreshIpLocationCache();
  let timeout: NodeJS.Timeout | null = null;
  const timedOut = new Promise<null>((resolve) => {
    timeout = setTimeout(() => {
      resolve(null);
    }, IP_GEO_WAIT_BUDGET_MS);
  });
  try {
    return await Promise.race([refresh, timedOut]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
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
  const ipLocation = await resolveCachedIpLocation();
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

const shouldSyncPersonaContext = (request: LyraClientRequestPayload): boolean => {
  const method = readTrimmedString(request.method);
  return method === "thread/start" || method === "thread/resume" || method === "turn/start";
};

export const resetAgentCorePersonaContextCacheForTests = (): void => {
  ipLocationCache = null;
  ipLocationInFlight = null;
};

export const buildAgentCorePersonaContextForTests = buildPersonaContextPayload;

export const createAgentCoreIpcBridge = (
  runtimeClient: LyraRuntimeClient
): AgentCoreIpcBridge => {
  const requestRuntime = async <T>(method: string, payload: unknown): Promise<T> =>
    await runtimeClient.request<T>(method, payload);
  const syncPersonaContext = async (): Promise<void> => {
    try {
      const payload = await buildPersonaContextPayload();
      await requestRuntime("lyra.runtime.request", {
        method: "lyra/runtime/personaContext/set",
        params: payload
      });
    } catch {
      // Best-effort sync: turn execution should continue even when context probing fails.
    }
  };

  ipcMain.handle(LYRA_CHANNELS.lyraRuntimeHealth, async () =>
    await requestRuntime<LyraRuntimeHealth>("lyra.runtime.health", null)
  );

  ipcMain.handle(
    LYRA_CHANNELS.lyraRuntimeRequest,
    async (_event, request: LyraClientRequestPayload) => {
      if (shouldSyncPersonaContext(request)) {
        await syncPersonaContext();
      }
      return await requestRuntime<unknown>("lyra.runtime.request", request);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.lyraRuntimeNotify,
    async (_event, notification: LyraClientNotificationPayload) => {
      await requestRuntime<null>("lyra.runtime.notify", notification);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.lyraRuntimeResolveServerRequest,
    async (_event, request: LyraResolveServerRequestPayload) => {
      await requestRuntime<null>("lyra.runtime.resolve_server_request", request);
    }
  );

  ipcMain.handle(
    LYRA_CHANNELS.lyraRuntimeRejectServerRequest,
    async (_event, request: LyraRejectServerRequestPayload) => {
      await requestRuntime<null>("lyra.runtime.reject_server_request", request);
    }
  );

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== "lyra.runtime") {
      return;
    }

    const event = payload as LyraRuntimeEvent;
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue;
      }
      window.webContents.send(LYRA_CHANNELS.lyraEvent, event);
    }
  });

  return {
    dispose: () => {
      unsubscribeRuntimeEvents();
      ipcMain.removeHandler(LYRA_CHANNELS.lyraRuntimeHealth);
      ipcMain.removeHandler(LYRA_CHANNELS.lyraRuntimeRequest);
      ipcMain.removeHandler(LYRA_CHANNELS.lyraRuntimeNotify);
      ipcMain.removeHandler(LYRA_CHANNELS.lyraRuntimeResolveServerRequest);
      ipcMain.removeHandler(LYRA_CHANNELS.lyraRuntimeRejectServerRequest);
    }
  };
};
