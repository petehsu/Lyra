import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign,
  type KeyObject
} from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  canonicalJson,
  canonicalReleaseBomComponentV1,
  canonicalReleaseBomV1,
  type ComponentTargetV1,
  type ReleaseBomComponentV1,
  type ReleaseBomV1,
  type SignedChannelCatalogV1,
  type SignedReleaseKeyringV1
} from "../../packages/app-runtime/src/index.ts";
import {
  CHANNEL_PROMOTION_TARGETS_V1,
  CHANNEL_INITIALIZATION_MARKER_NAME_V1,
  assertPromotionReleasePublicationState,
  parseImmutableReleaseAssetUrl,
  replaceChannelCatalogAssets,
  validateChannelPromotion,
  type ChannelAssetMutationClient,
  type PromotionCatalogDocument,
  type ReleaseAssetIdentity
} from "./channel-promotion.ts";
import { LYRA_DESKTOP_RELEASE_COMPONENTS_V1 } from "./release-package.ts";

const SIGNATURE_PLACEHOLDER = Buffer.alloc(64).toString("base64");
const NOW = new Date("2026-08-01T00:00:00.000Z");
const REPOSITORY = "petehsu/lyra-releases";

const rawPublicKey = (key: KeyObject): string => {
  const der = key.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("base64");
};

const signature = (payload: string, key: KeyObject): string =>
  sign(null, Buffer.from(payload, "utf8"), key).toString("base64");

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const expectedEntry = (componentId: string, target: ComponentTargetV1): string => {
  if (componentId === "lyra.core") return "projection.json";
  if (componentId === "lyra.runtime") {
    return target.startsWith("windows-") ? "bin/lyrad.exe" : "bin/lyrad";
  }
  if (componentId.startsWith("lyra.language.")) return "bundle.json";
  if (componentId === "lyra.uiux.classic") return "index.mjs";
  if (componentId === "lyra.resource.rust-analyzer") {
    return target.startsWith("windows-") ? "rust-analyzer.exe" : "rust-analyzer";
  }
  if (componentId === "lyra.resource.aria2") return "manifest.json";
  if (componentId === "lyra.resource.playwright") return "resource.json";
  return "index.mjs";
};

type SignedSet = {
  readonly documents: readonly PromotionCatalogDocument[];
  readonly boms: ReadonlyMap<string, Buffer>;
  readonly keyring: SignedReleaseKeyringV1;
};

const createSignedSet = ({
  rootPrivateKey,
  rootKeyId,
  releasePrivateKey,
  releaseKeyId,
  releaseTag,
  releaseVersion,
  catalogSequence,
  keyringSequence,
  generatedAt = "2026-07-31T00:00:00.000Z",
  expiresAt = "2026-10-01T00:00:00.000Z",
  keyringExpiresAt = "2026-10-01T00:00:00.000Z",
  coreVersion = "1.0.0",
  minimumSafeCoreVersion,
  revocations = [],
  entryOverrides = {},
  executionClassOverrides = {},
  allowedExecutionClasses = ["first-party-shared-renderer"]
}: {
  readonly rootPrivateKey: KeyObject;
  readonly rootKeyId: string;
  readonly releasePrivateKey: KeyObject;
  readonly releaseKeyId: string;
  readonly releaseTag: string;
  readonly releaseVersion: string;
  readonly catalogSequence: number;
  readonly keyringSequence: number;
  readonly generatedAt?: string;
  readonly expiresAt?: string;
  readonly keyringExpiresAt?: string;
  readonly coreVersion?: string;
  readonly minimumSafeCoreVersion?: string;
  readonly revocations?: SignedChannelCatalogV1["payload"]["revocations"];
  readonly entryOverrides?: Readonly<Record<string, string | undefined>>;
  readonly executionClassOverrides?: Readonly<Record<
    string,
    ReleaseBomComponentV1["executionClass"]
  >>;
  readonly allowedExecutionClasses?: SignedReleaseKeyringV1["payload"]["keys"][number]["executionClasses"];
}): SignedSet => {
  const actualReleasePublicKey = rawPublicKey(createPublicKey(releasePrivateKey));
  const keyringPayload: SignedReleaseKeyringV1["payload"] = {
    sequence: keyringSequence,
    generatedAt: "2026-06-01T00:00:00.000Z",
    expiresAt: keyringExpiresAt,
    keys: [{
      keyId: releaseKeyId,
      publicKey: actualReleasePublicKey,
      publisher: "Lyra",
      channels: ["preview"],
      componentKinds: ["core", "runtime", "app", "resource", "extension"],
      componentIdPrefixes: ["lyra."],
      executionClasses: allowedExecutionClasses,
      validFrom: "2026-06-01T00:00:00.000Z",
      validUntil: keyringExpiresAt
    }],
    revokedKeyIds: []
  };
  const keyring: SignedReleaseKeyringV1 = {
    schemaVersion: 1,
    payload: keyringPayload,
    signature: {
      algorithm: "ed25519",
      keyId: rootKeyId,
      value: signature(canonicalJson(keyringPayload), rootPrivateKey)
    }
  };
  const boms = new Map<string, Buffer>();
  const documents = CHANNEL_PROMOTION_TARGETS_V1.map((target) => {
    const components = Object.entries(LYRA_DESKTOP_RELEASE_COMPONENTS_V1).map(
      ([componentId, contract], index): ReleaseBomComponentV1 => {
        const unsigned = {
          componentId,
          kind: contract.kind,
          version: componentId === "lyra.core" ? coreVersion : "1.0.0",
          target,
          url: `https://github.com/${REPOSITORY}/releases/download/${releaseTag}/${target}-${index}.zip`,
          size: 100 + index,
          sha256: createHash("sha256").update(`${target}-${componentId}`).digest("hex"),
          keyId: releaseKeyId,
          ...(Object.hasOwn(entryOverrides, componentId)
            ? (entryOverrides[componentId] === undefined
              ? {}
              : { entry: entryOverrides[componentId] })
            : { entry: expectedEntry(componentId, target) }),
          ...(contract.kind === "app"
            ? {
              executionClass: executionClassOverrides[componentId]
                ?? "first-party-shared-renderer" as const
            }
            : {}),
          activation: contract.activation,
          delivery: contract.delivery
        };
        return {
          ...unsigned,
          signature: signature(
            canonicalReleaseBomComponentV1({
              ...unsigned,
              signature: SIGNATURE_PLACEHOLDER
            }),
            releasePrivateKey
          )
        };
      }
    );
    const bom: ReleaseBomV1 = {
      schemaVersion: 1,
      releaseVersion,
      channel: "preview",
      target,
      coreVersion,
      hostApiVersion: "1.0.0",
      components
    };
    const bomBytes = Buffer.from(`${JSON.stringify(bom, null, 2)}\n`);
    const bomName = `${sha256(bomBytes)}.json`;
    const bomUrl = `https://github.com/${REPOSITORY}/releases/download/${releaseTag}/${bomName}`;
    boms.set(bomUrl, bomBytes);
    const payload: SignedChannelCatalogV1["payload"] = {
      sequence: catalogSequence,
      channel: "preview",
      generatedAt,
      expiresAt,
      ...(minimumSafeCoreVersion === undefined ? {} : { minimumSafeCoreVersion }),
      revocations,
      releases: [{
        version: releaseVersion,
        bomUrl,
        bomSha256: sha256(bomBytes),
        bomSignature: signature(canonicalReleaseBomV1(bom), releasePrivateKey),
        keyId: releaseKeyId
      }]
    };
    const catalog: SignedChannelCatalogV1 = {
      schemaVersion: 1,
      keyring,
      payload,
      signature: {
        algorithm: "ed25519",
        keyId: releaseKeyId,
        value: signature(canonicalJson(payload), releasePrivateKey)
      }
    };
    return {
      name: `catalog-preview-${target}.json`,
      bytes: Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`)
    };
  });
  return { documents, boms, keyring };
};

const createFixture = ({
  candidateCatalogSequence = 21,
  candidateKeyringSequence = 11,
  currentCatalogSequence = 20,
  currentKeyringSequence = 10,
  candidateVersion = "1.2.3-preview.1",
  candidateExpiresAt,
  candidateCoreVersion,
  candidateMinimumSafeCoreVersion,
  candidateRevocations,
  candidateEntryOverrides,
  candidateExecutionClassOverrides,
  candidateAllowedExecutionClasses,
  reuseCurrentKeyring = false
}: {
  readonly candidateCatalogSequence?: number;
  readonly candidateKeyringSequence?: number;
  readonly currentCatalogSequence?: number;
  readonly currentKeyringSequence?: number;
  readonly candidateVersion?: string;
  readonly candidateExpiresAt?: string;
  readonly candidateCoreVersion?: string;
  readonly candidateMinimumSafeCoreVersion?: string;
  readonly candidateRevocations?: SignedChannelCatalogV1["payload"]["revocations"];
  readonly candidateEntryOverrides?: Readonly<Record<string, string | undefined>>;
  readonly candidateExecutionClassOverrides?: Readonly<Record<
    string,
    ReleaseBomComponentV1["executionClass"]
  >>;
  readonly candidateAllowedExecutionClasses?: SignedReleaseKeyringV1["payload"]["keys"][number]["executionClasses"];
  readonly reuseCurrentKeyring?: boolean;
} = {}) => {
  const root = generateKeyPairSync("ed25519");
  const currentRelease = generateKeyPairSync("ed25519");
  const candidateRelease = reuseCurrentKeyring
    ? currentRelease
    : generateKeyPairSync("ed25519");
  const common = { rootPrivateKey: root.privateKey, rootKeyId: "root-1" };
  const current = createSignedSet({
    ...common,
    releasePrivateKey: currentRelease.privateKey,
    releaseKeyId: "release-current",
    releaseTag: "v1.2.2-preview.1",
    releaseVersion: "1.2.2-preview.1",
    catalogSequence: currentCatalogSequence,
    keyringSequence: currentKeyringSequence,
    generatedAt: "2026-07-10T00:00:00.000Z",
    expiresAt: "2026-07-20T00:00:00.000Z"
  });
  const candidate = createSignedSet({
    ...common,
    releasePrivateKey: candidateRelease.privateKey,
    releaseKeyId: reuseCurrentKeyring ? "release-current" : "release-candidate",
    releaseTag: "v1.2.3-preview.1",
    releaseVersion: candidateVersion,
    catalogSequence: candidateCatalogSequence,
    keyringSequence: candidateKeyringSequence,
    ...(candidateExpiresAt === undefined ? {} : { expiresAt: candidateExpiresAt }),
    ...(candidateCoreVersion === undefined ? {} : { coreVersion: candidateCoreVersion }),
    ...(candidateMinimumSafeCoreVersion === undefined
      ? {}
      : { minimumSafeCoreVersion: candidateMinimumSafeCoreVersion }),
    ...(candidateRevocations === undefined ? {} : { revocations: candidateRevocations }),
    ...(candidateEntryOverrides === undefined ? {} : { entryOverrides: candidateEntryOverrides }),
    ...(candidateExecutionClassOverrides === undefined
      ? {}
      : { executionClassOverrides: candidateExecutionClassOverrides }),
    ...(candidateAllowedExecutionClasses === undefined
      ? {}
      : { allowedExecutionClasses: candidateAllowedExecutionClasses })
  });
  return {
    candidate,
    current,
    trustedRoots: { "root-1": rawPublicKey(root.publicKey) },
    releaseVersion: candidateVersion,
    rootPrivateKey: root.privateKey,
    candidateReleasePrivateKey: candidateRelease.privateKey
  };
};

const validateFixture = async (
  fixture: ReturnType<typeof createFixture>,
  overrides: Partial<Parameters<typeof validateChannelPromotion>[0]> = {}
) => await validateChannelPromotion({
  channel: "preview",
  releaseTag: "v1.2.3-preview.1",
  releaseVersion: fixture.releaseVersion,
  repository: REPOSITORY,
  candidateCatalogs: fixture.candidate.documents,
  currentCatalogs: fixture.current.documents,
  trustedRoots: fixture.trustedRoots,
  expectedKeyring: fixture.candidate.keyring,
  now: NOW,
  loadCandidateBom: async (url) => {
    const bytes = fixture.candidate.boms.get(url);
    if (bytes === undefined) throw new Error(`missing fixture BOM ${url}`);
    return bytes;
  },
  assertCandidateComponentAsset: async () => {},
  ...overrides
});

test("validates all six immutable catalogs, BOMs, signatures, and anti-rollback floors", async () => {
  let assertedAssets = 0;
  const result = await validateFixture(createFixture(), {
    assertCandidateComponentAsset: async (_url, size, digest) => {
      assert.ok(size > 0);
      assert.match(digest, /^[0-9a-f]{64}$/u);
      assertedAssets += 1;
    }
  });
  assert.equal(result.catalogs.size, 6);
  assert.equal(result.catalogSequence, 21);
  assert.equal(result.previousCatalogSequence, 20);
  assert.equal(result.keyringSequence, 11);
  assert.equal(result.previousKeyringSequence, 10);
  assert.equal(result.initialChannel, false);
  assert.equal(
    assertedAssets,
    CHANNEL_PROMOTION_TARGETS_V1.length * Object.keys(LYRA_DESKTOP_RELEASE_COMPONENTS_V1).length
  );
});

test("requires an explicit one-time mode for an empty current channel", async () => {
  const fixture = createFixture();
  await assert.rejects(
    validateFixture(fixture, { currentCatalogs: [] }),
    /explicit one-time empty-channel initialization is required/u
  );
  const result = await validateFixture(fixture, {
    currentCatalogs: [],
    allowEmptyCurrentChannel: true
  });
  assert.equal(result.initialChannel, true);
  assert.equal(result.previousCatalogSequence, 0);
  assert.equal(result.previousKeyringSequence, 0);
});

test("requires immutable source state, mutable channel state, and default HTTPS port", () => {
  assert.doesNotThrow(() => assertPromotionReleasePublicationState({
    tagName: "v1.2.3-preview.1",
    draft: false,
    immutable: true,
    expectedTag: "v1.2.3-preview.1",
    requiredImmutability: "immutable",
    description: "Source"
  }));
  assert.throws(() => assertPromotionReleasePublicationState({
    tagName: "v1.2.3-preview.1",
    draft: false,
    immutable: false,
    expectedTag: "v1.2.3-preview.1",
    requiredImmutability: "immutable",
    description: "Source"
  }), /already-public immutable GitHub Release/u);
  assert.throws(() => assertPromotionReleasePublicationState({
    tagName: "preview-channel",
    draft: false,
    immutable: true,
    expectedTag: "preview-channel",
    requiredImmutability: "mutable",
    description: "Channel"
  }), /already-public mutable GitHub Release/u);

  assert.throws(() => parseImmutableReleaseAssetUrl({
    url: "https://github.com:444/petehsu/lyra-releases/releases/download/v1.2.3-preview.1/bom.json",
    repository: REPOSITORY,
    releaseTag: "v1.2.3-preview.1"
  }), /not an immutable GitHub Release URL/u);
});

test("rejects missing targets, changed signatures, and mixed releases", async () => {
  const fixture = createFixture();
  await assert.rejects(
    validateFixture(fixture, { candidateCatalogs: fixture.candidate.documents.slice(1) }),
    /exactly 6 catalog assets/u
  );
  const damaged = fixture.candidate.documents.map((document, index) => index === 0
    ? { ...document, bytes: Buffer.from(document.bytes.toString("utf8").replace("preview.1", "preview.9")) }
    : document);
  await assert.rejects(
    validateFixture(fixture, { candidateCatalogs: damaged }),
    /signature is invalid|describes/u
  );

  const alternate = createSignedSet({
    rootPrivateKey: fixture.rootPrivateKey,
    rootKeyId: "root-1",
    releasePrivateKey: fixture.candidateReleasePrivateKey,
    releaseKeyId: "release-candidate",
    releaseTag: "v1.2.3-preview.1",
    releaseVersion: "1.2.4-preview.1",
    catalogSequence: 21,
    keyringSequence: 11
  });
  const mixedBoms = new Map([...fixture.candidate.boms, ...alternate.boms]);
  await assert.rejects(
    validateFixture(fixture, {
      candidateCatalogs: [alternate.documents[0]!, ...fixture.candidate.documents.slice(1)],
      loadCandidateBom: async (url) => mixedBoms.get(url)!
    }),
    /describes 1\.2\.4-preview\.1, not 1\.2\.3-preview\.1/u
  );
});

test("rejects expired candidates and catalog or keyring rollback", async () => {
  await assert.rejects(
    validateFixture(createFixture({ candidateExpiresAt: "2026-07-31T23:59:59.000Z" })),
    /not currently valid/u
  );
  await assert.rejects(
    validateFixture(createFixture({ candidateCatalogSequence: 20 })),
    /Catalog sequence 20 must be greater/u
  );
  await assert.rejects(
    validateFixture(createFixture({ candidateKeyringSequence: 9 })),
    /Keyring sequence 9 is below/u
  );
});

test("reuses only an exact authenticated keyring at the current sequence", async () => {
  const reused = createFixture({
    candidateKeyringSequence: 10,
    reuseCurrentKeyring: true
  });
  const result = await validateFixture(reused);
  assert.equal(result.keyringSequence, 10);
  assert.equal(result.previousKeyringSequence, 10);

  await assert.rejects(
    validateFixture(createFixture({ candidateKeyringSequence: 10 })),
    /same-sequence keyring ambiguity is forbidden/u
  );

  const ambiguous = createFixture({
    candidateKeyringSequence: 10,
    reuseCurrentKeyring: true
  });
  const alternateRelease = generateKeyPairSync("ed25519");
  const alternateCurrent = createSignedSet({
    rootPrivateKey: ambiguous.rootPrivateKey,
    rootKeyId: "root-1",
    releasePrivateKey: alternateRelease.privateKey,
    releaseKeyId: "release-alternate",
    releaseTag: "v1.2.2-preview.1",
    releaseVersion: "1.2.2-preview.1",
    catalogSequence: 20,
    keyringSequence: 10,
    generatedAt: "2026-07-10T00:00:00.000Z",
    expiresAt: "2026-07-20T00:00:00.000Z"
  });
  await assert.rejects(
    validateFixture(ambiguous, {
      currentCatalogs: [alternateCurrent.documents[0]!, ...ambiguous.current.documents.slice(1)]
    }),
    /same-sequence keyring ambiguity is forbidden/u
  );
});

test("rejects candidates that violate their minimum Core version or revocations", async () => {
  await assert.rejects(
    validateFixture(createFixture({
      candidateCoreVersion: "1.9.9",
      candidateMinimumSafeCoreVersion: "2.0.0"
    })),
    /Core 1\.9\.9 is below minimumSafeCoreVersion 2\.0\.0/u
  );

  await assert.rejects(
    validateFixture(createFixture({
      candidateRevocations: [{ componentId: "lyra.editor", version: "1.0.0" }]
    })),
    /contains revoked component lyra\.editor@1\.0\.0/u
  );
});

test("rejects signed candidates with unusable entries or non-first-party app execution", async () => {
  await assert.rejects(
    validateFixture(createFixture({
      candidateEntryOverrides: { "lyra.core": undefined }
    })),
    /unauthorized or invalid lyra\.core entry/u
  );
  await assert.rejects(
    validateFixture(createFixture({
      candidateExecutionClassOverrides: { "lyra.agent": "sandboxed-web" },
      candidateAllowedExecutionClasses: ["first-party-shared-renderer", "sandboxed-web"]
    })),
    /unauthorized or invalid lyra\.agent entry/u
  );
  await assert.rejects(
    validateFixture(createFixture({
      candidateEntryOverrides: { "lyra.runtime": "bin/wrong-runtime" }
    })),
    /unauthorized or invalid lyra\.runtime entry/u
  );
});

test("requires candidates to embed the configured root-signed keyring when supplied", async () => {
  const fixture = createFixture();
  const otherRelease = generateKeyPairSync("ed25519");
  const other = createSignedSet({
    rootPrivateKey: fixture.rootPrivateKey,
    rootKeyId: "root-1",
    releasePrivateKey: otherRelease.privateKey,
    releaseKeyId: "release-other",
    releaseTag: "v1.2.3-preview.1",
    releaseVersion: "1.2.3-preview.1",
    catalogSequence: 21,
    keyringSequence: 12
  });
  await assert.rejects(
    validateFixture(fixture, { expectedKeyring: other.keyring }),
    /configured expected keyring/u
  );
});

class MemoryAssetClient implements ChannelAssetMutationClient {
  readonly assets = new Map<number, { name: string; bytes: Buffer }>();
  #nextId = 100;
  #renameCalls = 0;
  readonly #failRenameAt: number | undefined;

  constructor(failRenameAt?: number) {
    this.#failRenameAt = failRenameAt;
  }

  seed(name: string, bytes: Buffer): ReleaseAssetIdentity {
    const id = this.#nextId++;
    this.assets.set(id, { name, bytes });
    return { id, name };
  }

  async upload(name: string, bytes: Buffer): Promise<ReleaseAssetIdentity> {
    if ([...this.assets.values()].some((asset) => asset.name === name)) {
      throw new Error(`duplicate ${name}`);
    }
    return this.seed(name, Buffer.from(bytes));
  }

  async download(asset: ReleaseAssetIdentity): Promise<Buffer> {
    const stored = this.assets.get(asset.id);
    if (stored === undefined) throw new Error("missing asset");
    return Buffer.from(stored.bytes);
  }

  async rename(asset: ReleaseAssetIdentity, name: string): Promise<ReleaseAssetIdentity> {
    this.#renameCalls += 1;
    if (this.#renameCalls === this.#failRenameAt) throw new Error("injected rename failure");
    const stored = this.assets.get(asset.id);
    if (stored === undefined) throw new Error("missing asset");
    if ([...this.assets].some(([id, other]) => id !== asset.id && other.name === name)) {
      throw new Error(`duplicate ${name}`);
    }
    stored.name = name;
    return { id: asset.id, name };
  }

  async remove(asset: ReleaseAssetIdentity): Promise<void> {
    if (!this.assets.delete(asset.id)) throw new Error("missing asset");
  }
}

const createMutationInput = (client: MemoryAssetClient) => {
  const current = new Map<ComponentTargetV1, ReleaseAssetIdentity>();
  const catalogs = new Map<ComponentTargetV1, PromotionCatalogDocument>();
  for (const target of CHANNEL_PROMOTION_TARGETS_V1) {
    const name = `catalog-preview-${target}.json`;
    current.set(target, client.seed(name, Buffer.from(`old-${target}`)));
    catalogs.set(target, { name, bytes: Buffer.from(`new-${target}`) });
  }
  return { current, catalogs };
};

test("stages, verifies, swaps, and removes old channel assets", async () => {
  const client = new MemoryAssetClient();
  const { current, catalogs } = createMutationInput(client);
  await replaceChannelCatalogAssets({
    client,
    currentAssets: current,
    catalogs,
    transactionId: "test-success"
  });
  assert.equal(client.assets.size, 6);
  for (const target of CHANNEL_PROMOTION_TARGETS_V1) {
    const name = `catalog-preview-${target}.json`;
    const asset = [...client.assets.values()].find((candidate) => candidate.name === name);
    assert.equal(asset?.bytes.toString("utf8"), `new-${target}`);
  }
});

test("initializes only an empty channel and removes all staging assets on failure", async () => {
  const markerlessClient = new MemoryAssetClient();
  const markerless = createMutationInput(markerlessClient);
  for (const asset of [...markerlessClient.assets.keys()]) markerlessClient.assets.delete(asset);
  await assert.rejects(
    replaceChannelCatalogAssets({
      client: markerlessClient,
      currentAssets: new Map(),
      catalogs: markerless.catalogs,
      transactionId: "test-markerless-initialize"
    }),
    /requires exactly one canonical initialization marker/u
  );

  const client = new MemoryAssetClient();
  const { catalogs } = createMutationInput(client);
  const initializationMarker = {
    name: CHANNEL_INITIALIZATION_MARKER_NAME_V1,
    bytes: Buffer.from("genesis")
  };
  for (const asset of [...client.assets.keys()]) client.assets.delete(asset);
  await replaceChannelCatalogAssets({
    client,
    currentAssets: new Map(),
    catalogs,
    initializationMarker,
    transactionId: "test-initialize"
  });
  assert.equal(client.assets.size, 7);
  for (const target of CHANNEL_PROMOTION_TARGETS_V1) {
    const name = `catalog-preview-${target}.json`;
    const asset = [...client.assets.values()].find((candidate) => candidate.name === name);
    assert.equal(asset?.bytes.toString("utf8"), `new-${target}`);
  }
  assert.equal(
    [...client.assets.values()].find(
      (candidate) => candidate.name === CHANNEL_INITIALIZATION_MARKER_NAME_V1
    )?.bytes.toString("utf8"),
    "genesis"
  );

  const failingClient = new MemoryAssetClient(2);
  const failing = createMutationInput(failingClient);
  for (const asset of [...failingClient.assets.keys()]) failingClient.assets.delete(asset);
  await assert.rejects(
    replaceChannelCatalogAssets({
      client: failingClient,
      currentAssets: new Map(),
      catalogs: failing.catalogs,
      initializationMarker,
      transactionId: "test-initialize-rollback"
    }),
    /injected rename failure/u
  );
  assert.equal(failingClient.assets.size, 0);
});

test("restores all old channel assets when a staged rename fails", async () => {
  const client = new MemoryAssetClient(8);
  const { current, catalogs } = createMutationInput(client);
  await assert.rejects(
    replaceChannelCatalogAssets({
      client,
      currentAssets: current,
      catalogs,
      transactionId: "test-rollback"
    }),
    /injected rename failure/u
  );
  assert.equal(client.assets.size, 6);
  for (const target of CHANNEL_PROMOTION_TARGETS_V1) {
    const name = `catalog-preview-${target}.json`;
    const asset = [...client.assets.values()].find((candidate) => candidate.name === name);
    assert.equal(asset?.bytes.toString("utf8"), `old-${target}`);
  }
});

test("keeps channel promotion explicit and separate from draft creation without private keys", async () => {
  const workflow = await readFile(
    path.resolve(".github/workflows/promote-component-channel.yml"),
    "utf8"
  );
  const draftWorkflow = await readFile(
    path.resolve(".github/workflows/modular-release.yml"),
    "utf8"
  );
  const cli = await readFile(path.resolve("tools/components/promote-channel.ts"), "utf8");
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /INITIALIZE EMPTY/u);
  assert.match(workflow, /initialize-empty-channel/u);
  assert.doesNotMatch(workflow, /LYRA_RELEASE_PRIVATE_KEY|gh release create/u);
  assert.doesNotMatch(cli, /private[-_ ]key/iu);
  assert.doesNotMatch(draftWorkflow, /promote-channel\.ts|promote-component-channel/u);
});

test("fails closed before any Stable channel mutation can be attempted", async () => {
  const workflow = await readFile(
    path.resolve(".github/workflows/promote-component-channel.yml"),
    "utf8"
  );
  assert.doesNotMatch(workflow, /^\s*- stable\s*$/mu);

  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    path.resolve("tools/components/promote-channel.ts"),
    "--apply",
    "--channel",
    "stable",
    "--release-tag",
    "v1.0.0",
    "--release-version",
    "1.0.0",
    "--confirm",
    "PROMOTE stable v1.0.0 1.0.0",
    "--trust-store",
    path.resolve("does-not-exist.json")
  ], {
    cwd: path.resolve("."),
    encoding: "utf8",
    env: { ...process.env, LYRA_RELEASES_TOKEN: "must-not-be-used" }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stable promotion is disabled/u);
  assert.doesNotMatch(result.stderr, /ENOENT|GitHub API/u);
});
