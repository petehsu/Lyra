import { builtinModules, createRequire } from "node:module";
import { lstat, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_OUTPUT_BYTES = 96 * 1024 * 1024;
const MAX_OUTPUT_FILES = 2_000;

const REQUIRED_OUTPUT_FILES = [
  "main/index.cjs",
  "main/shared-process.cjs",
  "preload/browser-page-frame.cjs",
  "preload/index.cjs",
  "preload/third-party-app.cjs",
  "renderer/index.html"
] as const;

const REQUIRED_EXTRA_RESOURCES = [
  "aria2",
  "component-trust/trusted-keys.json",
  "download-manager",
  "icons/app",
  "legal/LYRA-LICENSE.txt",
  "legal/THIRD-PARTY-NOTICES.md",
  "location/read-macos-location.swift",
  "lsp",
  "native",
  "osint",
  "playwright-browsers"
] as const;

const OPTIONAL_DYNAMIC_EXTERNALS = new Set(["@opentelemetry/api"]);
const BUILTIN_MODULES = new Set(
  builtinModules.flatMap((specifier) => [
    specifier,
    specifier.startsWith("node:") ? specifier.slice("node:".length) : `node:${specifier}`
  ])
);

type AsarStat = {
  readonly size?: number;
  readonly files?: Readonly<Record<string, unknown>>;
  readonly link?: string;
};

type AsarApi = {
  readonly extractFile: (archive: string, filename: string) => Buffer;
  readonly listPackage: (archive: string) => string[];
  readonly statFile: (archive: string, filename: string, followLinks?: boolean) => AsarStat;
};

export type TreeMeasurement = {
  readonly bytes: number;
  readonly files: number;
};

export type CorePayloadReport = {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly output: TreeMeasurement & {
    readonly path: string;
    readonly requiredFiles: readonly string[];
    readonly optionalDynamicExternals: readonly string[];
  };
  readonly archive?: TreeMeasurement & {
    readonly path: string;
    readonly archiveBytes: number;
    readonly entries: number;
  };
  readonly extraResources?: Readonly<Record<string, TreeMeasurement>>;
};

const displayPath = (candidate: string, repositoryRoot: string): string => {
  const relative = path.relative(repositoryRoot, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : candidate;
};

const measureTree = async (
  candidate: string,
  options: { readonly allowSymbolicLinks?: boolean } = {}
): Promise<TreeMeasurement> => {
  const metadata = await stat(candidate);
  if (metadata.isFile()) {
    return { bytes: metadata.size, files: 1 };
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Core payload path is neither a regular file nor directory: ${candidate}`);
  }

  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(candidate, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      const absolute = path.join(candidate, entry.name);
      if (options.allowSymbolicLinks !== true) {
        throw new Error(`Core payload must not contain symbolic links: ${absolute}`);
      }
      const linkMetadata = await lstat(absolute);
      bytes += linkMetadata.size;
      files += 1;
      continue;
    }
    const measured = await measureTree(path.join(candidate, entry.name), options);
    bytes += measured.bytes;
    files += measured.files;
  }
  return { bytes, files };
};

const listRegularFiles = async (
  root: string,
  current = root
): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Core output must not contain symbolic links: ${absolute}`);
    }
    if (entry.isDirectory()) {
      result.push(...await listRegularFiles(root, absolute));
    } else if (entry.isFile()) {
      result.push(path.relative(root, absolute).split(path.sep).join("/"));
    } else {
      throw new Error(`Core output contains an unsupported filesystem entry: ${absolute}`);
    }
  }
  return result;
};

const isAllowedRuntimeSpecifier = (specifier: string): boolean => (
  specifier === "electron"
  || specifier.startsWith("./")
  || specifier.startsWith("../")
  || BUILTIN_MODULES.has(specifier)
);

const auditRuntimeImports = (
  source: string,
  filename: string,
  options: { readonly allowComputedDynamicImports?: boolean } = {}
): Set<string> => {
  const optionalExternals = new Set<string>();
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );

  const inspect = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined
      && ts.isStringLiteralLike(node.moduleSpecifier)
      && !isAllowedRuntimeSpecifier(node.moduleSpecifier.text)
    ) {
      throw new Error(
        `${filename} imports external runtime package ${node.moduleSpecifier.text}.`
      );
    }

    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
          throw new Error(`${filename} contains a non-literal require(), which cannot be verified.`);
        }
        const specifier = node.arguments[0].text;
        if (!isAllowedRuntimeSpecifier(specifier)) {
          throw new Error(`${filename} requires external runtime package ${specifier}.`);
        }
      }

      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length !== 1) {
          throw new Error(`${filename} contains an invalid dynamic import().`);
        }
        const argument = node.arguments[0];
        if (ts.isStringLiteralLike(argument)) {
          if (!isAllowedRuntimeSpecifier(argument.text)) {
            throw new Error(`${filename} imports external runtime package ${argument.text}.`);
          }
        } else if (ts.isIdentifier(argument)) {
          const declaration = sourceFile.statements.find((statement) => (
            ts.isVariableStatement(statement)
            && statement.declarationList.declarations.some((candidate) => (
              ts.isIdentifier(candidate.name)
              && candidate.name.text === argument.text
              && candidate.initializer !== undefined
              && ts.isStringLiteralLike(candidate.initializer)
              && OPTIONAL_DYNAMIC_EXTERNALS.has(candidate.initializer.text)
            ))
          ));
          const propertyAccess = node.parent;
          const isCaughtOptionalImport = declaration !== undefined
            && ts.isPropertyAccessExpression(propertyAccess)
            && propertyAccess.expression === node
            && propertyAccess.name.text === "catch"
            && ts.isCallExpression(propertyAccess.parent);
          if (!isCaughtOptionalImport && options.allowComputedDynamicImports !== true) {
            throw new Error(
              `${filename} contains an unverifiable non-literal dynamic import(${argument.text}).`
            );
          }
          if (!isCaughtOptionalImport) {
            ts.forEachChild(node, inspect);
            return;
          }
          const matchingDeclaration = declaration as ts.VariableStatement;
          const declared = matchingDeclaration.declarationList.declarations.find((candidate) => (
            ts.isIdentifier(candidate.name) && candidate.name.text === argument.text
          ));
          if (declared?.initializer === undefined || !ts.isStringLiteralLike(declared.initializer)) {
            throw new Error(`${filename} contains an invalid optional dynamic import.`);
          }
          optionalExternals.add(declared.initializer.text);
        } else if (options.allowComputedDynamicImports !== true) {
          throw new Error(`${filename} contains an unverifiable dynamic import().`);
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return optionalExternals;
};

const assertReleaseFileName = (relative: string): void => {
  const lower = relative.toLowerCase();
  if (
    lower.endsWith(".map")
    || lower.endsWith(".ts")
    || lower.endsWith(".tsx")
    || /(?:^|\/)(?:src|test|tests|__tests__)(?:\/|$)/u.test(lower)
    || /(?:^|\/)[^/]+\.(?:spec|test)\.[^/]+$/u.test(lower)
  ) {
    throw new Error(`Core payload contains source, test, or source-map material: ${relative}`);
  }
};

export const validateBuilderConfiguration = async (
  repositoryRoot: string
): Promise<void> => {
  const packagePath = path.join(repositoryRoot, "apps", "desktop", "package.json");
  const document = JSON.parse(await readFile(packagePath, "utf8")) as {
    readonly build?: {
      readonly files?: readonly unknown[];
    };
  };
  const files = document.build?.files;
  if (!Array.isArray(files) || files.some((entry) => typeof entry !== "string")) {
    throw new Error("Desktop electron-builder files must be an explicit string allowlist.");
  }
  const patterns = files as readonly string[];
  const positive = patterns.filter((entry) => !entry.startsWith("!"));
  if (
    positive.length !== 2
    || !positive.includes("out/**/*")
    || !positive.includes("package.json")
  ) {
    throw new Error("Desktop Core archive must allow only out/**/* and package.json.");
  }
  if (!patterns.includes("!node_modules{,/**/*}")) {
    throw new Error("Desktop Core archive must explicitly exclude node_modules.");
  }
};

export const checkBuiltCoreOutput = async (
  outputRoot: string
): Promise<TreeMeasurement & {
  readonly requiredFiles: readonly string[];
  readonly optionalDynamicExternals: readonly string[];
}> => {
  const files = await listRegularFiles(outputRoot);
  const fileSet = new Set(files);
  for (const required of REQUIRED_OUTPUT_FILES) {
    if (!fileSet.has(required)) {
      throw new Error(`Core output is missing required entry: ${required}`);
    }
  }
  if (files.length > MAX_OUTPUT_FILES) {
    throw new Error(`Core output contains ${files.length} files; limit is ${MAX_OUTPUT_FILES}.`);
  }

  const optionalDynamicExternals = new Set<string>();
  for (const relative of files) {
    assertReleaseFileName(relative);
    if (
      relative.endsWith(".cjs")
      || relative.endsWith(".js")
      || relative.endsWith(".mjs")
    ) {
      const source = await readFile(path.join(outputRoot, ...relative.split("/")), "utf8");
      for (
        const specifier of auditRuntimeImports(
          source,
          relative,
          { allowComputedDynamicImports: relative.startsWith("renderer/") }
        )
      ) {
        optionalDynamicExternals.add(specifier);
      }
      if (/\/\/[#@]\s*sourceMappingURL=/u.test(source)) {
        throw new Error(`Core output contains source-map metadata: ${relative}`);
      }
    }
  }

  const measured = await measureTree(outputRoot);
  if (measured.bytes > MAX_OUTPUT_BYTES) {
    throw new Error(`Core output is ${measured.bytes} bytes; limit is ${MAX_OUTPUT_BYTES}.`);
  }
  return {
    ...measured,
    requiredFiles: REQUIRED_OUTPUT_FILES,
    optionalDynamicExternals: [...optionalDynamicExternals].sort()
  };
};

const loadAsar = (repositoryRoot: string): AsarApi => {
  const desktopPackage = path.join(repositoryRoot, "apps", "desktop", "package.json");
  const requireFromDesktop = createRequire(desktopPackage);
  return requireFromDesktop("@electron/asar") as AsarApi;
};

const findFilesNamed = async (
  root: string,
  filename: string,
  depth = 0
): Promise<string[]> => {
  if (depth > 8) {
    return [];
  }
  const matches: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isFile() && entry.name === filename) {
      matches.push(absolute);
    } else if (entry.isDirectory()) {
      matches.push(...await findFilesNamed(absolute, filename, depth + 1));
    }
  }
  return matches;
};

export const locatePackagedAsar = async (distRoot: string): Promise<string> => {
  const matches = await findFilesNamed(distRoot, "app.asar");
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one packaged app.asar under ${distRoot}, found ${matches.length}.`
    );
  }
  return matches[0];
};

export const checkPackagedCoreArchive = async (
  archivePath: string,
  repositoryRoot: string,
  options: { readonly requireExtraResources?: boolean } = {}
): Promise<{
  readonly archive: TreeMeasurement & {
    readonly archiveBytes: number;
    readonly entries: number;
  };
  readonly extraResources: Readonly<Record<string, TreeMeasurement>>;
}> => {
  const archiveMetadata = await stat(archivePath);
  if (!archiveMetadata.isFile() || archiveMetadata.size === 0) {
    throw new Error(`Core app.asar is missing or empty: ${archivePath}`);
  }
  if (archiveMetadata.size > MAX_ARCHIVE_BYTES) {
    throw new Error(
      `Core app.asar is ${archiveMetadata.size} bytes; limit is ${MAX_ARCHIVE_BYTES}.`
    );
  }

  const asar = loadAsar(repositoryRoot);
  const entries = asar.listPackage(archivePath);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(
      `Core app.asar contains ${entries.length} entries; limit is ${MAX_ARCHIVE_ENTRIES}.`
    );
  }

  let payloadBytes = 0;
  let payloadFiles = 0;
  const archiveFiles = new Set<string>();
  for (const rawEntry of entries) {
    const relative = rawEntry.replace(/^\/+/u, "");
    if (relative === "") {
      continue;
    }
    const topLevel = relative.split("/")[0];
    if (topLevel !== "out" && topLevel !== "package.json") {
      throw new Error(`Core app.asar contains forbidden top-level entry: ${relative}`);
    }
    assertReleaseFileName(relative);
    const metadata = asar.statFile(archivePath, relative, false);
    if (metadata.link !== undefined) {
      throw new Error(`Core app.asar contains a symbolic link: ${relative}`);
    }
    if (typeof metadata.size === "number") {
      archiveFiles.add(relative);
      payloadBytes += metadata.size;
      payloadFiles += 1;
    }
  }
  for (const required of REQUIRED_OUTPUT_FILES) {
    const packagedPath = `out/${required}`;
    if (!archiveFiles.has(packagedPath)) {
      throw new Error(`Core app.asar is missing required entry: ${packagedPath}`);
    }
  }
  if (!archiveFiles.has("package.json")) {
    throw new Error("Core app.asar is missing package.json.");
  }

  const packageDocument = JSON.parse(
    asar.extractFile(archivePath, "package.json").toString("utf8")
  ) as {
    readonly name?: unknown;
    readonly main?: unknown;
    readonly dependencies?: unknown;
  };
  if (
    packageDocument.name !== "@lyra/desktop"
    || packageDocument.main !== "out/main/index.cjs"
  ) {
    throw new Error("Core app.asar package metadata has an invalid identity or entry point.");
  }
  if (
    packageDocument.dependencies !== undefined
    && (
      typeof packageDocument.dependencies !== "object"
      || packageDocument.dependencies === null
      || Array.isArray(packageDocument.dependencies)
    )
  ) {
    throw new Error("Core app.asar dependencies metadata must be an object when present.");
  }

  for (const relative of archiveFiles) {
    if (
      relative.endsWith(".cjs")
      || relative.endsWith(".js")
      || relative.endsWith(".mjs")
    ) {
      const source = asar.extractFile(archivePath, relative).toString("utf8");
      auditRuntimeImports(
        source,
        relative,
        { allowComputedDynamicImports: relative.startsWith("out/renderer/") }
      );
      if (/\/\/[#@]\s*sourceMappingURL=/u.test(source)) {
        throw new Error(`Core app.asar contains source-map metadata: ${relative}`);
      }
    }
  }

  const resourcesRoot = path.dirname(archivePath);
  const unpackedRoot = path.join(resourcesRoot, "app.asar.unpacked");
  try {
    const unpacked = await measureTree(unpackedRoot);
    if (unpacked.files !== 0 || unpacked.bytes !== 0) {
      throw new Error(
        `Core app.asar.unpacked must be empty, found ${unpacked.files} files (${unpacked.bytes} bytes).`
      );
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const extraResources: Record<string, TreeMeasurement> = {};
  if (options.requireExtraResources !== false) {
    for (const relative of REQUIRED_EXTRA_RESOURCES) {
      const measured = await measureTree(
        path.join(resourcesRoot, ...relative.split("/")),
        { allowSymbolicLinks: true }
      );
      if (measured.files === 0) {
        throw new Error(`Required Core extraResource is empty: ${relative}`);
      }
      extraResources[relative] = measured;
    }
  }

  return {
    archive: {
      archiveBytes: archiveMetadata.size,
      bytes: payloadBytes,
      entries: entries.length,
      files: payloadFiles
    },
    extraResources
  };
};

export const writeCorePayloadReport = async (
  reportPath: string,
  report: CorePayloadReport
): Promise<void> => {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
};

export const makeCorePayloadReport = (
  repositoryRoot: string,
  outputRoot: string,
  output: Awaited<ReturnType<typeof checkBuiltCoreOutput>>,
  archivePath?: string,
  packaged?: Awaited<ReturnType<typeof checkPackagedCoreArchive>>
): CorePayloadReport => ({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  output: {
    ...output,
    path: displayPath(outputRoot, repositoryRoot)
  },
  ...(archivePath !== undefined && packaged !== undefined
    ? {
        archive: {
          ...packaged.archive,
          path: displayPath(archivePath, repositoryRoot)
        },
        extraResources: packaged.extraResources
      }
    : {})
});
