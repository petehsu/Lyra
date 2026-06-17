import { app } from "electron";
import * as os from "node:os";

import type { AppMetaPayload } from "../../shared/desktop-bridge";
import { resolveCurrentDesktopTarget } from "../platform-target";
import type { WorkbenchStateIpcBridge } from "../workbench-state/service";

export type HostPersonaContextPayload = {
  readonly currentTime?: string;
  readonly locationLabel?: string;
  readonly deviceSummary?: string;
  readonly userName?: string;
};

const readString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readAppMeta = (): AppMetaPayload => {
  let userName: string | undefined;
  try {
    userName = os.userInfo().username;
  } catch {
    userName = process.env.USER ?? process.env.USERNAME;
  }
  const desktopTarget = resolveCurrentDesktopTarget();
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    desktopTargetId: desktopTarget.id,
    desktopSupportTier: desktopTarget.supportTier,
    linuxLibc: desktopTarget.libc,
    isPackaged: app.isPackaged,
    ...(userName === undefined || userName.trim().length === 0
      ? {}
      : { userName: userName.trim() }),
    hostName: os.hostname(),
    locale: app.getLocale(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
};

const formatPlatformLabel = (platform: NodeJS.Platform): string => {
  if (platform === "darwin") {
    return "macOS";
  }
  if (platform === "win32") {
    return "Windows";
  }
  if (platform === "linux") {
    return "Linux";
  }
  return platform;
};

const formatCurrentTime = (
  locale: string | undefined,
  timeZone: string | undefined
): string | undefined => {
  if (timeZone === undefined || timeZone.trim().length === 0) {
    return undefined;
  }
  try {
    return new Intl.DateTimeFormat(locale ?? "en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone
    }).format(new Date());
  } catch {
    return undefined;
  }
};

const formatDeviceSummary = (meta: AppMetaPayload): string | undefined => {
  const hostName = meta.hostName?.trim();
  if (hostName === undefined || hostName.length === 0) {
    return undefined;
  }
  const parts = [formatPlatformLabel(meta.platform)];
  if (meta.arch !== undefined && meta.arch.trim().length > 0) {
    parts.push(meta.arch);
  }
  parts.push(hostName);
  if (meta.version.trim().length > 0) {
    parts.push(`Lyra ${meta.version}`);
  }
  return parts.join(" · ");
};

const readLocationLabel = (
  workbenchState: WorkbenchStateIpcBridge
): string | undefined => {
  const raw = workbenchState.readState("location");
  if (raw === null || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as {
      readonly consent?: unknown;
      readonly fix?: { readonly displayName?: unknown };
    };
    if (parsed.consent !== "granted") {
      return undefined;
    }
    return readString(parsed.fix?.displayName);
  } catch {
    return undefined;
  }
};

export const readHostPersonaContextPayload = (
  workbenchState: WorkbenchStateIpcBridge
): HostPersonaContextPayload => {
  const meta = readAppMeta();
  const currentTime = formatCurrentTime(meta.locale, meta.timeZone);
  const locationLabel = readLocationLabel(workbenchState);
  const deviceSummary = formatDeviceSummary(meta);
  return {
    ...(currentTime === undefined ? {} : { currentTime }),
    ...(locationLabel === undefined ? {} : { locationLabel }),
    ...(deviceSummary === undefined ? {} : { deviceSummary }),
    ...(meta.userName === undefined ? {} : { userName: meta.userName })
  };
};

export const createHostPersonaContextHandlers = (
  workbenchState: WorkbenchStateIpcBridge
): {
  readonly "agent.readHostPersonaContext": () => Promise<HostPersonaContextPayload>;
} => ({
  "agent.readHostPersonaContext": async () =>
    readHostPersonaContextPayload(workbenchState)
});