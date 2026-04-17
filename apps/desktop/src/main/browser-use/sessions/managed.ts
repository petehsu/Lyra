import { randomUUID } from "node:crypto";

import type {
  BrowserUsePrepareSessionRequest,
  BrowserUsePreparedSessionResult,
  BrowserUseSessionHandle,
} from "../../../shared/browser-use";
import {
  createRealProfileSelectionQuestionError,
  listBrowserUseRealProfiles,
  resolveBrowserUseProfileSelection,
} from "../profiles";
import type { BrowserUseManagedSessionRecord, BrowserUseRuntimeManager } from "../types";
import { createBrowserUseError } from "../types";
import { ensureBrowserUseDaemonCommandOk } from "./daemon-commands";

export const prepareManagedSession = async (
  runtime: BrowserUseRuntimeManager,
  request?: BrowserUsePrepareSessionRequest,
  existing?: BrowserUseManagedSessionRecord,
): Promise<BrowserUsePreparedSessionResult | BrowserUseManagedSessionRecord> => {
  if (existing !== undefined) {
    return {
      session: existing.session,
      reused: true,
    };
  }

  const mode = request?.mode ?? "managed";
  const authMode = request?.authMode ?? "isolated";
  if (mode !== "managed") {
    throw createBrowserUseError("browser_use_current_tab_unsupported", "Managed session preparation only supports managed mode.");
  }

  let profileName = request?.profileName?.trim();
  if (authMode === "prompt_real_profile") {
    const profiles = await listBrowserUseRealProfiles();
    if (profiles.length === 0) {
      throw createBrowserUseError(
        "profile_required",
        "browser_use could not find any local signed-in browser profiles to use for prompt_real_profile.",
        { authMode },
        false,
      );
    }
    if (profileName && profileName.length > 0) {
      const resolved = resolveBrowserUseProfileSelection(profiles, profileName);
      if (resolved !== undefined) {
        profileName = resolved.profileDirectory;
      }
    } else if (profiles.length === 1) {
      const [onlyProfile] = profiles;
      if (onlyProfile !== undefined) {
        profileName = onlyProfile.profileDirectory;
      }
    } else {
      throw createRealProfileSelectionQuestionError(profiles);
    }
  }

  const sessionId = request?.reuseSessionId?.trim().length ? request.reuseSessionId!.trim() : randomUUID();
  const daemonSessionName = `lyra-${sessionId}`;
  await runtime.startDaemon({
    daemonSessionName,
    headed: request?.headed !== false,
    ...(profileName ? { profileName } : {}),
  });

  const connectData = await ensureBrowserUseDaemonCommandOk(
    runtime,
    {
      session: {
        sessionId,
        mode: "managed",
        authMode,
        backend: "browser_use_daemon",
        ready: true,
        createdAt: Date.now(),
        headed: request?.headed !== false,
        ...(profileName ? { profileName } : {}),
      },
      daemonSessionName,
    },
    "connect",
    {},
  );

  const session: BrowserUseSessionHandle = {
    sessionId,
    mode: "managed",
    authMode,
    backend: "browser_use_daemon",
    ready: true,
    createdAt: Date.now(),
    headed: request?.headed !== false,
    ...(profileName ? { profileName } : {}),
    ...(typeof connectData.cdp_url === "string" ? { cdpUrl: connectData.cdp_url } : {}),
  };

  return {
    session,
    daemonSessionName,
    invalidate: async () => {
      await runtime.stopDaemon(daemonSessionName);
    },
  };
};
