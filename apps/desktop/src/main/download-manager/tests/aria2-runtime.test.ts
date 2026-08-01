import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  resolveAria2Runtime,
  resolveBundledAria2Candidates,
  resolveBundledAria2ManifestCandidates,
  resolveCurrentAria2BundleTarget
} from "../aria2-runtime";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "lyra-aria2-runtime-"));
  tempDirs.push(tempDir);
  return tempDir;
};

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe("aria2 runtime resolution", () => {
  test("resolves bundled candidates for supported targets", () => {
    expect(resolveCurrentAria2BundleTarget("darwin", "arm64")?.id).toBe("darwin-arm64");
    expect(resolveBundledAria2ManifestCandidates(["/resources/aria2"], "darwin", "arm64")).toEqual([
      path.join("/resources/aria2", "darwin-arm64", "manifest.json"),
      path.join("/resources/aria2", "manifest.json")
    ]);
    expect(resolveBundledAria2Candidates(["/resources/aria2"], "win32", "x64")).toEqual([
      path.join("/resources/aria2", "win32-x64", "aria2c.exe"),
      path.join("/resources/aria2", "aria2c.exe")
    ]);
  });

  test("prefers bundled binaries over PATH fallback", async () => {
    const resourcesPath = await createTempDir();
    const binaryPath = path.join(resourcesPath, "aria2", "darwin-arm64", "aria2c");
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await writeFile(binaryPath, "");
    await chmod(binaryPath, 0o755);

    const resolved = resolveAria2Runtime({
      platform: "darwin",
      arch: "arm64",
      resourcesPath,
      cwd: resourcesPath,
      allowPathFallback: true,
      env: {
        PATH: ""
      }
    });

    expect(resolved).toMatchObject({
      available: true,
      binaryPath,
      source: "bundled"
    });
  });

  test("prefers the active component binary and refuses packaged fallback", async () => {
    const resourcesPath = await createTempDir();
    const componentBinary = path.join(resourcesPath, "components", "aria2c");
    const bundledBinary = path.join(resourcesPath, "aria2", "darwin-arm64", "aria2c");
    await mkdir(path.dirname(componentBinary), { recursive: true });
    await mkdir(path.dirname(bundledBinary), { recursive: true });
    await writeFile(componentBinary, "");
    await writeFile(bundledBinary, "");
    await chmod(componentBinary, 0o755);
    await chmod(bundledBinary, 0o755);

    expect(resolveAria2Runtime({
      platform: "darwin",
      arch: "arm64",
      resourcesPath,
      componentBinaryPath: componentBinary,
      env: {
        LYRA_RESOURCE_COMPONENT_MODE: "signed-components"
      }
    })).toMatchObject({
      available: true,
      binaryPath: componentBinary,
      source: "component"
    });

    expect(resolveAria2Runtime({
      platform: "darwin",
      arch: "arm64",
      resourcesPath,
      componentBinaryPath: path.join(resourcesPath, "missing"),
      env: {
        LYRA_RESOURCE_COMPONENT_MODE: "signed-components"
      }
    })).toMatchObject({
      available: false,
      source: "missing"
    });
  });

  test("prefers verified manifest bundles with nested binaries", async () => {
    const resourcesPath = await createTempDir();
    const targetRoot = path.join(resourcesPath, "aria2", "darwin-arm64");
    const binaryPath = path.join(targetRoot, "bin", "aria2c");
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await writeFile(binaryPath, "#!/bin/sh\nexit 0\n");
    await chmod(binaryPath, 0o755);
    await writeFile(path.join(targetRoot, "manifest.json"), `${JSON.stringify({
      bundleVersion: "aria2-test",
      target: "darwin-arm64",
      binary: "bin/aria2c",
      source: "test",
      files: [
        {
          path: "bin/aria2c",
          sha256: await sha256File(binaryPath),
          executable: true
        }
      ]
    })}\n`);

    const resolved = resolveAria2Runtime({
      platform: "darwin",
      arch: "arm64",
      resourcesPath,
      cwd: resourcesPath,
      env: {
        PATH: ""
      }
    });

    expect(resolved).toMatchObject({
      available: true,
      binaryPath,
      source: "bundled",
      manifest: {
        bundleVersion: "aria2-test",
        binary: "bin/aria2c"
      }
    });
  });

  test("rejects manifest bundles with mismatched hashes", async () => {
    const resourcesPath = await createTempDir();
    const targetRoot = path.join(resourcesPath, "aria2", "darwin-arm64");
    const binaryPath = path.join(targetRoot, "bin", "aria2c");
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await writeFile(binaryPath, "#!/bin/sh\nexit 0\n");
    await chmod(binaryPath, 0o755);
    await writeFile(path.join(targetRoot, "manifest.json"), `${JSON.stringify({
      bundleVersion: "aria2-test",
      target: "darwin-arm64",
      binary: "bin/aria2c",
      source: "test",
      files: [
        {
          path: "bin/aria2c",
          sha256: "0".repeat(64),
          executable: true
        }
      ]
    })}\n`);

    expect(resolveAria2Runtime({
      platform: "darwin",
      arch: "arm64",
      resourcesPath,
      cwd: resourcesPath,
      env: {
        PATH: ""
      }
    }).available).toBe(false);
  });

  test("uses PATH fallback only when explicitly allowed", async () => {
    const tempDir = await createTempDir();
    const binDir = path.join(tempDir, "bin");
    const binaryPath = path.join(binDir, "aria2c");
    await mkdir(binDir, { recursive: true });
    await writeFile(binaryPath, "");
    await chmod(binaryPath, 0o755);

    expect(resolveAria2Runtime({
      platform: "darwin",
      arch: "arm64",
      resourcesPath: tempDir,
      cwd: tempDir,
      env: {
        PATH: binDir
      }
    }).available).toBe(false);

    expect(resolveAria2Runtime({
      platform: "darwin",
      arch: "arm64",
      resourcesPath: tempDir,
      cwd: tempDir,
      allowPathFallback: true,
      env: {
        PATH: binDir
      }
    })).toMatchObject({
      available: true,
      binaryPath,
      source: "path"
    });
  });
});
