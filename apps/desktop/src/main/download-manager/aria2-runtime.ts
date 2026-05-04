import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  readFileSync
} from "node:fs";
import path from "node:path";

export type Aria2BundleTargetId =
  | "linux-x64"
  | "linux-arm64"
  | "darwin-x64"
  | "darwin-arm64"
  | "win32-x64"
  | "win32-arm64";

export type Aria2BundleTarget = {
  readonly id: Aria2BundleTargetId;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly binaryFileName: string;
};

export type Aria2BundleManifestFile = {
  readonly path: string;
  readonly sha256: string;
  readonly executable?: boolean | undefined;
};

export type Aria2BundleManifest = {
  readonly bundleVersion: string;
  readonly target: Aria2BundleTargetId;
  readonly binary: string;
  readonly source: string;
  readonly packages?: readonly string[] | undefined;
  readonly files: readonly Aria2BundleManifestFile[];
};

export type Aria2RuntimeResolution =
  | {
      readonly available: true;
      readonly binaryPath: string;
      readonly source: "bundled" | "path";
      readonly target: Aria2BundleTarget | null;
      readonly manifest: Aria2BundleManifest | null;
    }
  | {
      readonly available: false;
      readonly binaryPath: null;
      readonly source: "missing";
      readonly target: Aria2BundleTarget | null;
      readonly manifest: null;
      readonly candidates: readonly string[];
    };

export type Aria2RuntimeResolutionOptions = {
  readonly platform?: NodeJS.Platform | undefined;
  readonly arch?: NodeJS.Architecture | undefined;
  readonly appPath?: string | undefined;
  readonly resourcesPath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly allowPathFallback?: boolean | undefined;
};

export const ARIA2_BUNDLE_TARGETS: readonly Aria2BundleTarget[] = [
  {
    id: "linux-x64",
    platform: "linux",
    arch: "x64",
    binaryFileName: "aria2c"
  },
  {
    id: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    binaryFileName: "aria2c"
  },
  {
    id: "darwin-x64",
    platform: "darwin",
    arch: "x64",
    binaryFileName: "aria2c"
  },
  {
    id: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    binaryFileName: "aria2c"
  },
  {
    id: "win32-x64",
    platform: "win32",
    arch: "x64",
    binaryFileName: "aria2c.exe"
  },
  {
    id: "win32-arm64",
    platform: "win32",
    arch: "arm64",
    binaryFileName: "aria2c.exe"
  }
] as const;

const isExecutable = (candidatePath: string, platform: NodeJS.Platform): boolean => {
  try {
    accessSync(candidatePath, platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isManifestFile = (value: unknown): value is Aria2BundleManifestFile =>
  isRecord(value)
  && typeof value.path === "string"
  && value.path.length > 0
  && typeof value.sha256 === "string"
  && value.sha256.length > 0
  && (value.executable === undefined || typeof value.executable === "boolean");

const isAria2BundleManifest = (value: unknown): value is Aria2BundleManifest =>
  isRecord(value)
  && typeof value.bundleVersion === "string"
  && value.bundleVersion.trim().length > 0
  && typeof value.target === "string"
  && typeof value.binary === "string"
  && value.binary.trim().length > 0
  && typeof value.source === "string"
  && value.source.trim().length > 0
  && (value.packages === undefined || (
    Array.isArray(value.packages)
    && value.packages.every((entry) => typeof entry === "string" && entry.length > 0)
  ))
  && Array.isArray(value.files)
  && value.files.every(isManifestFile);

const normalizeManifestPath = (value: string): string =>
  value.split(path.sep).join("/");

const isSafeRelativePath = (value: string): boolean => {
  const normalized = normalizeManifestPath(value);
  return normalized.length > 0
    && path.isAbsolute(normalized) === false
    && normalized.split("/").every((part) => part.length > 0 && part !== "..");
};

const resolveManifestRelativePath = (root: string, relativePath: string): string | null => {
  if (isSafeRelativePath(relativePath) === false) {
    return null;
  }
  const resolved = path.resolve(root, relativePath);
  const rootWithSeparator = path.resolve(root) + path.sep;
  return resolved === path.resolve(root) || resolved.startsWith(rootWithSeparator)
    ? resolved
    : null;
};

const sha256FileSync = (filePath: string): string =>
  createHash("sha256").update(readFileSync(filePath)).digest("hex");

const readJsonFileSync = (filePath: string): unknown => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const validateManifestFiles = (
  root: string,
  files: readonly Aria2BundleManifestFile[],
  platform: NodeJS.Platform
): boolean => {
  for (const file of files) {
    const absolutePath = resolveManifestRelativePath(root, file.path);
    if (absolutePath === null) {
      return false;
    }
    try {
      if (sha256FileSync(absolutePath) !== file.sha256) {
        return false;
      }
      if (file.executable === true && isExecutable(absolutePath, platform) === false) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
};

export const readVerifiedAria2BundleManifest = (
  manifestPath: string,
  target: Aria2BundleTarget,
  platform: NodeJS.Platform,
  options: {
    readonly verifyAllFiles?: boolean | undefined;
  } = {}
): {
  readonly manifest: Aria2BundleManifest;
  readonly binaryPath: string;
} | null => {
  const root = path.dirname(manifestPath);
  const parsed = readJsonFileSync(manifestPath);
  if (isAria2BundleManifest(parsed) === false || parsed.target !== target.id) {
    return null;
  }
  const binaryPath = resolveManifestRelativePath(root, parsed.binary);
  if (binaryPath === null || isExecutable(binaryPath, platform) === false) {
    return null;
  }
  const binaryManifestFile = parsed.files.find((file) =>
    normalizeManifestPath(file.path) === normalizeManifestPath(parsed.binary)
  );
  if (binaryManifestFile === undefined) {
    return null;
  }
  const filesToVerify = options.verifyAllFiles === true
    ? parsed.files
    : [binaryManifestFile];
  if (validateManifestFiles(root, filesToVerify, platform) === false) {
    return null;
  }
  return {
    manifest: parsed,
    binaryPath
  };
};

export const resolveCurrentAria2BundleTarget = (
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): Aria2BundleTarget | null =>
  ARIA2_BUNDLE_TARGETS.find((target) => target.platform === platform && target.arch === arch) ?? null;

export const resolveAria2BundleRoots = ({
  appPath,
  resourcesPath,
  cwd
}: {
  readonly appPath?: string | undefined;
  readonly resourcesPath?: string | undefined;
  readonly cwd?: string | undefined;
}): readonly string[] => {
  const roots = [
    resourcesPath === undefined ? "" : path.join(resourcesPath, "aria2"),
    resourcesPath === undefined ? "" : path.join(resourcesPath, "resources", "aria2"),
    appPath === undefined ? "" : path.join(appPath, "resources", "aria2"),
    cwd === undefined ? "" : path.join(cwd, "apps/desktop/resources/aria2")
  ].filter((value) => value.length > 0);
  return Array.from(new Set(roots));
};

export const resolveBundledAria2Candidates = (
  roots: readonly string[],
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): readonly string[] => {
  const target = resolveCurrentAria2BundleTarget(platform, arch);
  if (target === null) {
    return [];
  }
  return Array.from(new Set(
    roots.flatMap((root) => [
      path.join(root, target.id, target.binaryFileName),
      path.join(root, target.binaryFileName)
    ])
  ));
};

export const resolveBundledAria2ManifestCandidates = (
  roots: readonly string[],
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): readonly string[] => {
  const target = resolveCurrentAria2BundleTarget(platform, arch);
  if (target === null) {
    return [];
  }
  return Array.from(new Set(
    roots.flatMap((root) => [
      path.join(root, target.id, "manifest.json"),
      path.join(root, "manifest.json")
    ])
  ));
};

const resolvePathFallbackCandidates = (
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): readonly string[] => {
  const pathValue = env.PATH ?? "";
  const pathExt = platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter((value) => value.length > 0)
    : [""];
  const binaryNames = platform === "win32" ? ["aria2c.exe", "aria2c"] : ["aria2c"];
  return pathValue
    .split(path.delimiter)
    .filter((entry) => entry.length > 0)
    .flatMap((entry) =>
      binaryNames.flatMap((binaryName) =>
        pathExt.map((extension) =>
          binaryName.toLowerCase().endsWith(extension.toLowerCase())
            ? path.join(entry, binaryName)
            : path.join(entry, `${binaryName}${extension.toLowerCase()}`)
        )
      )
    );
};

export const resolveAria2Runtime = (
  options: Aria2RuntimeResolutionOptions = {}
): Aria2RuntimeResolution => {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const env = options.env ?? process.env;
  const target = resolveCurrentAria2BundleTarget(platform, arch);
  const bundleRoots = resolveAria2BundleRoots({
    appPath: options.appPath,
    resourcesPath: options.resourcesPath,
    cwd: options.cwd ?? process.cwd()
  });
  const manifestCandidates = resolveBundledAria2ManifestCandidates(
    bundleRoots,
    platform,
    arch
  );
  if (target !== null) {
    for (const manifestPath of manifestCandidates) {
      const manifestResult = readVerifiedAria2BundleManifest(manifestPath, target, platform);
      if (manifestResult !== null) {
        return {
          available: true,
          binaryPath: manifestResult.binaryPath,
          source: "bundled",
          target,
          manifest: manifestResult.manifest
        };
      }
    }
  }
  const bundledCandidates = resolveBundledAria2Candidates(
    bundleRoots,
    platform,
    arch
  );
  const bundledBinaryPath = bundledCandidates.find((candidate) => isExecutable(candidate, platform));
  if (bundledBinaryPath !== undefined) {
    return {
      available: true,
      binaryPath: bundledBinaryPath,
      source: "bundled",
      target,
      manifest: null
    };
  }

  const pathCandidates = options.allowPathFallback === true
    ? resolvePathFallbackCandidates(platform, env)
    : [];
  const pathBinaryPath = pathCandidates.find((candidate) => isExecutable(candidate, platform));
  if (pathBinaryPath !== undefined) {
    return {
      available: true,
      binaryPath: pathBinaryPath,
      source: "path",
      target,
      manifest: null
    };
  }

  return {
    available: false,
    binaryPath: null,
    source: "missing",
    target,
    manifest: null,
    candidates: [...manifestCandidates, ...bundledCandidates, ...pathCandidates]
  };
};
