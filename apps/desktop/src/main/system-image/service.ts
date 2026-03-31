import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";

import {
  LYRA_CHANNELS,
  type LyraSystemAssignSessionImageRequest,
  type LyraSystemClearSessionImageOverrideRequest,
  type LyraSystemEvent,
  type LyraSystemImageDescriptor,
  type LyraSystemImageManifest,
  type LyraSystemInstallFromDirectoryRequest,
  type LyraSystemInstallFromPackageRequest,
  type LyraSystemReadResolvedSessionRequest,
  type LyraSystemRegistryState,
  type LyraSystemResolvedSession,
  type LyraSystemSetDefaultImageRequest,
  type LyraSystemSetRuntimeModeOverrideRequest,
  type LyraSystemUninstallRequest
} from "../../shared/desktop-bridge";
import { loadSystemImageNativeBindings } from "./native-loader";
import type {
  NativeSystemAssignSessionImageRequest,
  NativeSystemClearSessionImageOverrideRequest,
  NativeSystemInstallFromDirectoryRequest,
  NativeSystemInstallFromPackageRequest,
  NativeSystemInstallSeedRequest,
  NativeSystemReadResolvedSessionRequest,
  NativeSystemSetDefaultImageRequest,
  NativeSystemSetRuntimeModeOverrideRequest,
  NativeSystemUninstallRequest,
  SystemImageIpcBridge,
  SystemImageNativeBindings
} from "./types";

const OFFICIAL_SYSTEM_IMAGE_ID = "lyra-official";

const OFFICIAL_SYSTEM_SEED_MANIFEST: LyraSystemImageManifest = {
  id: OFFICIAL_SYSTEM_IMAGE_ID,
  title: "Lyra Official System",
  version: "1.0.0",
  apiVersion: {
    min: "1.0.0",
    max: "1.0.0"
  },
  shellMode: "full-shell",
  defaultRuntimeMode: "sandbox",
  entryPath: "system/index.js",
  capabilities: ["*"],
  platformArtifacts: [
    {
      platform: "any",
      arch: "any",
      kind: "js-module",
      path: "system/index.js"
    }
  ]
};

const nowIso = (): string => new Date().toISOString();

const parseJsonResponse = <T>(value: string): T => JSON.parse(value) as T;

const invokeNativeJson = <TRequest extends object, TResponse>(
  method: (requestJson: string) => string,
  request: TRequest
): TResponse => parseJsonResponse<TResponse>(method(JSON.stringify(request)));

const readRegistry = (
  bindings: SystemImageNativeBindings,
  storageRoot: string
): LyraSystemRegistryState =>
  invokeNativeJson(
    bindings.readSystemImageRegistryJson,
    { storageRoot }
  );

const listInstalled = (
  bindings: SystemImageNativeBindings,
  storageRoot: string
): readonly LyraSystemImageDescriptor[] =>
  invokeNativeJson(
    bindings.listInstalledSystemImagesJson,
    { storageRoot }
  );

const readResolvedSession = (
  bindings: SystemImageNativeBindings,
  request: NativeSystemReadResolvedSessionRequest
): LyraSystemResolvedSession =>
  invokeNativeJson(
    bindings.readResolvedSessionSystemJson,
    request
  );

const publishSystemEvent = (
  getWindow: () => BrowserWindow | null,
  event: LyraSystemEvent
): void => {
  const window = getWindow();
  if (window === null || window.isDestroyed()) {
    return;
  }
  window.webContents.send(LYRA_CHANNELS.systemImagesEvent, event);
};

const publishRegistryEvent = (
  getWindow: () => BrowserWindow | null,
  state: LyraSystemRegistryState
): void => {
  publishSystemEvent(getWindow, {
    kind: "registry-updated",
    state,
    timestamp: nowIso()
  });
};

const publishSessionEvent = (
  getWindow: () => BrowserWindow | null,
  resolved: LyraSystemResolvedSession
): void => {
  publishSystemEvent(getWindow, {
    kind: "session-updated",
    sessionId: resolved.sessionId,
    resolved,
    timestamp: nowIso()
  });
};

const installOfficialSeed = (
  bindings: SystemImageNativeBindings,
  storageRoot: string
): LyraSystemImageDescriptor => {
  const installed = listInstalled(bindings, storageRoot);
  const existing = installed.find((descriptor) => descriptor.imageId === OFFICIAL_SYSTEM_IMAGE_ID);
  if (existing !== undefined) {
    return existing;
  }

  const request: NativeSystemInstallSeedRequest = {
    storageRoot,
    manifest: OFFICIAL_SYSTEM_SEED_MANIFEST
  };
  return invokeNativeJson(
    bindings.installSystemImageSeedJson,
    request
  );
};

export const createSystemImageIpcBridge = (
  storageRoot: string,
  getWindow: () => BrowserWindow | null
): SystemImageIpcBridge => {
  const loadResult = loadSystemImageNativeBindings();
  if (loadResult.ok === false) {
    throw new Error(
      `system-image native unavailable: ${loadResult.errorMessage}\ntried paths:\n${loadResult.triedPaths.join("\n")}`
    );
  }

  const bindings = loadResult.bindings;
  const safeEnsureOfficialSeed = (): void => {
    try {
      const descriptor = installOfficialSeed(bindings, storageRoot);
      const registry = readRegistry(bindings, storageRoot);
      publishRegistryEvent(getWindow, registry);
      console.info(`[lyra-system-image] official seed ready: ${descriptor.imageId}@${descriptor.version}`);
    } catch (error) {
      console.error(`[lyra-system-image] failed to ensure official seed: ${String(error)}`);
    }
  };

  safeEnsureOfficialSeed();

  const handlers: Array<
    readonly [string, (event: IpcMainInvokeEvent, payload?: unknown) => unknown]
  > = [
    [
      LYRA_CHANNELS.systemImagesReadRegistry,
      () => readRegistry(bindings, storageRoot)
    ],
    [
      LYRA_CHANNELS.systemImagesListInstalled,
      () => listInstalled(bindings, storageRoot)
    ],
    [
      LYRA_CHANNELS.systemImagesInstallFromDirectory,
      (_event, payload) => {
        const request = payload as LyraSystemInstallFromDirectoryRequest;
        const descriptor = invokeNativeJson<
          NativeSystemInstallFromDirectoryRequest,
          LyraSystemImageDescriptor
        >(bindings.installSystemImageFromDirectoryJson, {
          storageRoot,
          ...request
        });
        publishRegistryEvent(getWindow, readRegistry(bindings, storageRoot));
        return descriptor;
      }
    ],
    [
      LYRA_CHANNELS.systemImagesInstallFromPackage,
      (_event, payload) => {
        const request = payload as LyraSystemInstallFromPackageRequest;
        const descriptor = invokeNativeJson<
          NativeSystemInstallFromPackageRequest,
          LyraSystemImageDescriptor
        >(bindings.installSystemImageFromPackageJson, {
          storageRoot,
          ...request
        });
        publishRegistryEvent(getWindow, readRegistry(bindings, storageRoot));
        return descriptor;
      }
    ],
    [
      LYRA_CHANNELS.systemImagesInstallOfficialSeed,
      () => {
        const descriptor = installOfficialSeed(bindings, storageRoot);
        publishRegistryEvent(getWindow, readRegistry(bindings, storageRoot));
        return descriptor;
      }
    ],
    [
      LYRA_CHANNELS.systemImagesUninstall,
      (_event, payload) => {
        const request = payload as LyraSystemUninstallRequest;
        const state = invokeNativeJson<
          NativeSystemUninstallRequest,
          LyraSystemRegistryState
        >(bindings.uninstallSystemImageJson, {
          storageRoot,
          ...request
        });
        publishRegistryEvent(getWindow, state);
        return state;
      }
    ],
    [
      LYRA_CHANNELS.systemImagesSetDefault,
      (_event, payload) => {
        const request = payload as LyraSystemSetDefaultImageRequest;
        const state = invokeNativeJson<
          NativeSystemSetDefaultImageRequest,
          LyraSystemRegistryState
        >(bindings.setDefaultSystemImageJson, {
          storageRoot,
          ...request
        });
        publishRegistryEvent(getWindow, state);
        return state;
      }
    ],
    [
      LYRA_CHANNELS.systemImagesAssignSession,
      (_event, payload) => {
        const request = payload as LyraSystemAssignSessionImageRequest;
        const resolved = invokeNativeJson<
          NativeSystemAssignSessionImageRequest,
          LyraSystemResolvedSession
        >(bindings.assignSessionSystemImageJson, {
          storageRoot,
          ...request
        });
        publishSessionEvent(getWindow, resolved);
        return resolved;
      }
    ],
    [
      LYRA_CHANNELS.systemImagesClearSessionOverride,
      (_event, payload) => {
        const request = payload as LyraSystemClearSessionImageOverrideRequest;
        const resolved = invokeNativeJson<
          NativeSystemClearSessionImageOverrideRequest,
          LyraSystemResolvedSession
        >(bindings.clearSessionSystemImageOverrideJson, {
          storageRoot,
          ...request
        });
        publishSessionEvent(getWindow, resolved);
        return resolved;
      }
    ],
    [
      LYRA_CHANNELS.systemImagesSetRuntimeModeOverride,
      (_event, payload) => {
        const request = payload as LyraSystemSetRuntimeModeOverrideRequest;
        const state = invokeNativeJson<
          NativeSystemSetRuntimeModeOverrideRequest,
          LyraSystemRegistryState
        >(bindings.setSystemRuntimeModeOverrideJson, {
          storageRoot,
          ...request
        });
        publishRegistryEvent(getWindow, state);
        if (typeof request.sessionId === "string" && request.sessionId.length > 0) {
          const resolved = readResolvedSession(bindings, {
            storageRoot,
            sessionId: request.sessionId
          });
          publishSessionEvent(getWindow, resolved);
        }
        return state;
      }
    ],
    [
      LYRA_CHANNELS.systemImagesReadResolvedSession,
      (_event, payload) =>
        readResolvedSession(bindings, {
          storageRoot,
          ...(payload as LyraSystemReadResolvedSessionRequest)
        })
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    dispose: () => {
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
    },
    loadResult
  };
};
