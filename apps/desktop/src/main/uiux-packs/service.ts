import { ipcMain, protocol } from "electron";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import {
  LYRA_CHANNELS,
  type WorkbenchStateKey
} from "../../shared/desktop-bridge";
import type {
  InstalledUiuxPack,
  UiuxInstallFromGitRequest,
  UiuxInstallFromLocalRequest,
  UiuxInstallFromNpmRequest,
  UiuxListPacksResponse,
  UiuxPackRuntime,
  UiuxRequestActivationRequest,
  UiuxRequestActivationResponse,
  UiuxResolveRuntimeRequest,
  UiuxSetTrustStateRequest
} from "../../shared/uiux-packs";
import type { WorkbenchStateIpcBridge } from "../workbench-state";
import {
  installUiuxPackageFromRoot,
  promotePendingUiuxPackActivation,
  readTrustedUiuxPack,
  readUiuxRegistryDocument,
  requestUiuxPackActivationInRegistry,
  updateUiuxPackTrustState,
  writeUiuxRegistryDocument
} from "./registry";

export const LYRA_UIUX_PACK_SCHEME = "lyra-uiux-pack";

const execFileAsync = promisify(execFile);

const BUILTIN_UIUX_PACKS = [
  {
    id: "classic",
    name: "Classic",
    description: "Current Lyra desktop layout and visual language."
  }
] as const;

const hashSource = (value: unknown): string =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

const createPackAssetUrl = (packId: string, asset: "entry.js" | "style.css"): string =>
  `${LYRA_UIUX_PACK_SCHEME}://pack/${encodeURIComponent(packId)}/${asset}`;

const normalizeString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value.trim();
};

const updatePreferencePackId = (
  workbenchStateBridge: WorkbenchStateIpcBridge,
  packId: string
): void => {
  const key: WorkbenchStateKey = "preferences";
  const raw = workbenchStateBridge.readState(key);
  const parsed =
    typeof raw === "string" && raw.trim().length > 0
      ? JSON.parse(raw) as Record<string, unknown>
      : {};
  workbenchStateBridge.writeState(
    key,
    JSON.stringify({
      ...parsed,
      uiPackId: packId
    })
  );
};

const clearExternalActivation = (storageRoot: string): void => {
  const registry = readUiuxRegistryDocument(storageRoot);
  writeUiuxRegistryDocument(storageRoot, {
    version: 1,
    installed: registry.installed
  });
};

const createRuntimeForPack = (
  storageRoot: string,
  packId: string
): UiuxPackRuntime | null => {
  const pack = readTrustedUiuxPack(storageRoot, packId);
  if (pack === null) {
    return null;
  }
  return {
    packId,
    entryUrl: createPackAssetUrl(packId, "entry.js"),
    ...(pack.cssPath === undefined ? {} : { cssUrl: createPackAssetUrl(packId, "style.css") })
  };
};

const installGitSource = async (
  storageRoot: string,
  request: UiuxInstallFromGitRequest
): Promise<InstalledUiuxPack> => {
  const url = normalizeString(request.url, "git url");
  const sourceRoot = path.join(storageRoot, "sources", "git", hashSource(request));
  rmSync(sourceRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(sourceRoot), { recursive: true });
  const args = [
    "clone",
    "--depth",
    "1",
    ...(typeof request.ref === "string" && request.ref.trim().length > 0
      ? ["--branch", request.ref.trim()]
      : []),
    url,
    sourceRoot
  ];
  await execFileAsync("git", args, { timeout: 120_000 });
  const packageRoot =
    typeof request.subdir === "string" && request.subdir.trim().length > 0
      ? path.join(sourceRoot, request.subdir.trim())
      : sourceRoot;
  return installUiuxPackageFromRoot({
    storageRoot,
    sourceRoot: packageRoot,
    source: {
      kind: "git",
      url,
      ...(typeof request.ref === "string" && request.ref.trim().length > 0
        ? { ref: request.ref.trim() }
        : {}),
      ...(typeof request.subdir === "string" && request.subdir.trim().length > 0
        ? { subdir: request.subdir.trim() }
        : {})
    }
  });
};

const installNpmSource = async (
  storageRoot: string,
  request: UiuxInstallFromNpmRequest
): Promise<InstalledUiuxPack> => {
  const packageName = normalizeString(request.packageName, "npm package name");
  const sourceRoot = path.join(storageRoot, "sources", "npm", hashSource(request));
  rmSync(sourceRoot, { recursive: true, force: true });
  mkdirSync(sourceRoot, { recursive: true });
  const spec =
    typeof request.version === "string" && request.version.trim().length > 0
      ? `${packageName}@${request.version.trim()}`
      : packageName;
  await execFileAsync(
    "npm",
    ["install", "--prefix", sourceRoot, "--ignore-scripts", "--no-audit", "--no-fund", spec],
    { timeout: 120_000 }
  );
  const packageRoot = path.join(sourceRoot, "node_modules", ...packageName.split("/"));
  const sourcePackageRoot =
    typeof request.subdir === "string" && request.subdir.trim().length > 0
      ? path.join(packageRoot, request.subdir.trim())
      : packageRoot;
  return installUiuxPackageFromRoot({
    storageRoot,
    sourceRoot: sourcePackageRoot,
    source: {
      kind: "npm",
      packageName,
      ...(typeof request.version === "string" && request.version.trim().length > 0
        ? { version: request.version.trim() }
        : {}),
      ...(typeof request.subdir === "string" && request.subdir.trim().length > 0
        ? { subdir: request.subdir.trim() }
        : {})
    }
  });
};

const resolveProtocolAsset = (
  storageRoot: string,
  requestUrl: string
): { readonly path: string; readonly contentType: string } | null => {
  const parsedUrl = new URL(requestUrl);
  if (parsedUrl.hostname !== "pack") {
    return null;
  }
  const segments = parsedUrl.pathname.split("/").filter((segment) => segment.length > 0);
  const packId = segments[0] === undefined ? null : decodeURIComponent(segments[0]);
  const asset = segments[1];
  if (packId === null || (asset !== "entry.js" && asset !== "style.css")) {
    return null;
  }
  const pack = readTrustedUiuxPack(storageRoot, packId);
  if (pack === null) {
    return null;
  }
  if (asset === "entry.js") {
    return {
      path: pack.entryPath,
      contentType: "text/javascript; charset=utf-8"
    };
  }
  if (pack.cssPath === undefined) {
    return null;
  }
  return {
    path: pack.cssPath,
    contentType: "text/css; charset=utf-8"
  };
};

const registerUiuxPackProtocol = (storageRoot: string): void => {
  protocol.handle(LYRA_UIUX_PACK_SCHEME, async (request) => {
    const asset = resolveProtocolAsset(storageRoot, request.url);
    if (asset === null) {
      return new Response(new Uint8Array(), { status: 404 });
    }
    try {
      return new Response(readFileSync(asset.path), {
        status: 200,
        headers: {
          "content-type": asset.contentType,
          "cache-control": "private, max-age=5"
        }
      });
    } catch (_error) {
      return new Response(new Uint8Array(), { status: 404 });
    }
  });
};

export type UiuxPacksIpcBridge = {
  readonly dispose: () => void;
};

export const createUiuxPacksIpcBridge = ({
  storageRoot,
  workbenchStateBridge
}: {
  readonly storageRoot: string;
  readonly workbenchStateBridge: WorkbenchStateIpcBridge;
}): UiuxPacksIpcBridge => {
  mkdirSync(storageRoot, { recursive: true });
  promotePendingUiuxPackActivation(storageRoot);
  registerUiuxPackProtocol(storageRoot);

  ipcMain.handle(LYRA_CHANNELS.uiuxListPacks, (): UiuxListPacksResponse => {
    const registry = readUiuxRegistryDocument(storageRoot);
    return {
      builtin: BUILTIN_UIUX_PACKS,
      installed: registry.installed,
      ...(registry.activeExternalPackId === undefined
        ? {}
        : { activeExternalPackId: registry.activeExternalPackId }),
      ...(registry.pendingExternalPackId === undefined
        ? {}
        : { pendingExternalPackId: registry.pendingExternalPackId })
    };
  });
  ipcMain.handle(
    LYRA_CHANNELS.uiuxInstallFromLocal,
    (_event, request: UiuxInstallFromLocalRequest): InstalledUiuxPack =>
      installUiuxPackageFromRoot({
        storageRoot,
        sourceRoot: path.resolve(normalizeString(request.sourcePath, "source path")),
        source: {
          kind: "local",
          path: path.resolve(normalizeString(request.sourcePath, "source path"))
        }
      })
  );
  ipcMain.handle(
    LYRA_CHANNELS.uiuxInstallFromGit,
    async (_event, request: UiuxInstallFromGitRequest): Promise<InstalledUiuxPack> =>
      installGitSource(storageRoot, request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.uiuxInstallFromNpm,
    async (_event, request: UiuxInstallFromNpmRequest): Promise<InstalledUiuxPack> =>
      installNpmSource(storageRoot, request)
  );
  ipcMain.handle(
    LYRA_CHANNELS.uiuxSetTrustState,
    (_event, request: UiuxSetTrustStateRequest): InstalledUiuxPack =>
      updateUiuxPackTrustState({
        storageRoot,
        packId: normalizeString(request.packId, "pack id"),
        trustState: request.trustState
      })
  );
  ipcMain.handle(
    LYRA_CHANNELS.uiuxRequestActivation,
    (_event, request: UiuxRequestActivationRequest): UiuxRequestActivationResponse => {
      const packId = normalizeString(request.packId, "pack id");
      if (packId === "classic") {
        clearExternalActivation(storageRoot);
        updatePreferencePackId(workbenchStateBridge, "classic");
        return {
          packId,
          reloadRequired: false,
          activated: true
        };
      }
      requestUiuxPackActivationInRegistry({ storageRoot, packId });
      updatePreferencePackId(workbenchStateBridge, packId);
      return {
        packId,
        reloadRequired: true,
        activated: false
      };
    }
  );
  ipcMain.handle(
    LYRA_CHANNELS.uiuxResolveRuntime,
    (_event, request: UiuxResolveRuntimeRequest): UiuxPackRuntime | null =>
      createRuntimeForPack(storageRoot, normalizeString(request.packId, "pack id"))
  );

  return {
    dispose: () => {
      protocol.unhandle(LYRA_UIUX_PACK_SCHEME);
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxListPacks);
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxInstallFromLocal);
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxInstallFromGit);
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxInstallFromNpm);
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxSetTrustState);
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxRequestActivation);
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxResolveRuntime);
    }
  };
};
