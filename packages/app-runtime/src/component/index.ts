export const COMPONENT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const RELEASE_BOM_SCHEMA_VERSION = 1 as const;
export const SIGNED_RELEASE_KEYRING_SCHEMA_VERSION = 1 as const;
export const SIGNED_CHANNEL_CATALOG_SCHEMA_VERSION = 1 as const;

export type ComponentKindV1 = "core" | "runtime" | "app" | "resource" | "extension";
export type ComponentTargetV1 =
  | "darwin-x64"
  | "darwin-arm64"
  | "windows-x64"
  | "windows-arm64"
  | "linux-x64"
  | "linux-arm64";
export type ComponentChannelV1 = "stable" | "preview";
export type ComponentActivationV1 =
  | "core-restart"
  | "module-idle"
  | "runtime-idle"
  | "resource-idle"
  | "next-session";
export type ComponentDeliveryV1 = "required" | "on-demand";
export type ComponentExecutionClassV1 =
  | "first-party-shared-renderer"
  | "sandboxed-web"
  | "sandboxed-web-wasi";

export type SemanticVersionRangeV1 = {
  readonly minInclusive: string;
  readonly maxExclusive?: string;
};

export type RuntimeProtocolRangeV1 = {
  readonly min: number;
  readonly max: number;
};

export type ComponentDataSchemaV1 = {
  readonly readerMin: number;
  readonly readerMax: number;
  readonly writer: number;
};

export type ComponentFileV1 = {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
};

export type ComponentManifestV1 = {
  readonly schemaVersion: typeof COMPONENT_MANIFEST_SCHEMA_VERSION;
  readonly componentId: string;
  readonly kind: ComponentKindV1;
  readonly version: string;
  readonly target: ComponentTargetV1;
  readonly entry?: string;
  readonly executionClass?: ComponentExecutionClassV1;
  readonly activation: ComponentActivationV1;
  readonly hostApiRange?: SemanticVersionRangeV1;
  readonly runtimeProtocolRange?: RuntimeProtocolRangeV1;
  readonly dataSchema: ComponentDataSchemaV1;
  readonly permissions: readonly string[];
  readonly publisher: string;
  readonly files: readonly ComponentFileV1[];
  readonly keyId: string;
  readonly signature: string;
};

export type ReleaseBomComponentV1 = {
  readonly componentId: string;
  readonly kind: ComponentKindV1;
  readonly version: string;
  readonly target: ComponentTargetV1;
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
  readonly signature: string;
  readonly keyId: string;
  readonly entry?: string;
  readonly executionClass?: ComponentExecutionClassV1;
  readonly activation: ComponentActivationV1;
  readonly delivery: ComponentDeliveryV1;
};

export type ReleaseBomV1 = {
  readonly schemaVersion: typeof RELEASE_BOM_SCHEMA_VERSION;
  readonly releaseVersion: string;
  readonly channel: ComponentChannelV1;
  readonly target: ComponentTargetV1;
  readonly coreVersion: string;
  readonly hostApiVersion: string;
  readonly components: readonly ReleaseBomComponentV1[];
};

export type CatalogRevocationV1 = {
  readonly componentId: string;
  readonly version: string;
  readonly reason?: string;
};

export type CatalogReleaseV1 = {
  readonly version: string;
  readonly bomUrl: string;
  readonly bomSha256: string;
  readonly bomSignature: string;
  readonly keyId: string;
};

export type ChannelCatalogPayloadV1 = {
  readonly sequence: number;
  readonly channel: ComponentChannelV1;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly minimumSafeCoreVersion?: string;
  readonly revocations: readonly CatalogRevocationV1[];
  readonly releases: readonly CatalogReleaseV1[];
};

export type Ed25519SignatureV1 = {
  readonly algorithm: "ed25519";
  readonly keyId: string;
  readonly value: string;
};

export type ReleaseKeyV1 = {
  readonly keyId: string;
  /** Raw 32-byte Ed25519 public key encoded as base64. */
  readonly publicKey: string;
  readonly publisher: string;
  readonly channels: readonly ComponentChannelV1[];
  /** Component kinds this root-certified release key may sign. */
  readonly componentKinds: readonly ComponentKindV1[];
  /**
   * Component ID prefixes this release key may sign. Every signed component
   * ID must start with at least one prefix in this root-certified list.
   */
  readonly componentIdPrefixes: readonly string[];
  /**
   * Execution classes this root-certified release key may sign.
   * An empty list is valid for keys that publish only non-application
   * components. The authorization is part of the root-signed keyring.
   */
  readonly executionClasses: readonly ComponentExecutionClassV1[];
  readonly validFrom: string;
  readonly validUntil: string;
};

export type ReleaseKeyringPayloadV1 = {
  readonly sequence: number;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly keys: readonly ReleaseKeyV1[];
  readonly revokedKeyIds: readonly string[];
};

export type SignedReleaseKeyringV1 = {
  readonly schemaVersion: typeof SIGNED_RELEASE_KEYRING_SCHEMA_VERSION;
  readonly payload: ReleaseKeyringPayloadV1;
  readonly signature: Ed25519SignatureV1;
};

export type SignedChannelCatalogV1 = {
  readonly schemaVersion: typeof SIGNED_CHANNEL_CATALOG_SCHEMA_VERSION;
  readonly keyring: SignedReleaseKeyringV1;
  readonly payload: ChannelCatalogPayloadV1;
  readonly signature: Ed25519SignatureV1;
};

const COMPONENT_ID_PATTERN = /^[a-z0-9._-]{1,128}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const PERMISSION_PATTERN = /^[a-z0-9-]+(?::[a-z0-9._-]+)*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ED25519_SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{86}==$/;
const ED25519_PUBLIC_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
const KINDS = new Set<ComponentKindV1>(["core", "runtime", "app", "resource", "extension"]);
const TARGETS = new Set<ComponentTargetV1>([
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
]);
const CHANNELS = new Set<ComponentChannelV1>(["stable", "preview"]);
const ACTIVATIONS = new Set<ComponentActivationV1>([
  "core-restart",
  "module-idle",
  "runtime-idle",
  "resource-idle",
  "next-session"
]);
const DELIVERIES = new Set<ComponentDeliveryV1>(["required", "on-demand"]);
const EXECUTION_CLASSES = new Set<ComponentExecutionClassV1>([
  "first-party-shared-renderer",
  "sandboxed-web",
  "sandboxed-web-wasi"
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key));

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isSafeNonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isSemanticVersion = (value: unknown): value is string =>
  typeof value === "string" && SEMVER_PATTERN.test(value);

const isIsoTimestamp = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isNaN(Date.parse(value)) === false;

const isHttpsUrl = (value: unknown): value is string => {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.host.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hash.length === 0;
  } catch {
    return false;
  }
};

const isSignature = (value: unknown): value is string =>
  typeof value === "string" && ED25519_SIGNATURE_PATTERN.test(value);

const isRelativePackagePath = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.startsWith("/")) {
    return false;
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const isTarget = (value: unknown): value is ComponentTargetV1 =>
  typeof value === "string" && TARGETS.has(value as ComponentTargetV1);

const isExecutionClass = (value: unknown): value is ComponentExecutionClassV1 =>
  typeof value === "string" && EXECUTION_CLASSES.has(value as ComponentExecutionClassV1);

const hasValidExecutionClass = (
  kind: unknown,
  executionClass: unknown
): boolean => kind === "app" ? isExecutionClass(executionClass) : executionClass === undefined;

const isSemanticVersionRange = (value: unknown): value is SemanticVersionRangeV1 =>
  isRecord(value) &&
  hasOnlyKeys(value, ["minInclusive", "maxExclusive"]) &&
  isSemanticVersion(value.minInclusive) &&
  (value.maxExclusive === undefined || isSemanticVersion(value.maxExclusive));

const isRuntimeProtocolRange = (value: unknown): value is RuntimeProtocolRangeV1 =>
  isRecord(value) &&
  hasOnlyKeys(value, ["min", "max"]) &&
  isPositiveInteger(value.min) &&
  isPositiveInteger(value.max) &&
  value.min <= value.max;

const isDataSchema = (value: unknown): value is ComponentDataSchemaV1 =>
  isRecord(value) &&
  hasOnlyKeys(value, ["readerMin", "readerMax", "writer"]) &&
  isPositiveInteger(value.readerMin) &&
  isPositiveInteger(value.readerMax) &&
  isPositiveInteger(value.writer) &&
  value.readerMin <= value.writer &&
  value.writer <= value.readerMax;

const isComponentFile = (value: unknown): value is ComponentFileV1 =>
  isRecord(value) &&
  hasOnlyKeys(value, ["path", "size", "sha256"]) &&
  isRelativePackagePath(value.path) &&
  isSafeNonNegativeInteger(value.size) &&
  typeof value.sha256 === "string" &&
  SHA256_PATTERN.test(value.sha256);

export const validateComponentManifestV1 = (value: unknown): value is ComponentManifestV1 => {
  if (
    isRecord(value) === false ||
    hasOnlyKeys(value, [
      "schemaVersion",
      "componentId",
      "kind",
      "version",
      "target",
      "entry",
      "executionClass",
      "activation",
      "hostApiRange",
      "runtimeProtocolRange",
      "dataSchema",
      "permissions",
      "publisher",
      "files",
      "keyId",
      "signature"
    ]) === false ||
    value.schemaVersion !== COMPONENT_MANIFEST_SCHEMA_VERSION ||
    typeof value.componentId !== "string" ||
    COMPONENT_ID_PATTERN.test(value.componentId) === false ||
    KINDS.has(value.kind as ComponentKindV1) === false ||
    isSemanticVersion(value.version) === false ||
    isTarget(value.target) === false ||
    (value.entry !== undefined && isRelativePackagePath(value.entry) === false) ||
    hasValidExecutionClass(value.kind, value.executionClass) === false ||
    ACTIVATIONS.has(value.activation as ComponentActivationV1) === false ||
    (value.hostApiRange !== undefined && isSemanticVersionRange(value.hostApiRange) === false) ||
    (value.runtimeProtocolRange !== undefined && isRuntimeProtocolRange(value.runtimeProtocolRange) === false) ||
    isDataSchema(value.dataSchema) === false ||
    Array.isArray(value.permissions) === false ||
    value.permissions.some(
      (permission) => typeof permission !== "string" || PERMISSION_PATTERN.test(permission) === false
    ) ||
    new Set(value.permissions).size !== value.permissions.length ||
    isNonEmptyString(value.publisher) === false ||
    Array.isArray(value.files) === false ||
    value.files.length === 0 ||
    value.files.some((file) => isComponentFile(file) === false) ||
    typeof value.keyId !== "string" ||
    IDENTIFIER_PATTERN.test(value.keyId) === false ||
    isSignature(value.signature) === false
  ) {
    return false;
  }

  const paths = value.files.map((file) => (file as ComponentFileV1).path);
  return new Set(paths).size === paths.length &&
    (value.entry === undefined || paths.includes(value.entry));
};

const validateBomComponent = (value: unknown): value is ReleaseBomComponentV1 =>
  isRecord(value) &&
  hasOnlyKeys(value, [
    "componentId",
    "kind",
    "version",
    "target",
    "url",
    "size",
    "sha256",
    "signature",
    "keyId",
    "entry",
    "executionClass",
    "activation",
    "delivery"
  ]) &&
  typeof value.componentId === "string" &&
  COMPONENT_ID_PATTERN.test(value.componentId) &&
  KINDS.has(value.kind as ComponentKindV1) &&
  isSemanticVersion(value.version) &&
  isTarget(value.target) &&
  isHttpsUrl(value.url) &&
  isPositiveInteger(value.size) &&
  typeof value.sha256 === "string" &&
  SHA256_PATTERN.test(value.sha256) &&
  isSignature(value.signature) &&
  typeof value.keyId === "string" &&
  IDENTIFIER_PATTERN.test(value.keyId) &&
  (value.entry === undefined || isRelativePackagePath(value.entry)) &&
  hasValidExecutionClass(value.kind, value.executionClass) &&
  ACTIVATIONS.has(value.activation as ComponentActivationV1) &&
  DELIVERIES.has(value.delivery as ComponentDeliveryV1);

export const validateReleaseBomV1 = (value: unknown): value is ReleaseBomV1 => {
  if (
    isRecord(value) === false ||
    hasOnlyKeys(value, [
      "schemaVersion",
      "releaseVersion",
      "channel",
      "target",
      "coreVersion",
      "hostApiVersion",
      "components"
    ]) === false ||
    value.schemaVersion !== RELEASE_BOM_SCHEMA_VERSION ||
    isSemanticVersion(value.releaseVersion) === false ||
    CHANNELS.has(value.channel as ComponentChannelV1) === false ||
    isTarget(value.target) === false ||
    isSemanticVersion(value.coreVersion) === false ||
    isSemanticVersion(value.hostApiVersion) === false ||
    Array.isArray(value.components) === false ||
    value.components.length === 0 ||
    value.components.some((component) => validateBomComponent(component) === false)
  ) {
    return false;
  }

  const components = value.components as ReleaseBomComponentV1[];
  const identities = components.map(({ componentId }) => componentId);
  const core = components.filter(({ kind }) => kind === "core");
  return new Set(identities).size === identities.length &&
    components.every(({ target }) => target === value.target) &&
    core.length === 1 &&
    core[0]?.version === value.coreVersion;
};

const isCatalogRevocation = (value: unknown): value is CatalogRevocationV1 =>
  isRecord(value) &&
  hasOnlyKeys(value, ["componentId", "version", "reason"]) &&
  typeof value.componentId === "string" &&
  COMPONENT_ID_PATTERN.test(value.componentId) &&
  isSemanticVersion(value.version) &&
  (value.reason === undefined || isNonEmptyString(value.reason));

const isCatalogRelease = (value: unknown): value is CatalogReleaseV1 =>
  isRecord(value) &&
  hasOnlyKeys(value, ["version", "bomUrl", "bomSha256", "bomSignature", "keyId"]) &&
  isSemanticVersion(value.version) &&
  isHttpsUrl(value.bomUrl) &&
  typeof value.bomSha256 === "string" &&
  SHA256_PATTERN.test(value.bomSha256) &&
  isSignature(value.bomSignature) &&
  typeof value.keyId === "string" &&
  IDENTIFIER_PATTERN.test(value.keyId);

const isSignatureEnvelope = (value: unknown): value is Ed25519SignatureV1 =>
  isRecord(value) &&
  hasOnlyKeys(value, ["algorithm", "keyId", "value"]) &&
  value.algorithm === "ed25519" &&
  typeof value.keyId === "string" &&
  IDENTIFIER_PATTERN.test(value.keyId) &&
  isSignature(value.value);

const isReleaseKey = (value: unknown): value is ReleaseKeyV1 =>
  isRecord(value) &&
  hasOnlyKeys(value, [
    "keyId",
    "publicKey",
    "publisher",
    "channels",
    "componentKinds",
    "componentIdPrefixes",
    "executionClasses",
    "validFrom",
    "validUntil"
  ]) &&
  typeof value.keyId === "string" &&
  IDENTIFIER_PATTERN.test(value.keyId) &&
  typeof value.publicKey === "string" &&
  ED25519_PUBLIC_KEY_PATTERN.test(value.publicKey) &&
  isNonEmptyString(value.publisher) &&
  Array.isArray(value.channels) &&
  value.channels.length > 0 &&
  value.channels.every((channel) => CHANNELS.has(channel as ComponentChannelV1)) &&
  new Set(value.channels).size === value.channels.length &&
  Array.isArray(value.componentKinds) &&
  value.componentKinds.length > 0 &&
  value.componentKinds.every((kind) => KINDS.has(kind as ComponentKindV1)) &&
  new Set(value.componentKinds).size === value.componentKinds.length &&
  Array.isArray(value.componentIdPrefixes) &&
  value.componentIdPrefixes.length > 0 &&
  value.componentIdPrefixes.every(
    (prefix) => typeof prefix === "string" && COMPONENT_ID_PATTERN.test(prefix)
  ) &&
  new Set(value.componentIdPrefixes).size === value.componentIdPrefixes.length &&
  Array.isArray(value.executionClasses) &&
  value.executionClasses.every((executionClass) => isExecutionClass(executionClass)) &&
  new Set(value.executionClasses).size === value.executionClasses.length &&
  isIsoTimestamp(value.validFrom) &&
  isIsoTimestamp(value.validUntil) &&
  Date.parse(value.validFrom) < Date.parse(value.validUntil);

/** Validates the root-signed release keyring shape, not its signature bytes. */
export const validateSignedReleaseKeyringV1 = (
  value: unknown
): value is SignedReleaseKeyringV1 => {
  if (
    isRecord(value) === false ||
    hasOnlyKeys(value, ["schemaVersion", "payload", "signature"]) === false ||
    value.schemaVersion !== SIGNED_RELEASE_KEYRING_SCHEMA_VERSION ||
    isRecord(value.payload) === false ||
    hasOnlyKeys(value.payload, [
      "sequence",
      "generatedAt",
      "expiresAt",
      "keys",
      "revokedKeyIds"
    ]) === false ||
    isPositiveInteger(value.payload.sequence) === false ||
    isIsoTimestamp(value.payload.generatedAt) === false ||
    isIsoTimestamp(value.payload.expiresAt) === false ||
    Date.parse(value.payload.generatedAt) >= Date.parse(value.payload.expiresAt) ||
    Array.isArray(value.payload.keys) === false ||
    value.payload.keys.length === 0 ||
    value.payload.keys.some((key) => isReleaseKey(key) === false) ||
    Array.isArray(value.payload.revokedKeyIds) === false ||
    value.payload.revokedKeyIds.some(
      (keyId) => typeof keyId !== "string" || IDENTIFIER_PATTERN.test(keyId) === false
    ) ||
    isSignatureEnvelope(value.signature) === false
  ) {
    return false;
  }
  const keys = value.payload.keys as ReleaseKeyV1[];
  const revokedKeyIds = value.payload.revokedKeyIds as string[];
  return new Set(keys.map(({ keyId }) => keyId)).size === keys.length &&
    new Set(revokedKeyIds).size === revokedKeyIds.length;
};

/** Validates the signed envelope shape, not the Ed25519 signature itself. */
export const validateSignedChannelCatalogV1 = (value: unknown): value is SignedChannelCatalogV1 => {
  if (
    isRecord(value) === false ||
    hasOnlyKeys(value, ["schemaVersion", "keyring", "payload", "signature"]) === false ||
    value.schemaVersion !== SIGNED_CHANNEL_CATALOG_SCHEMA_VERSION ||
    validateSignedReleaseKeyringV1(value.keyring) === false ||
    isRecord(value.payload) === false ||
    hasOnlyKeys(value.payload, [
      "sequence",
      "channel",
      "generatedAt",
      "expiresAt",
      "minimumSafeCoreVersion",
      "revocations",
      "releases"
    ]) === false ||
    isPositiveInteger(value.payload.sequence) === false ||
    CHANNELS.has(value.payload.channel as ComponentChannelV1) === false ||
    isIsoTimestamp(value.payload.generatedAt) === false ||
    isIsoTimestamp(value.payload.expiresAt) === false ||
    Date.parse(value.payload.generatedAt) >= Date.parse(value.payload.expiresAt) ||
    (value.payload.minimumSafeCoreVersion !== undefined &&
      isSemanticVersion(value.payload.minimumSafeCoreVersion) === false) ||
    Array.isArray(value.payload.revocations) === false ||
    value.payload.revocations.some((revocation) => isCatalogRevocation(revocation) === false) ||
    Array.isArray(value.payload.releases) === false ||
    value.payload.releases.length === 0 ||
    value.payload.releases.some((release) => isCatalogRelease(release) === false) ||
    isSignatureEnvelope(value.signature) === false
  ) {
    return false;
  }

  const catalog = value as unknown as SignedChannelCatalogV1;
  const releases = catalog.payload.releases;
  const generatedAt = Date.parse(catalog.payload.generatedAt);
  const expiresAt = Date.parse(catalog.payload.expiresAt);
  const keyring = catalog.keyring.payload;
  const signingKey = keyring.keys.find(({ keyId }) => keyId === catalog.signature.keyId);
  return new Set(releases.map(({ version }) => version)).size === releases.length &&
    keyring.revokedKeyIds.includes(catalog.signature.keyId) === false &&
    generatedAt >= Date.parse(keyring.generatedAt) &&
    expiresAt <= Date.parse(keyring.expiresAt) &&
    signingKey !== undefined &&
    signingKey.channels.includes(catalog.payload.channel) &&
    generatedAt >= Date.parse(signingKey.validFrom) &&
    expiresAt <= Date.parse(signingKey.validUntil) &&
    releases.every(({ keyId }) => keyId === signingKey.keyId);
};

/** Deterministic JSON for signing. Rejects values that JSON would silently discard. */
export const canonicalJson = (value: unknown): string => {
  const ancestors = new Set<object>();

  const serialize = (current: unknown): string => {
    if (current === null || typeof current === "boolean" || typeof current === "string") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (Number.isSafeInteger(current) === false || Object.is(current, -0)) {
        throw new TypeError("Canonical JSON only supports safe integers.");
      }
      return JSON.stringify(current);
    }
    if (typeof current !== "object") {
      throw new TypeError(`Canonical JSON does not support ${typeof current}.`);
    }
    if (ancestors.has(current)) {
      throw new TypeError("Canonical JSON does not support cyclic values.");
    }

    ancestors.add(current);
    let result: string;
    if (Array.isArray(current)) {
      result = `[${current.map((item) => serialize(item)).join(",")}]`;
    } else {
      if (Object.getPrototypeOf(current) !== Object.prototype) {
        throw new TypeError("Canonical JSON only supports plain objects.");
      }
      result = `{${Object.keys(current as Record<string, unknown>)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${serialize((current as Record<string, unknown>)[key])}`)
        .join(",")}}`;
    }
    ancestors.delete(current);
    return result;
  };

  return serialize(value);
};

export const canonicalChannelCatalogPayloadV1 = (catalog: SignedChannelCatalogV1): string =>
  canonicalJson(catalog.payload);

export const canonicalReleaseKeyringPayloadV1 = (keyring: SignedReleaseKeyringV1): string =>
  canonicalJson(keyring.payload);

export const canonicalReleaseBomV1 = (bom: ReleaseBomV1): string => canonicalJson(bom);

export const canonicalReleaseBomComponentV1 = (component: ReleaseBomComponentV1): string => {
  const { signature: _signature, ...unsigned } = component;
  return canonicalJson(unsigned);
};

export const canonicalComponentManifestV1 = (manifest: ComponentManifestV1): string => {
  const { signature: _signature, ...unsigned } = manifest;
  return canonicalJson(unsigned);
};
