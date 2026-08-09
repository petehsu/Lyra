import { createHash, createPublicKey, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  canonicalComponentManifestV1,
  canonicalJson,
  canonicalReleaseKeyringPayloadV1,
  canonicalReleaseBomComponentV1,
  canonicalReleaseBomV1,
  validateComponentManifestV1,
  validateReleaseBomV1,
  validateSignedChannelCatalogV1,
  validateSignedReleaseKeyringV1,
  type ComponentActivationV1,
  type ComponentDeliveryV1,
  type ComponentExecutionClassV1,
  type ComponentKindV1,
  type ComponentManifestV1,
  type ComponentTargetV1,
  type ReleaseBomComponentV1,
  type ReleaseBomV1,
  type SignedChannelCatalogV1,
  type SignedReleaseKeyringV1
} from "../../packages/app-runtime/src/index.ts";

const SIGNATURE_PLACEHOLDER = Buffer.alloc(64).toString("base64");
const COMPONENT_ID_PATTERN = /^[a-z0-9._-]{1,128}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,128}$/u;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export type ReleaseComponentSpecV1 = {
  readonly componentId: string;
  readonly kind: ComponentKindV1;
  readonly version: string;
  readonly sourceDirectory: string;
  readonly entry?: string;
  readonly executionClass?: ComponentExecutionClassV1;
  readonly activation: ComponentActivationV1;
  readonly delivery?: ComponentDeliveryV1;
  readonly hostApiRange?: {
    readonly minInclusive: string;
    readonly maxExclusive?: string;
  };
  readonly runtimeProtocolRange?: {
    readonly min: number;
    readonly max: number;
  };
  readonly dataSchema: {
    readonly readerMin: number;
    readonly readerMax: number;
    readonly writer: number;
  };
  readonly permissions: readonly string[];
};

export type ReleasePackageSpecV1 = {
  readonly schemaVersion: 1;
  readonly releaseVersion: string;
  readonly channel: "stable" | "preview";
  readonly sequence: number;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly target: ComponentTargetV1;
  readonly hostApiVersion: string;
  readonly publisher: string;
  readonly keyId: string;
  readonly minimumSafeCoreVersion?: string;
  readonly revocations?: readonly {
    readonly componentId: string;
    readonly version: string;
    readonly reason?: string;
  }[];
  readonly components: readonly ReleaseComponentSpecV1[];
};

export type ReleasePackageReportV1 = {
  readonly releaseVersion: string;
  readonly target: ComponentTargetV1;
  readonly catalogPath: string;
  readonly bomPath: string;
  readonly offlineBundleRoot: string;
  readonly componentArchives: readonly {
    readonly componentId: string;
    readonly version: string;
    readonly path: string;
    readonly size: number;
    readonly sha256: string;
  }[];
  readonly totalArchiveBytes: number;
  readonly releaseManifestPath: string;
  readonly sizeReportPath: string;
  readonly checksumsPath: string;
  readonly sbomPaths: readonly string[];
};

export const LYRA_DESKTOP_RELEASE_COMPONENTS_V1 = {
  "lyra.core": { kind: "core", activation: "core-restart", delivery: "required" },
  "lyra.runtime": { kind: "runtime", activation: "runtime-idle", delivery: "required" },
  "lyra.browser": { kind: "app", activation: "module-idle", delivery: "required" },
  "lyra.files": { kind: "app", activation: "module-idle", delivery: "required" },
  "lyra.editor": { kind: "app", activation: "module-idle", delivery: "required" },
  "lyra.images": { kind: "app", activation: "module-idle", delivery: "required" },
  "lyra.terminal": { kind: "app", activation: "module-idle", delivery: "required" },
  "lyra.downloads": { kind: "app", activation: "module-idle", delivery: "required" },
  "lyra.agent": { kind: "app", activation: "module-idle", delivery: "required" },
  "lyra.credentials": { kind: "app", activation: "module-idle", delivery: "required" },
  "lyra.notifications": { kind: "app", activation: "module-idle", delivery: "required" },
  "lyra.language.en-us": { kind: "resource", activation: "resource-idle", delivery: "required" },
  "lyra.language.zh-cn": { kind: "resource", activation: "resource-idle", delivery: "required" },
  "lyra.uiux.classic": { kind: "extension", activation: "next-session", delivery: "required" },
  "lyra.resource.rust-analyzer": { kind: "resource", activation: "resource-idle", delivery: "required" },
  "lyra.resource.aria2": { kind: "resource", activation: "resource-idle", delivery: "required" },
  "lyra.resource.playwright": { kind: "resource", activation: "resource-idle", delivery: "on-demand" }
} as const satisfies Readonly<Record<string, {
  readonly kind: ComponentKindV1;
  readonly activation: ComponentActivationV1;
  readonly delivery: ComponentDeliveryV1;
}>>;

type ArchiveDirectory = (sourceDirectory: string, destination: string) => Promise<void>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

const sha256File = async (filePath: string): Promise<string> =>
  sha256(await readFile(filePath));

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await lstat(filePath);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const signature = (payload: string, privateKey: KeyObject): string =>
  sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");

const writeText = async (filePath: string, contents: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.pending-${randomUUID()}`;
  await writeFile(temporary, contents, { flag: "wx" });
  await rm(filePath, { force: true });
  await rename(temporary, filePath);
};

const writeJson = async (filePath: string, value: unknown): Promise<void> =>
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);

const run = async (
  command: string,
  args: readonly string[],
  cwd?: string
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stderr: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `${command} failed (${signal ?? code ?? "unknown"}): ${Buffer.concat(stderr).toString("utf8").trim()}`
      ));
    });
  });
};

export const archiveDirectory: ArchiveDirectory = async (sourceDirectory, destination) => {
  await mkdir(path.dirname(destination), { recursive: true });
  await rm(destination, { force: true });
  if (process.platform === "win32") {
    // 7z creates standard ZIP files that the Rust zip crate can parse.
    // tar.exe (libarchive) produces ZIP64 for large archives, causing
    // "Invalid CDFH offset in EOCD" when the zip crate reads them back.
    await run("7z.exe", ["a", "-tzip", "-mx=1", destination, "."], sourceDirectory);
    return;
  }
  await run("zip", ["-X", "-q", "-r", destination, "."], sourceDirectory);
};

const walkFiles = async (
  root: string,
  directory = root,
  prefix = ""
): Promise<readonly string[]> => {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Component source is not a regular directory: ${directory}`);
  }
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    const absolute = path.join(directory, entry.name);
    const entryMetadata = await lstat(absolute);
    if (entryMetadata.isSymbolicLink()) {
      throw new Error(`Component source contains a symbolic link: ${relative}`);
    }
    if (entryMetadata.isDirectory()) {
      files.push(...await walkFiles(root, absolute, relative));
    } else if (entryMetadata.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Component source contains a special file: ${relative}`);
    }
  }
  return files;
};

const resolveSourceDirectory = (specPath: string, value: string): string =>
  path.resolve(path.dirname(specPath), value);

const validateSpec = (value: unknown): ReleasePackageSpecV1 => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.components)) {
    throw new Error("Release package spec must use schemaVersion 1 and contain components.");
  }
  const spec = value as unknown as ReleasePackageSpecV1;
  if (
    !SEMVER_PATTERN.test(spec.releaseVersion)
    || !["stable", "preview"].includes(spec.channel)
    || !Number.isSafeInteger(spec.sequence)
    || spec.sequence < 1
    || Number.isNaN(Date.parse(spec.generatedAt))
    || Number.isNaN(Date.parse(spec.expiresAt))
    || Date.parse(spec.generatedAt) >= Date.parse(spec.expiresAt)
    || !SEMVER_PATTERN.test(spec.hostApiVersion)
    || spec.publisher.trim().length === 0
    || !IDENTIFIER_PATTERN.test(spec.keyId)
  ) {
    throw new Error("Release package identity, time, or version fields are invalid.");
  }
  const ids = new Set<string>();
  for (const component of spec.components) {
    if (
      !COMPONENT_ID_PATTERN.test(component.componentId)
      || !SEMVER_PATTERN.test(component.version)
      || component.sourceDirectory.trim().length === 0
      || ids.has(component.componentId)
    ) {
      throw new Error(`Invalid or duplicate component spec: ${component.componentId}`);
    }
    ids.add(component.componentId);
  }
  const cores = spec.components.filter(({ kind }) => kind === "core");
  if (cores.length !== 1) {
    throw new Error("A release must contain exactly one Core component.");
  }
  const expectedEntries = Object.entries(LYRA_DESKTOP_RELEASE_COMPONENTS_V1);
  if (spec.components.length !== expectedEntries.length) {
    throw new Error(
      `A Lyra Desktop release must contain exactly ${expectedEntries.length} first-party components.`
    );
  }
  const componentsById = new Map(spec.components.map((component) => [component.componentId, component]));
  for (const [componentId, expected] of expectedEntries) {
    const component = componentsById.get(componentId);
    if (component === undefined) {
      throw new Error(`Lyra Desktop release is missing ${componentId}.`);
    }
    if (
      component.kind !== expected.kind
      || component.activation !== expected.activation
      || (component.delivery ?? "required") !== expected.delivery
    ) {
      throw new Error(`Lyra Desktop release metadata is invalid for ${componentId}.`);
    }
    if (component.kind === "app" && component.hostApiRange === undefined) {
      throw new Error(`Workspace app must declare a Host API range: ${componentId}.`);
    }
    if (
      component.kind === "app"
      && component.executionClass !== "first-party-shared-renderer"
    ) {
      throw new Error(`First-party app must use the shared renderer execution class: ${componentId}.`);
    }
    if (component.kind !== "app" && component.executionClass !== undefined) {
      throw new Error(`Only app components may declare an execution class: ${componentId}.`);
    }
    if (component.kind === "runtime" && component.runtimeProtocolRange === undefined) {
      throw new Error(`Runtime must declare a protocol range: ${componentId}.`);
    }
  }
  return spec;
};

const packageComponent = async ({
  component,
  spec,
  specPath,
  baseUrl,
  outputRoot,
  releasePrivateKey,
  archive
}: {
  readonly component: ReleaseComponentSpecV1;
  readonly spec: ReleasePackageSpecV1;
  readonly specPath: string;
  readonly baseUrl: string;
  readonly outputRoot: string;
  readonly releasePrivateKey: KeyObject;
  readonly archive: ArchiveDirectory;
}): Promise<{
  readonly bom: ReleaseBomComponentV1;
  readonly manifest: ComponentManifestV1;
  readonly report: ReleasePackageReportV1["componentArchives"][number];
}> => {
  const sourceDirectory = resolveSourceDirectory(specPath, component.sourceDirectory);
  const sourceMetadata = await stat(sourceDirectory);
  if (!sourceMetadata.isDirectory()) {
    throw new Error(`Component source does not exist: ${sourceDirectory}`);
  }
  const relativeFiles = [...await walkFiles(sourceDirectory)].sort();
  if (relativeFiles.length === 0 || relativeFiles.includes("component.json")) {
    throw new Error(`Component source must be non-empty and must not contain component.json: ${component.componentId}`);
  }
  if (component.entry !== undefined && !relativeFiles.includes(component.entry)) {
    throw new Error(`Component entry is not present in its source: ${component.componentId}/${component.entry}`);
  }
  const files = await Promise.all(relativeFiles.map(async (relative) => {
    const absolute = path.join(sourceDirectory, ...relative.split("/"));
    const metadata = await stat(absolute);
    return {
      path: relative,
      size: metadata.size,
      sha256: await sha256File(absolute)
    };
  }));
  const unsignedManifest = {
    schemaVersion: 1,
    componentId: component.componentId,
    kind: component.kind,
    version: component.version,
    target: spec.target,
    ...(component.entry === undefined ? {} : { entry: component.entry }),
    ...(component.executionClass === undefined
      ? {}
      : { executionClass: component.executionClass }),
    activation: component.activation,
    ...(component.hostApiRange === undefined ? {} : { hostApiRange: component.hostApiRange }),
    ...(component.runtimeProtocolRange === undefined
      ? {}
      : { runtimeProtocolRange: component.runtimeProtocolRange }),
    dataSchema: component.dataSchema,
    permissions: component.permissions,
    publisher: spec.publisher,
    files,
    keyId: spec.keyId
  } as const;
  const manifest = {
    ...unsignedManifest,
    signature: signature(
      canonicalComponentManifestV1({
        ...unsignedManifest,
        signature: SIGNATURE_PLACEHOLDER
      } as ComponentManifestV1),
      releasePrivateKey
    )
  } satisfies ComponentManifestV1;
  if (!validateComponentManifestV1(manifest)) {
    throw new Error(`Generated ComponentManifestV1 is invalid: ${component.componentId}`);
  }

  const stagingParent = await mkdtemp(path.join(os.tmpdir(), "lyra-component-package-"));
  const stagingRoot = path.join(stagingParent, "package");
  const temporaryArchivePath = path.join(
    outputRoot,
    "components",
    `.pending-${randomUUID()}.zip`
  );
  try {
    await cp(sourceDirectory, stagingRoot, { recursive: true, force: false, errorOnExist: true });
    await writeFile(path.join(stagingRoot, "component.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx"
    });
    await archive(stagingRoot, temporaryArchivePath);
    const archiveMetadata = await stat(temporaryArchivePath);
    const archiveSha256 = await sha256File(temporaryArchivePath);
    const archiveName = `${archiveSha256}.zip`;
    const archivePath = path.join(outputRoot, "components", archiveName);
    if (await pathExists(archivePath)) {
      if (await sha256File(archivePath) !== archiveSha256) {
        throw new Error(`Content-addressed component collision: ${archiveSha256}`);
      }
      await rm(temporaryArchivePath, { force: true });
    } else {
      await rename(temporaryArchivePath, archivePath);
    }
    const unsignedBomComponent = {
      componentId: component.componentId,
      kind: component.kind,
      version: component.version,
      target: spec.target,
      url: `${baseUrl}/${encodeURIComponent(archiveName)}`,
      size: archiveMetadata.size,
      sha256: archiveSha256,
      ...(component.entry === undefined ? {} : { entry: component.entry }),
      ...(component.executionClass === undefined
        ? {}
        : { executionClass: component.executionClass }),
      activation: component.activation,
      delivery: component.delivery ?? "required",
      keyId: spec.keyId
    } as const;
    const bom = {
      ...unsignedBomComponent,
      signature: signature(
        canonicalReleaseBomComponentV1({
          ...unsignedBomComponent,
          signature: SIGNATURE_PLACEHOLDER
        } as ReleaseBomComponentV1),
        releasePrivateKey
      )
    } satisfies ReleaseBomComponentV1;
    return {
      bom,
      manifest,
      report: {
        componentId: component.componentId,
        version: component.version,
        path: archivePath,
        size: archiveMetadata.size,
        sha256: archiveSha256
      }
    };
  } finally {
    await rm(stagingParent, { recursive: true, force: true });
    await rm(temporaryArchivePath, { force: true });
  }
};

export const packageRelease = async ({
  specPath,
  outputRoot,
  baseUrl,
  releasePrivateKey,
  keyring,
  trustedRoots,
  assetLayout = "directory",
  archive = archiveDirectory
}: {
  readonly specPath: string;
  readonly outputRoot: string;
  readonly baseUrl: string;
  readonly releasePrivateKey: KeyObject;
  readonly keyring: SignedReleaseKeyringV1;
  readonly trustedRoots: Readonly<Record<string, string>>;
  readonly assetLayout?: "directory" | "flat";
  readonly archive?: ArchiveDirectory;
}): Promise<ReleasePackageReportV1> => {
  const spec = validateSpec(JSON.parse(await readFile(specPath, "utf8")) as unknown);
  if (!validateSignedReleaseKeyringV1(keyring)) {
    throw new Error("Signed release keyring did not pass the production contract validator.");
  }
  const trustedRoot = trustedRoots[keyring.signature.keyId];
  if (trustedRoot === undefined) {
    throw new Error(`Release keyring uses an untrusted root: ${keyring.signature.keyId}`);
  }
  const rootBytes = Buffer.from(trustedRoot, "base64");
  if (rootBytes.length !== 32) {
    throw new Error("Trusted Ed25519 root must contain 32 bytes.");
  }
  const rootPublicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), rootBytes]),
    format: "der",
    type: "spki"
  });
  if (!verify(
    null,
    Buffer.from(canonicalReleaseKeyringPayloadV1(keyring)),
    rootPublicKey,
    Buffer.from(keyring.signature.value, "base64")
  )) {
    throw new Error("Release keyring root signature is invalid.");
  }
  const releasePublicJwk = createPublicKey(releasePrivateKey).export({ format: "jwk" });
  if (releasePublicJwk.kty !== "OKP" || releasePublicJwk.crv !== "Ed25519" || releasePublicJwk.x === undefined) {
    throw new Error("Release signing key must be Ed25519.");
  }
  const releasePublicKey = Buffer.from(releasePublicJwk.x, "base64url").toString("base64");
  const certifiedReleaseKey = keyring.payload.keys.find(({ keyId }) => keyId === spec.keyId);
  if (
    certifiedReleaseKey === undefined
    || certifiedReleaseKey.publicKey !== releasePublicKey
    || certifiedReleaseKey.publisher !== spec.publisher
    || !certifiedReleaseKey.channels.includes(spec.channel)
    || keyring.payload.revokedKeyIds.includes(spec.keyId)
    || Date.parse(spec.generatedAt) < Date.parse(certifiedReleaseKey.validFrom)
    || Date.parse(spec.expiresAt) > Date.parse(certifiedReleaseKey.validUntil)
    || Date.parse(spec.generatedAt) < Date.parse(keyring.payload.generatedAt)
    || Date.parse(spec.expiresAt) > Date.parse(keyring.payload.expiresAt)
  ) {
    throw new Error("Release signing key is not authorized by the supplied offline keyring.");
  }
  for (const component of spec.components) {
    if (!certifiedReleaseKey.componentKinds.includes(component.kind)) {
      throw new Error(
        `Release signing key ${spec.keyId} is not root-authorized for component kind ${component.kind}.`
      );
    }
    if (
      !certifiedReleaseKey.componentIdPrefixes.some(
        (prefix) => component.componentId.startsWith(prefix)
      )
    ) {
      throw new Error(
        `Release signing key ${spec.keyId} is not root-authorized for component ID ${component.componentId}.`
      );
    }
    if (
      component.executionClass !== undefined
      && !certifiedReleaseKey.executionClasses.includes(component.executionClass)
    ) {
      throw new Error(
        `Release signing key ${spec.keyId} is not root-authorized for execution class ${component.executionClass}.`
      );
    }
  }
  const normalizedBaseUrl = baseUrl.replace(/\/+$/u, "");
  const parsedBaseUrl = new URL(normalizedBaseUrl);
  if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new Error("Release base URL must be an HTTPS URL without credentials.");
  }
  await mkdir(outputRoot, { recursive: true });
  const artifactUrl = (group: "boms" | "components", name: string): string =>
    assetLayout === "flat"
      ? `${normalizedBaseUrl}/${encodeURIComponent(name)}`
      : `${normalizedBaseUrl}/${group}/${encodeURIComponent(name)}`;
  const packaged = [];
  for (const component of spec.components) {
    packaged.push(await packageComponent({
      component,
      spec,
      specPath,
      baseUrl: assetLayout === "flat"
        ? normalizedBaseUrl
        : `${normalizedBaseUrl}/components`,
      outputRoot,
      releasePrivateKey,
      archive
    }));
  }
  const core = packaged.find(({ bom }) => bom.kind === "core");
  if (core === undefined) {
    throw new Error("Core component disappeared while packaging the release.");
  }
  const bom: ReleaseBomV1 = {
    schemaVersion: 1,
    releaseVersion: spec.releaseVersion,
    channel: spec.channel,
    target: spec.target,
    coreVersion: core.bom.version,
    hostApiVersion: spec.hostApiVersion,
    components: packaged.map(({ bom: component }) => component)
  };
  if (!validateReleaseBomV1(bom)) {
    throw new Error("Generated ReleaseBomV1 did not pass the production contract validator.");
  }
  const bomBytes = Buffer.from(`${JSON.stringify(bom, null, 2)}\n`, "utf8");
  const bomDigest = sha256(bomBytes);
  const bomName = `${bomDigest}.json`;
  const bomPath = path.join(outputRoot, "boms", bomName);
  await mkdir(path.dirname(bomPath), { recursive: true });
  await writeFile(bomPath, bomBytes, { flag: "wx" }).catch(async (error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    if (await sha256File(bomPath) !== bomDigest) {
      throw new Error(`Content-addressed BOM collision: ${bomDigest}`);
    }
  });
  const catalogPayload: SignedChannelCatalogV1["payload"] = {
    sequence: spec.sequence,
    channel: spec.channel,
    generatedAt: spec.generatedAt,
    expiresAt: spec.expiresAt,
    ...(spec.minimumSafeCoreVersion === undefined
      ? {}
      : { minimumSafeCoreVersion: spec.minimumSafeCoreVersion }),
    revocations: spec.revocations ?? [],
    releases: [{
      version: spec.releaseVersion,
      bomUrl: artifactUrl("boms", bomName),
      bomSha256: bomDigest,
      bomSignature: signature(canonicalReleaseBomV1(bom), releasePrivateKey),
      keyId: spec.keyId
    }]
  };
  const catalog: SignedChannelCatalogV1 = {
    schemaVersion: 1,
    keyring,
    payload: catalogPayload,
    signature: {
      algorithm: "ed25519",
      keyId: spec.keyId,
      value: signature(canonicalJson(catalogPayload), releasePrivateKey)
    }
  };
  if (!validateSignedChannelCatalogV1(catalog)) {
    throw new Error("Generated SignedChannelCatalogV1 did not pass the production contract validator.");
  }
  // Ensure our signing serializer and JSON output agree before publishing bytes.
  canonicalReleaseKeyringPayloadV1(catalog.keyring);
  canonicalJson(catalog.payload);
  const catalogPath = assetLayout === "flat"
    ? path.join(outputRoot, `catalog-${spec.channel}-${spec.target}.json`)
    : path.join(outputRoot, "catalogs", spec.channel, `${spec.target}.json`);
  await writeJson(catalogPath, catalog);
  const componentArchives = packaged.map(({ report }) => report);
  const sbomPaths: string[] = [];
  for (const component of packaged) {
    const sbomPath = path.join(
      outputRoot,
      "sbom",
      `${component.manifest.componentId}-${component.manifest.version}-${spec.target}.spdx.json`
    );
    await writeJson(sbomPath, createComponentSpdx({
      manifest: component.manifest,
      archive: component.report,
      generatedAt: spec.generatedAt,
      publisher: spec.publisher,
      releaseVersion: spec.releaseVersion,
      target: spec.target
    }));
    sbomPaths.push(sbomPath);
  }
  const sizeReportPath = path.join(
    outputRoot,
    "reports",
    `component-sizes-${spec.target}.v1.json`
  );
  await writeJson(sizeReportPath, {
    schemaVersion: 1,
    releaseVersion: spec.releaseVersion,
    target: spec.target,
    components: componentArchives
      .map(({ componentId, version, size, sha256 }) => ({ componentId, version, size, sha256 }))
      .sort((left, right) => left.componentId.localeCompare(right.componentId)),
    totalArchiveBytes: componentArchives.reduce((total, component) => total + component.size, 0)
  });
  const releaseManifestPath = path.join(
    outputRoot,
    `release-manifest-${spec.target}.v1.json`
  );
  await writeJson(releaseManifestPath, {
    schemaVersion: 1,
    releaseVersion: spec.releaseVersion,
    channel: spec.channel,
    target: spec.target,
    keyringSequence: keyring.payload.sequence,
    catalogSequence: spec.sequence,
    catalog: relativeReleasePath(outputRoot, catalogPath),
    bom: relativeReleasePath(outputRoot, bomPath),
    components: componentArchives.map((component, index) => ({
      componentId: component.componentId,
      version: component.version,
      archive: relativeReleasePath(outputRoot, component.path),
      size: component.size,
      sha256: component.sha256,
      sbom: relativeReleasePath(outputRoot, sbomPaths[index]!)
    }))
  });
  const checksumFiles = [
    catalogPath,
    bomPath,
    ...componentArchives.map(({ path: archivePath }) => archivePath),
    ...sbomPaths,
    sizeReportPath,
    releaseManifestPath
  ];
  const checksumsPath = path.join(outputRoot, `SHA256SUMS-${spec.target}`);
  await writeText(
    checksumsPath,
    `${(await Promise.all(checksumFiles.map(async (filePath) =>
      `${await sha256File(filePath)}  ${relativeReleasePath(outputRoot, filePath)}`
    ))).sort().join("\n")}\n`
  );
  return {
    releaseVersion: spec.releaseVersion,
    target: spec.target,
    catalogPath,
    bomPath,
    offlineBundleRoot: outputRoot,
    componentArchives,
    totalArchiveBytes: componentArchives.reduce((total, component) => total + component.size, 0),
    releaseManifestPath,
    sizeReportPath,
    checksumsPath,
    sbomPaths
  };
};

const relativeReleasePath = (outputRoot: string, filePath: string): string =>
  path.relative(outputRoot, filePath).split(path.sep).join("/");

const spdxId = (value: string): string =>
  value.replace(/[^A-Za-z0-9.-]/gu, "-");

const createComponentSpdx = ({
  manifest,
  archive,
  generatedAt,
  publisher,
  releaseVersion,
  target
}: {
  readonly manifest: ComponentManifestV1;
  readonly archive: ReleasePackageReportV1["componentArchives"][number];
  readonly generatedAt: string;
  readonly publisher: string;
  readonly releaseVersion: string;
  readonly target: ComponentTargetV1;
}): unknown => {
  const packageId = `SPDXRef-Package-${spdxId(manifest.componentId)}`;
  const files = manifest.files.map((file, index) => ({
    fileName: file.path,
    SPDXID: `SPDXRef-File-${index + 1}-${spdxId(path.basename(file.path))}`,
    checksums: [{ algorithm: "SHA256", checksumValue: file.sha256 }],
    fileTypes: ["OTHER"],
    licenseConcluded: "NOASSERTION",
    copyrightText: "NOASSERTION"
  }));
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${manifest.componentId}-${manifest.version}-${target}`,
    documentNamespace:
      `https://lyra.ltd/sbom/${encodeURIComponent(releaseVersion)}/${encodeURIComponent(target)}`
      + `/${encodeURIComponent(manifest.componentId)}/${encodeURIComponent(manifest.version)}`,
    creationInfo: {
      created: generatedAt,
      creators: ["Tool: Lyra release packer"]
    },
    documentDescribes: [packageId],
    packages: [{
      name: manifest.componentId,
      SPDXID: packageId,
      versionInfo: manifest.version,
      supplier: "NOASSERTION",
      comment: `Release publisher: ${publisher}`,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: true,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
      checksums: [{ algorithm: "SHA256", checksumValue: archive.sha256 }]
    }],
    files,
    relationships: [
      { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: packageId },
      ...files.map((file) => ({
        spdxElementId: packageId,
        relationshipType: "CONTAINS",
        relatedSpdxElement: file.SPDXID
      }))
    ]
  };
};

export const readReleasePrivateKey = async (filePath: string): Promise<KeyObject> => {
  const { createPrivateKey } = await import("node:crypto");
  return createPrivateKey(await readFile(filePath));
};
