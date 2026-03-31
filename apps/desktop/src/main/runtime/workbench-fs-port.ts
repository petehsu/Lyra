import path from "node:path";

import type {
  FilesNativeBindings,
  NativeWorkbenchCollectFilePathsRequest,
  NativeWorkbenchCollectedFilePath,
  NativeWorkbenchPathProbeResult
} from "../files/types";

export type WorkbenchFsPort = {
  readonly probePath: (value: string | undefined) => NativeWorkbenchPathProbeResult | undefined;
  readonly collectFilePaths: (
    rootPath: string,
    basePath?: string
  ) => Promise<readonly string[]>;
};

const toPathCandidate = (value: string): string => path.resolve(value);

export const createWorkbenchFsPort = (
  nativeBindings: FilesNativeBindings
): WorkbenchFsPort => ({
  probePath: (value) => {
    const trimmed = value?.trim();
    if (trimmed === undefined || trimmed.length === 0) {
      return undefined;
    }
    return nativeBindings.probeWorkbenchPath({ path: trimmed });
  },
  collectFilePaths: async (rootPath, basePath) => {
    const trimmedRootPath = rootPath.trim();
    const trimmedBasePath = basePath?.trim();
    const result = nativeBindings.collectWorkbenchFilePaths({
      rootPath: trimmedRootPath,
      ...(trimmedBasePath === undefined || trimmedBasePath.length === 0
        ? {}
        : { basePath: trimmedBasePath })
    } satisfies NativeWorkbenchCollectFilePathsRequest);
    return result.map((entry: NativeWorkbenchCollectedFilePath) => entry.path);
  }
});
