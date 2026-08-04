import { readFile } from "node:fs/promises";
import path from "node:path";

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

export const FIRST_PARTY_APP_PACKAGES_V1 = {
  "lyra.browser": "lyra-browser",
  "lyra.files": "lyra-files",
  "lyra.editor": "lyra-editor",
  "lyra.images": "lyra-images",
  "lyra.terminal": "lyra-terminal",
  "lyra.downloads": "lyra-downloads",
  "lyra.agent": "lyra-agent",
  "lyra.credentials": "lyra-credentials",
  "lyra.notifications": "lyra-notifications"
} as const;

export const VERSIONED_FIRST_PARTY_METADATA_COMPONENTS_V1 = [
  "lyra.runtime",
  "lyra.language.en-us",
  "lyra.language.zh-cn",
  "lyra.resource.rust-analyzer",
  "lyra.resource.aria2",
  "lyra.resource.playwright"
] as const;

interface PackageVersion {
  readonly private?: unknown;
  readonly version?: unknown;
}

interface UiuxManifestVersion {
  readonly id?: unknown;
  readonly version?: unknown;
}

interface ResourceVersionsDocumentV1 {
  readonly schemaVersion?: unknown;
  readonly components?: unknown;
}

const parseJson = async (file: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `Unable to read component version metadata ${file}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

const requireSemver = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !SEMVER_PATTERN.test(value)) {
    throw new Error(`${label} must be a SemVer value.`);
  }
  return value;
};

const objectRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
};

export const loadIndependentComponentVersions = async (
  repository: string
): Promise<ReadonlyMap<string, string>> => {
  const versions = new Map<string, string>();
  const corePackagePath = path.join(repository, "apps", "desktop", "package.json");
  const corePackage = objectRecord(
    await parseJson(corePackagePath) as PackageVersion,
    "lyra.core package"
  );
  if (corePackage.private !== true) {
    throw new Error("lyra.core must remain a private package.");
  }
  versions.set(
    "lyra.core",
    requireSemver(corePackage.version, "lyra.core package version")
  );

  for (const [componentId, directory] of Object.entries(FIRST_PARTY_APP_PACKAGES_V1)) {
    const packagePath = path.join(repository, "apps", directory, "package.json");
    const packageDocument = objectRecord(
      await parseJson(packagePath) as PackageVersion,
      `${componentId} package`
    );
    if (packageDocument.private !== true) {
      throw new Error(`${componentId} must remain a private package.`);
    }
    versions.set(
      componentId,
      requireSemver(packageDocument.version, `${componentId} package version`)
    );
  }

  const uiuxPath = path.join(
    repository,
    "components",
    "first-party",
    "uiux-classic",
    "uiux-manifest.json"
  );
  const uiux = objectRecord(
    await parseJson(uiuxPath) as UiuxManifestVersion,
    "Classic UIUX manifest"
  );
  if (uiux.id !== "classic") {
    throw new Error("Classic UIUX manifest id must be classic.");
  }
  versions.set(
    "lyra.uiux.classic",
    requireSemver(uiux.version, "Classic UIUX version")
  );

  const resourceVersionsPath = path.join(
    repository,
    "components",
    "first-party",
    "resource-versions.v1.json"
  );
  const resourceDocument = objectRecord(
    await parseJson(resourceVersionsPath) as ResourceVersionsDocumentV1,
    "Resource versions document"
  );
  if (resourceDocument.schemaVersion !== 1) {
    throw new Error("Resource versions document schemaVersion must be 1.");
  }
  const resources = objectRecord(
    resourceDocument.components,
    "Resource versions components"
  );
  const expected = new Set<string>(VERSIONED_FIRST_PARTY_METADATA_COMPONENTS_V1);
  for (const componentId of Object.keys(resources)) {
    if (!expected.has(componentId)) {
      throw new Error(`Unexpected independently versioned component: ${componentId}`);
    }
  }
  for (const componentId of VERSIONED_FIRST_PARTY_METADATA_COMPONENTS_V1) {
    if (!Object.hasOwn(resources, componentId)) {
      throw new Error(`Missing independently versioned component: ${componentId}`);
    }
    versions.set(
      componentId,
      requireSemver(resources[componentId], `${componentId} version`)
    );
  }
  return versions;
};

export const requireIndependentComponentVersion = (
  versions: ReadonlyMap<string, string>,
  componentId: string
): string => {
  const version = versions.get(componentId);
  if (version === undefined) {
    throw new Error(`No independent version metadata for ${componentId}.`);
  }
  return version;
};
