import fs from "node:fs";
import path from "node:path";

import type { ImageViewerNativeBindings, ImageViewerNativeLoadResult } from "./types";

type DlopenProcess = NodeJS.Process & {
  readonly dlopen: (module: NodeModule, filename: string) => void;
};

type NodeAddonModule = NodeModule & {
  exports: Record<string, unknown>;
};

const requiredMethods: readonly (keyof ImageViewerNativeBindings)[] = [
  "openImage",
  "readTile",
  "closeSession"
];

const resolveNativeFileNames = (): readonly string[] => {
  if (process.platform === "win32") {
    return ["lyra_image_napi.dll", "lyra_image_napi.node"];
  }
  if (process.platform === "darwin") {
    return ["liblyra_image_napi.dylib", "lyra_image_napi.node"];
  }
  return ["liblyra_image_napi.so", "lyra_image_napi.node"];
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

export const resolveImageViewerNativeCandidates = (cwd: string): readonly string[] => {
  const candidates: string[] = [];
  const fileNames = resolveNativeFileNames();
  for (const baseRoot of resolveBaseRoots(cwd)) {
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

  const explicit = process.env.LYRA_IMAGE_VIEWER_NATIVE_LIB;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    candidates.unshift(path.resolve(cwd, explicit.trim()));
  }
  return Array.from(new Set(candidates));
};

const validateBindings = (value: unknown): value is ImageViewerNativeBindings => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return requiredMethods.every((methodName) => typeof candidate[methodName] === "function");
};

const loadFromPath = (candidatePath: string): ImageViewerNativeBindings | null => {
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
    throw new Error(`image viewer native addon loaded but missing required exports (${candidatePath})`);
  }
  return moduleLike.exports;
};

export const loadImageViewerNativeBindings = (): ImageViewerNativeLoadResult => {
  const cwd = process.cwd();
  const candidates = resolveImageViewerNativeCandidates(cwd);
  let lastError = "image viewer native addon not found";
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
