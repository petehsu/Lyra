import fs from "node:fs";
import path from "node:path";

import {
  resolveNativeLibraryFileNames,
  resolveNativeResourceCandidates
} from "../native-resource-paths";
import type { FilesNativeBindings, FilesNativeLoadResult } from "./types";

type DlopenProcess = NodeJS.Process & {
  readonly dlopen: (module: NodeModule, filename: string) => void;
};

type NodeAddonModule = NodeModule & {
  exports: Record<string, unknown>;
};

const requiredMethods: readonly (keyof FilesNativeBindings)[] = [
  "readHome",
  "readDirectory",
  "subscribeDirectory",
  "unsubscribeDirectory",
  "pollDirectoryPatches",
  "readTrash",
  "createFile",
  "createFolder",
  "moveToTrash",
  "restoreFromTrash",
  "emptyTrash",
  "mountDevice",
  "ejectDevice",
  "readFavorites",
  "writeFavorites",
  "readRecentLocations",
  "writeRecentLocations",
  "readTextFile",
  "writeTextFile",
  "statFile",
  "probeWorkbenchPath",
  "collectWorkbenchFilePaths"
];

export const resolveNativeCandidates = (cwd: string): readonly string[] => {
  return resolveNativeResourceCandidates({
    cwd,
    moduleDir: __dirname,
    envVar: "LYRA_FILES_NATIVE_LIB",
    fileNames: resolveNativeLibraryFileNames("lyra_files_napi"),
  });
};

const validateBindings = (value: unknown): value is FilesNativeBindings => {
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

const loadFromPath = (candidatePath: string): FilesNativeBindings | null => {
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

export const loadFilesNativeBindings = (): FilesNativeLoadResult => {
  const cwd = process.cwd();
  const candidates = resolveNativeCandidates(cwd);

  let lastError = "files native addon not found";

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
