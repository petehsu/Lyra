import { cp, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ComponentTargetV1 } from "../../packages/app-runtime/src/index.ts";
import type { SignedReleaseKeyringV1 } from "../../packages/app-runtime/src/index.ts";

import { authenticatePreviousChannelRelease } from "./channel-promotion.ts";
import {
  FIRST_PARTY_APP_PACKAGES_V1,
  loadIndependentComponentVersions,
  requireIndependentComponentVersion
} from "./component-versions.ts";
import { FIRST_PARTY_APP_RELEASE_CONTRACTS_V1, isCompleteFirstPartyAppId } from "./first-party-app-release.ts";
import { LYRA_DESKTOP_RELEASE_COMPONENTS_V1, packageRelease, readReleasePrivateKey } from "./release-package.ts";

const TARGETS = [
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
] as const satisfies readonly ComponentTargetV1[];

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const exists = async (candidate: string): Promise<boolean> => {
  try {
    await lstat(candidate);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const removePackagingNoise = async (directory: string): Promise<void> => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await removePackagingNoise(candidate);
      continue;
    }
    if (
      entry.name === ".DS_Store"
      || entry.name === ".gitignore"
      || entry.name === ".gitkeep"
      || entry.name.endsWith(".map")
      || entry.name.endsWith(".tsbuildinfo")
    ) {
      await rm(candidate, { force: true });
    }
  }
};

const copyDirectory = async (source: string, destination: string): Promise<void> => {
  const metadata = await stat(source);
  if (!metadata.isDirectory()) {
    throw new Error(`Component source is not a directory: ${source}`);
  }
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    force: false
  });
};

const main = async (): Promise<void> => {
  const rebuildComponentIds = argument("--rebuild").split(",").map((value) => value.trim()).filter(
    (value) => value.length > 0
  );
  if (rebuildComponentIds.length === 0) {
    throw new Error("--rebuild must list at least one component ID.");
  }
  const repository = path.resolve(argument("--repo"));
  const outputRoot = path.resolve(argument("--out"));
  const previousBomDir = path.resolve(argument("--previous-bom-dir"));
  const previousCatalogDir = path.resolve(argument("--previous-catalog-dir"));
  const workRoot = path.resolve(argument("--work"));
  const releaseVersion = argument("--release-version");
  const channel = argument("--channel");
  const sequence = Number(argument("--sequence"));
  const generatedAt = argument("--generated-at");
  const expiresAt = argument("--expires-at");
  const publisher = argument("--publisher");
  const keyId = argument("--key-id");
  const baseUrl = argument("--base-url");
  if (channel !== "preview" && channel !== "stable") {
    throw new Error("Channel is invalid.");
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Sequence is invalid.");
  }
  const independentVersions = await loadIndependentComponentVersions(repository);
  const appContract = new Map(
    FIRST_PARTY_APP_RELEASE_CONTRACTS_V1.map(([componentId, directory, permissions]) => [
      componentId,
      { directory, permissions }
    ])
  );
  const sources = path.join(workRoot, "sources");
  await mkdir(sources, { recursive: true });
  for (const componentId of rebuildComponentIds) {
    const expected = Object.hasOwn(LYRA_DESKTOP_RELEASE_COMPONENTS_V1, componentId)
      ? LYRA_DESKTOP_RELEASE_COMPONENTS_V1[
        componentId as keyof typeof LYRA_DESKTOP_RELEASE_COMPONENTS_V1
      ]
      : undefined;
    if (expected === undefined || (expected.kind !== "app" && expected.kind !== "extension")) {
      throw new Error(`App-only packaging cannot rebuild ${componentId}.`);
    }
    if (expected.kind === "app" && !isCompleteFirstPartyAppId(componentId)) {
      throw new Error(
        `App-only packaging cannot rebuild preview ${componentId}; Core still owns that surface.`
      );
    }
    const destination = path.join(sources, componentId);
    if (componentId === "lyra.uiux.classic") {
      await copyDirectory(
        path.join(repository, "components", "first-party", "uiux-classic"),
        destination
      );
    } else {
      const directory = FIRST_PARTY_APP_PACKAGES_V1[
        componentId as keyof typeof FIRST_PARTY_APP_PACKAGES_V1
      ];
      if (directory === undefined) {
        throw new Error(`No first-party app package for ${componentId}.`);
      }
      await copyDirectory(path.join(repository, "apps", directory, "dist"), destination);
      const entry = path.join(destination, "index.mjs");
      if (!(await exists(entry))) {
        throw new Error(`${componentId} entry is missing: ${entry}`);
      }
    }
    await removePackagingNoise(destination);
  }
  const components = rebuildComponentIds.map((componentId) => {
    const definition = LYRA_DESKTOP_RELEASE_COMPONENTS_V1[
      componentId as keyof typeof LYRA_DESKTOP_RELEASE_COMPONENTS_V1
    ];
    const app = appContract.get(componentId);
    return {
      componentId,
      kind: definition.kind,
      version: requireIndependentComponentVersion(independentVersions, componentId),
      sourceDirectory: `../sources/${componentId}`,
      entry: "index.mjs",
      activation: definition.activation,
      delivery: definition.delivery,
      dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
      ...(definition.kind === "app"
        ? {
          executionClass: "first-party-shared-renderer" as const,
          hostApiRange: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
          permissions: app?.permissions ?? []
        }
        : { permissions: ["desktop-api"] })
    };
  });
  const keyring = JSON.parse(
    await readFile(path.resolve(argument("--keyring")), "utf8")
  ) as SignedReleaseKeyringV1;
  const trustStore = JSON.parse(
    await readFile(path.resolve(argument("--trust-store")), "utf8")
  ) as { readonly roots?: Readonly<Record<string, string>> };
  if (trustStore.roots === undefined) {
    throw new Error("Component trust store has no roots.");
  }
  const releasePrivateKey = await readReleasePrivateKey(path.resolve(argument("--release-private-key")));
  const reports = [];
  for (const target of TARGETS) {
    const { catalog, bom: previousBom } = authenticatePreviousChannelRelease({
      catalogValue: JSON.parse(
        await readFile(path.join(previousCatalogDir, `catalog-${channel}-${target}.json`), "utf8")
      ),
      bomBytes: await readFile(path.join(previousBomDir, `${target}.json`)),
      channel,
      target,
      trustedRoots: trustStore.roots
    });
    if (sequence <= catalog.payload.sequence) {
      throw new Error(
        `App-only packaging requires sequence > ${catalog.payload.sequence} for ${target}.`
      );
    }
    const specPath = path.join(workRoot, "specs", `${target}.json`);
    await mkdir(path.dirname(specPath), { recursive: true });
    await writeFile(specPath, `${JSON.stringify({
      schemaVersion: 1,
      releaseVersion,
      channel,
      sequence,
      generatedAt,
      expiresAt,
      target,
      hostApiVersion: previousBom.hostApiVersion,
      publisher,
      keyId,
      components
    }, null, 2)}\n`);
    reports.push(await packageRelease({
      specPath,
      outputRoot,
      baseUrl,
      releasePrivateKey,
      keyring,
      trustedRoots: trustStore.roots,
      assetLayout: "flat",
      previousBom,
      previousSequence: catalog.payload.sequence
    }));
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    packaging: "app-only",
    rebuildComponentIds,
    targets: reports.map((report) => ({
      target: report.target,
      catalogPath: report.catalogPath,
      bomPath: report.bomPath
    }))
  }, null, 2)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`lyra-app-only-release: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
