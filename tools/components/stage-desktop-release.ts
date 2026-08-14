import {
  cp,
  lstat,
  mkdir,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { EN_US_DICTIONARY } from "../../apps/desktop/src/shared/i18n/en-US/index.ts";
import {
  NATIVE_CONTEXT_MENU_EN_US_TRANSLATIONS
} from "../../apps/desktop/src/shared/language-packs.ts";
import type { ComponentTargetV1 } from "../../packages/app-runtime/src/index.ts";

import { archiveDirectory, LYRA_DESKTOP_RELEASE_COMPONENTS_V1 } from "./release-package.ts";
import {
  FIRST_PARTY_APP_PACKAGES_V1,
  loadIndependentComponentVersions,
  requireIndependentComponentVersion
} from "./component-versions.ts";
import { FIRST_PARTY_APP_RELEASE_CONTRACTS_V1 } from "./first-party-app-release.ts";

const TARGETS = new Set<ComponentTargetV1>([
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
]);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const optionalArgument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
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

const requireFile = async (file: string, label: string): Promise<void> => {
  const metadata = await stat(file);
  if (!metadata.isFile()) throw new Error(`${label} is not a file: ${file}`);
};

const requireDirectory = async (directory: string, label: string): Promise<void> => {
  const metadata = await stat(directory);
  if (!metadata.isDirectory()) throw new Error(`${label} is not a directory: ${directory}`);
};

const copyDirectory = async (source: string, destination: string): Promise<void> => {
  await requireDirectory(source, "component source");
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    force: false
  });
};

const copyCoreDirectory = async (
  source: string,
  destination: string,
  target: ComponentTargetV1
): Promise<void> => {
  await requireDirectory(source, "Core payload");
  const resourceTarget = desktopResourceTarget(target);
  const runtimeName = target.startsWith("windows-") ? "lyrad.exe" : "lyrad";
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    force: false,
    filter: (candidate) => {
      const relative = path.relative(source, candidate);
      if (relative.length === 0 || relative.startsWith(`..${path.sep}`)) {
        return true;
      }
      const segments = relative.split(path.sep);
      const resourcesOffset =
        segments[0] === "Contents" && segments[1] === "Resources"
          ? 2
          : segments[0] === "resources"
            ? 1
            : -1;
      if (resourcesOffset < 0) {
        return true;
      }
      const resourceName = segments[resourcesOffset];
      if (
        resourceName === "aria2"
        || resourceName === "lsp"
        || resourceName === "playwright-browsers"
      ) {
        return false;
      }
      return !(
        resourceName === "native"
        && segments[resourcesOffset + 1] === resourceTarget
        && segments[resourcesOffset + 2] === runtimeName
      );
    }
  });
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

const desktopResourceTarget = (target: ComponentTargetV1): string =>
  target.startsWith("windows-") ? target.replace("windows-", "win32-") : target;

const resolveCoreDirectory = async (
  explicit: string | undefined,
  desktopDist: string | undefined,
  target: ComponentTargetV1
): Promise<string> => {
  if (explicit !== undefined) return path.resolve(explicit);
  if (desktopDist === undefined) {
    throw new Error("Use --core-dir or provide --desktop-dist for automatic Core discovery.");
  }
  const dist = path.resolve(desktopDist);
  const entries = await readdir(dist, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(dist, entry.name);
    if (target.startsWith("darwin-")) {
      const app = path.join(directory, "Lyra.app");
      if (await exists(app)) candidates.push(app);
    } else if (target.startsWith("windows-") && /win.*-unpacked$/u.test(entry.name)) {
      candidates.push(directory);
    } else if (target.startsWith("linux-") && /linux.*-unpacked$/u.test(entry.name)) {
      candidates.push(directory);
    }
  }
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one unpacked Core payload for ${target}, found ${candidates.length}.`);
  }
  return candidates[0]!;
};

const nativeMenuBundle = (): Record<string, string> => ({
  ...NATIVE_CONTEXT_MENU_EN_US_TRANSLATIONS
});

for (const [componentId, directory] of FIRST_PARTY_APP_RELEASE_CONTRACTS_V1) {
  if (FIRST_PARTY_APP_PACKAGES_V1[componentId] !== directory) {
    throw new Error(`First-party app version metadata is out of sync for ${componentId}.`);
  }
}

const main = async (): Promise<void> => {
  const repository = path.resolve(argument("--repo"));
  const output = path.resolve(argument("--out"));
  const coreDirectory = await resolveCoreDirectory(
    optionalArgument("--core-dir"),
    optionalArgument("--desktop-dist"),
    argument("--target") as ComponentTargetV1
  );
  const runtimeBinary = path.resolve(argument("--runtime-bin"));
  const target = argument("--target") as ComponentTargetV1;
  const releaseVersion = argument("--release-version");
  const channel = argument("--channel");
  const sequence = Number(argument("--sequence"));
  const generatedAt = argument("--generated-at");
  const expiresAt = argument("--expires-at");
  const publisher = argument("--publisher");
  const keyId = argument("--key-id");
  const baseUrl = argument("--base-url");
  if (!TARGETS.has(target)) throw new Error(`Unsupported component target: ${target}`);
  if (!SEMVER_PATTERN.test(releaseVersion)) throw new Error("Release version is not SemVer.");
  if (channel !== "stable" && channel !== "preview") throw new Error("Channel is invalid.");
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Sequence is invalid.");
  if (!baseUrl.startsWith("https://")) throw new Error("Base URL must use HTTPS.");
  if (await exists(output)) throw new Error(`Release staging output already exists: ${output}`);
  await requireDirectory(repository, "repository");
  await requireDirectory(coreDirectory, "Core payload");
  await requireFile(runtimeBinary, "Runtime binary");
  const independentVersions = await loadIndependentComponentVersions(repository);
  await mkdir(output, { recursive: true });
  const sources = path.join(output, "sources");
  await mkdir(sources);

  const coreSource = path.join(sources, "lyra.core");
  const coreWorking = path.join(output, ".core-working");
  await copyCoreDirectory(coreDirectory, coreWorking, target);
  const resourceRoots = [
    path.join(coreWorking, "Contents", "Resources"),
    path.join(coreWorking, "resources")
  ];
  const resourceTarget = desktopResourceTarget(target);
  for (const root of resourceRoots) {
    if (!(await exists(root))) continue;
    for (const modularResource of ["aria2", "lsp", "playwright-browsers"]) {
      await rm(path.join(root, modularResource), { recursive: true, force: true });
    }
    await rm(
      path.join(root, "native", resourceTarget, target.startsWith("windows-") ? "lyrad.exe" : "lyrad"),
      { force: true }
    );
  }
  await removePackagingNoise(coreWorking);
  await mkdir(coreSource);
  await archiveDirectory(coreWorking, path.join(coreSource, "payload.zip"));
  await writeFile(path.join(coreSource, "projection.json"), `${JSON.stringify({
    schemaVersion: 1,
    format: "zip",
    payload: "payload.zip",
    target
  }, null, 2)}\n`, "utf8");
  await rm(coreWorking, { recursive: true, force: true });

  const runtimeSource = path.join(sources, "lyra.runtime", "bin");
  await mkdir(runtimeSource, { recursive: true });
  const runtimeName = target.startsWith("windows-") ? "lyrad.exe" : "lyrad";
  await cp(runtimeBinary, path.join(runtimeSource, runtimeName), {
    errorOnExist: true,
    force: false
  });

  for (const [componentId, directory] of FIRST_PARTY_APP_RELEASE_CONTRACTS_V1) {
    const source = path.join(repository, "apps", directory, "dist");
    const destination = path.join(sources, componentId);
    await copyDirectory(source, destination);
    await removePackagingNoise(destination);
    await requireFile(path.join(destination, "index.mjs"), `${componentId} entry`);
  }

  for (const [componentId, locale, dictionary] of [
    ["lyra.language.en-us", "en-US", EN_US_DICTIONARY]
  ] as const) {
    const destination = path.join(sources, componentId);
    await mkdir(destination);
    await writeFile(path.join(destination, "bundle.json"), `${JSON.stringify({
      ...dictionary,
      ...nativeMenuBundle()
    }, null, 2)}\n`, "utf8");
    await writeFile(path.join(destination, "resource.json"), `${JSON.stringify({
      schemaVersion: 1,
      locale,
      version: requireIndependentComponentVersion(independentVersions, componentId)
    }, null, 2)}\n`, "utf8");
  }

  await copyDirectory(
    path.join(repository, "components", "first-party", "uiux-classic"),
    path.join(sources, "lyra.uiux.classic")
  );

  const rustAnalyzerSource = path.join(sources, "lyra.resource.rust-analyzer");
  await copyDirectory(
    path.join(repository, "apps", "desktop", "resources", "lsp", resourceTarget),
    rustAnalyzerSource
  );
  await cp(
    path.join(repository, "apps", "desktop", "resources", "lsp", "manifest-rust-analyzer.json"),
    path.join(rustAnalyzerSource, "resource.json"),
    { errorOnExist: true, force: false }
  );

  await copyDirectory(
    path.join(repository, "apps", "desktop", "resources", "aria2", resourceTarget),
    path.join(sources, "lyra.resource.aria2")
  );

  const playwrightSource = path.join(sources, "lyra.resource.playwright");
  await copyDirectory(
    path.join(repository, "apps", "desktop", "resources", "playwright-browsers"),
    playwrightSource
  );
  await writeFile(path.join(playwrightSource, "resource.json"), `${JSON.stringify({
    schemaVersion: 1,
    family: "playwright",
    target,
    version: requireIndependentComponentVersion(
      independentVersions,
      "lyra.resource.playwright"
    )
  }, null, 2)}\n`, "utf8");
  await removePackagingNoise(sources);

  const specs = new Map<string, {
    readonly version: string;
    readonly entry?: string;
    readonly permissions: readonly string[];
    readonly hostApiRange?: { readonly minInclusive: string; readonly maxExclusive: string };
    readonly runtimeProtocolRange?: { readonly min: number; readonly max: number };
    readonly executionClass?: "first-party-shared-renderer";
  }>();
  specs.set("lyra.core", {
    version: requireIndependentComponentVersion(independentVersions, "lyra.core"),
    entry: "projection.json",
    permissions: ["system:desktop-host"]
  });
  specs.set("lyra.runtime", {
    version: requireIndependentComponentVersion(independentVersions, "lyra.runtime"),
    entry: `bin/${runtimeName}`,
    permissions: ["runtime:agent", "runtime:terminal", "runtime:downloads", "runtime:lsp"],
    runtimeProtocolRange: { min: 2, max: 2 }
  });
  for (const [componentId, _directory, permissions] of FIRST_PARTY_APP_RELEASE_CONTRACTS_V1) {
    specs.set(componentId, {
      version: requireIndependentComponentVersion(independentVersions, componentId),
      entry: "index.mjs",
      permissions,
      hostApiRange: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
      executionClass: "first-party-shared-renderer"
    });
  }
  specs.set("lyra.language.en-us", {
    version: requireIndependentComponentVersion(independentVersions, "lyra.language.en-us"),
    entry: "bundle.json",
    permissions: []
  });
  specs.set("lyra.uiux.classic", {
    version: requireIndependentComponentVersion(independentVersions, "lyra.uiux.classic"),
    entry: "index.mjs",
    permissions: ["desktop-api"]
  });
  specs.set("lyra.resource.rust-analyzer", {
    version: requireIndependentComponentVersion(
      independentVersions,
      "lyra.resource.rust-analyzer"
    ),
    entry: target.startsWith("windows-") ? "rust-analyzer.exe" : "rust-analyzer",
    permissions: ["process:spawn"]
  });
  specs.set("lyra.resource.aria2", {
    version: requireIndependentComponentVersion(independentVersions, "lyra.resource.aria2"),
    entry: "manifest.json",
    permissions: ["process:spawn", "network:download"]
  });
  specs.set("lyra.resource.playwright", {
    version: requireIndependentComponentVersion(
      independentVersions,
      "lyra.resource.playwright"
    ),
    entry: "resource.json",
    permissions: ["process:spawn", "browser:automation"]
  });

  const components = Object.entries(LYRA_DESKTOP_RELEASE_COMPONENTS_V1).map(
    ([componentId, definition]) => {
      const detail = specs.get(componentId);
      if (detail === undefined) throw new Error(`No staged release metadata for ${componentId}.`);
      return {
        componentId,
        kind: definition.kind,
        version: detail.version,
        sourceDirectory: `./sources/${componentId}`,
        ...(detail.entry === undefined ? {} : { entry: detail.entry }),
        ...(detail.executionClass === undefined ? {} : { executionClass: detail.executionClass }),
        activation: definition.activation,
        delivery: definition.delivery,
        ...(detail.hostApiRange === undefined ? {} : { hostApiRange: detail.hostApiRange }),
        ...(detail.runtimeProtocolRange === undefined
          ? {}
          : { runtimeProtocolRange: detail.runtimeProtocolRange }),
        dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
        permissions: detail.permissions
      };
    }
  );
  const specPath = path.join(output, "release-spec.v1.json");
  await writeFile(specPath, `${JSON.stringify({
    schemaVersion: 1,
    releaseVersion,
    channel,
    sequence,
    generatedAt,
    expiresAt,
    target,
    hostApiVersion: "1.0.0",
    publisher,
    keyId,
    components
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    target,
    specPath,
    sourcesRoot: sources,
    componentCount: components.length,
    baseUrl
  }, null, 2)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`lyra-release-stage: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
