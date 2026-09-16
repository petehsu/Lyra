import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TARGETS = new Set([
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
]);

export type ElectronOnlineTarget =
  | "darwin-x64"
  | "darwin-arm64"
  | "windows-x64"
  | "windows-arm64"
  | "linux-x64"
  | "linux-arm64";

export type ElectronOnlinePlan = {
  readonly target: ElectronOnlineTarget;
  readonly unpackedCandidates: readonly string[];
  readonly builderArgs: readonly string[];
  readonly extension: "dmg" | "exe" | "AppImage";
  readonly os: "mac" | "win" | "linux";
  readonly arch: "x64" | "arm64";
};

// Electron first-run artifacts are the product shell. The 25 MiB gate stays on
// the rust Linux distro bootstrap in package-linux-formats.ts.
export const ELECTRON_ONLINE_HAS_SIZE_LIMIT = false;

export const resolveElectronOnlinePlan = (target: string): ElectronOnlinePlan => {
  if (!TARGETS.has(target)) {
    throw new Error(`Unsupported Electron installer target: ${target}`);
  }
  switch (target as ElectronOnlineTarget) {
    case "darwin-x64":
      return {
        target,
        unpackedCandidates: ["mac", "mac-x64"],
        builderArgs: ["--mac", "dmg"],
        extension: "dmg",
        os: "mac",
        arch: "x64"
      };
    case "darwin-arm64":
      return {
        target,
        unpackedCandidates: ["mac-arm64"],
        builderArgs: ["--mac", "dmg"],
        extension: "dmg",
        os: "mac",
        arch: "arm64"
      };
    case "windows-x64":
      return {
        target,
        unpackedCandidates: ["win-unpacked"],
        builderArgs: ["--win", "portable"],
        extension: "exe",
        os: "win",
        arch: "x64"
      };
    case "windows-arm64":
      return {
        target,
        unpackedCandidates: ["win-arm64-unpacked"],
        builderArgs: ["--win", "portable"],
        extension: "exe",
        os: "win",
        arch: "arm64"
      };
    case "linux-x64":
      return {
        target,
        unpackedCandidates: ["linux-unpacked"],
        builderArgs: ["--linux", "AppImage"],
        extension: "AppImage",
        os: "linux",
        arch: "x64"
      };
    case "linux-arm64":
      return {
        target,
        unpackedCandidates: ["linux-arm64-unpacked"],
        builderArgs: ["--linux", "AppImage"],
        extension: "AppImage",
        os: "linux",
        arch: "arm64"
      };
  }
};

export const resolveUnpackedAppDir = async (
  distRoot: string,
  plan: ElectronOnlinePlan
): Promise<string> => {
  const missing: string[] = [];
  for (const relative of plan.unpackedCandidates) {
    const candidate = path.join(distRoot, relative);
    try {
      if ((await stat(candidate)).isDirectory()) {
        return candidate;
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      missing.push(candidate);
    }
  }
  throw new Error(
    `Unpacked Electron app for ${plan.target} was not found. Tried: ${
      missing.length === 0 ? plan.unpackedCandidates.join(", ") : missing.join(", ")
    }`
  );
};

const argument = (name: string, required = true): string | undefined => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (required && (value === undefined || value.startsWith("--"))) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value === undefined || value.startsWith("--") ? undefined : value;
};

const run = async (
  command: string,
  args: readonly string[],
  cwd: string
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env: process.env,
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

const collectFiles = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(candidate));
      continue;
    }
    if (entry.isFile()) {
      files.push(candidate);
    }
  }
  return files;
};

export const selectElectronOnlineArtifact = async (
  distRoot: string,
  plan: ElectronOnlinePlan
): Promise<string> => {
  const suffix = `.${plan.extension}`;
  const files = (await collectFiles(distRoot)).filter((file) => {
    const name = path.basename(file);
    return name.endsWith(suffix)
      && name.endsWith(".blockmap") === false
      && name.includes("Offline") === false;
  });
  if (files.length === 0) {
    throw new Error(`No ${plan.extension} artifact found under ${distRoot}.`);
  }
  const ranked = await Promise.all(files.map(async (file) => ({
    file,
    size: (await stat(file)).size
  })));
  ranked.sort((left, right) => right.size - left.size);
  return ranked[0]!.file;
};

const main = async (): Promise<void> => {
  const distRoot = path.resolve(argument("--dist")!);
  const output = path.resolve(argument("--out")!);
  const plan = resolveElectronOnlinePlan(argument("--target")!);
  const expectedExtension = `.${plan.extension}`;
  if (!output.endsWith(expectedExtension)) {
    throw new Error(`Electron online installer output must end in ${expectedExtension}`);
  }
  if (!(await stat(distRoot)).isDirectory()) {
    throw new Error(`Electron dist is not a directory: ${distRoot}`);
  }
  const unpacked = await resolveUnpackedAppDir(distRoot, plan);
  await run("pnpm", [
    "--filter",
    "@lyra/desktop",
    "exec",
    "electron-builder",
    "--prepackaged",
    unpacked,
    ...plan.builderArgs,
    "--publish",
    "never"
  ], process.cwd());
  const artifact = await selectElectronOnlineArtifact(distRoot, plan);
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(artifact, output);
  const bytes = await readFile(output);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    kind: "electron-online",
    target: plan.target,
    path: output,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeLimited: ELECTRON_ONLINE_HAS_SIZE_LIMIT
  }, null, 2)}\n`);
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `lyra-electron-online-package: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
