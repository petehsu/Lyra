import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  canonicalChannelCatalogPayloadV1,
  canonicalComponentManifestV1,
  canonicalReleaseKeyringPayloadV1,
  canonicalReleaseBomComponentV1,
  canonicalReleaseBomV1,
  canonicalJson,
  validateComponentManifestV1,
  validateReleaseBomV1,
  validateSignedChannelCatalogV1,
  type ComponentManifestV1,
  type ReleaseBomV1,
  type SignedChannelCatalogV1,
  type SignedReleaseKeyringV1
} from "../../packages/app-runtime/src/index.ts";
import {
  LYRA_DESKTOP_RELEASE_COMPONENTS_V1,
  packageRelease
} from "./release-package.ts";

const execFileAsync = promisify(execFile);

test("packages signed component archives, an exact BOM, and a target catalog", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-release-package-test-"));
  try {
    const sources = path.join(root, "sources");
    const releaseComponents = Object.entries(LYRA_DESKTOP_RELEASE_COMPONENTS_V1);
    await Promise.all(releaseComponents.map(async ([componentId]) => {
      const source = path.join(sources, componentId);
      await mkdir(source, { recursive: true });
      await writeFile(path.join(source, "entry.bin"), `${componentId}\n`);
    }));
    const componentSpecs = releaseComponents.map(([componentId, contract]) => ({
      componentId,
      kind: contract.kind,
      version: "1.0.0",
      sourceDirectory: `sources/${componentId}`,
      entry: "entry.bin",
      ...(contract.kind === "app"
        ? { executionClass: "first-party-shared-renderer" as const }
        : {}),
      activation: contract.activation,
      delivery: contract.delivery,
      ...(contract.kind === "app" || contract.kind === "core"
        ? { hostApiRange: { minInclusive: "1.0.0", maxExclusive: "2.0.0" } }
        : {}),
      ...(contract.kind === "runtime"
        ? { runtimeProtocolRange: { min: 2, max: 2 } }
        : {}),
      dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
      permissions: []
    }));
    const specPath = path.join(root, "release.json");
    await writeFile(specPath, `${JSON.stringify({
      schemaVersion: 1,
      releaseVersion: "1.0.0-preview.1",
      channel: "preview",
      sequence: 9,
      generatedAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2026-08-30T00:00:00.000Z",
      target: "darwin-arm64",
      hostApiVersion: "1.0.0",
      publisher: "Lyra",
      keyId: "release-test-1",
      minimumSafeCoreVersion: "1.0.0",
      components: componentSpecs
    }, null, 2)}\n`);
    const { privateKey: rootPrivateKey, publicKey: rootPublicKey } = generateKeyPairSync("ed25519");
    const { privateKey: releasePrivateKey, publicKey: releasePublicKey } = generateKeyPairSync("ed25519");
    const releasePublicDer = releasePublicKey.export({ type: "spki", format: "der" });
    const keyringPayload: SignedReleaseKeyringV1["payload"] = {
      sequence: 4,
      generatedAt: "2026-07-29T00:00:00.000Z",
      expiresAt: "2026-09-30T00:00:00.000Z",
      keys: [{
        keyId: "release-test-1",
        publicKey: releasePublicDer.subarray(releasePublicDer.length - 32).toString("base64"),
        publisher: "Lyra",
        channels: ["preview"],
        componentKinds: ["core", "runtime", "app", "resource", "extension"],
        componentIdPrefixes: ["lyra."],
        executionClasses: [
          "first-party-shared-renderer",
          "sandboxed-web",
          "sandboxed-web-wasi"
        ],
        validFrom: "2026-07-29T00:00:00.000Z",
        validUntil: "2026-09-30T00:00:00.000Z"
      }],
      revokedKeyIds: []
    };
    const keyring: SignedReleaseKeyringV1 = {
      schemaVersion: 1,
      payload: keyringPayload,
      signature: {
        algorithm: "ed25519",
        keyId: "root-test-1",
        value: sign(
          null,
          Buffer.from(canonicalJson(keyringPayload)),
          rootPrivateKey
        ).toString("base64")
      }
    };
    const rootPublicDer = rootPublicKey.export({ type: "spki", format: "der" });
    const baseUrl = "https://github.com/petehsu/lyra-releases/releases/download/v1.0.0-preview.1";
    const packageWithScope = (
      payload: SignedReleaseKeyringV1["payload"],
      outputDirectory: string
    ) => packageRelease({
      specPath,
      outputRoot: path.join(root, outputDirectory),
      baseUrl,
      releasePrivateKey,
      keyring: {
        schemaVersion: 1,
        payload,
        signature: {
          algorithm: "ed25519",
          keyId: "root-test-1",
          value: sign(
            null,
            Buffer.from(canonicalJson(payload)),
            rootPrivateKey
          ).toString("base64")
        }
      },
      trustedRoots: {
        "root-test-1": rootPublicDer.subarray(rootPublicDer.length - 32).toString("base64")
      },
      assetLayout: "flat"
    });
    const appOnlyPayload: SignedReleaseKeyringV1["payload"] = {
      ...keyringPayload,
      keys: keyringPayload.keys.map((key) => ({
        ...key,
        componentKinds: ["app"]
      }))
    };
    await assert.rejects(
      packageWithScope(appOnlyPayload, "release-kind-denied"),
      /not root-authorized for component kind core/u
    );
    const foreignNamespacePayload: SignedReleaseKeyringV1["payload"] = {
      ...keyringPayload,
      keys: keyringPayload.keys.map((key) => ({
        ...key,
        componentIdPrefixes: ["example."]
      }))
    };
    await assert.rejects(
      packageWithScope(foreignNamespacePayload, "release-id-denied"),
      /not root-authorized for component ID lyra\.core/u
    );
    const sandboxOnlyPayload: SignedReleaseKeyringV1["payload"] = {
      ...keyringPayload,
      keys: keyringPayload.keys.map((key) => ({
        ...key,
        executionClasses: ["sandboxed-web", "sandboxed-web-wasi"]
      }))
    };
    await assert.rejects(
      packageWithScope(sandboxOnlyPayload, "release-execution-denied"),
      /not root-authorized for execution class first-party-shared-renderer/u
    );
    const report = await packageRelease({
      specPath,
      outputRoot: path.join(root, "release"),
      baseUrl,
      releasePrivateKey,
      keyring,
      trustedRoots: {
        "root-test-1": rootPublicDer.subarray(rootPublicDer.length - 32).toString("base64")
      },
      assetLayout: "flat"
    });
    assert.equal(report.componentArchives.length, releaseComponents.length);
    assert.ok(report.totalArchiveBytes > 0);
    assert.equal(report.sbomPaths.length, releaseComponents.length);
    const releaseManifest = JSON.parse(
      await readFile(report.releaseManifestPath, "utf8")
    ) as { readonly componentCount?: number; readonly components: readonly unknown[] };
    assert.equal(releaseManifest.components.length, releaseComponents.length);
    const sizeReport = JSON.parse(await readFile(report.sizeReportPath, "utf8")) as {
      readonly totalArchiveBytes: number;
    };
    assert.equal(sizeReport.totalArchiveBytes, report.totalArchiveBytes);
    const checksums = await readFile(report.checksumsPath, "utf8");
    assert.match(checksums, /release-manifest-darwin-arm64\.v1\.json/u);
    assert.match(checksums, /component-sizes-darwin-arm64\.v1\.json/u);
    const firstSbom = JSON.parse(await readFile(report.sbomPaths[0]!, "utf8")) as {
      readonly spdxVersion: string;
      readonly documentDescribes: readonly string[];
    };
    assert.equal(firstSbom.spdxVersion, "SPDX-2.3");
    assert.equal(firstSbom.documentDescribes.length, 1);

    const catalog = JSON.parse(await readFile(report.catalogPath, "utf8")) as SignedChannelCatalogV1;
    const bom = JSON.parse(await readFile(report.bomPath, "utf8")) as ReleaseBomV1;
    assert.equal(
      catalog.payload.releases[0]?.bomUrl,
      `${baseUrl}/${path.basename(report.bomPath)}`
    );
    for (const [index, component] of bom.components.entries()) {
      assert.equal(
        component.url,
        `${baseUrl}/${path.basename(report.componentArchives[index]!.path)}`
      );
    }
    assert.equal(validateSignedChannelCatalogV1(catalog), true);
    assert.equal(validateReleaseBomV1(bom), true);
    assert.equal(verify(
      null,
      Buffer.from(canonicalChannelCatalogPayloadV1(catalog)),
      releasePublicKey,
      Buffer.from(catalog.signature.value, "base64")
    ), true);
    assert.equal(verify(
      null,
      Buffer.from(canonicalReleaseKeyringPayloadV1(catalog.keyring)),
      rootPublicKey,
      Buffer.from(catalog.keyring.signature.value, "base64")
    ), true);
    assert.equal(verify(
      null,
      Buffer.from(canonicalReleaseBomV1(bom)),
      releasePublicKey,
      Buffer.from(catalog.payload.releases[0]?.bomSignature ?? "", "base64")
    ), true);

    for (const [index, component] of bom.components.entries()) {
      assert.equal(verify(
        null,
        Buffer.from(canonicalReleaseBomComponentV1(component)),
        releasePublicKey,
        Buffer.from(component.signature, "base64")
      ), true);
      const archivePath = report.componentArchives[index]?.path;
      assert.ok(archivePath);
      const { stdout } = await execFileAsync("unzip", ["-p", archivePath, "component.json"], {
        encoding: "utf8"
      });
      const manifest = JSON.parse(stdout) as ComponentManifestV1;
      assert.equal(validateComponentManifestV1(manifest), true);
      assert.equal(manifest.componentId, component.componentId);
      assert.equal(verify(
        null,
        Buffer.from(canonicalComponentManifestV1(manifest)),
        releasePublicKey,
        Buffer.from(manifest.signature, "base64")
      ), true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
