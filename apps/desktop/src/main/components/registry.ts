import { createHash, verify } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  canonicalComponentManifestV1,
  validateComponentManifestV1,
  type ComponentExecutionClassV1,
  type ComponentKindV1,
  type ComponentManifestV1,
  type ComponentTargetV1
} from "@lyra/app-runtime";

import { readJsonFile, writeFileAtomic } from "../persistence";
import {
  parseBootstrapActivationRegistry,
  type BootstrapActivationRegistryV1,
  type BootstrapActivationStateV1,
  type CanonicalActivationRegistryClient
} from "./bootstrap-registry-client";

export const COMPONENT_REGISTRY_SCHEMA_VERSION = 1 as const;

export type InstalledComponentVersionV1 = {
  readonly manifest: ComponentManifestV1;
  readonly installedAt: string;
  readonly target: string;
};

export type InstalledComponentV1 = {
  readonly componentId: string;
  readonly kind: ComponentKindV1;
  readonly active?: string;
  readonly previous?: string;
  readonly pending?: string;
  readonly versions: Readonly<Record<string, InstalledComponentVersionV1>>;
};

export type ComponentRegistryV1 = {
  readonly schemaVersion: typeof COMPONENT_REGISTRY_SCHEMA_VERSION;
  readonly bootstrapRevision: number;
  readonly highestKeyringSequence: Readonly<Record<string, number>>;
  readonly highestCatalogSequence: Readonly<Record<string, number>>;
  readonly components: Readonly<Record<string, InstalledComponentV1>>;
};

export type ComponentRegistryStore = {
  readonly list: () => Promise<readonly InstalledComponentV1[]>;
  readonly read: (componentId: string) => Promise<InstalledComponentV1 | null>;
  readonly verifyInstalledVersion: (
    componentId: string,
    version: string
  ) => Promise<InstalledComponentVersionV1>;
  readonly installFromDirectory: (sourceDirectory: string) => Promise<InstalledComponentV1>;
  readonly activate: (componentId: string) => Promise<InstalledComponentV1>;
  readonly rollback: (componentId: string) => Promise<InstalledComponentV1>;
  readonly restoreActivation: (
    componentId: string,
    activation: {
      readonly active?: string;
      readonly previous?: string;
      readonly pending?: string;
    }
  ) => Promise<InstalledComponentV1>;
  readonly uninstallVersion: (componentId: string, version: string) => Promise<void>;
  readonly recordKeyringSequence: (channel: string, sequence: number) => Promise<void>;
  readonly recordCatalogSequence: (channel: string, sequence: number) => Promise<void>;
};

export type ComponentReleaseKeyScope = {
  readonly publisher: string;
  readonly componentKinds: readonly ComponentKindV1[];
  readonly componentIdPrefixes: readonly string[];
  readonly executionClasses: readonly ComponentExecutionClassV1[];
};

export type ComponentRegistryStoreOptions = {
  readonly componentsRoot: string;
  readonly systemRoot: string;
  readonly publicKeys: Readonly<Record<string, string>>;
  readonly releaseKeyScopes: Readonly<Record<string, ComponentReleaseKeyScope>>;
  /// Production activation authority. When present, bootstrap registry
  /// transactions are committed by the Rust helper under `bootstrap.lock`.
  readonly canonicalActivationRegistry?: CanonicalActivationRegistryClient;
  /// Explicit development/test escape hatch for packages that were not
  /// installed by the signed bootstrap flow. Production callers leave false.
  readonly allowLocalActivation?: boolean;
};

const REGISTRY_FILE = "registry.v1.json";
const LOG_PREFIX = "lyra-components";
const ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;
const COMPONENT_KINDS = new Set<ComponentKindV1>([
  "core",
  "runtime",
  "app",
  "resource",
  "extension"
]);
const COMPONENT_TARGETS = new Set<ComponentTargetV1>([
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
]);

const emptyRegistry = (): ComponentRegistryV1 => ({
  schemaVersion: COMPONENT_REGISTRY_SCHEMA_VERSION,
  bootstrapRevision: 0,
  highestKeyringSequence: {},
  highestCatalogSequence: {},
  components: {}
});

const resolveCurrentComponentTarget = (): ComponentTargetV1 | null => {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const candidate = `${platform}-${process.arch}`;
  return COMPONENT_TARGETS.has(candidate as ComponentTargetV1)
    ? candidate as ComponentTargetV1
    : null;
};

const isCurrentTarget = (target: ComponentTargetV1): boolean =>
  target === resolveCurrentComponentTarget();

const decodeSignature = (value: string): Buffer => {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 64) {
    throw new Error("Component signature must be a 64-byte Ed25519 signature.");
  }
  return bytes;
};

const verifyManifestSignature = (
  manifest: ComponentManifestV1,
  publicKeys: Readonly<Record<string, string>>,
  releaseKeyScopes: Readonly<Record<string, ComponentReleaseKeyScope>>
): void => {
  const publicKey = publicKeys[manifest.keyId];
  if (publicKey === undefined) {
    throw new Error(`Unknown component signing key: ${manifest.keyId}`);
  }
  const payload = Buffer.from(canonicalComponentManifestV1(manifest), "utf8");
  if (!verify(null, payload, publicKey, decodeSignature(manifest.signature))) {
    throw new Error(`Component signature verification failed: ${manifest.componentId}`);
  }
  const scope = releaseKeyScopes[manifest.keyId];
  if (scope === undefined) {
    throw new Error(`Component signing key has no root-certified scope: ${manifest.keyId}`);
  }
  if (scope.publisher !== manifest.publisher) {
    throw new Error(
      `Component publisher is not authorized by signing key ${manifest.keyId}.`
    );
  }
  if (!scope.componentKinds.includes(manifest.kind)) {
    throw new Error(
      `Component signing key ${manifest.keyId} is not authorized for component kind ${manifest.kind}.`
    );
  }
  if (
    !scope.componentIdPrefixes.some((prefix) => manifest.componentId.startsWith(prefix))
  ) {
    throw new Error(
      `Component signing key ${manifest.keyId} is not authorized for component ID ${manifest.componentId}.`
    );
  }
  if (
    manifest.executionClass !== undefined
    && !scope.executionClasses.includes(manifest.executionClass)
  ) {
    throw new Error(
      `Component signing key ${manifest.keyId} is not authorized for execution class ${manifest.executionClass}.`
    );
  }
};

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const resolveContainedPath = (root: string, relativePath: string): string => {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Component file escapes its package root: ${relativePath}`);
  }
  return resolved;
};

const pathExists = async (candidate: string): Promise<boolean> => {
  try {
    await lstat(candidate);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[]
): boolean => Object.keys(value).every((key) => allowed.includes(key));

const isOptionalStringField = (
  value: Readonly<Record<string, unknown>>,
  key: string
): boolean => value[key] === undefined || typeof value[key] === "string";

const listPackageFiles = async (
  root: string,
  directory = root,
  prefix = ""
): Promise<readonly string[]> => {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Component package path is not a regular directory: ${prefix || "."}`);
  }
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const entryPath = resolveContainedPath(root, relativePath);
    const entryMetadata = await lstat(entryPath);
    if (entryMetadata.isSymbolicLink()) {
      throw new Error(`Component packages cannot contain symbolic links: ${relativePath}`);
    }
    if (entryMetadata.isDirectory()) {
      files.push(...await listPackageFiles(root, entryPath, relativePath));
    } else if (entryMetadata.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Component packages can only contain regular files: ${relativePath}`);
    }
  }
  return files;
};

const verifyComponentDirectory = async (
  sourceDirectory: string,
  publicKeys: Readonly<Record<string, string>>,
  releaseKeyScopes: Readonly<Record<string, ComponentReleaseKeyScope>>,
  options: { readonly allowInstalledMarker?: boolean } = {}
): Promise<ComponentManifestV1> => {
  const manifestPath = resolveContainedPath(sourceDirectory, "component.json");
  const manifestMetadata = await lstat(manifestPath);
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
    throw new Error("Component manifest must be a regular file.");
  }
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!validateComponentManifestV1(parsed)) {
    throw new Error("Component manifest is invalid.");
  }
  if (!isCurrentTarget(parsed.target)) {
    throw new Error(
      `Component target ${parsed.target} does not match ${process.platform}-${process.arch}.`
    );
  }
  verifyManifestSignature(parsed, publicKeys, releaseKeyScopes);
  if (parsed.files.some((file) => file.path === "component.json")) {
    throw new Error("Component manifest cannot include itself in the signed file inventory.");
  }
  const actualFiles = [...await listPackageFiles(sourceDirectory)].sort();
  const expectedFiles = [
    "component.json",
    ...(options.allowInstalledMarker === true
      && actualFiles.includes(".lyra-component.v1.json")
      ? [".lyra-component.v1.json"]
      : []),
    ...parsed.files.map((file) => file.path)
  ].sort();
  if (
    actualFiles.length !== expectedFiles.length
    || actualFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    throw new Error("Component package contains undeclared or missing files.");
  }
  for (const file of parsed.files) {
    const filePath = resolveContainedPath(sourceDirectory, file.path);
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size !== file.size) {
      throw new Error(`Component file size mismatch: ${file.path}`);
    }
    if (await sha256File(filePath) !== file.sha256) {
      throw new Error(`Component file digest mismatch: ${file.path}`);
    }
  }
  return parsed;
};

const normalizeRegistry = (value: unknown): ComponentRegistryV1 => {
  if (value === null) {
    return emptyRegistry();
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Component registry must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== COMPONENT_REGISTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported component registry schema: ${String(raw.schemaVersion)}`);
  }
  if (
    typeof raw.bootstrapRevision !== "number"
    || !Number.isSafeInteger(raw.bootstrapRevision)
    || raw.bootstrapRevision < 0
    || typeof raw.highestKeyringSequence !== "object"
    || raw.highestKeyringSequence === null
    || Array.isArray(raw.highestKeyringSequence)
    || Object.values(raw.highestKeyringSequence).some(
      (sequence) => typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0
    )
    || typeof raw.highestCatalogSequence !== "object"
    || raw.highestCatalogSequence === null
    || Array.isArray(raw.highestCatalogSequence)
    || Object.values(raw.highestCatalogSequence).some(
      (sequence) => typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0
    )
    || typeof raw.components !== "object"
    || raw.components === null
    || Array.isArray(raw.components)
  ) {
    throw new Error("Component registry fields are invalid.");
  }
  const components: Record<string, InstalledComponentV1> = {};
  for (const [componentId, candidate] of Object.entries(raw.components)) {
    if (!ID_PATTERN.test(componentId) || typeof candidate !== "object" || candidate === null) {
      throw new Error(`Invalid component registry entry: ${componentId}`);
    }
    const record = candidate as Record<string, unknown>;
    if (
      !hasOnlyKeys(record, ["componentId", "kind", "active", "previous", "pending", "versions"])
      || record.componentId !== componentId
      || typeof record.kind !== "string"
      || !COMPONENT_KINDS.has(record.kind as ComponentKindV1)
      || !isOptionalStringField(record, "active")
      || !isOptionalStringField(record, "previous")
      || !isOptionalStringField(record, "pending")
      || typeof record.versions !== "object"
      || record.versions === null
      || Array.isArray(record.versions)
    ) {
      throw new Error(`Invalid component registry entry: ${componentId}`);
    }
    const versions: Record<string, InstalledComponentVersionV1> = {};
    for (const [version, installed] of Object.entries(record.versions)) {
      if (
        !VERSION_PATTERN.test(version)
        || typeof installed !== "object"
        || installed === null
        || !validateComponentManifestV1((installed as Record<string, unknown>).manifest)
        || typeof (installed as Record<string, unknown>).installedAt !== "string"
        || typeof (installed as Record<string, unknown>).target !== "string"
      ) {
        throw new Error(`Invalid installed component version: ${componentId}@${version}`);
      }
      const normalizedInstalled = installed as InstalledComponentVersionV1;
      if (
        normalizedInstalled.manifest.componentId !== componentId
        || normalizedInstalled.manifest.version !== version
        || normalizedInstalled.manifest.kind !== record.kind
        || normalizedInstalled.manifest.target !== normalizedInstalled.target
      ) {
        throw new Error(`Installed component identity mismatch: ${componentId}@${version}`);
      }
      versions[version] = normalizedInstalled;
    }
    const active = typeof record.active === "string" ? record.active : undefined;
    const previous = typeof record.previous === "string" ? record.previous : undefined;
    const pending = typeof record.pending === "string" ? record.pending : undefined;
    for (const pointer of [active, previous, pending]) {
      if (pointer !== undefined && versions[pointer] === undefined) {
        throw new Error(`Component pointer references a missing version: ${componentId}@${pointer}`);
      }
    }
    components[componentId] = {
      componentId,
      kind: record.kind as ComponentKindV1,
      ...(active === undefined ? {} : { active }),
      ...(previous === undefined ? {} : { previous }),
      ...(pending === undefined ? {} : { pending }),
      versions
    };
  }
  return {
    schemaVersion: COMPONENT_REGISTRY_SCHEMA_VERSION,
    bootstrapRevision: raw.bootstrapRevision,
    highestKeyringSequence: raw.highestKeyringSequence as Readonly<Record<string, number>>,
    highestCatalogSequence: raw.highestCatalogSequence as Readonly<Record<string, number>>,
    components
  };
};

const readBootstrapActivationProjection = async (
  systemRoot: string
): Promise<BootstrapActivationRegistryV1 | null> => {
  const directory = path.join(systemRoot, "registry-v1");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = /^registry-(\d{20})-[0-9a-f-]{36}\.json$/u.exec(entry.name);
      return match === null
        ? null
        : {
            revision: Number.parseInt(match[1] ?? "", 10),
            path: path.join(directory, entry.name)
          };
    })
    .filter((entry): entry is { readonly revision: number; readonly path: string } => entry !== null)
    .sort((left, right) => right.revision - left.revision);
  const latest = candidates[0];
  if (latest === undefined) {
    return null;
  }
  if (candidates[1]?.revision === latest.revision) {
    throw new Error(`Multiple bootstrap registries have revision ${latest.revision}.`);
  }
  const metadata = await lstat(latest.path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4 * 1024 * 1024) {
    throw new Error("Bootstrap component registry is not a bounded regular file.");
  }
  const value = JSON.parse(await readFile(latest.path, "utf8")) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Bootstrap component registry is invalid.");
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== 1
    || raw.revision !== latest.revision
    || !Number.isSafeInteger(raw.revision)
    || raw.revision < 1
    || typeof raw.keyringSequence !== "number"
    || !Number.isSafeInteger(raw.keyringSequence)
    || raw.keyringSequence < 0
    || typeof raw.catalogSequence !== "number"
    || !Number.isSafeInteger(raw.catalogSequence)
    || raw.catalogSequence < 0
    || typeof raw.target !== "string"
    || typeof raw.components !== "object"
    || raw.components === null
    || Array.isArray(raw.components)
    || !isOptionalStringField(raw, "activeReleaseVersion")
    || !isOptionalStringField(raw, "pendingReleaseVersion")
    || !hasOnlyKeys(raw, [
      "schemaVersion",
      "revision",
      "keyringSequence",
      "catalogSequence",
      "target",
      "activeReleaseVersion",
      "pendingReleaseVersion",
      "components"
    ])
  ) {
    throw new Error("Bootstrap component registry fields are invalid.");
  }
  return parseBootstrapActivationRegistry(raw);
};

export const readBootstrapKeyringSequence = async (systemRoot: string): Promise<number> =>
  (await readBootstrapActivationProjection(systemRoot))?.keyringSequence ?? 0;

export const createComponentRegistryStore = ({
  componentsRoot,
  systemRoot,
  publicKeys,
  releaseKeyScopes,
  canonicalActivationRegistry,
  allowLocalActivation = false
}: ComponentRegistryStoreOptions): ComponentRegistryStore => {
  const registryPath = path.join(systemRoot, REGISTRY_FILE);
  let registry: ComponentRegistryV1 | null = null;
  let bootstrapProjection: BootstrapActivationRegistryV1 | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();

  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const synchronizeBootstrapProjection = async (
    current: ComponentRegistryV1,
    projection: BootstrapActivationRegistryV1 | null
  ): Promise<ComponentRegistryV1> => {
    if (projection === null) {
      return current;
    }
    if (
      bootstrapProjection !== null
      && projection.revision < bootstrapProjection.revision
    ) {
      throw new Error(
        `Bootstrap registry revision moved backwards: ${projection.revision} < ${bootstrapProjection.revision}.`
      );
    }
    if (projection.revision < current.bootstrapRevision) {
      throw new Error(
        `Component cache is ahead of the bootstrap registry: ${current.bootstrapRevision} > ${projection.revision}.`
      );
    }
    const mustSynchronize = bootstrapProjection === null
      || projection.revision > bootstrapProjection.revision;
    bootstrapProjection = projection;
    if (!mustSynchronize) {
      return current;
    }
    const currentTarget = resolveCurrentComponentTarget();
    if (currentTarget === null || projection.target !== currentTarget) {
      throw new Error(
        `Bootstrap registry target ${projection.target} does not match ${currentTarget ?? "unsupported"}.`
      );
    }
    const components: Record<string, InstalledComponentV1> = { ...current.components };
    for (const [componentId, value] of Object.entries(projection.components)) {
      if (
        !ID_PATTERN.test(componentId)
        || typeof value !== "object"
        || value === null
        || Array.isArray(value)
        || !hasOnlyKeys(value as unknown as Record<string, unknown>, [
          "active",
          "previous",
          "pending"
        ])
        || !isOptionalStringField(value as unknown as Record<string, unknown>, "active")
        || !isOptionalStringField(value as unknown as Record<string, unknown>, "previous")
        || !isOptionalStringField(value as unknown as Record<string, unknown>, "pending")
      ) {
        throw new Error(`Invalid bootstrap component pointer: ${componentId}`);
      }
      const pointers = {
        active: typeof value.active === "string" ? value.active : undefined,
        previous: typeof value.previous === "string" ? value.previous : undefined,
        pending: typeof value.pending === "string" ? value.pending : undefined
      };
      const selectedVersions = [...new Set(
        [pointers.active, pointers.previous, pointers.pending]
          .filter((version): version is string => version !== undefined)
      )];
      if (selectedVersions.some((version) => !VERSION_PATTERN.test(version))) {
        throw new Error(`Invalid bootstrap component version: ${componentId}`);
      }
      const existing = components[componentId];
      const versions: Record<string, InstalledComponentVersionV1> = {
        ...(existing?.versions ?? {})
      };
      let kind = existing?.kind;
      for (const version of selectedVersions) {
        const versionRoot = path.join(componentsRoot, componentId, version, currentTarget);
        try {
          const manifest = await verifyComponentDirectory(versionRoot, publicKeys, releaseKeyScopes, {
            allowInstalledMarker: true
          });
          if (manifest.componentId !== componentId || manifest.version !== version) {
            throw new Error(`Bootstrap component identity mismatch: ${componentId}@${version}`);
          }
          if (kind !== undefined && kind !== manifest.kind) {
            throw new Error(`Bootstrap component kind changed: ${componentId}`);
          }
          kind = manifest.kind;
          const metadata = await stat(versionRoot);
          versions[version] = {
            manifest,
            installedAt: versions[version]?.installedAt ?? metadata.mtime.toISOString(),
            target: currentTarget
          };
        } catch (error) {
          // ponytail: skip stale/missing component dirs instead of crashing startup.
          // Ceiling: silently drops one component version; app falls back to embedded defaults.
          // Upgrade path: re-install the component or run the language-pack regen tool.
          if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
            console.warn(`[components] skipping missing component directory: ${componentId}@${version}`);
            continue;
          }
          throw error;
        }
      }
      if (kind === undefined) {
        continue;
      }
      components[componentId] = {
        componentId,
        kind,
        ...(pointers.active === undefined ? {} : { active: pointers.active }),
        ...(pointers.previous === undefined ? {} : { previous: pointers.previous }),
        ...(pointers.pending === undefined ? {} : { pending: pointers.pending }),
        versions
      };
    }
    return {
      schemaVersion: COMPONENT_REGISTRY_SCHEMA_VERSION,
      bootstrapRevision: projection.revision,
      highestKeyringSequence: {
        ...current.highestKeyringSequence,
        bootstrap: Math.max(
          current.highestKeyringSequence.bootstrap ?? 0,
          projection.keyringSequence
        )
      },
      highestCatalogSequence: {
        ...current.highestCatalogSequence,
        bootstrap: Math.max(
          current.highestCatalogSequence.bootstrap ?? 0,
          projection.catalogSequence
        )
      },
      components
    };
  };

  const load = async (): Promise<ComponentRegistryV1> => {
    if (registry === null) {
      registry = normalizeRegistry(await readJsonFile(registryPath, LOG_PREFIX));
    }
    const current = registry;
    const projection = bootstrapProjection === null && canonicalActivationRegistry !== undefined
      ? await canonicalActivationRegistry.read()
      : await readBootstrapActivationProjection(systemRoot);
    const synchronized = await synchronizeBootstrapProjection(current, projection);
    if (synchronized !== current) {
      await writeFileAtomic(registryPath, `${JSON.stringify(synchronized, null, 2)}\n`);
      registry = synchronized;
    }
    return registry;
  };

  const save = async (next: ComponentRegistryV1): Promise<void> => {
    await writeFileAtomic(registryPath, `${JSON.stringify(next, null, 2)}\n`);
    registry = next;
  };

  const synchronizeAfterCanonicalMutation = async (
    projection: BootstrapActivationRegistryV1
  ): Promise<ComponentRegistryV1> => {
    if (registry === null) {
      registry = normalizeRegistry(await readJsonFile(registryPath, LOG_PREFIX));
    }
    const current = registry;
    const synchronized = await synchronizeBootstrapProjection(current, projection);
    if (synchronized === current) {
      throw new Error("Canonical activation mutation did not advance the bootstrap registry.");
    }
    await save(synchronized);
    return synchronized;
  };

  const readRequired = async (componentId: string): Promise<InstalledComponentV1> => {
    const component = (await load()).components[componentId];
    if (component === undefined) {
      throw new Error(`Component is not installed: ${componentId}`);
    }
    return component;
  };

  const requireLocalActivation = (componentId: string): void => {
    if (!allowLocalActivation) {
      throw new Error(
        `Canonical activation registry is required for component ${componentId}.`
      );
    }
  };

  const isCanonicalComponent = (componentId: string): boolean =>
    bootstrapProjection?.components[componentId] !== undefined;

  const activationStateMatches = (
    state: BootstrapActivationStateV1,
    expected: {
      readonly active?: string;
      readonly previous?: string;
      readonly pending?: string;
    }
  ): boolean => state.active === expected.active
    && state.previous === expected.previous
    && state.pending === expected.pending;

  const verifyInstalledVersion = async (
    component: InstalledComponentV1,
    version: string
  ): Promise<InstalledComponentVersionV1> => {
    const installed = component.versions[version];
    if (installed === undefined) {
      throw new Error(`Component version is not installed: ${component.componentId}@${version}`);
    }
    const versionRoot = path.join(
      componentsRoot,
      component.componentId,
      version,
      installed.target
    );
    const manifest = await verifyComponentDirectory(versionRoot, publicKeys, releaseKeyScopes, {
      allowInstalledMarker: true
    });
    if (
      canonicalComponentManifestV1(manifest)
        !== canonicalComponentManifestV1(installed.manifest)
      || manifest.signature !== installed.manifest.signature
    ) {
      throw new Error(
        `Installed component manifest differs from the registry: ${component.componentId}@${version}`
      );
    }
    return installed;
  };

  return {
    list: async () => Object.values((await load()).components),
    read: async (componentId) => (await load()).components[componentId] ?? null,
    verifyInstalledVersion: (componentId, version) => mutate(async () =>
      await verifyInstalledVersion(await readRequired(componentId), version)),
    installFromDirectory: (sourceDirectory) => mutate(async () => {
      const manifest = await verifyComponentDirectory(
        sourceDirectory,
        publicKeys,
        releaseKeyScopes
      );
      const current = await load();
      const existing = current.components[manifest.componentId];
      if (existing !== undefined && existing.kind !== manifest.kind) {
        throw new Error(`Component kind changed for ${manifest.componentId}.`);
      }
      const target = manifest.target;
      const destination = path.join(
        componentsRoot,
        manifest.componentId,
        manifest.version,
        target
      );
      const existingVersion = existing?.versions[manifest.version];
      if (existingVersion !== undefined && existing !== undefined) {
        if (existingVersion.manifest.signature !== manifest.signature) {
          throw new Error(`Installed component version is immutable: ${manifest.componentId}@${manifest.version}`);
        }
        try {
          const installedManifest = await verifyComponentDirectory(
            destination,
            publicKeys,
            releaseKeyScopes
          );
          if (installedManifest.signature === manifest.signature) {
            return existing;
          }
        } catch {
          // Continue with a verified repair package below.
        }
      }
      if (await pathExists(destination)) {
        try {
          const installedManifest = await verifyComponentDirectory(
            destination,
            publicKeys,
            releaseKeyScopes
          );
          if (installedManifest.signature !== manifest.signature) {
            throw new Error(
              `Installed component version is immutable: ${manifest.componentId}@${manifest.version}`
            );
          }
        } catch (error: unknown) {
          if (
            error instanceof Error
            && error.message.startsWith("Installed component version is immutable:")
          ) {
            throw error;
          }
          // A signed source package may repair a damaged installation of the same version.
        }
      }
      const staging = `${destination}.pending`;
      const backup = `${destination}.repair-backup`;
      if (await pathExists(backup)) {
        if (await pathExists(destination)) {
          await rm(backup, { recursive: true, force: true });
        } else {
          await rename(backup, destination);
        }
      }
      await rm(staging, { recursive: true, force: true });
      await mkdir(path.dirname(destination), { recursive: true });
      try {
        await cp(sourceDirectory, staging, { recursive: true, force: false, errorOnExist: true });
        const stagedManifest = await verifyComponentDirectory(
          staging,
          publicKeys,
          releaseKeyScopes
        );
        if (stagedManifest.signature !== manifest.signature) {
          throw new Error("Component package changed while it was being staged.");
        }
      } catch (error: unknown) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
      const destinationExists = await pathExists(destination);
      if (destinationExists) {
        await rename(destination, backup);
      }
      try {
        await rename(staging, destination);
      } catch (error: unknown) {
        if (destinationExists) {
          await rename(backup, destination).catch(() => undefined);
        }
        throw error;
      }
      await rm(backup, { recursive: true, force: true });

      const installed: InstalledComponentVersionV1 = {
        manifest,
        installedAt: new Date().toISOString(),
        target
      };
      const canonicalPointers = bootstrapProjection?.components[manifest.componentId];
      const nextComponent: InstalledComponentV1 = {
        componentId: manifest.componentId,
        kind: manifest.kind,
        ...(canonicalPointers === undefined
          ? existing?.active === undefined
            ? { pending: manifest.version }
            : existing.active === manifest.version
              ? { active: existing.active }
              : { active: existing.active, pending: manifest.version }
          : {
              ...(canonicalPointers.active === undefined
                ? {}
                : { active: canonicalPointers.active }),
              ...(canonicalPointers.previous === undefined
                ? {}
                : { previous: canonicalPointers.previous }),
              ...(canonicalPointers.pending === undefined
                ? {}
                : { pending: canonicalPointers.pending })
            }),
        ...(canonicalPointers !== undefined || existing?.previous === undefined
          ? {}
          : { previous: existing.previous }),
        versions: {
          ...(existing?.versions ?? {}),
          [manifest.version]: installed
        }
      };
      await save({
        ...current,
        components: {
          ...current.components,
          [manifest.componentId]: nextComponent
        }
      });
      return nextComponent;
    }),
    activate: (componentId) => mutate(async () => {
      const current = await load();
      const component = current.components[componentId];
      if (component === undefined) {
        throw new Error(`Component is not installed: ${componentId}`);
      }
      if (component.pending === undefined) {
        return component;
      }
      await verifyInstalledVersion(component, component.pending);
      if (isCanonicalComponent(componentId)) {
        if (canonicalActivationRegistry === undefined || bootstrapProjection === null) {
          throw new Error(
            `Canonical activation registry helper is unavailable for component ${componentId}.`
          );
        }
        const projection = await canonicalActivationRegistry.activate({
          componentId,
          expectedRevision: bootstrapProjection.revision,
          expectedPending: component.pending
        });
        const synchronized = await synchronizeAfterCanonicalMutation(projection);
        const activated = synchronized.components[componentId];
        if (activated === undefined) {
          throw new Error(`Canonical activation removed component ${componentId}.`);
        }
        return activated;
      }
      requireLocalActivation(componentId);
      const { pending, ...withoutPending } = component;
      const next: InstalledComponentV1 = {
        ...withoutPending,
        active: pending,
        ...(component.active === undefined ? {} : { previous: component.active }),
      };
      await save({
        ...current,
        components: { ...current.components, [componentId]: next }
      });
      return next;
    }),
    rollback: (componentId) => mutate(async () => {
      const current = await load();
      const component = current.components[componentId];
      if (component === undefined) {
        throw new Error(`Component is not installed: ${componentId}`);
      }
      if (component.previous === undefined) {
        return component;
      }
      await verifyInstalledVersion(component, component.previous);
      if (isCanonicalComponent(componentId)) {
        if (canonicalActivationRegistry === undefined || bootstrapProjection === null) {
          throw new Error(
            `Canonical activation registry helper is unavailable for component ${componentId}.`
          );
        }
        const projection = await canonicalActivationRegistry.rollback({
          componentId,
          expectedRevision: bootstrapProjection.revision,
          expectedPrevious: component.previous
        });
        const synchronized = await synchronizeAfterCanonicalMutation(projection);
        const rolledBack = synchronized.components[componentId];
        if (rolledBack === undefined) {
          throw new Error(`Canonical rollback removed component ${componentId}.`);
        }
        return rolledBack;
      }
      requireLocalActivation(componentId);
      const { pending: _pending, ...withoutPending } = component;
      const next: InstalledComponentV1 = {
        ...withoutPending,
        active: component.previous,
        ...(component.active === undefined ? {} : { previous: component.active })
      };
      await save({
        ...current,
        components: { ...current.components, [componentId]: next }
      });
      return next;
    }),
    restoreActivation: (componentId, activation) => mutate(async () => {
      const current = await load();
      const component = current.components[componentId];
      if (component === undefined) {
        throw new Error(`Component is not installed: ${componentId}`);
      }
      const selected = [...new Set(
        [activation.active, activation.previous, activation.pending]
          .filter((version): version is string => version !== undefined)
      )];
      for (const version of selected) {
        await verifyInstalledVersion(component, version);
      }
      if (isCanonicalComponent(componentId)) {
        if (canonicalActivationRegistry === undefined || bootstrapProjection === null) {
          throw new Error(
            `Canonical activation registry helper is unavailable for component ${componentId}.`
          );
        }
        if (bootstrapProjection.revision < 2) {
          throw new Error("Canonical activation has no predecessor to restore.");
        }
        const sourceRevision = bootstrapProjection.revision - 1;
        const source = await canonicalActivationRegistry.readRevision(sourceRevision);
        const sourceState = source.components[componentId];
        if (sourceState === undefined || !activationStateMatches(sourceState, activation)) {
          throw new Error(
            `Requested activation restore does not match canonical revision ${sourceRevision}.`
          );
        }
        const projection = await canonicalActivationRegistry.restore({
          componentId,
          expectedRevision: bootstrapProjection.revision,
          sourceRevision
        });
        const synchronized = await synchronizeAfterCanonicalMutation(projection);
        const restored = synchronized.components[componentId];
        if (restored === undefined || !activationStateMatches(restored, activation)) {
          throw new Error(`Canonical activation restore failed for component ${componentId}.`);
        }
        return restored;
      }
      requireLocalActivation(componentId);
      const {
        active: _active,
        previous: _previous,
        pending: _pending,
        ...withoutActivation
      } = component;
      const next: InstalledComponentV1 = {
        ...withoutActivation,
        ...(activation.active === undefined ? {} : { active: activation.active }),
        ...(activation.previous === undefined ? {} : { previous: activation.previous }),
        ...(activation.pending === undefined ? {} : { pending: activation.pending })
      };
      await save({
        ...current,
        components: { ...current.components, [componentId]: next }
      });
      return next;
    }),
    uninstallVersion: (componentId, version) => mutate(async () => {
      const current = await load();
      const component = await readRequired(componentId);
      if ([component.active, component.previous, component.pending].includes(version)) {
        throw new Error(`Cannot remove a referenced component version: ${componentId}@${version}`);
      }
      const installed = component.versions[version];
      if (installed === undefined) {
        return;
      }
      const { [version]: _removed, ...versions } = component.versions;
      await save({
        ...current,
        components: {
          ...current.components,
          [componentId]: { ...component, versions }
        }
      });
      await rm(path.join(componentsRoot, componentId, version, installed.target), {
        recursive: true,
        force: true
      });
    }),
    recordKeyringSequence: (channel, sequence) => mutate(async () => {
      if (!Number.isSafeInteger(sequence) || sequence < 0) {
        throw new Error("Keyring sequence must be a non-negative integer.");
      }
      const current = await load();
      const highest = current.highestKeyringSequence[channel] ?? -1;
      if (sequence < highest) {
        throw new Error(`Keyring rollback rejected for ${channel}: ${sequence} < ${highest}`);
      }
      if (sequence === highest) {
        return;
      }
      await save({
        ...current,
        highestKeyringSequence: {
          ...current.highestKeyringSequence,
          [channel]: sequence
        }
      });
    }),
    recordCatalogSequence: (channel, sequence) => mutate(async () => {
      if (!Number.isSafeInteger(sequence) || sequence < 0) {
        throw new Error("Catalog sequence must be a non-negative integer.");
      }
      const current = await load();
      const highest = current.highestCatalogSequence[channel] ?? -1;
      if (sequence < highest) {
        throw new Error(`Catalog rollback rejected for ${channel}: ${sequence} < ${highest}`);
      }
      if (sequence === highest) {
        return;
      }
      await save({
        ...current,
        highestCatalogSequence: {
          ...current.highestCatalogSequence,
          [channel]: sequence
        }
      });
    })
  };
};
