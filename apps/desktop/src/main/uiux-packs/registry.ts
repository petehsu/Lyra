import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import type {
  InstalledUiuxPack,
  UiuxPackManifest,
  UiuxPackSource,
  UiuxPackTrustState,
  UiuxUninstallResponse
} from "../../shared/uiux-packs";
import type {
  LyraCapabilityRisk,
  LyraSoftwareActionManifest,
  LyraSoftwareManifest
} from "../../shared/software-capabilities";

const REGISTRY_FILE_NAME = "registry.v1.json";
const PLUGIN_MANIFEST_PATH = path.join(".lyra-plugin", "plugin.json");
const EXTERNAL_PACK_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const EXTERNAL_PACK_ID_PREFIX = "external:";
const SOFTWARE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,191}$/;
const SOFTWARE_ACTION_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,191}$/;
const CAPABILITY_RISKS = new Set<LyraCapabilityRisk>([
  "read",
  "navigate",
  "write",
  "external",
  "destructive"
]);

type UiuxRegistryDocument = {
  readonly version: 1;
  readonly installed: readonly InstalledUiuxPack[];
  readonly activeExternalPackId?: string;
  readonly pendingExternalPackId?: string;
};

type PluginJsonRecord = {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly title?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly entry?: unknown;
  readonly permissions?: unknown;
  readonly uiux?: unknown;
  readonly uiuxPack?: unknown;
  readonly software?: unknown;
  readonly contributes?: {
    readonly uiuxPacks?: unknown;
    readonly software?: unknown;
  };
};

type UiuxDeclarationRecord = {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly title?: unknown;
  readonly version?: unknown;
  readonly description?: unknown;
  readonly entry?: unknown;
  readonly css?: unknown;
  readonly l10n?: unknown;
  readonly workbenchUiApi?: unknown;
  readonly apiVersion?: unknown;
  readonly permissions?: unknown;
  readonly software?: unknown;
  readonly compatibility?: {
    readonly workbenchUiApi?: unknown;
  };
};

type SoftwareDeclarationRecord = {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly category?: unknown;
  readonly version?: unknown;
  readonly actions?: unknown;
};

type SoftwareActionDeclarationRecord = {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly risk?: unknown;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
};

const nowIso = (): string => new Date().toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => asString(entry))
        .filter((entry): entry is string => entry !== undefined)
    : [];

const asRecordArray = (value: unknown): readonly Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(isRecord)
    : [];

const uniqueStrings = (values: readonly string[]): readonly string[] =>
  [...new Set(values)];

const normalizePackId = (value: unknown): string => {
  const rawId = asString(value)?.toLowerCase();
  const id = rawId?.startsWith(EXTERNAL_PACK_ID_PREFIX)
    ? rawId
    : rawId === undefined
      ? undefined
      : `${EXTERNAL_PACK_ID_PREFIX}${rawId}`;
  const idWithoutPrefix = id?.slice(EXTERNAL_PACK_ID_PREFIX.length);
  if (
    id === undefined
    || idWithoutPrefix === undefined
    || EXTERNAL_PACK_ID_PATTERN.test(idWithoutPrefix) === false
  ) {
    throw new Error("UIUX pack id must match /^[a-z0-9][a-z0-9._:-]{1,127}$/");
  }
  if (idWithoutPrefix === "classic") {
    throw new Error("UIUX pack id 'classic' is reserved for the built-in pack");
  }
  return id;
};

const normalizeRelativePath = (value: unknown, fieldName: string): string => {
  const relativePath = asString(value);
  if (relativePath === undefined) {
    throw new Error(`UIUX pack ${fieldName} is required`);
  }
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) {
    throw new Error(`UIUX pack ${fieldName} must be a package-relative path`);
  }
  return relativePath;
};

const resolveInsideRoot = (root: string, relativePath: string): string => {
  const resolved = path.resolve(root, relativePath);
  const rootWithSeparator = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && resolved.startsWith(rootWithSeparator) === false) {
    throw new Error(`UIUX pack path escapes package root: ${relativePath}`);
  }
  return resolved;
};

const selectUiuxDeclaration = (pluginJson: PluginJsonRecord): UiuxDeclarationRecord => {
  if (isRecord(pluginJson.uiuxPack)) {
    return pluginJson.uiuxPack;
  }
  if (isRecord(pluginJson.uiux)) {
    return pluginJson.uiux;
  }
  const contributedPacks = pluginJson.contributes?.uiuxPacks;
  if (Array.isArray(contributedPacks) && isRecord(contributedPacks[0])) {
    return contributedPacks[0];
  }
  return {};
};

const normalizeExternalSoftwareId = (packId: string, value: unknown): string => {
  const rawId = asString(value)?.toLowerCase();
  if (rawId === undefined || SOFTWARE_ID_PATTERN.test(rawId) === false) {
    throw new Error("Software id must match /^[a-z0-9][a-z0-9._:-]{1,191}$/");
  }
  return rawId.startsWith(`${packId}:`) ? rawId : `${packId}:${rawId}`;
};

const normalizeExternalActionId = (softwareId: string, value: unknown): string => {
  const rawId = asString(value)?.toLowerCase();
  if (rawId === undefined || SOFTWARE_ACTION_ID_PATTERN.test(rawId) === false) {
    throw new Error("Software action id must match /^[a-z0-9][a-z0-9._:-]{0,191}$/");
  }
  return rawId.startsWith(`${softwareId}.`) ? rawId : `${softwareId}.${rawId}`;
};

const normalizeRisk = (value: unknown): LyraCapabilityRisk => {
  const risk = asString(value) as LyraCapabilityRisk | undefined;
  if (risk === undefined) {
    return "read";
  }
  if (CAPABILITY_RISKS.has(risk) === false) {
    throw new Error(`Unsupported software action risk: ${risk}`);
  }
  return risk;
};

const parseSoftwareActionDeclaration = (
  softwareId: string,
  value: SoftwareActionDeclarationRecord
): LyraSoftwareActionManifest => {
  const id = normalizeExternalActionId(softwareId, value.id);
  return {
    id,
    title: asString(value.title) ?? asString(value.name) ?? id,
    description: asString(value.description) ?? "External Lyra software action.",
    risk: normalizeRisk(value.risk),
    ...(value.inputSchema === undefined ? {} : { inputSchema: value.inputSchema }),
    ...(value.outputSchema === undefined ? {} : { outputSchema: value.outputSchema })
  };
};

const parseSoftwareDeclaration = (
  packId: string,
  value: SoftwareDeclarationRecord
): LyraSoftwareManifest => {
  const id = normalizeExternalSoftwareId(packId, value.id);
  const category = asString(value.category);
  const version = asString(value.version);
  const actions = asRecordArray(value.actions).map((action) =>
    parseSoftwareActionDeclaration(id, action)
  );
  if (actions.length === 0) {
    throw new Error(`Software ${id} must declare at least one action`);
  }
  return {
    id,
    title: asString(value.title) ?? asString(value.name) ?? id,
    description: asString(value.description) ?? "External Lyra software.",
    ...(category === undefined ? {} : { category }),
    ...(version === undefined ? {} : { version }),
    source: "uiux",
    sourceId: packId,
    actions
  };
};

const selectSoftwareDeclarations = (
  pluginJson: PluginJsonRecord,
  declaration: UiuxDeclarationRecord,
  packId: string
): readonly LyraSoftwareManifest[] =>
  [
    declaration.software,
    pluginJson.software,
    pluginJson.contributes?.software
  ].flatMap((candidate) =>
    asRecordArray(candidate).map((software) =>
      parseSoftwareDeclaration(packId, software)
    )
  );

export const createEmptyUiuxRegistryDocument = (): UiuxRegistryDocument => ({
  version: 1,
  installed: []
});

export const resolveUiuxRegistryPath = (storageRoot: string): string =>
  path.join(storageRoot, REGISTRY_FILE_NAME);

export const readUiuxRegistryDocument = (storageRoot: string): UiuxRegistryDocument => {
  try {
    const parsed = JSON.parse(readFileSync(resolveUiuxRegistryPath(storageRoot), "utf8")) as Partial<UiuxRegistryDocument>;
    return {
      version: 1,
      installed: Array.isArray(parsed.installed) ? parsed.installed : [],
      ...(typeof parsed.activeExternalPackId === "string"
        ? { activeExternalPackId: parsed.activeExternalPackId }
        : {}),
      ...(typeof parsed.pendingExternalPackId === "string"
        ? { pendingExternalPackId: parsed.pendingExternalPackId }
        : {})
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
    return createEmptyUiuxRegistryDocument();
  }
};

export const writeUiuxRegistryDocument = (
  storageRoot: string,
  document: UiuxRegistryDocument
): void => {
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(
    resolveUiuxRegistryPath(storageRoot),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8"
  );
};

export const parseUiuxPackManifest = (packageRoot: string): UiuxPackManifest => {
  const manifestPath = path.join(packageRoot, PLUGIN_MANIFEST_PATH);
  const pluginJson = JSON.parse(readFileSync(manifestPath, "utf8")) as PluginJsonRecord;
  const declaration = selectUiuxDeclaration(pluginJson);
  const id = normalizePackId(declaration.id ?? pluginJson.id);
  const entry = normalizeRelativePath(declaration.entry ?? pluginJson.entry, "entry");
  const css = asString(declaration.css);
  const l10n = asString(declaration.l10n);
  const workbenchUiApi =
    declaration.workbenchUiApi
    ?? declaration.apiVersion
    ?? declaration.compatibility?.workbenchUiApi
    ?? "1";

  if (workbenchUiApi !== "1") {
    throw new Error(`Unsupported UIUX workbench UI API: ${String(workbenchUiApi)}`);
  }

  return {
    id,
    name:
      asString(declaration.name)
      ?? asString(declaration.title)
      ?? asString(pluginJson.name)
      ?? asString(pluginJson.title)
      ?? id,
    version: asString(declaration.version) ?? asString(pluginJson.version) ?? "0.0.0",
    description:
      asString(declaration.description)
      ?? asString(pluginJson.description)
      ?? "External Lyra UIUX pack.",
    entry,
    ...(css === undefined ? {} : { css: normalizeRelativePath(css, "css") }),
    ...(l10n === undefined ? {} : { l10n: normalizeRelativePath(l10n, "l10n") }),
    workbenchUiApi: "1",
    permissions: uniqueStrings([
      ...asStringArray(pluginJson.permissions),
      ...asStringArray(declaration.permissions)
    ]),
    software: selectSoftwareDeclarations(pluginJson, declaration, id)
  };
};

// ponytail: 解析 entry/css/l10n 路径 — l10n 为目录路径，不存在时静默跳过（可选字段）
export const resolveUiuxPackRuntimePaths = (
  packageRoot: string,
  manifest: UiuxPackManifest
): Pick<InstalledUiuxPack, "entryPath" | "cssPath" | "l10nPath"> => {
  const entryPath = resolveInsideRoot(packageRoot, manifest.entry);
  if (existsSync(entryPath) === false) {
    throw new Error(`UIUX pack entry not found: ${manifest.entry}`);
  }
  const cssPath =
    manifest.css === undefined
      ? undefined
      : resolveInsideRoot(packageRoot, manifest.css);
  if (cssPath !== undefined && existsSync(cssPath) === false) {
    throw new Error(`UIUX pack CSS not found: ${manifest.css}`);
  }
  const l10nPath =
    manifest.l10n === undefined
      ? undefined
      : resolveInsideRoot(packageRoot, manifest.l10n);
  if (l10nPath !== undefined && existsSync(l10nPath) === false) {
    // ponytail: l10n 目录不存在时静默跳过 — pack 可声明 l10n 但不提供文件
    return {
      entryPath,
      ...(cssPath === undefined ? {} : { cssPath })
    };
  }
  return {
    entryPath,
    ...(cssPath === undefined ? {} : { cssPath }),
    ...(l10nPath === undefined ? {} : { l10nPath })
  };
};

export const createUiuxSourceFingerprint = (
  source: UiuxPackSource,
  packageRoot: string,
  manifest: UiuxPackManifest
): string => {
  const entryStats = statSync(resolveInsideRoot(packageRoot, manifest.entry));
  const cssStats =
    manifest.css === undefined
      ? null
      : statSync(resolveInsideRoot(packageRoot, manifest.css));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      source,
      manifest,
      entry: {
        size: entryStats.size,
        mtimeMs: entryStats.mtimeMs
      },
      css:
        cssStats === null
          ? null
          : {
              size: cssStats.size,
              mtimeMs: cssStats.mtimeMs
            }
    }))
    .digest("hex");
};

export const toUiuxPackStorageName = (packId: string): string => {
  const slug = packId.replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const digest = crypto.createHash("sha256").update(packId).digest("hex").slice(0, 12);
  return `${slug.length === 0 ? "pack" : slug}-${digest}`;
};

export const installUiuxPackageFromRoot = ({
  storageRoot,
  sourceRoot,
  source
}: {
  readonly storageRoot: string;
  readonly sourceRoot: string;
  readonly source: UiuxPackSource;
}): InstalledUiuxPack => {
  const sourceManifest = parseUiuxPackManifest(sourceRoot);
  const installedRoot = path.join(
    storageRoot,
    "installed",
    toUiuxPackStorageName(sourceManifest.id)
  );
  rmSync(installedRoot, { recursive: true, force: true });
  mkdirSync(path.dirname(installedRoot), { recursive: true });
  cpSync(sourceRoot, installedRoot, {
    recursive: true,
    force: true,
    filter: (sourcePath) => path.basename(sourcePath) !== "node_modules"
  });

  const manifest = parseUiuxPackManifest(installedRoot);
  const runtimePaths = resolveUiuxPackRuntimePaths(installedRoot, manifest);
  const registry = readUiuxRegistryDocument(storageRoot);
  const existing = registry.installed.find((pack) => pack.id === manifest.id);
  const timestamp = nowIso();
  const installed: InstalledUiuxPack = {
    id: manifest.id,
    manifest,
    source,
    packagePath: installedRoot,
    ...runtimePaths,
    sourceFingerprint: createUiuxSourceFingerprint(source, installedRoot, manifest),
    trustState: existing?.trustState ?? "untrusted",
    installedAt: existing?.installedAt ?? timestamp,
    updatedAt: timestamp
  };

  writeUiuxRegistryDocument(storageRoot, {
    ...registry,
    installed: [
      ...registry.installed.filter((pack) => pack.id !== manifest.id),
      installed
    ].sort((left, right) => left.id.localeCompare(right.id))
  });
  return installed;
};

export const updateUiuxPackTrustState = ({
  storageRoot,
  packId,
  trustState
}: {
  readonly storageRoot: string;
  readonly packId: string;
  readonly trustState: UiuxPackTrustState;
}): InstalledUiuxPack => {
  const registry = readUiuxRegistryDocument(storageRoot);
  const existing = registry.installed.find((pack) => pack.id === packId);
  if (existing === undefined) {
    throw new Error(`UIUX pack is not installed: ${packId}`);
  }
  const updated: InstalledUiuxPack = {
    ...existing,
    trustState,
    updatedAt: nowIso(),
    ...(trustState === "trusted" ? {} : { lastError: "Pack is not trusted." })
  };
  const nextRegistry: UiuxRegistryDocument = {
    version: 1,
    installed: registry.installed.map((pack) => pack.id === packId ? updated : pack),
    ...(trustState !== "trusted" && registry.activeExternalPackId === packId
      ? {}
      : registry.activeExternalPackId === undefined
        ? {}
        : { activeExternalPackId: registry.activeExternalPackId }),
    ...(trustState !== "trusted" && registry.pendingExternalPackId === packId
      ? {}
      : registry.pendingExternalPackId === undefined
        ? {}
        : { pendingExternalPackId: registry.pendingExternalPackId })
  };
  writeUiuxRegistryDocument(storageRoot, {
    ...nextRegistry
  });
  return updated;
};

export const readTrustedUiuxPack = (
  storageRoot: string,
  packId: string
): InstalledUiuxPack | null => {
  const registry = readUiuxRegistryDocument(storageRoot);
  const pack = registry.installed.find((entry) => entry.id === packId);
  if (pack === undefined || pack.trustState !== "trusted") {
    return null;
  }
  return pack;
};

export const uninstallUiuxPack = ({
  storageRoot,
  packId
}: {
  readonly storageRoot: string;
  readonly packId: string;
}): UiuxUninstallResponse => {
  const registry = readUiuxRegistryDocument(storageRoot);
  const existing = registry.installed.find((pack) => pack.id === packId);
  if (existing === undefined) {
    throw new Error(`UIUX pack is not installed: ${packId}`);
  }
  rmSync(existing.packagePath, { recursive: true, force: true });
  writeUiuxRegistryDocument(storageRoot, {
    version: 1,
    installed: registry.installed.filter((pack) => pack.id !== packId),
    ...(registry.activeExternalPackId === packId || registry.activeExternalPackId === undefined
      ? {}
      : { activeExternalPackId: registry.activeExternalPackId }),
    ...(registry.pendingExternalPackId === packId || registry.pendingExternalPackId === undefined
      ? {}
      : { pendingExternalPackId: registry.pendingExternalPackId })
  });
  return {
    packId,
    removed: true
  };
};

export const requestUiuxPackActivationInRegistry = ({
  storageRoot,
  packId
}: {
  readonly storageRoot: string;
  readonly packId: string;
}): void => {
  const registry = readUiuxRegistryDocument(storageRoot);
  const pack = registry.installed.find((entry) => entry.id === packId);
  if (pack === undefined) {
    throw new Error(`UIUX pack is not installed: ${packId}`);
  }
  if (pack.trustState !== "trusted") {
    throw new Error(`UIUX pack must be trusted before activation: ${packId}`);
  }
  writeUiuxRegistryDocument(storageRoot, {
    ...registry,
    pendingExternalPackId: packId
  });
};

export const promotePendingUiuxPackActivation = (storageRoot: string): void => {
  const registry = readUiuxRegistryDocument(storageRoot);
  const pendingPackId = registry.pendingExternalPackId;
  if (pendingPackId === undefined) {
    return;
  }
  const pack = registry.installed.find((entry) => entry.id === pendingPackId);
  writeUiuxRegistryDocument(storageRoot, {
    version: 1,
    installed: registry.installed,
    ...(pack?.trustState === "trusted"
      ? { activeExternalPackId: pendingPackId }
      : registry.activeExternalPackId === undefined
        ? {}
        : { activeExternalPackId: registry.activeExternalPackId })
  });
};
