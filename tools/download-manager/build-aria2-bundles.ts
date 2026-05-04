import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  cp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

type TargetConfig = {
  readonly id: string;
  readonly condaSubdir: string;
  readonly binary: string;
};

type CondaPackageRecord = {
  readonly name: string;
  readonly version: string;
  readonly build: string;
  readonly build_number?: number | undefined;
  readonly depends?: readonly string[] | undefined;
  readonly sha256?: string | undefined;
  readonly md5?: string | undefined;
  readonly timestamp?: number | undefined;
};

type CondaPackage = CondaPackageRecord & {
  readonly fileName: string;
  readonly archiveKind: "conda" | "tar-bz2";
};

type CondaRepodata = {
  readonly packages?: Record<string, CondaPackageRecord> | undefined;
  readonly "packages.conda"?: Record<string, CondaPackageRecord> | undefined;
};

type BundleFile = {
  readonly path: string;
  readonly sha256: string;
  readonly executable?: boolean;
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(currentDir, "../..");
const BUNDLES_ROOT = path.join(REPO_ROOT, "apps/desktop/resources/aria2");
const CONDA_FORGE_ROOT = "https://conda.anaconda.org/conda-forge";
const ARIA2_GITHUB_RELEASE = "release-1.37.0";
const ARIA2_GITHUB_VERSION = "1.37.0";
const ARIA2_WINDOWS_ASSET = "aria2-1.37.0-win-64bit-build1.zip";
const ROOT_PACKAGE = "aria2";

const TARGETS: Record<string, TargetConfig> = {
  "darwin-arm64": {
    id: "darwin-arm64",
    condaSubdir: "osx-arm64",
    binary: "bin/aria2c"
  },
  "darwin-x64": {
    id: "darwin-x64",
    condaSubdir: "osx-64",
    binary: "bin/aria2c"
  },
  "linux-arm64": {
    id: "linux-arm64",
    condaSubdir: "linux-aarch64",
    binary: "bin/aria2c"
  },
  "linux-x64": {
    id: "linux-x64",
    condaSubdir: "linux-64",
    binary: "bin/aria2c"
  },
  "win32-arm64": {
    id: "win32-arm64",
    condaSubdir: "win-arm64",
    binary: "Library/bin/aria2c.exe"
  },
  "win32-x64": {
    id: "win32-x64",
    condaSubdir: "win-64",
    binary: "Library/bin/aria2c.exe"
  }
};

const versionCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base"
});

const runProcess = async (
  command: string,
  args: readonly string[],
  options?: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
  }
): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutHandle = typeof options?.timeoutMs === "number" && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, options.timeoutMs)
      : null;
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      if (code === 0 && timedOut === false) {
        resolve();
        return;
      }
      reject(
        new Error(
          timedOut
            ? `${command} ${args.join(" ")} timed out`
            : `${command} ${args.join(" ")} failed (${code ?? "signal"})\n${stderr || stdout}`
        )
      );
    });
  });
};

const resolveCurrentTarget = (): TargetConfig => {
  const targetId = `${process.platform}-${process.arch}`;
  const target = TARGETS[targetId];
  if (target === undefined) {
    throw new Error(`unsupported current aria2 target ${targetId}`);
  }
  return target;
};

const parseTargets = (): readonly TargetConfig[] => {
  const args = process.argv.slice(2);
  if (args.includes("--all-targets")) {
    return Object.values(TARGETS);
  }
  const targetArg = args.find((arg) => arg.startsWith("--target="));
  if (targetArg === undefined) {
    return [resolveCurrentTarget()];
  }
  const ids = targetArg
    .slice("--target=".length)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (ids.length === 0) {
    throw new Error("--target cannot be empty");
  }
  return ids.map((id) => {
    const target = TARGETS[id];
    if (target === undefined) {
      throw new Error(`unknown aria2 target ${id}`);
    }
    return target;
  });
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (response.ok === false) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }
  return await response.json() as T;
};

const fetchFile = async (url: string, destination: string): Promise<void> => {
  const response = await fetch(url);
  if (response.ok === false) {
    throw new Error(`failed to download ${url}: ${response.status}`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
};

const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256").update(await readFile(filePath)).digest("hex");

const collectFiles = async (root: string, relativeRoot = ""): Promise<readonly string[]> => {
  const current = path.join(root, relativeRoot);
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(root, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
};

const findFileByBaseName = async (
  root: string,
  baseName: string
): Promise<string | null> => {
  const relativeFiles = await collectFiles(root);
  const match = relativeFiles.find((relativePath) => path.basename(relativePath).toLowerCase() === baseName);
  return match === undefined ? null : path.join(root, match);
};

const packageRecordsFromRepodata = (repodata: CondaRepodata): readonly CondaPackage[] =>
  [
    ...Object.entries(repodata["packages.conda"] ?? {})
      .filter(([fileName]) => fileName.endsWith(".conda"))
      .map(([fileName, record]) => ({
        ...record,
        fileName,
        archiveKind: "conda" as const
      })),
    ...Object.entries(repodata.packages ?? {})
      .filter(([fileName]) => fileName.endsWith(".tar.bz2"))
      .map(([fileName, record]) => ({
        ...record,
        fileName,
        archiveKind: "tar-bz2" as const
      }))
  ];

const comparePackages = (left: CondaPackage, right: CondaPackage): number => {
  const versionOrder = versionCollator.compare(left.version, right.version);
  if (versionOrder !== 0) {
    return versionOrder;
  }
  const buildNumberOrder = (left.build_number ?? 0) - (right.build_number ?? 0);
  if (buildNumberOrder !== 0) {
    return buildNumberOrder;
  }
  return (left.timestamp ?? 0) - (right.timestamp ?? 0);
};

const dependencyParts = (dependency: string): {
  readonly name: string;
  readonly constraint: string;
} | null => {
  const trimmed = dependency.trim();
  const name = trimmed.split(/\s+/u)[0]?.trim();
  if (name === undefined || name.length === 0 || name.startsWith("__")) {
    return null;
  }
  return {
    name,
    constraint: trimmed.slice(name.length).trim()
  };
};

const compareVersions = (left: string, right: string): number =>
  versionCollator.compare(left, right);

const versionMatchesWildcard = (version: string, pattern: string): boolean => {
  if (pattern.endsWith(".*") === false) {
    return version === pattern;
  }
  return version.startsWith(pattern.slice(0, -1));
};

const versionSatisfiesClause = (version: string, clause: string): boolean => {
  const trimmed = clause.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const match = /^(>=|<=|>|<|==|=)\s*([^\s,]+)$/u.exec(trimmed);
  if (match === null) {
    return true;
  }
  const [, operator, expected] = match;
  if (operator === "=" || operator === "==") {
    return versionMatchesWildcard(version, expected);
  }
  const order = compareVersions(version, expected);
  if (operator === ">=") {
    return order >= 0;
  }
  if (operator === ">") {
    return order > 0;
  }
  if (operator === "<=") {
    return order <= 0;
  }
  return order < 0;
};

const versionSatisfiesConstraint = (version: string, constraint: string): boolean => {
  if (constraint.length === 0) {
    return true;
  }
  return constraint
    .split(",")
    .every((clause) => versionSatisfiesClause(version, clause));
};

const selectLatestPackage = (
  packages: readonly CondaPackage[],
  packageName: string,
  constraints: readonly string[]
): CondaPackage => {
  const candidates = packages
    .filter((candidate) =>
      candidate.name === packageName
      && constraints.every((constraint) => versionSatisfiesConstraint(candidate.version, constraint))
    )
    .sort(comparePackages);
  const selected = candidates.at(-1);
  if (selected === undefined) {
    throw new Error(`conda-forge package not found: ${packageName} ${constraints.join(" ")}`);
  }
  return selected;
};

const resolvePackageSet = (
  packages: readonly CondaPackage[],
  rootPackageName: string
): readonly CondaPackage[] => {
  const resolved = new Map<string, CondaPackage>();
  const constraintsByName = new Map<string, string[]>();
  const visiting = new Set<string>();
  const visit = (packageName: string, constraint = ""): void => {
    if (constraint.length > 0) {
      constraintsByName.set(packageName, [
        ...(constraintsByName.get(packageName) ?? []),
        constraint
      ]);
    }
    if (resolved.has(packageName) || visiting.has(packageName)) {
      return;
    }
    visiting.add(packageName);
    const selected = selectLatestPackage(packages, packageName, constraintsByName.get(packageName) ?? []);
    resolved.set(packageName, selected);
    for (const dependency of selected.depends ?? []) {
      const dependencyPart = dependencyParts(dependency);
      if (dependencyPart !== null) {
        visit(dependencyPart.name, dependencyPart.constraint);
      }
    }
    visiting.delete(packageName);
  };
  visit(rootPackageName);
  return [...resolved.values()].sort((left, right) => left.name.localeCompare(right.name));
};

const materializePackage = async (
  target: TargetConfig,
  packageRecord: CondaPackage,
  targetRoot: string,
  tempRoot: string
): Promise<void> => {
  const packageUrl = `${CONDA_FORGE_ROOT}/${target.condaSubdir}/${packageRecord.fileName}`;
  const packagePath = path.join(tempRoot, packageRecord.fileName);
  await fetchFile(packageUrl, packagePath);
  if (packageRecord.sha256 !== undefined && await sha256File(packagePath) !== packageRecord.sha256) {
    throw new Error(`sha256 mismatch for ${packageRecord.fileName}`);
  }
  if (packageRecord.archiveKind === "tar-bz2") {
    await runProcess("tar", ["-xjf", packagePath, "-C", targetRoot], { timeoutMs: 120_000 });
    return;
  }

  const extractRoot = path.join(tempRoot, `${packageRecord.fileName}.extract`);
  await mkdir(extractRoot, { recursive: true });
  await runProcess("unzip", ["-q", packagePath, "-d", extractRoot], { timeoutMs: 120_000 });
  const archiveNames = await readdir(extractRoot);
  const packageArchive = archiveNames.find((fileName) => /^pkg-.+\.tar\.zst$/u.test(fileName));
  if (packageArchive === undefined) {
    throw new Error(`missing pkg tarball inside ${packageRecord.fileName}`);
  }
  const packageTarPath = path.join(extractRoot, "pkg.tar");
  await runProcess(
    "zstd",
    ["-d", path.join(extractRoot, packageArchive), "-o", packageTarPath],
    { timeoutMs: 120_000 }
  );
  await runProcess("tar", ["-xf", packageTarPath, "-C", targetRoot], { timeoutMs: 120_000 });
};

const normalizeRelativePath = (relativePath: string): string =>
  relativePath.split(path.sep).join("/");

const removeIfExists = async (filePath: string): Promise<void> => {
  await rm(filePath, { recursive: true, force: true });
};

const pruneRuntimeBundle = async (
  targetRoot: string,
  binaryRelativePath: string
): Promise<void> => {
  await Promise.all([
    removeIfExists(path.join(targetRoot, "include")),
    removeIfExists(path.join(targetRoot, "info")),
    removeIfExists(path.join(targetRoot, "man")),
    removeIfExists(path.join(targetRoot, "share"))
  ]);

  const binaryPath = path.join(targetRoot, binaryRelativePath);
  const binaryDir = path.dirname(binaryPath);
  try {
    const binaryDirEntries = await readdir(binaryDir, { withFileTypes: true });
    await Promise.all(binaryDirEntries.map(async (entry) => {
      const entryPath = path.join(binaryDir, entry.name);
      if (entryPath !== binaryPath) {
        await removeIfExists(entryPath);
      }
    }));
  } catch {
    // The binary directory will be validated after pruning.
  }

  const relativeFiles = await collectFiles(targetRoot);
  await Promise.all(relativeFiles
    .filter((relativePath) => {
      const normalized = normalizeRelativePath(relativePath);
      return normalized.endsWith(".a")
        || normalized.endsWith(".la")
        || normalized.includes("/pkgconfig/")
        || normalized.includes("/cmake/");
    })
    .map((relativePath) => removeIfExists(path.join(targetRoot, relativePath))));
};

const buildManifestFiles = async (targetRoot: string): Promise<readonly BundleFile[]> => {
  const relativeFiles = await collectFiles(targetRoot);
  const manifestFiles: BundleFile[] = [];
  for (const relativePath of relativeFiles) {
    if (normalizeRelativePath(relativePath) === "manifest.json") {
      continue;
    }
    const absolutePath = path.join(targetRoot, relativePath);
    const absoluteStat = await stat(absolutePath);
    manifestFiles.push({
      path: normalizeRelativePath(relativePath),
      sha256: await sha256File(absolutePath),
      ...(absoluteStat.mode & 0o111 ? { executable: true } : {})
    });
  }
  return manifestFiles;
};

const writeBundleManifest = async (
  targetRoot: string,
  manifest: {
    readonly bundleVersion: string;
    readonly target: string;
    readonly binary: string;
    readonly source: string;
    readonly packages: readonly string[];
  }
): Promise<void> => {
  await writeFile(
    path.join(targetRoot, "manifest.json"),
    `${JSON.stringify({
      ...manifest,
      files: await buildManifestFiles(targetRoot)
    }, null, 2)}\n`,
    "utf8"
  );
};

const buildCondaForgeBundle = async (
  target: TargetConfig,
  targetRoot: string,
  tempRoot: string
): Promise<void> => {
  const repodata = await fetchJson<CondaRepodata>(
    `${CONDA_FORGE_ROOT}/${target.condaSubdir}/repodata.json`
  );
  const packageSet = resolvePackageSet(packageRecordsFromRepodata(repodata), ROOT_PACKAGE);
  for (const packageRecord of packageSet) {
    await materializePackage(target, packageRecord, targetRoot, tempRoot);
  }
  await pruneRuntimeBundle(targetRoot, target.binary);
  const binaryPath = path.join(targetRoot, target.binary);
  await access(binaryPath, constants.F_OK);
  if (target.id.startsWith("win32-") === false) {
    await chmod(binaryPath, 0o755);
  }
  const aria2Package = packageSet.find((packageRecord) => packageRecord.name === ROOT_PACKAGE);
  await writeBundleManifest(targetRoot, {
    bundleVersion: `aria2-${aria2Package?.version ?? "unknown"}-conda-forge-${target.id}`,
    target: target.id,
    binary: target.binary,
    source: "conda-forge",
    packages: packageSet.map((packageRecord) => packageRecord.fileName)
  });
  process.stdout.write(`aria2 bundle created for ${target.id} (${packageSet.length} packages)\n`);
};

const buildOfficialWindowsBundle = async (
  target: TargetConfig,
  targetRoot: string,
  tempRoot: string
): Promise<void> => {
  const downloadPath = path.join(tempRoot, ARIA2_WINDOWS_ASSET);
  const extractedRoot = path.join(tempRoot, "official-windows");
  const assetUrl = `https://github.com/aria2/aria2/releases/download/${ARIA2_GITHUB_RELEASE}/${ARIA2_WINDOWS_ASSET}`;
  await mkdir(extractedRoot, { recursive: true });
  await fetchFile(assetUrl, downloadPath);
  await runProcess("unzip", ["-q", downloadPath, "-d", extractedRoot], { timeoutMs: 120_000 });
  const binaryPath = await findFileByBaseName(extractedRoot, "aria2c.exe");
  if (binaryPath === null) {
    throw new Error(`aria2c.exe not found in ${ARIA2_WINDOWS_ASSET}`);
  }
  await cp(path.dirname(binaryPath), targetRoot, {
    recursive: true,
    force: true,
    errorOnExist: false
  });
  await access(path.join(targetRoot, "aria2c.exe"), constants.F_OK);
  await writeBundleManifest(targetRoot, {
    bundleVersion: `aria2-${ARIA2_GITHUB_VERSION}-official-win64-${target.id}`,
    target: target.id,
    binary: "aria2c.exe",
    source: target.id === "win32-arm64"
      ? "github.com/aria2/aria2 win64 package via Windows ARM64 x64 emulation"
      : "github.com/aria2/aria2 win64 package",
    packages: [ARIA2_WINDOWS_ASSET]
  });
  process.stdout.write(`aria2 official Windows bundle created for ${target.id}\n`);
};

const buildTargetBundle = async (target: TargetConfig): Promise<void> => {
  const targetRoot = path.join(BUNDLES_ROOT, target.id);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lyra-aria2-build-"));
  try {
    await rm(targetRoot, { recursive: true, force: true });
    await mkdir(targetRoot, { recursive: true });
    try {
      await buildCondaForgeBundle(target, targetRoot, tempRoot);
    } catch (error) {
      if (target.id.startsWith("win32-")) {
        await rm(targetRoot, { recursive: true, force: true });
        await mkdir(targetRoot, { recursive: true });
        await buildOfficialWindowsBundle(target, targetRoot, tempRoot);
        return;
      }
      throw error;
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  const targets = parseTargets();
  for (const target of targets) {
    await buildTargetBundle(target);
  }
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[aria2 build] ${message}\n`);
  process.exitCode = 1;
});
