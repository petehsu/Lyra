import fs from "node:fs";
import path from "node:path";

import type { SystemImageNativeBindings, SystemImageNativeLoadResult } from "./types";

type DlopenProcess = NodeJS.Process & {
  readonly dlopen: (module: NodeModule, filename: string) => void;
};

type NodeAddonModule = NodeModule & {
  exports: Record<string, unknown>;
};

const requiredMethods: readonly (keyof SystemImageNativeBindings)[] = [
  "readSystemImageRegistryJson",
  "listInstalledSystemImagesJson",
  "installSystemImageFromDirectoryJson",
  "installSystemImageFromPackageJson",
  "installSystemImageSeedJson",
  "uninstallSystemImageJson",
  "setDefaultSystemImageJson",
  "assignSessionSystemImageJson",
  "clearSessionSystemImageOverrideJson",
  "setSystemRuntimeModeOverrideJson",
  "readResolvedSessionSystemJson"
];

const resolveNativeFileNames = (): readonly string[] => {
  if (process.platform === "win32") {
    return ["lyra_system_image_napi.dll", "lyra_system_image_napi.node"];
  }
  if (process.platform === "darwin") {
    return ["liblyra_system_image_napi.dylib", "lyra_system_image_napi.node"];
  }
  return ["liblyra_system_image_napi.so", "lyra_system_image_napi.node"];
};

const resolveBaseRoots = (cwd: string): readonly string[] => {
  const runtimeDir = typeof __dirname === "string" ? __dirname : cwd;
  return Array.from(
    new Set([
      path.resolve(cwd),
      path.resolve(runtimeDir),
      path.resolve(runtimeDir, ".."),
      path.resolve(runtimeDir, "../.."),
      path.resolve(runtimeDir, "../../.."),
      path.resolve(runtimeDir, "../../../.."),
      path.resolve(runtimeDir, "../../../../..")
    ])
  );
};

export const resolveSystemImageNativeCandidates = (cwd: string): readonly string[] => {
  const fileNames = resolveNativeFileNames();
  const baseRoots = resolveBaseRoots(cwd);
  const candidates: string[] = [];
  for (const baseRoot of baseRoots) {
    const roots = [
      path.resolve(baseRoot, "target/debug"),
      path.resolve(baseRoot, "target/release"),
      path.resolve(baseRoot, "apps/desktop/native"),
      path.resolve(baseRoot, "native")
    ];
    for (const root of roots) {
      for (const fileName of fileNames) {
        candidates.push(path.join(root, fileName));
      }
    }
  }

  const explicit = process.env.LYRA_SYSTEM_IMAGE_NATIVE_LIB;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    const normalized = explicit.trim();
    const explicitPaths = [
      path.resolve(cwd, normalized),
      ...baseRoots.map((root) => path.resolve(root, normalized))
    ];
    candidates.unshift(...explicitPaths);
  }

  return Array.from(new Set(candidates));
};

const validateBindings = (value: unknown): value is SystemImageNativeBindings => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  for (const methodName of requiredMethods) {
    if (typeof candidate[methodName] !== "function") {
      return false;
    }
  }
  return true;
};

const loadFromPath = (candidatePath: string): SystemImageNativeBindings | null => {
  if (fs.existsSync(candidatePath) === false) {
    return null;
  }

  const moduleLike = {
    id: candidatePath,
    filename: candidatePath,
    loaded: false,
    path: path.dirname(candidatePath),
    paths: [],
    exports: {}
  } as unknown as NodeAddonModule;

  (process as DlopenProcess).dlopen(moduleLike, candidatePath);

  if (validateBindings(moduleLike.exports) === false) {
    throw new Error(`native addon loaded but missing required exports (${candidatePath})`);
  }
  return moduleLike.exports;
};

export const loadSystemImageNativeBindings = (): SystemImageNativeLoadResult => {
  const cwd = process.cwd();
  const candidates = resolveSystemImageNativeCandidates(cwd);
  let lastError = "system-image native addon not found";

  for (const candidate of candidates) {
    try {
      const bindings = loadFromPath(candidate);
      if (bindings !== null) {
        return {
          ok: true,
          bindings,
          loadedFrom: candidate
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ok: false,
    errorMessage: lastError,
    triedPaths: candidates
  };
};
