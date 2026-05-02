import fs from "node:fs";
import path from "node:path";

import {
  resolveNativeLibraryFileNames,
  resolveNativeResourceCandidates
} from "../native-resource-paths";
import type { ResourcesNativeBindings, ResourcesNativeLoadResult } from "./types";

type DlopenProcess = NodeJS.Process & {
  readonly dlopen: (module: NodeModule, filename: string) => void;
};

type NodeAddonModule = NodeModule & {
  exports: Record<string, unknown>;
};

const requiredMethods: readonly (keyof ResourcesNativeBindings)[] = [
  "registerOrUpdateResourceJson",
  "removeResource",
  "requestLifecycle",
  "readSnapshotJson",
  "readSystemSnapshotJson",
  "requestActivityActionJson"
];

export const resolveResourcesNativeCandidates = (cwd: string): readonly string[] => {
  return resolveNativeResourceCandidates({
    cwd,
    moduleDir: __dirname,
    envVar: "LYRA_RESOURCE_NATIVE_LIB",
    fileNames: resolveNativeLibraryFileNames("lyra_resource_napi"),
  });
};

const validateBindings = (value: unknown): value is ResourcesNativeBindings => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return requiredMethods.every((methodName) => typeof candidate[methodName] === "function");
};

const loadFromPath = (candidatePath: string): ResourcesNativeBindings | null => {
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
    throw new Error(`resource native addon loaded but missing required exports (${candidatePath})`);
  }
  return moduleLike.exports;
};

export const loadResourcesNativeBindings = (): ResourcesNativeLoadResult => {
  const cwd = process.cwd();
  const candidates = resolveResourcesNativeCandidates(cwd);
  let lastError = "resource native addon not found";
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
