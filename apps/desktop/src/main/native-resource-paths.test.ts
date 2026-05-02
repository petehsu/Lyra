import path from "node:path";
import { describe, expect, test } from "vitest";

import {
  resolveNativeLibraryFileNames,
  resolveNativeResourceCandidates
} from "./native-resource-paths";

describe("native resource paths", () => {
  test("builds target-specific packaged and development candidates", () => {
    const cwd = path.resolve(path.sep, "repo");
    const resourcesPath = path.resolve(path.sep, "opt", "Lyra", "resources");
    const candidates = resolveNativeResourceCandidates({
      cwd,
      moduleDir: path.join(cwd, "apps/desktop/out/main/files"),
      resourcesPath,
      platform: "linux",
      arch: "arm64",
      fileNames: ["lyrad"],
    });

    expect(candidates.length).toBe(new Set(candidates).size);
    expect(candidates).toContain(path.join(resourcesPath, "native/linux-arm64/lyrad"));
    expect(candidates).toContain(path.join(resourcesPath, "native/lyrad"));
    expect(candidates).toContain(path.join(cwd, "target/debug/lyrad"));
    expect(candidates).toContain(path.join(cwd, "apps/desktop/native/linux-arm64/lyrad"));
  });

  test("uses platform library names for N-API addons", () => {
    expect(resolveNativeLibraryFileNames("lyra_files_napi", "darwin")).toEqual([
      "liblyra_files_napi.dylib",
      "lyra_files_napi.node",
    ]);
    expect(resolveNativeLibraryFileNames("lyra_files_napi", "win32")).toEqual([
      "lyra_files_napi.dll",
      "lyra_files_napi.node",
    ]);
    expect(resolveNativeLibraryFileNames("lyra_files_napi", "linux")).toEqual([
      "liblyra_files_napi.so",
      "lyra_files_napi.node",
    ]);
  });
});
