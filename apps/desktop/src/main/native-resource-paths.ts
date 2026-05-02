import path from "node:path";

import { resolveDesktopTarget } from "./platform-target";

type NativeResourceCandidateInput = {
  readonly cwd: string;
  readonly fileNames: readonly string[];
  readonly envVar?: string;
  readonly moduleDir?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly resourcesPath?: string;
};

const resolveBaseRoots = (cwd: string, moduleDir?: string): readonly string[] => {
  const runtimeDir = typeof moduleDir === "string" && moduleDir.length > 0 ? moduleDir : cwd;
  return Array.from(
    new Set([
      path.resolve(cwd),
      path.resolve(runtimeDir),
      path.resolve(runtimeDir, ".."),
      path.resolve(runtimeDir, "../.."),
      path.resolve(runtimeDir, "../../.."),
      path.resolve(runtimeDir, "../../../.."),
      path.resolve(runtimeDir, "../../../../.."),
    ])
  );
};

const resolvePackagedResourceRoots = (
  cwd: string,
  resourcesPath: string | undefined
): readonly string[] => {
  const roots = [
    typeof resourcesPath === "string" && resourcesPath.length > 0 ? resourcesPath : undefined,
    typeof process.resourcesPath === "string" && process.resourcesPath.length > 0
      ? process.resourcesPath
      : undefined,
    cwd,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  return Array.from(new Set(roots.map((root) => path.resolve(root))));
};

export const resolveNativeResourceCandidates = ({
  cwd,
  fileNames,
  envVar,
  moduleDir,
  platform = process.platform,
  arch = process.arch,
  resourcesPath,
}: NativeResourceCandidateInput): readonly string[] => {
  const target = resolveDesktopTarget({ platform, arch });
  const candidates: string[] = [];
  const explicit = envVar === undefined ? undefined : process.env[envVar];
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    const normalized = explicit.trim();
    const baseRoots = resolveBaseRoots(cwd, moduleDir);
    candidates.push(path.resolve(cwd, normalized));
    candidates.push(...baseRoots.map((root) => path.resolve(root, normalized)));
  }

  for (const root of resolvePackagedResourceRoots(cwd, resourcesPath)) {
    for (const fileName of fileNames) {
      candidates.push(path.join(root, "native", target.id, fileName));
      candidates.push(path.join(root, "native", fileName));
      candidates.push(path.join(root, "resources", "native", target.id, fileName));
      candidates.push(path.join(root, "resources", "native", fileName));
    }
  }

  for (const baseRoot of resolveBaseRoots(cwd, moduleDir)) {
    const roots = [
      path.resolve(baseRoot, "target/debug"),
      path.resolve(baseRoot, "target/release"),
      path.resolve(baseRoot, "apps/desktop/native", target.id),
      path.resolve(baseRoot, "apps/desktop/native"),
      path.resolve(baseRoot, "native", target.id),
      path.resolve(baseRoot, "native"),
      path.resolve(baseRoot, "resources/native", target.id),
      path.resolve(baseRoot, "resources/native"),
    ];
    for (const root of roots) {
      for (const fileName of fileNames) {
        candidates.push(path.join(root, fileName));
      }
    }
  }

  return Array.from(new Set(candidates));
};

export const resolveNativeLibraryFileNames = (
  stem: string,
  platform: NodeJS.Platform = process.platform
): readonly string[] => {
  if (platform === "win32") {
    return [`${stem}.dll`, `${stem}.node`];
  }
  if (platform === "darwin") {
    return [`lib${stem}.dylib`, `${stem}.node`];
  }
  return [`lib${stem}.so`, `${stem}.node`];
};
