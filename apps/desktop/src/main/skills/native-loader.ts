import fs from "node:fs";
import path from "node:path";

import {
  resolveNativeLibraryFileNames,
  resolveNativeResourceCandidates
} from "../native-resource-paths";
import type { SkillsNativeBindings, SkillsNativeLoadResult } from "./types";

type DlopenProcess = NodeJS.Process & {
  readonly dlopen: (module: NodeModule, filename: string) => void;
};

type NodeAddonModule = NodeModule & {
  exports: Record<string, unknown>;
};

const requiredMethods: readonly (keyof SkillsNativeBindings)[] = [
  "collectSkillFileSummariesJson",
  "discoverSkillsImportSourceJson",
  "buildBuiltinSkillsCatalogJson",
  "copySkillPackageJson",
  "writeBuiltinSkillPackageJson",
  "createLyraSkillPackageJson",
  "readSkillContentPreviewJson",
  "readSkillsScopeDocumentJson",
  "writeSkillsScopeDocumentJson",
  "mergeEffectiveSkillsJson",
  "updateInstalledSkillStateJson",
  "removeInstalledSkillJson",
  "installSkillsJson",
  "createAndInstallLyraSkillJson",
  "updateInstalledSkillStateInStorageJson",
  "removeInstalledSkillInStorageJson",
  "readInstalledSkillDetailsJson"
];

export const resolveSkillsNativeCandidates = (cwd: string): readonly string[] => {
  return resolveNativeResourceCandidates({
    cwd,
    moduleDir: __dirname,
    envVar: "LYRA_SKILLS_NATIVE_LIB",
    fileNames: resolveNativeLibraryFileNames("lyra_skills_napi"),
  });
};

const validateBindings = (value: unknown): value is SkillsNativeBindings => {
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

const loadFromPath = (candidatePath: string): SkillsNativeBindings | null => {
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

export const loadSkillsNativeBindings = (): SkillsNativeLoadResult => {
  const cwd = process.cwd();
  const candidates = resolveSkillsNativeCandidates(cwd);

  let lastError = "skills native addon not found";

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
