import { existsSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import type { ComponentSummary } from "../../shared/desktop-bridge";
import {
  createAppModuleAssetUrl,
  decodeAppModuleAssetRequest,
  type AppModuleAsset,
  type AppModuleRuntimeV1
} from "./app-module-assets";

const ENTRY_FILE = "index.mjs";
const PACKAGE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const COMPONENT_TARGETS = new Set([
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
]);

/**
 * ponytail: unsigned source-tree overlay for complete apps only. Add a row
 * when another unit leaves preview; never overlay preview packages. Packaged
 * builds must not construct this overlay.
 */
export const COMPLETE_APP_DEV_OVERLAYS = [
  {
    componentId: "lyra.notifications",
    packageDirectory: "lyra-notifications",
    permissions: ["notifications:read"]
  },
  {
    componentId: "lyra.credentials",
    packageDirectory: "lyra-credentials",
    permissions: ["credentials:read", "credentials:write", "browser:navigate", "settings:open"]
  },
  {
    componentId: "lyra.downloads",
    packageDirectory: "lyra-downloads",
    permissions: ["downloads:read", "downloads:write"]
  }
] as const;

type DiscoveredOverlay = {
  readonly componentId: string;
  readonly version: string;
  readonly permissions: readonly string[];
  readonly entryPath: string;
  readonly installedAt: string;
  readonly target: string;
};

export const resolveCompleteAppDevOverlayRoot = (cwd: string): string | undefined => {
  const candidates = [path.resolve(cwd), path.resolve(cwd, "..", "..")];
  return candidates.find((root) =>
    existsSync(path.join(root, "apps", "desktop", "package.json"))
    && COMPLETE_APP_DEV_OVERLAYS.every((spec) =>
      existsSync(path.join(root, "apps", spec.packageDirectory, "package.json"))));
};

const overlayTarget = (): string | undefined => {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const candidate = `${platform}-${process.arch}`;
  return COMPONENT_TARGETS.has(candidate) ? candidate : undefined;
};

const readPackageVersion = async (packageJsonPath: string): Promise<string | undefined> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (
      typeof parsed !== "object"
      || parsed === null
      || !("version" in parsed)
      || typeof parsed.version !== "string"
      || !PACKAGE_VERSION_PATTERN.test(parsed.version)
    ) {
      return undefined;
    }
    return parsed.version;
  } catch {
    return undefined;
  }
};

const discoverOverlays = async (repoRoot: string): Promise<readonly DiscoveredOverlay[]> => {
  const target = overlayTarget();
  if (target === undefined) {
    return [];
  }
  const discovered: DiscoveredOverlay[] = [];
  for (const spec of COMPLETE_APP_DEV_OVERLAYS) {
    const packageRoot = path.join(repoRoot, "apps", spec.packageDirectory);
    const version = await readPackageVersion(path.join(packageRoot, "package.json"));
    if (version === undefined) {
      continue;
    }
    const entryPath = path.join(packageRoot, "dist", ENTRY_FILE);
    try {
      const metadata = await lstat(entryPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        continue;
      }
      discovered.push({
        componentId: spec.componentId,
        version,
        permissions: spec.permissions,
        entryPath,
        installedAt: metadata.mtime.toISOString(),
        target
      });
    } catch {
      continue;
    }
  }
  return discovered;
};

const toSummary = (overlay: DiscoveredOverlay): ComponentSummary => ({
  componentId: overlay.componentId,
  kind: "app",
  active: overlay.version,
  versions: [{
    version: overlay.version,
    installedAt: overlay.installedAt,
    target: overlay.target
  }]
});

export const createCompleteAppDevOverlay = (repoRoot: string) => {
  const find = async (
    componentId: string,
    version: string
  ): Promise<DiscoveredOverlay | undefined> =>
    (await discoverOverlays(repoRoot)).find((item) =>
      item.componentId === componentId && item.version === version);

  return {
    mergeList: async (
      installed: readonly ComponentSummary[]
    ): Promise<readonly ComponentSummary[]> => {
      const installedIds = new Set(installed.map((item) => item.componentId));
      return [
        ...installed,
        ...(await discoverOverlays(repoRoot))
          .filter((item) => installedIds.has(item.componentId) === false)
          .map(toSummary)
      ];
    },
    resolve: async (
      componentId: string,
      version: string
    ): Promise<AppModuleRuntimeV1 | null> => {
      const overlay = await find(componentId, version);
      if (overlay === undefined) {
        return null;
      }
      return {
        componentId: overlay.componentId,
        version: overlay.version,
        entryUrl: createAppModuleAssetUrl(overlay.componentId, overlay.version, ENTRY_FILE),
        permissions: [...overlay.permissions]
      };
    },
    readAsset: async (requestUrl: string): Promise<AppModuleAsset | null> => {
      const request = decodeAppModuleAssetRequest(requestUrl);
      if (request === null || request.assetPath !== ENTRY_FILE) {
        return null;
      }
      const overlay = await find(request.componentId, request.version);
      if (overlay === undefined) {
        return null;
      }
      const metadata = await lstat(overlay.entryPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        return null;
      }
      return {
        bytes: await readFile(overlay.entryPath),
        contentType: "text/javascript; charset=utf-8"
      };
    }
  };
};
