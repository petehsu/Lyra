import { ipcMain, protocol } from "electron";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  UiuxSetTrustStateRequest,
  UiuxUninstallRequest,
  UiuxUninstallResponse
} from "../../shared/uiux-packs";
import type { WorkbenchStateIpcBridge } from "../workbench-state";
import {
  installUiuxPackageFromRoot,
  promotePendingUiuxPackActivation,
  readTrustedUiuxPack,
  readUiuxRegistryDocument,
  requestUiuxPackActivationInRegistry,
  uninstallUiuxPack,
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

const normalizeSafeSubdir = (
  sourceRoot: string,
  value: unknown,
  fieldName: string
): string | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const subdir = value.trim();
  if (path.isAbsolute(subdir) || subdir.includes("\0")) {
    throw new Error(`${fieldName} must be a relative path inside the package`);
  }
  const root = path.resolve(sourceRoot);
  const resolved = path.resolve(root, subdir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${fieldName} must stay inside the package`);
  }
  return resolved;
};

const normalizeGitUrl = (value: unknown): string => {
  const url = normalizeString(value, "git url");
  if (/[\0\r\n]/u.test(url)) {
    throw new Error("git url contains invalid characters");
  }
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/u.test(url)) {
    return url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("git url must be https:// or ssh://");
  }
  if (!["https:", "ssh:", "git+ssh:"].includes(parsed.protocol)) {
    throw new Error("git url protocol must be https:// or ssh://");
  }
  if (parsed.hostname.trim().length === 0) {
    throw new Error("git url host is required");
  }
  return url;
};

const normalizeNpmPackageName = (value: unknown): string => {
  const packageName = normalizeString(value, "npm package name");
  if (
    packageName.length > 214 ||
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName)
  ) {
    throw new Error("npm package name is invalid");
  }
  return packageName;
};

const normalizeNpmVersion = (value: unknown): string | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const version = value.trim();
  if (
    version.length > 128 ||
    /[\0\r\n]/u.test(version) ||
    /^(?:file|link|workspace|http|https|git|github|git\+ssh):/iu.test(version) ||
    !/^[A-Za-z0-9._~^*<>=|-]+$/u.test(version)
  ) {
    throw new Error("npm version is invalid");
  }
  return version;
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

// ponytail: 从 l10n 目录加载所有 {locale}.json — 文件名即 locale，内容即 bundle
// ceiling: 不递归子目录；locale 文件名须匹配 /^[a-z]{2,3}-[A-Z]{2,3}$/ 或 BCP-47 子集
const loadL10nBundles = (
  l10nPath: string | undefined
): Record<string, Record<string, string>> | undefined => {
  if (l10nPath === undefined) {
    return undefined;
  }
  let entries: readonly string[];
  try {
    entries = readdirSync(l10nPath);
  } catch {
    return undefined;
  }
  const bundles: Record<string, Record<string, string>> = {};
  for (const fileName of entries) {
    if (fileName.endsWith(".json") === false) {
      continue;
    }
    const locale = fileName.slice(0, -5);
    try {
      const parsed = JSON.parse(readFileSync(path.join(l10nPath, fileName), "utf-8")) as Record<string, unknown>;
      // ponytail: 只接受 Record<string, string> 结构 — 深层嵌套或非字符串值跳过
      const bundle: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          bundle[key] = value;
        }
      }
      if (Object.keys(bundle).length > 0) {
        bundles[locale] = bundle;
      }
    } catch {
      // ponytail: 损坏的 JSON 文件静默跳过 — 不阻塞 pack 加载
    }
  }
  return Object.keys(bundles).length > 0 ? bundles : undefined;
};

const createRuntimeForPack = (
  storageRoot: string,
  packId: string
): UiuxPackRuntime | null => {
  const pack = readTrustedUiuxPack(storageRoot, packId);
  if (pack === null) {
    return null;
  }
  const l10nBundles = loadL10nBundles(pack.l10nPath);
  return {
    packId,
    entryUrl: createPackAssetUrl(packId, "entry.js"),
    ...(pack.cssPath === undefined ? {} : { cssUrl: createPackAssetUrl(packId, "style.css") }),
    software: pack.manifest.software,
    ...(l10nBundles === undefined ? {} : { l10nBundles })
  };
};

const installGitSource = async (
  storageRoot: string,
  request: UiuxInstallFromGitRequest
): Promise<InstalledUiuxPack> => {
  const url = normalizeGitUrl(request.url);
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
  await execFileAsync("git", args, {
    timeout: 120_000,
    env: { ...process.env, GIT_ALLOW_PROTOCOL: "https:ssh:git+ssh" }
  });
  const packageRoot = normalizeSafeSubdir(sourceRoot, request.subdir, "git subdir") ?? sourceRoot;
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
  const packageName = normalizeNpmPackageName(request.packageName);
  const sourceRoot = path.join(storageRoot, "sources", "npm", hashSource(request));
  rmSync(sourceRoot, { recursive: true, force: true });
  mkdirSync(sourceRoot, { recursive: true });
  const version = normalizeNpmVersion(request.version);
  const spec = version === null ? packageName : `${packageName}@${version}`;
  await execFileAsync(
    "npm",
    ["install", "--prefix", sourceRoot, "--ignore-scripts", "--no-audit", "--no-fund", spec],
    { timeout: 120_000 }
  );
  const packageRoot = path.join(sourceRoot, "node_modules", ...packageName.split("/"));
  const sourcePackageRoot =
    normalizeSafeSubdir(packageRoot, request.subdir, "npm subdir") ?? packageRoot;
  return installUiuxPackageFromRoot({
    storageRoot,
    sourceRoot: sourcePackageRoot,
    source: {
      kind: "npm",
      packageName,
      ...(version === null ? {} : { version }),
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
    LYRA_CHANNELS.uiuxUninstall,
    (_event, request: UiuxUninstallRequest): UiuxUninstallResponse =>
      uninstallUiuxPack({
        storageRoot,
        packId: normalizeString(request.packId, "pack id")
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
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxUninstall);
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxRequestActivation);
      ipcMain.removeHandler(LYRA_CHANNELS.uiuxResolveRuntime);
    }
  };
};
