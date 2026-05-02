import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

import { app } from "electron";

export type BrowserUseBundleTargetId =
  | "linux-x64"
  | "linux-arm64"
  | "darwin-x64"
  | "darwin-arm64"
  | "win32-x64"
  | "win32-arm64";

export type BrowserUseBundleTarget = {
  readonly id: BrowserUseBundleTargetId;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly pythonBinary: string;
};

export type BrowserUseBundleFileManifest = {
  readonly path: string;
  readonly sha256?: string;
  readonly executable?: boolean;
};

export type BrowserUseBundleManifest = {
  readonly bundleVersion: string;
  readonly target: BrowserUseBundleTargetId;
  readonly browserUsePin: string;
  readonly pythonBinary: string;
  readonly pythonArchive: string;
  readonly browserUseWheel: string;
  readonly wheelhouseDir: string;
  readonly files: readonly BrowserUseBundleFileManifest[];
};

export type BrowserUseBundle = {
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly manifest: BrowserUseBundleManifest;
  readonly target: BrowserUseBundleTarget;
};

const BUNDLE_TARGETS: readonly BrowserUseBundleTarget[] = [
  {
    id: "linux-x64",
    platform: "linux",
    arch: "x64",
    pythonBinary: "python/bin/python3.12",
  },
  {
    id: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    pythonBinary: "python/bin/python3.12",
  },
  {
    id: "darwin-x64",
    platform: "darwin",
    arch: "x64",
    pythonBinary: "python/bin/python3.12",
  },
  {
    id: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    pythonBinary: "python/bin/python3.12",
  },
  {
    id: "win32-x64",
    platform: "win32",
    arch: "x64",
    pythonBinary: "python/python.exe",
  },
  {
    id: "win32-arm64",
    platform: "win32",
    arch: "arm64",
    pythonBinary: "python/python.exe",
  },
] as const;

const BUNDLE_MANIFEST_NAME = "manifest.json";

const isAccessible = async (candidatePath: string): Promise<boolean> => {
  try {
    await access(candidatePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

export const resolveCurrentBrowserUseBundleTarget = (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): BrowserUseBundleTarget | null =>
  BUNDLE_TARGETS.find((target) => target.platform === platform && target.arch === arch) ?? null;

export const resolveBrowserUseBundleRoots = (): readonly string[] => {
  const appPath = app.getAppPath();
  const resourcesPath =
    typeof process.resourcesPath === "string" && process.resourcesPath.length > 0
      ? process.resourcesPath
      : "";
  const cwd = process.cwd();
  return Array.from(
    new Set(
      [
        path.join(resourcesPath, "browser-use"),
        path.join(resourcesPath, "resources", "browser-use"),
        path.join(appPath, "resources", "browser-use"),
        path.join(cwd, "apps/desktop/resources/browser-use"),
      ].filter((value) => value.length > 0),
    ),
  );
};

const normalizeManifest = (
  manifestPath: string,
  target: BrowserUseBundleTarget,
  value: unknown,
): BrowserUseBundleManifest | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const files = Array.isArray(record.files)
    ? record.files.flatMap((entry) => {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
          return [];
        }
        const fileRecord = entry as Record<string, unknown>;
        if (typeof fileRecord.path !== "string" || fileRecord.path.trim().length === 0) {
          return [];
        }
        return [{
          path: fileRecord.path.trim(),
          ...(typeof fileRecord.sha256 === "string" && fileRecord.sha256.trim().length > 0
            ? { sha256: fileRecord.sha256.trim().toLowerCase() }
            : {}),
          ...(fileRecord.executable === true ? { executable: true } : {}),
        }];
      })
    : [];
  if (
    typeof record.bundleVersion !== "string"
    || record.bundleVersion.trim().length === 0
    || record.target !== target.id
    || typeof record.browserUsePin !== "string"
    || record.browserUsePin.trim().length === 0
    || typeof record.pythonBinary !== "string"
    || record.pythonBinary.trim().length === 0
    || typeof record.pythonArchive !== "string"
    || record.pythonArchive.trim().length === 0
    || typeof record.browserUseWheel !== "string"
    || record.browserUseWheel.trim().length === 0
    || typeof record.wheelhouseDir !== "string"
    || record.wheelhouseDir.trim().length === 0
    || files.length === 0
  ) {
    return null;
  }
  return {
    bundleVersion: record.bundleVersion.trim(),
    target: target.id,
    browserUsePin: record.browserUsePin.trim(),
    pythonBinary: record.pythonBinary.trim(),
    pythonArchive: record.pythonArchive.trim(),
    browserUseWheel: record.browserUseWheel.trim(),
    wheelhouseDir: record.wheelhouseDir.trim(),
    files,
  };
};

export const resolveBundledBrowserUseBundle = async (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): Promise<BrowserUseBundle | null> => {
  const target = resolveCurrentBrowserUseBundleTarget(platform, arch);
  if (target === null) {
    return null;
  }

  for (const root of resolveBrowserUseBundleRoots()) {
    const candidateRoot = path.join(root, target.id);
    const manifestPath = path.join(candidateRoot, BUNDLE_MANIFEST_NAME);
    if (!(await isAccessible(manifestPath))) {
      continue;
    }
    try {
      const raw = await readFile(manifestPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const manifest = normalizeManifest(manifestPath, target, parsed);
      if (manifest === null) {
        continue;
      }
      return {
        rootPath: candidateRoot,
        manifestPath,
        manifest,
        target,
      };
    } catch {
      continue;
    }
  }

  return null;
};
