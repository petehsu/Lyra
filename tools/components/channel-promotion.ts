import {
  createHash,
  createPublicKey,
  randomUUID,
  verify,
  type KeyObject
} from "node:crypto";

import {
  canonicalChannelCatalogPayloadV1,
  canonicalJson,
  canonicalReleaseBomComponentV1,
  canonicalReleaseBomV1,
  canonicalReleaseKeyringPayloadV1,
  validateReleaseBomV1,
  validateSignedChannelCatalogV1,
  validateSignedReleaseKeyringV1,
  type ComponentChannelV1,
  type ComponentTargetV1,
  type ReleaseBomV1,
  type SignedChannelCatalogV1,
  type SignedReleaseKeyringV1
} from "../../packages/app-runtime/src/index.ts";
import { LYRA_DESKTOP_RELEASE_COMPONENTS_V1 } from "./release-package.ts";

export const CHANNEL_PROMOTION_TARGETS_V1 = [
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
] as const satisfies readonly ComponentTargetV1[];
export const CHANNEL_INITIALIZATION_MARKER_NAME_V1 = "channel-initialized-v1.json";

const TARGETS = new Set<string>(CHANNEL_PROMOTION_TARGETS_V1);
const RELEASE_TAG_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,127}$/u;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const PROMOTION_REMAINDER_PATTERN = /^promotion-(?:pending|backup)-/u;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export type PromotionCatalogDocument = {
  readonly name: string;
  readonly bytes: Buffer;
};

export type ChannelPromotionValidationInput = {
  readonly channel: ComponentChannelV1;
  readonly releaseTag: string;
  readonly releaseVersion: string;
  readonly repository: string;
  readonly candidateCatalogs: readonly PromotionCatalogDocument[];
  readonly currentCatalogs: readonly PromotionCatalogDocument[];
  readonly trustedRoots: Readonly<Record<string, string>>;
  readonly expectedKeyring?: SignedReleaseKeyringV1;
  readonly allowEmptyCurrentChannel?: boolean;
  readonly now?: Date;
  readonly loadCandidateBom: (url: string) => Promise<Buffer>;
  readonly assertCandidateComponentAsset: (
    url: string,
    size: number,
    sha256: string
  ) => Promise<void>;
};

export type ValidatedChannelPromotion = {
  readonly channel: ComponentChannelV1;
  readonly releaseTag: string;
  readonly releaseVersion: string;
  readonly catalogSequence: number;
  readonly previousCatalogSequence: number;
  readonly keyringSequence: number;
  readonly previousKeyringSequence: number;
  readonly initialChannel: boolean;
  readonly catalogs: ReadonlyMap<ComponentTargetV1, PromotionCatalogDocument>;
};

export type ReleaseAssetIdentity = {
  readonly id: number;
  readonly name: string;
};

export type ChannelAssetMutationClient = {
  readonly upload: (name: string, bytes: Buffer) => Promise<ReleaseAssetIdentity>;
  readonly download: (asset: ReleaseAssetIdentity) => Promise<Buffer>;
  readonly rename: (asset: ReleaseAssetIdentity, name: string) => Promise<ReleaseAssetIdentity>;
  readonly remove: (asset: ReleaseAssetIdentity) => Promise<void>;
};

export const assertPromotionReleasePublicationState = ({
  tagName,
  draft,
  immutable,
  expectedTag,
  requiredImmutability,
  description
}: {
  readonly tagName: unknown;
  readonly draft: unknown;
  readonly immutable: unknown;
  readonly expectedTag: string;
  readonly requiredImmutability: "immutable" | "mutable";
  readonly description: string;
}): void => {
  const expectedImmutable = requiredImmutability === "immutable";
  if (
    tagName !== expectedTag
    || draft !== false
    || immutable !== expectedImmutable
  ) {
    throw new Error(
      `${description} must be an already-public ${requiredImmutability} GitHub Release `
      + "with the exact requested tag."
    );
  }
};

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const compareSemanticVersions = (left: string, right: string): number => {
  const parse = (value: string): {
    readonly core: readonly [bigint, bigint, bigint];
    readonly prerelease: readonly string[] | undefined;
  } => {
    const buildIndex = value.indexOf("+");
    const withoutBuild = buildIndex < 0 ? value : value.slice(0, buildIndex);
    const prereleaseIndex = withoutBuild.indexOf("-");
    const core = prereleaseIndex < 0
      ? withoutBuild
      : withoutBuild.slice(0, prereleaseIndex);
    const prerelease = prereleaseIndex < 0
      ? undefined
      : withoutBuild.slice(prereleaseIndex + 1).split(".");
    const parts = core.split(".");
    return {
      core: [BigInt(parts[0]!), BigInt(parts[1]!), BigInt(parts[2]!)],
      prerelease
    };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  for (let index = 0; index < leftVersion.core.length; index += 1) {
    if (leftVersion.core[index]! < rightVersion.core[index]!) return -1;
    if (leftVersion.core[index]! > rightVersion.core[index]!) return 1;
  }
  if (leftVersion.prerelease === undefined || rightVersion.prerelease === undefined) {
    if (leftVersion.prerelease === rightVersion.prerelease) return 0;
    return leftVersion.prerelease === undefined ? 1 : -1;
  }
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      if (leftPart === rightPart) return 0;
      return leftPart === undefined ? -1 : 1;
    }
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = BigInt(leftPart);
      const rightNumber = BigInt(rightPart);
      if (leftNumber < rightNumber) return -1;
      if (leftNumber > rightNumber) return 1;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (leftPart < rightPart) return -1;
    if (leftPart > rightPart) return 1;
  }
  return 0;
};

const parseJson = (bytes: Buffer, description: string): unknown => {
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`${description} must contain between 1 byte and ${MAX_DOCUMENT_BYTES} bytes.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`${description} is not valid JSON.`);
  }
};

const createRawEd25519PublicKey = (encoded: string, description: string): KeyObject => {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== encoded) {
    throw new Error(`${description} must be one canonical base64-encoded 32-byte Ed25519 key.`);
  }
  return createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), bytes]),
    format: "der",
    type: "spki"
  });
};

const verifySignature = ({
  payload,
  signature,
  publicKey,
  description
}: {
  readonly payload: string;
  readonly signature: string;
  readonly publicKey: KeyObject;
  readonly description: string;
}): void => {
  const bytes = Buffer.from(signature, "base64");
  if (
    bytes.length !== 64
    || bytes.toString("base64") !== signature
    || !verify(null, Buffer.from(payload, "utf8"), publicKey, bytes)
  ) {
    throw new Error(`${description} signature is invalid.`);
  }
};

const verifyKeyring = ({
  keyring,
  trustedRoots,
  now,
  requireCurrent,
  description
}: {
  readonly keyring: SignedReleaseKeyringV1;
  readonly trustedRoots: Readonly<Record<string, string>>;
  readonly now: number;
  readonly requireCurrent: boolean;
  readonly description: string;
}): void => {
  if (!validateSignedReleaseKeyringV1(keyring)) {
    throw new Error(`${description} release keyring has an invalid structure.`);
  }
  const root = trustedRoots[keyring.signature.keyId];
  if (root === undefined) {
    throw new Error(`${description} release keyring uses an untrusted root: ${keyring.signature.keyId}.`);
  }
  verifySignature({
    payload: canonicalReleaseKeyringPayloadV1(keyring),
    signature: keyring.signature.value,
    publicKey: createRawEd25519PublicKey(root, `Trusted root ${keyring.signature.keyId}`),
    description: `${description} release keyring`
  });
  if (
    requireCurrent
    && (now < Date.parse(keyring.payload.generatedAt) || now >= Date.parse(keyring.payload.expiresAt))
  ) {
    throw new Error(`${description} release keyring is not currently valid.`);
  }
};

const verifyCatalog = ({
  value,
  channel,
  trustedRoots,
  now,
  requireCurrent,
  description
}: {
  readonly value: unknown;
  readonly channel: ComponentChannelV1;
  readonly trustedRoots: Readonly<Record<string, string>>;
  readonly now: number;
  readonly requireCurrent: boolean;
  readonly description: string;
}): SignedChannelCatalogV1 => {
  if (!validateSignedChannelCatalogV1(value)) {
    throw new Error(`${description} does not satisfy SignedChannelCatalogV1.`);
  }
  if (value.payload.channel !== channel) {
    throw new Error(`${description} belongs to ${value.payload.channel}, not ${channel}.`);
  }
  verifyKeyring({
    keyring: value.keyring,
    trustedRoots,
    now,
    requireCurrent,
    description
  });
  const releaseKey = value.keyring.payload.keys.find(
    ({ keyId }) => keyId === value.signature.keyId
  );
  if (releaseKey === undefined) {
    throw new Error(`${description} release key is absent from its root-signed keyring.`);
  }
  const publicKey = createRawEd25519PublicKey(
    releaseKey.publicKey,
    `${description} release key ${releaseKey.keyId}`
  );
  verifySignature({
    payload: canonicalChannelCatalogPayloadV1(value),
    signature: value.signature.value,
    publicKey,
    description
  });
  if (
    requireCurrent
    && (
      now < Date.parse(value.payload.generatedAt)
      || now >= Date.parse(value.payload.expiresAt)
      || now < Date.parse(releaseKey.validFrom)
      || now >= Date.parse(releaseKey.validUntil)
    )
  ) {
    throw new Error(`${description} or its release key is not currently valid.`);
  }
  return value;
};

const parseTargetName = (
  name: string,
  channel: ComponentChannelV1
): ComponentTargetV1 => {
  const match = /^catalog-(stable|preview)-([a-z0-9-]+)\.json$/u.exec(name);
  if (match === null || match[1] !== channel || !TARGETS.has(match[2] ?? "")) {
    throw new Error(`Unexpected ${channel} catalog asset name: ${name}.`);
  }
  return match[2] as ComponentTargetV1;
};

const indexCatalogs = (
  documents: readonly PromotionCatalogDocument[],
  channel: ComponentChannelV1,
  description: string
): ReadonlyMap<ComponentTargetV1, PromotionCatalogDocument> => {
  if (documents.length !== CHANNEL_PROMOTION_TARGETS_V1.length) {
    throw new Error(
      `${description} must contain exactly ${CHANNEL_PROMOTION_TARGETS_V1.length} catalog assets.`
    );
  }
  const result = new Map<ComponentTargetV1, PromotionCatalogDocument>();
  for (const document of documents) {
    const target = parseTargetName(document.name, channel);
    if (result.has(target)) {
      throw new Error(`${description} contains duplicate target ${target}.`);
    }
    result.set(target, document);
  }
  const missing = CHANNEL_PROMOTION_TARGETS_V1.filter((target) => !result.has(target));
  if (missing.length > 0) {
    throw new Error(`${description} is missing targets: ${missing.join(", ")}.`);
  }
  return result;
};

const splitRepository = (repository: string): readonly [string, string] => {
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/u.exec(repository);
  if (match === null) {
    throw new Error("Release repository must use the owner/name form.");
  }
  return [match[1]!, match[2]!];
};

const expectedFirstPartyEntry = (
  componentId: string,
  target: ComponentTargetV1
): string => {
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

export const parseImmutableReleaseAssetUrl = ({
  url,
  repository,
  releaseTag
}: {
  readonly url: string;
  readonly repository: string;
  readonly releaseTag: string;
}): string => {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "github.com"
    || parsed.port.length > 0
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.search.length > 0
    || parsed.hash.length > 0
  ) {
    throw new Error(`BOM URL is not an immutable GitHub Release URL: ${url}`);
  }
  const [owner, name] = splitRepository(repository);
  let segments: string[];
  try {
    segments = parsed.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new Error(`BOM URL contains invalid percent encoding: ${url}`);
  }
  if (
    segments.length !== 6
    || segments[0] !== owner
    || segments[1] !== name
    || segments[2] !== "releases"
    || segments[3] !== "download"
    || segments[4] !== releaseTag
    || segments[5] === undefined
    || segments[5].includes("/")
    || segments[5].includes("\\")
  ) {
    throw new Error(`BOM URL does not belong to immutable release ${repository}@${releaseTag}: ${url}`);
  }
  return segments[5];
};

const verifyBom = ({
  bytes,
  expectedDigest,
  expectedSignature,
  expectedTarget,
  expectedChannel,
  expectedVersion,
  releaseKey,
  description
}: {
  readonly bytes: Buffer;
  readonly expectedDigest: string;
  readonly expectedSignature: string;
  readonly expectedTarget: ComponentTargetV1;
  readonly expectedChannel: ComponentChannelV1;
  readonly expectedVersion: string;
  readonly releaseKey: KeyObject;
  readonly description: string;
}): ReleaseBomV1 => {
  if (sha256(bytes) !== expectedDigest) {
    throw new Error(`${description} SHA-256 does not match its signed catalog descriptor.`);
  }
  const value = parseJson(bytes, description);
  if (!validateReleaseBomV1(value)) {
    throw new Error(`${description} does not satisfy ReleaseBomV1.`);
  }
  if (
    value.target !== expectedTarget
    || value.channel !== expectedChannel
    || value.releaseVersion !== expectedVersion
  ) {
    throw new Error(`${description} target, channel, or release version does not match its catalog.`);
  }
  verifySignature({
    payload: canonicalReleaseBomV1(value),
    signature: expectedSignature,
    publicKey: releaseKey,
    description
  });
  for (const component of value.components) {
    verifySignature({
      payload: canonicalReleaseBomComponentV1(component),
      signature: component.signature,
      publicKey: releaseKey,
      description: `${description} component ${component.componentId}`
    });
  }
  return value;
};

export const validateChannelPromotion = async (
  input: ChannelPromotionValidationInput
): Promise<ValidatedChannelPromotion> => {
  splitRepository(input.repository);
  if (!RELEASE_TAG_PATTERN.test(input.releaseTag)) {
    throw new Error("Immutable release tag must be one URL-safe path segment.");
  }
  if (["stable-channel", "preview-channel"].includes(input.releaseTag)) {
    throw new Error("The immutable source release cannot be a mutable channel release.");
  }
  if (!SEMVER_PATTERN.test(input.releaseVersion)) {
    throw new Error("Release version is not SemVer.");
  }
  if (Object.keys(input.trustedRoots).length === 0) {
    throw new Error("At least one configured public trust root is required for promotion.");
  }
  const now = (input.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) {
    throw new Error("Promotion verification time is invalid.");
  }
  const candidates = indexCatalogs(input.candidateCatalogs, input.channel, "Candidate release");
  const initialChannel = input.currentCatalogs.length === 0;
  if (initialChannel && input.allowEmptyCurrentChannel !== true) {
    throw new Error(
      "Current channel is empty; explicit one-time empty-channel initialization is required."
    );
  }
  const current = initialChannel
    ? new Map<ComponentTargetV1, PromotionCatalogDocument>()
    : indexCatalogs(input.currentCatalogs, input.channel, "Current channel release");

  if (input.expectedKeyring !== undefined) {
    verifyKeyring({
      keyring: input.expectedKeyring,
      trustedRoots: input.trustedRoots,
      now,
      requireCurrent: true,
      description: "Configured expected"
    });
  }

  const candidateSequences = new Set<number>();
  const candidateKeyringSequences = new Set<number>();
  const candidateKeyrings = new Set<string>();
  const candidatePolicies = new Set<string>();
  const candidateBomIdentities = new Set<string>();
  const previousSequences: number[] = [];
  const previousKeyringSequences: number[] = [];
  const previousKeyringsBySequence = new Map<number, Set<string>>();

  for (const target of CHANNEL_PROMOTION_TARGETS_V1) {
    const candidateDocument = candidates.get(target)!;
    const candidate = verifyCatalog({
      value: parseJson(candidateDocument.bytes, `Candidate catalog ${target}`),
      channel: input.channel,
      trustedRoots: input.trustedRoots,
      now,
      requireCurrent: true,
      description: `Candidate catalog ${target}`
    });
    if (candidate.payload.releases.length !== 1) {
      throw new Error(`Candidate catalog ${target} must describe exactly one release.`);
    }
    const descriptor = candidate.payload.releases[0]!;
    if (descriptor.version !== input.releaseVersion) {
      throw new Error(
        `Candidate catalog ${target} describes ${descriptor.version}, not ${input.releaseVersion}.`
      );
    }
    if (
      input.expectedKeyring !== undefined
      && canonicalJson(candidate.keyring) !== canonicalJson(input.expectedKeyring)
    ) {
      throw new Error(`Candidate catalog ${target} does not embed the configured expected keyring.`);
    }
    candidateSequences.add(candidate.payload.sequence);
    candidateKeyringSequences.add(candidate.keyring.payload.sequence);
    candidateKeyrings.add(canonicalJson(candidate.keyring));
    candidatePolicies.add(canonicalJson({
      generatedAt: candidate.payload.generatedAt,
      expiresAt: candidate.payload.expiresAt,
      ...(candidate.payload.minimumSafeCoreVersion === undefined
        ? {}
        : { minimumSafeCoreVersion: candidate.payload.minimumSafeCoreVersion }),
      revocations: candidate.payload.revocations,
      releaseKeyId: candidate.signature.keyId
    }));
    parseImmutableReleaseAssetUrl({
      url: descriptor.bomUrl,
      repository: input.repository,
      releaseTag: input.releaseTag
    });
    const releaseKeyRecord = candidate.keyring.payload.keys.find(
      ({ keyId }) => keyId === descriptor.keyId
    )!;
    const bom = verifyBom({
      bytes: await input.loadCandidateBom(descriptor.bomUrl),
      expectedDigest: descriptor.bomSha256,
      expectedSignature: descriptor.bomSignature,
      expectedTarget: target,
      expectedChannel: input.channel,
      expectedVersion: input.releaseVersion,
      releaseKey: createRawEd25519PublicKey(
        releaseKeyRecord.publicKey,
        `Candidate catalog ${target} release key ${releaseKeyRecord.keyId}`
      ),
      description: `Candidate BOM ${target}`
    });
    if (
      candidate.payload.minimumSafeCoreVersion !== undefined
      && compareSemanticVersions(bom.coreVersion, candidate.payload.minimumSafeCoreVersion) < 0
    ) {
      throw new Error(
        `Candidate BOM ${target} Core ${bom.coreVersion} is below minimumSafeCoreVersion `
        + `${candidate.payload.minimumSafeCoreVersion}.`
      );
    }
    const expectedComponents = Object.entries(LYRA_DESKTOP_RELEASE_COMPONENTS_V1);
    if (bom.components.length !== expectedComponents.length) {
      throw new Error(
        `Candidate BOM ${target} must contain exactly ${expectedComponents.length} release components.`
      );
    }
    const componentsById = new Map(bom.components.map((component) => [component.componentId, component]));
    candidateBomIdentities.add(canonicalJson({
      releaseVersion: bom.releaseVersion,
      coreVersion: bom.coreVersion,
      hostApiVersion: bom.hostApiVersion,
      components: [...bom.components]
        .sort((left, right) => left.componentId.localeCompare(right.componentId))
        .map((component) => ({
          componentId: component.componentId,
          kind: component.kind,
          version: component.version,
          keyId: component.keyId,
          ...(component.executionClass === undefined
            ? {}
            : { executionClass: component.executionClass }),
          activation: component.activation,
          delivery: component.delivery
        }))
    }));
    for (const [componentId, contract] of expectedComponents) {
      const component = componentsById.get(componentId);
      if (
        component === undefined
        || component.kind !== contract.kind
        || component.activation !== contract.activation
        || component.delivery !== contract.delivery
        || component.entry !== expectedFirstPartyEntry(componentId, target)
        || (
          component.kind === "app"
          && component.executionClass !== "first-party-shared-renderer"
        )
        || component.keyId !== releaseKeyRecord.keyId
        || !releaseKeyRecord.componentKinds.includes(component.kind)
        || !releaseKeyRecord.componentIdPrefixes.some((prefix) => componentId.startsWith(prefix))
        || (
          component.executionClass !== undefined
          && !releaseKeyRecord.executionClasses.includes(component.executionClass)
        )
      ) {
        throw new Error(`Candidate BOM ${target} has an unauthorized or invalid ${componentId} entry.`);
      }
      const revocation = candidate.payload.revocations.find(
        (entry) => entry.componentId === component.componentId && entry.version === component.version
      );
      if (revocation !== undefined) {
        throw new Error(
          `Candidate BOM ${target} contains revoked component ${component.componentId}@${component.version}.`
        );
      }
      parseImmutableReleaseAssetUrl({
        url: component.url,
        repository: input.repository,
        releaseTag: input.releaseTag
      });
      await input.assertCandidateComponentAsset(component.url, component.size, component.sha256);
    }

    if (!initialChannel) {
      const currentDocument = current.get(target)!;
      const previous = verifyCatalog({
        value: parseJson(currentDocument.bytes, `Current catalog ${target}`),
        channel: input.channel,
        trustedRoots: input.trustedRoots,
        now,
        // An expired channel document must still provide an authenticated
        // anti-rollback floor so that a fresh release can repair the channel.
        requireCurrent: false,
        description: `Current catalog ${target}`
      });
      previousSequences.push(previous.payload.sequence);
      previousKeyringSequences.push(previous.keyring.payload.sequence);
      const keyringsAtSequence = previousKeyringsBySequence.get(previous.keyring.payload.sequence)
        ?? new Set<string>();
      keyringsAtSequence.add(canonicalJson(previous.keyring));
      previousKeyringsBySequence.set(previous.keyring.payload.sequence, keyringsAtSequence);
    }
  }

  if (candidateSequences.size !== 1) {
    throw new Error("All six candidate catalogs must use the same catalog sequence.");
  }
  if (candidateKeyringSequences.size !== 1 || candidateKeyrings.size !== 1) {
    throw new Error("All six candidate catalogs must embed the same root-signed keyring.");
  }
  if (candidatePolicies.size !== 1 || candidateBomIdentities.size !== 1) {
    throw new Error(
      "All six candidate catalogs must use the same validity, revocation, release-key, Host API, and component-version policy."
    );
  }
  const catalogSequence = [...candidateSequences][0]!;
  const keyringSequence = [...candidateKeyringSequences][0]!;
  const previousCatalogSequence = initialChannel ? 0 : Math.max(...previousSequences);
  const previousKeyringSequence = initialChannel ? 0 : Math.max(...previousKeyringSequences);
  if (catalogSequence <= previousCatalogSequence) {
    throw new Error(
      `Catalog sequence ${catalogSequence} must be greater than current channel floor ${previousCatalogSequence}.`
    );
  }
  if (keyringSequence < previousKeyringSequence) {
    throw new Error(
      `Keyring sequence ${keyringSequence} is below current channel floor ${previousKeyringSequence}.`
    );
  }
  if (keyringSequence === previousKeyringSequence) {
    const floorKeyrings = previousKeyringsBySequence.get(previousKeyringSequence);
    const candidateKeyring = [...candidateKeyrings][0]!;
    if (
      floorKeyrings === undefined
      || floorKeyrings.size !== 1
      || !floorKeyrings.has(candidateKeyring)
    ) {
      throw new Error(
        `Keyring sequence ${keyringSequence} may be reused only with the exact authenticated `
        + "current keyring; same-sequence keyring ambiguity is forbidden."
      );
    }
  }
  return {
    channel: input.channel,
    releaseTag: input.releaseTag,
    releaseVersion: input.releaseVersion,
    catalogSequence,
    previousCatalogSequence,
    keyringSequence,
    previousKeyringSequence,
    initialChannel,
    catalogs: candidates
  };
};

const sameBytes = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && left.equals(right);

const bestEffortRemove = async (
  client: ChannelAssetMutationClient,
  assets: readonly ReleaseAssetIdentity[]
): Promise<readonly Error[]> => {
  const errors: Error[] = [];
  for (const asset of assets) {
    try {
      await client.remove(asset);
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return errors;
};

export const replaceChannelCatalogAssets = async ({
  client,
  currentAssets,
  catalogs,
  initializationMarker,
  beforeSwap,
  transactionId = randomUUID()
}: {
  readonly client: ChannelAssetMutationClient;
  readonly currentAssets: ReadonlyMap<ComponentTargetV1, ReleaseAssetIdentity>;
  readonly catalogs: ReadonlyMap<ComponentTargetV1, PromotionCatalogDocument>;
  readonly initializationMarker?: PromotionCatalogDocument;
  readonly beforeSwap?: (pending: readonly ReleaseAssetIdentity[]) => Promise<void>;
  readonly transactionId?: string;
}): Promise<void> => {
  if (!/^[A-Za-z0-9-]{1,64}$/u.test(transactionId)) {
    throw new Error("Promotion transaction ID is invalid.");
  }
  const initialChannel = currentAssets.size === 0;
  if (
    catalogs.size !== CHANNEL_PROMOTION_TARGETS_V1.length
    || (!initialChannel && currentAssets.size !== CHANNEL_PROMOTION_TARGETS_V1.length)
  ) {
    throw new Error("Promotion transaction must contain either zero or all six current catalogs.");
  }
  if (
    (initialChannel && initializationMarker === undefined)
    || (initializationMarker !== undefined && !initialChannel)
    || (
      initializationMarker !== undefined
      && initializationMarker.name !== CHANNEL_INITIALIZATION_MARKER_NAME_V1
    )
  ) {
    throw new Error("An empty channel requires exactly one canonical initialization marker.");
  }
  const pending: ReleaseAssetIdentity[] = [];
  const backups: Array<{
    readonly target: ComponentTargetV1;
    readonly originalName: string;
    asset: ReleaseAssetIdentity;
  }> = [];
  try {
    for (const target of CHANNEL_PROMOTION_TARGETS_V1) {
      const document = catalogs.get(target);
      const current = currentAssets.get(target);
      if (document === undefined || (!initialChannel && current === undefined)) {
        throw new Error(`Promotion transaction is missing target ${target}.`);
      }
      const uploaded = await client.upload(
        `promotion-pending-${transactionId}-${document.name}`,
        document.bytes
      );
      pending.push(uploaded);
      if (!sameBytes(await client.download(uploaded), document.bytes)) {
        throw new Error(`Uploaded staging catalog changed for ${target}.`);
      }
    }
    if (initializationMarker !== undefined) {
      const uploaded = await client.upload(
        `promotion-pending-${transactionId}-${initializationMarker.name}`,
        initializationMarker.bytes
      );
      pending.push(uploaded);
      if (!sameBytes(await client.download(uploaded), initializationMarker.bytes)) {
        throw new Error("Uploaded channel initialization marker changed.");
      }
    }

    await beforeSwap?.(pending);

    if (!initialChannel) {
      for (const target of CHANNEL_PROMOTION_TARGETS_V1) {
        const current = currentAssets.get(target)!;
        const backup = {
          target,
          originalName: current.name,
          asset: current
        };
        backups.push(backup);
        backup.asset = await client.rename(
          current,
          `promotion-backup-${transactionId}-${current.name}`
        );
      }
    }

    for (const [index, target] of CHANNEL_PROMOTION_TARGETS_V1.entries()) {
      const document = catalogs.get(target)!;
      pending[index] = await client.rename(pending[index]!, document.name);
    }
    for (const [index, target] of CHANNEL_PROMOTION_TARGETS_V1.entries()) {
      const document = catalogs.get(target)!;
      if (!sameBytes(await client.download(pending[index]!), document.bytes)) {
        throw new Error(`Promoted channel catalog changed for ${target}.`);
      }
    }
    if (initializationMarker !== undefined) {
      const markerIndex = CHANNEL_PROMOTION_TARGETS_V1.length;
      pending[markerIndex] = await client.rename(
        pending[markerIndex]!,
        initializationMarker.name
      );
      if (!sameBytes(await client.download(pending[markerIndex]!), initializationMarker.bytes)) {
        throw new Error("Promoted channel initialization marker changed.");
      }
    }
  } catch (error: unknown) {
    const rollbackErrors = [
      ...await bestEffortRemove(client, pending),
      ...await (async (): Promise<readonly Error[]> => {
        const errors: Error[] = [];
        for (const backup of backups) {
          try {
            backup.asset = await client.rename(backup.asset, backup.originalName);
          } catch (rollbackError: unknown) {
            errors.push(
              rollbackError instanceof Error
                ? rollbackError
                : new Error(String(rollbackError))
            );
          }
        }
        return errors;
      })()
    ];
    const cause = error instanceof Error ? error : new Error(String(error));
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [cause, ...rollbackErrors],
        "Channel promotion failed and rollback was incomplete. Manual channel repair is required."
      );
    }
    throw cause;
  }

  const cleanupErrors = await bestEffortRemove(
    client,
    backups.map(({ asset }) => asset)
  );
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Channel promotion succeeded, but old backup assets could not be removed."
    );
  }
};

export const isPromotionRemainderAsset = (name: string): boolean =>
  PROMOTION_REMAINDER_PATTERN.test(name);
