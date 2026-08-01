import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ComponentManifestV1 } from "@lyra/app-runtime";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ComponentRegistryStore, InstalledComponentVersionV1 } from "./registry";
import { createAppModuleAssetService } from "./app-module-assets";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-app-module-assets-"));
  roots.push(root);
  const componentsRoot = path.join(root, "components");
  const componentId = "lyra.images";
  const version = "1.2.0";
  const target = "darwin-arm64";
  const entry = "dist/entry.js";
  const bytes = Buffer.from("export default { id: 'lyra.images' };\n");
  await mkdir(path.join(componentsRoot, componentId, version, target, "dist"), {
    recursive: true
  });
  await writeFile(path.join(componentsRoot, componentId, version, target, entry), bytes);
  const manifest: ComponentManifestV1 = {
    schemaVersion: 1,
    componentId,
    kind: "app",
    version,
    target,
    entry,
    executionClass: "first-party-shared-renderer",
    activation: "module-idle",
    hostApiRange: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
    dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
    permissions: [],
    publisher: "Lyra",
    files: [{
      path: entry,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }],
    keyId: "test-release",
    signature: Buffer.alloc(64).toString("base64")
  };
  const installed: InstalledComponentVersionV1 = {
    manifest,
    installedAt: "2026-07-30T00:00:00.000Z",
    target
  };
  const verifyInstalledVersion = vi.fn(async () => installed);
  const registryStore = { verifyInstalledVersion } as unknown as ComponentRegistryStore;
  return {
    root,
    componentsRoot,
    componentId,
    version,
    entry,
    bytes,
    manifest,
    verifyInstalledVersion,
    service: createAppModuleAssetService({ componentsRoot, registryStore })
  };
};

describe("signed app module assets", () => {
  test("resolves and re-hashes an installed signed app entry", async () => {
    const fixture = await createFixture();

    const runtime = await fixture.service.resolveEntry({
      componentId: fixture.componentId,
      version: fixture.version
    });
    const asset = await fixture.service.readAsset(runtime.entryUrl);

    expect(runtime).toEqual({
      componentId: fixture.componentId,
      version: fixture.version,
      entryUrl: `lyra-app-module://component/${fixture.componentId}/${fixture.version}/${fixture.entry}`,
      permissions: []
    });
    expect(Buffer.from(asset?.bytes ?? [])).toEqual(fixture.bytes);
    expect(asset?.contentType).toBe("text/javascript; charset=utf-8");
    expect(fixture.verifyInstalledVersion).toHaveBeenCalledTimes(2);
  });

  test("refuses a payload changed after registry verification", async () => {
    const fixture = await createFixture();
    const runtime = await fixture.service.resolveEntry({
      componentId: fixture.componentId,
      version: fixture.version
    });
    await writeFile(
      path.join(
        fixture.componentsRoot,
        fixture.componentId,
        fixture.version,
        fixture.manifest.target,
        fixture.entry
      ),
      Buffer.alloc(fixture.bytes.length, 0x78)
    );

    await expect(fixture.service.readAsset(runtime.entryUrl)).rejects.toThrow("digest mismatch");
  });

  test("requires an app entry compatible with the current Host API", async () => {
    const fixture = await createFixture();
    Object.defineProperty(fixture.manifest, "hostApiRange", {
      value: { minInclusive: "2.0.0" },
      configurable: true
    });

    await expect(fixture.service.resolveEntry({
      componentId: fixture.componentId,
      version: fixture.version
    })).rejects.toThrow("incompatible with Host API");
  });

  test("does not serve undeclared files or malformed URLs", async () => {
    const fixture = await createFixture();

    await expect(fixture.service.readAsset(
      `lyra-app-module://component/${fixture.componentId}/${fixture.version}/dist/missing.js`
    )).resolves.toBeNull();
    await expect(fixture.service.readAsset(
      `lyra-app-module://component/${fixture.componentId}/${fixture.version}/${fixture.entry}?x=1`
    )).resolves.toBeNull();
  });
});
