import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  HOST_API_VERSION,
  type ComponentFileV1,
  type ComponentManifestV1
} from "@lyra/app-runtime";

import type { ComponentRegistryStore } from "./registry";

export const LYRA_APP_MODULE_SCHEME = "lyra-app-module";

export type AppModuleRuntimeV1 = {
  readonly componentId: string;
  readonly version: string;
  readonly entryUrl: string;
  readonly permissions: readonly string[];
};

export type AppModuleAsset = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
};

const COMPONENT_ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const normalizeComponentId = (value: unknown): string => {
  if (typeof value !== "string" || !COMPONENT_ID_PATTERN.test(value)) {
    throw new Error("App component id is invalid.");
  }
  return value;
};

const normalizeVersion = (value: unknown): string => {
  if (typeof value !== "string" || !SEMVER_PATTERN.test(value)) {
    throw new Error("App component version is invalid.");
  }
  return value;
};

const compareSemver = (left: string, right: string): number => {
  const leftParts = left.split(/[+-]/u, 1)[0]!.split(".").map(Number);
  const rightParts = right.split(/[+-]/u, 1)[0]!.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
};

const supportsCurrentHostApi = (manifest: ComponentManifestV1): boolean => {
  const range = manifest.hostApiRange;
  return range !== undefined
    && compareSemver(HOST_API_VERSION, range.minInclusive) >= 0
    && (range.maxExclusive === undefined
      || compareSemver(HOST_API_VERSION, range.maxExclusive) < 0);
};

const requireLoadableAppManifest = (manifest: ComponentManifestV1): string => {
  if (manifest.kind !== "app") {
    throw new Error(`Component is not a workspace app: ${manifest.componentId}`);
  }
  if (manifest.executionClass !== "first-party-shared-renderer") {
    throw new Error(
      `Component cannot execute in the shared renderer: ${manifest.componentId}@${manifest.version}`
    );
  }
  if (manifest.activation !== "module-idle") {
    throw new Error(`Workspace app must use module-idle activation: ${manifest.componentId}`);
  }
  if (!supportsCurrentHostApi(manifest)) {
    throw new Error(
      `Workspace app ${manifest.componentId}@${manifest.version} is incompatible with Host API ${HOST_API_VERSION}.`
    );
  }
  if (manifest.entry === undefined) {
    throw new Error(`Workspace app entry is missing: ${manifest.componentId}@${manifest.version}`);
  }
  return manifest.entry;
};

const encodeAssetPath = (value: string): string =>
  value.split("/").map((segment) => encodeURIComponent(segment)).join("/");

const createAssetUrl = (componentId: string, version: string, assetPath: string): string =>
  `${LYRA_APP_MODULE_SCHEME}://component/${encodeURIComponent(componentId)}/${encodeURIComponent(version)}/${encodeAssetPath(assetPath)}`;

const decodeAssetRequest = (
  requestUrl: string
): { readonly componentId: string; readonly version: string; readonly assetPath: string } | null => {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== `${LYRA_APP_MODULE_SCHEME}:`
    || parsed.hostname !== "component"
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    return null;
  }
  try {
    const segments = parsed.pathname
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
    const componentId = segments.shift();
    const version = segments.shift();
    if (componentId === undefined || version === undefined || segments.length === 0) {
      return null;
    }
    if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
      return null;
    }
    return {
      componentId: normalizeComponentId(componentId),
      version: normalizeVersion(version),
      assetPath: segments.join("/")
    };
  } catch {
    return null;
  }
};

const resolveContainedPath = (root: string, relativePath: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`App module asset escapes its package root: ${relativePath}`);
  }
  return resolved;
};

const contentTypeFor = (filePath: string): string => {
  switch (path.extname(filePath).toLowerCase()) {
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
};

const readVerifiedAsset = async (
  packageRoot: string,
  file: ComponentFileV1
): Promise<Uint8Array> => {
  const filePath = resolveContainedPath(packageRoot, file.path);
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== file.size) {
    throw new Error(`App module asset metadata mismatch: ${file.path}`);
  }
  const bytes = await readFile(filePath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== file.sha256) {
    throw new Error(`App module asset digest mismatch: ${file.path}`);
  }
  return bytes;
};

export const createAppModuleAssetService = ({
  componentsRoot,
  registryStore
}: {
  readonly componentsRoot: string;
  readonly registryStore: ComponentRegistryStore;
}) => ({
  resolveEntry: async (request: {
    readonly componentId: unknown;
    readonly version: unknown;
  }): Promise<AppModuleRuntimeV1> => {
    const componentId = normalizeComponentId(request.componentId);
    const version = normalizeVersion(request.version);
    const installed = await registryStore.verifyInstalledVersion(componentId, version);
    const entry = requireLoadableAppManifest(installed.manifest);
    return {
      componentId,
      version,
      entryUrl: createAssetUrl(componentId, version, entry),
      permissions: [...installed.manifest.permissions]
    };
  },
  readAsset: async (requestUrl: string): Promise<AppModuleAsset | null> => {
    const request = decodeAssetRequest(requestUrl);
    if (request === null) {
      return null;
    }
    const installed = await registryStore.verifyInstalledVersion(
      request.componentId,
      request.version
    );
    requireLoadableAppManifest(installed.manifest);
    const file = installed.manifest.files.find(({ path: filePath }) =>
      filePath === request.assetPath);
    if (file === undefined) {
      return null;
    }
    const packageRoot = path.join(
      componentsRoot,
      request.componentId,
      request.version,
      installed.target
    );
    return {
      bytes: await readVerifiedAsset(packageRoot, file),
      contentType: contentTypeFor(file.path)
    };
  }
});
